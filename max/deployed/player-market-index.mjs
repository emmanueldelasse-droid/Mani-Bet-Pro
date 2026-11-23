// The game page identifies profiles with a published Points threshold. It does not name
// the sportsbook or give a price for that threshold. Prices still require the profile.
const origin='https://linesmart.app';
const maxBytes=128*1024;
const newYork=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const slug=name=>String(name??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const teamSlug=name=>slug(name)==='la-clippers'?'los-angeles-clippers':slug(name);
const aliases={GS:'GSW',NY:'NYK',NO:'NOP',SA:'SAS',UTAH:'UTA',WSH:'WAS',PHO:'PHX',BKN:'BKN'};
const abbr=text=>aliases[text]??text;
const single=list=>list.length===1?list[0]:null;
function plain(value){
  return value.replace(/<[^>]*>/g,'').replace(/&(?:#x([\da-f]+)|#(\d+)|apos|quot|amp|nbsp);/gi,(s,hex,dec)=>{
    if(hex||dec){const code=parseInt(hex??dec,hex?16:10);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}
    return ({'&apos;':"'",'&quot;':'"','&amp;':'&','&nbsp;':' '})[s.toLowerCase()]??'';
  }).trim();
}
export function playerMarketIndexUrl(game){
  if(!Number.isFinite(Date.parse(game?.start))||!game?.home?.id||!game?.away?.id||game.home.id===game.away.id)return null;
  const away=teamSlug(game.away.name),home=teamSlug(game.home.name);
  if(!away||!home||away===home)return null;
  const d=Object.fromEntries(newYork.formatToParts(new Date(game.start)).map(t=>[t.type,t.value]));
  return origin+'/nba/games/'+away+'-at-'+home+'-'+d.year+'-'+d.month+'-'+d.day+'/';
}
function empty(source_url,observed_at,reason){
  return {status:'UNAVAILABLE',scope:'LISTED_POINTS_ONLY',source_url,observed_at,reason,http_status:null,retry_after:null,bytes:0,
    examined_rows:0,listed_players:0,reported_players:null,all_reported_players_scanned:false,all_reported_players_have_points_lines:false,players:[],rejected_rows:0};
}
function knownPlayers(game){
  const map=new Map();
  const groups=game.study?.pair?.primary?.player_points??game.independent_analysis?.advanced?.player_points;
  for(const side of ['away','home'])for(const player of groups?.[side]?.players??[]){
    if(!/^\d{1,16}$/.test(String(player?.id))||!player.name||
       (player.team_id!=null&&String(player.team_id)!==String(game[side].id)))continue;
    const key=slug(player.name),rows=map.get(key)??[];
    rows.push({...player,id:String(player.id),team_id:String(game[side].id),team_abbreviation:game[side].abbreviation});
    map.set(key,rows);
  }
  return map;
}
export function parsePlayerMarketIndex(html,game,observedAt){
  const source=playerMarketIndexUrl(game);
  const result=empty(source,observedAt,'MATCH_OR_DOCUMENT_UNVERIFIED');
  const at=Date.parse(observedAt),tip=Date.parse(game?.start);
  if(!source||game.status!=='STATUS_SCHEDULED'||!Number.isFinite(at)||at>=tip||typeof html!=='string'||html.length>maxBytes)return result;
  const pages=[];
  for(const script of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)){
    try{const data=JSON.parse(script[1]);if(data['@type']==='ItemPage')pages.push(data);}catch{return result;}
  }
  const page=single(pages),teams=page?.about;
  if(page?.url!==source||Date.parse(String(page.temporalCoverage).split('/')[0])!==tip||!Array.isArray(teams)||teams.length!==2||
      !teams.every((t,i)=>t?.['@type']==='SportsTeam'&&t.sport==='Basketball'&&
        teamSlug(t.name)===teamSlug(game[i===0?'away':'home'].name)))return result;
  const section=single([...html.matchAll(/<section\b(?=[^>]*\bid="props-s")[^>]*>([\s\S]*?)<\/section>/gi)])?.[1];
  if(!section)return result;
  const table=single([...section.matchAll(/<table\b(?=[^>]*class="[^"]*\bsx-props\b)[^>]*>([\s\S]*?)<\/table>/gi)])?.[1];
  if(!table)return result;
  const columns=[...(table.match(/<thead>([\s\S]*?)<\/thead>/i)?.[1]??'').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(c=>plain(c[1]));
  if(columns.slice(0,3).join('|')!=='Player|Market|Line')return result;
  const body=single([...table.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)])?.[1];
  if(!body)return result;
  const roster=knownPlayers(game),listed=new Set(),offers=new Map(),profiles=new Set(),conflicts=new Set();
  for(const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    result.examined_rows++;
    const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>c[1]);
    const anchor=single([...(cells[0]??'').matchAll(/<a\s+href="(nba\/props\/([a-z0-9-]+)\/)">([^<]+)<\/a>/gi)]);
    if(!anchor||slug(plain(anchor[3]))!==anchor[2]){result.rejected_rows++;continue;}
    const key=anchor[2];profiles.add(key);
    if(plain(cells[1]??'')!=='Points')continue;
    const line=plain(cells[2]??'').match(/^O\/U (\d+(?:\.5)?)$/);
    if(!line||Number(line[1])<=0){result.rejected_rows++;continue;}
    listed.add(key);
    const player=single(roster.get(key)??[]),team=plain((cells[0].match(/<span class="na">([^<]+)<\/span>/)?.[1]??'')).split(/\s+/)[0];
    if(!player||!team||!player.team_abbreviation||abbr(team)!==abbr(player.team_abbreviation)){
      result.rejected_rows++;continue;
    }
    const prior=offers.get(key);
    if(prior&&prior.index_line!==Number(line[1])){conflicts.add(key);result.rejected_rows++;continue;}
    offers.set(key,{...player,profile_url:origin+'/'+anchor[1],index_line:Number(line[1])});
  }
  for(const key of conflicts)offers.delete(key);
  const report=section.match(/\b\d+ prop lines? across (\d+) players?\b/i);
  const reported_players=report?Number(report[1]):null;
  const complete=reported_players!==null&&profiles.size===reported_players;
  return {...result,status:'INDEXED',reason:null,reported_players,listed_players:listed.size,
    all_reported_players_scanned:complete,all_reported_players_have_points_lines:complete&&listed.size===profiles.size,
    players:[...offers.values()]};
}

export async function fetchPlayerMarketIndex(game,{fetcher=fetch,clock=Date.now}={}){
  const source=playerMarketIndexUrl(game),started=new Date(clock()).toISOString();
  const result=empty(source,started,'MATCH_OUTSIDE_WINDOW');
  if(!source||game?.status!=='STATUS_SCHEDULED'||Date.parse(started)>=Date.parse(game.start))return result;
  const signal=AbortSignal.timeout(8000);
  try{
    const response=await fetcher(source,{headers:{Accept:'text/html'},redirect:'manual',signal});
    const observed=new Date(clock()).toISOString();
    result.observed_at=observed;result.http_status=response.status;result.retry_after=response.headers.get('Retry-After');
    if(!response.ok){result.reason='HTTP_'+response.status;return result;}
    if((response.url&&response.url!==source)||!/^text\/html(?:\s*;|$)/i.test(response.headers.get('Content-Type')??'')){
      result.reason='UNEXPECTED_DOCUMENT';return result;
    }
    if(Number(response.headers.get('Content-Length'))>maxBytes){result.reason='INDEX_TOO_LARGE';await response.body?.cancel();return result;}
    const reader=response.body?.getReader();if(!reader){result.reason='EMPTY_BODY';return result;}
    let bytes=0,html='';const decoder=new TextDecoder();
    while(true){
      const {value,done}=await reader.read();if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes){await reader.cancel();return {...result,bytes,reason:'INDEX_TOO_LARGE'};}
      html+=decoder.decode(value,{stream:true});
    }
    html+=decoder.decode();
    return {...parsePlayerMarketIndex(html,game,new Date(clock()).toISOString()),bytes,http_status:response.status,retry_after:null};
  }catch{return {...result,reason:'INDEX_FETCH_FAILED'};}
}
export {fetchPlayerMarketIndex as readListedOddsPlayers};
