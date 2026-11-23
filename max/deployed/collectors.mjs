import {pdfPages} from './pdf-driver.mjs';
export const COLLECTOR_VERSION='max-public-collectors-0.1.0';
const ESPN='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const officialHost='https://ak-static.cms.nba.com/referee/injury/';
const normalize=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const alias=s=>({UTAH:'UTA',NO:'NOP',GS:'GSW',SA:'SAS',NY:'NYK',WSH:'WAS',PHO:'PHX'}[s]??s);
const nyParts=at=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',
 year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
 .formatToParts(new Date(at)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
export function reportTimestamp(url){
 const m=String(url).match(/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf$/);
 if(!m)return null;
 const [,y,month,day,hour,minute,ap]=m,h=Number(hour)%12+(ap==='PM'?12:0);
 if(Number(hour)<1||Number(hour)>12||Number(minute)>59)return null;
 const guess=Date.UTC(+y,+month-1,+day,h,+minute),p=nyParts(guess);
 const offset=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute)-guess;
 const result=guess-offset,actual=nyParts(result);
 return actual.year===y&&actual.month===month&&actual.day===day?new Date(result).toISOString():null;
}
export function latestOfficialURL(html,nowISO){
 const now=Date.parse(nowISO);
 return [...new Set(String(html).match(/https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\/Injury-Report_\d{4}-\d{2}-\d{2}_\d{2}_\d{2}(?:AM|PM)\.pdf/g)??[])]
  .map(url=>({url,published_at:reportTimestamp(url)}))
  .filter(x=>Number.isFinite(Date.parse(x.published_at))&&Date.parse(x.published_at)<=now&&now-Date.parse(x.published_at)<=12*3600000)
  .sort((a,b)=>b.published_at.localeCompare(a.published_at))[0]??null;
}
function groupedLines(page){
 const rows=[];
 for(const item of page.items.filter(x=>x.text.trim()).sort((a,b)=>a.top-b.top||a.x-b.x)){
  let row=rows.find(r=>Math.abs(r.top-item.top)<2);
  if(!row){row={top:item.top,items:[]};rows.push(row);}row.items.push(item);
 }
 return rows.sort((a,b)=>a.top-b.top).map(r=>({...r,items:r.items.sort((a,b)=>a.x-b.x)}));
}
export function parseOfficialPages(pages,document){
 if(!Array.isArray(pages)||!pages.length||!reportTimestamp(document.url))throw Error('OFFICIAL_DOCUMENT_INVALID');
 const table=new Map();let date=null,clock=null,matchup=null,team=null,columns=null,players=0;
 const header=pages[0].items.map(x=>x.text).join('').replace(/\s/g,'');
 const urlDate=document.url.match(/_(\d{4})-(\d{2})-(\d{2})_/);
 if(!header.includes('InjuryReport:')||!header.includes(urlDate[2]+'/'+urlDate[3]+'/'+urlDate[1].slice(2)))
  throw Error('OFFICIAL_HEADER_MISMATCH');
 const headings=groupedLines(pages[0]).find(r=>{
  const s=normalize(r.items.map(x=>x.text).join(''));return s.includes('gamedate')&&s.includes('matchup')&&s.includes('reason');
 });
 if(!headings)throw Error('OFFICIAL_HEADINGS_MISSING');
 for(const page of pages){
  const names=headings.items.map(x=>({...x,x:x.x*page.width/pages[0].width}));
  const col=(value,fallback)=>names.find(x=>normalize(x.text)===value)?.x??fallback;
  columns={date:0,time:col('gametime',page.width*.14),match:col('matchup',page.width*.235),
   team:col('team',page.width*.313),player:col('player',col('playername',page.width*.505)),
   status:col('current',col('currentstatus',page.width*.695)),reason:col('reason',page.width*.792)};
  if(!(columns.team<columns.player&&columns.player<columns.status&&columns.status<columns.reason))throw Error('OFFICIAL_COLUMNS_INVALID');
  const text=(row,a,b)=>row.items.filter(x=>x.x>=a-2&&x.x<b-2).map(x=>x.text).join(' ').trim();
  for(const row of groupedLines(page)){
   const all=row.items.map(x=>x.text).join('');
   if(/InjuryReport:|Page\s*\d+of|GameDate/i.test(all.replace(/\s/g,'')))continue;
   const d=text(row,0,columns.time).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
   if(d)date=d[3]+'-'+d[1]+'-'+d[2];
   const time=text(row,columns.time,columns.match).replace(/\s/g,'').match(/^(\d{2}:\d{2})\(ET\)$/);
   if(time)clock=time[1];
   const m=text(row,columns.match,columns.team).replace(/\s/g,'').match(/^[A-Z]{2,4}@[A-Z]{2,4}$/);
   if(m){matchup=m[0];team=null;}
   if(!date||!clock||!matchup)continue;
   const key=date+'|'+matchup+'|'+clock;
   if(!table.has(key))table.set(key,{date,matchup,clock,teams:{}});
   const current=table.get(key);
   const t=text(row,columns.team,columns.player);
   if(t){team=t;current.teams[team]??={status:'UNKNOWN',players:[]};}
   if(!team)continue;
   const line=current.teams[team];
   if(/NOT\s*YET\s*SUBMITTED/i.test(all)){line.status='NOT_YET_SUBMITTED';continue;}
   const player=text(row,columns.player,columns.status),status=text(row,columns.status,columns.reason).toUpperCase();
   if(!player.includes(',')||!['OUT','QUESTIONABLE','DOUBTFUL','PROBABLE','AVAILABLE','LIMITED'].includes(status))continue;
   const [last,...first]=player.split(',');const name=first.join(',').trim()+' '+last.trim();
   if(!name.trim()||line.status==='NOT_YET_SUBMITTED')throw Error('OFFICIAL_ROW_CONFLICT');
   line.status='SUBMITTED';line.players.push({player:name.trim(),status,
    note:text(row,columns.reason,page.width+5).slice(0,200)});players++;
  }
 }
 if(!table.size||!players)throw Error('OFFICIAL_NO_VERIFIED_ROWS');
 return {schema_version:'max-official-table-v1',...document,matches:[...table.values()],players};
}
export function officialForGame(table,game,nowISO){
 const at=Date.parse(nowISO),published=Date.parse(table?.published_at),checked=Date.parse(table?.checked_at);
 if(!Number.isFinite(at)||!Number.isFinite(published)||!Number.isFinite(checked)||published>at||checked>at||at-published>12*3600000||at-checked>12*3600000)return null;
 const p=nyParts(game.start),date=p.year+'-'+p.month+'-'+p.day;
 const clock=String(Number(p.hour)%12||12).padStart(2,'0')+':'+p.minute;
 const match=alias(game.away.abbreviation)+'@'+alias(game.home.abbreviation);
 const entries=table.matches.filter(x=>x.date===date&&x.clock===clock&&x.matchup===match);
 if(entries.length!==1)return null;
 const row=entries[0],teams={};
 for(const side of ['home','away']){
  const t=game[side];const aliases=new Set([normalize(t.name),normalize(t.name.replace('Los Angeles Clippers','LA Clippers'))]);
  const found=Object.entries(row.teams).filter(([name])=>aliases.has(normalize(name)));
  if(found.length>1)return null;
  const data=found[0]?.[1];
  teams[side]={team_id:String(t.id),status:data?.status??'MISSING_FROM_DOCUMENT',
   players:(data?.players??[]).map(x=>({...x,match_id:String(game.id),event_start:game.start,
    team_id:String(t.id),source_url:table.url,published_at:table.published_at,checked_at:table.checked_at}))};
 }
 return {schema_version:'max-official-medical-v1',match_id:String(game.id),event_start:game.start,
  source_url:table.url,published_at:table.published_at,checked_at:table.checked_at,teams};
}
export async function collectOfficial(fetcher,nowISO){
 const now=new Date(nowISO),startYear=now.getUTCMonth()>=6?now.getUTCFullYear():now.getUTCFullYear()-1;
 const index='https://official.nba.com/nba-injury-report-'+startYear+'-'+String(startYear+1).slice(2)+'-season/';
 const options={signal:AbortSignal.timeout(15000)};
 const page=await fetcher(index,options);if(!page.ok)throw Error('OFFICIAL_INDEX_HTTP_'+page.status);
 const latest=latestOfficialURL(await page.text(),nowISO);if(!latest)throw Error('OFFICIAL_RECENT_DOCUMENT_MISSING');
 const response=await fetcher(latest.url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('OFFICIAL_PDF_HTTP_'+response.status);
 if(Number(response.headers?.get('content-length'))>3000000)throw Error('PDF_SIZE_LIMIT');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(new TextDecoder().decode(bytes.subarray(0,4))!=='%PDF')throw Error('OFFICIAL_NOT_PDF');
 return parseOfficialPages(await pdfPages(bytes),{...latest,index_url:index,checked_at:nowISO});
}
export function parseRoster(data,id,checked_at){
 const rows=[];
 function visit(node,depth=0){if(depth>4||!node||typeof node!=='object')return;
  if(node.id&&node.displayName&&node.position){rows.push({id:String(node.id),name:node.displayName,
   position:node.position.abbreviation??node.position.name??null,jersey:node.jersey??null});return;}
  for(const key of ['athletes','items','athlete']){const v=node[key];if(Array.isArray(v))v.forEach(x=>visit(x,depth+1));else visit(v,depth+1);}}
 visit(data);const unique=[...new Map(rows.map(x=>[x.id,x])).values()];
 if(unique.length<5||unique.length>35||(data.team?.id&&String(data.team.id)!==String(id)))return null;
 return {schema_version:'max-roster-v1',team_id:String(id),checked_at,players:unique,
  source_url:ESPN+'/teams/'+id+'/roster',source:'ESPN current team roster'};
}
export async function collectRosters(kv,fetcher,games,nowISO){
 const ids=[...new Set(games.filter(g=>g.status==='STATUS_SCHEDULED'&&Date.parse(g.start)>Date.parse(nowISO))
  .flatMap(g=>[String(g.home.id),String(g.away.id)]))];
 const map=new Map();let fetched=0,failed=0;
 for(const id of ids){
  const old=await kv.get('max:roster:'+id,{type:'json'});
  const age=Date.parse(nowISO)-Date.parse(old?.checked_at??'');
  if(old?.team_id===id&&Array.isArray(old.players)&&age>=0&&age<=36*3600000)map.set(id,old);
  if(old&&age>=0&&age<24*3600000)continue;
  if(fetched+failed>=8)continue;
  try{const r=await fetcher(ESPN+'/teams/'+id+'/roster',{signal:AbortSignal.timeout(10000)});
   if(!r.ok)throw Error('ROSTER_HTTP');const roster=parseRoster(await r.json(),id,nowISO);
   if(!roster)throw Error('ROSTER_INVALID');map.set(id,roster);fetched++;
   await kv.put('max:roster:'+id,JSON.stringify(roster),{expirationTtl:7*86400});
  }catch{failed++;}
 }
 return {rosters:map,state:ids.length===map.size?'OK':map.size?'PARTIAL':'UNAVAILABLE',
  requested:ids.length,available:map.size,fetched,failed};
}
export function rosterFilteredBoxes(boxes,rosters){
 return boxes.map(box=>({...box,teams:Object.fromEntries(Object.entries(box.teams??{}).map(([id,t])=>{
  const roster=rosters.get(String(id)),allowed=roster?new Set(roster.players.map(p=>p.id)):null;
  return [id,{...t,players:allowed?(t.players??[]).filter(p=>allowed.has(String(p.id))):t.players}];
 }))}));
}
