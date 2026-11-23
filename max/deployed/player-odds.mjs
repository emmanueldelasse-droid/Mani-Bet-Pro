// LineSmart displays both sides from one named sportsbook on the public player profile.
// Its game summary only lists thresholds, so it cannot be used to invent prices.
const origin='https://linesmart.app';
const rules='https://boothillcasino.com/wp-content/uploads/2026/10/KS-DKE-House-Rules-v13.0-EN-CLEAN-9.2.26.pdf';
const maxBytes=160000;
const sideNames=['away','home'];
const numberId=id=>/^\d{1,16}$/.test(String(id??''));
const slug=s=>String(s??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const slugTeam=s=>slug(s)==='la-clippers'?'los-angeles-clippers':slug(s);
const iso=value=>new Date(value).toISOString();
const ny=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
const month='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const localParts=ms=>Object.fromEntries(ny.formatToParts(ms).map(p=>[p.type,p.value]));
function localStamp(ms){
  const t=localParts(ms);
  return t.weekday+', '+t.month+' '+t.day+', '+t.year+' · '+t.hour+':'+t.minute+' '+t.dayPeriod+' ET';
}
function sourceInstant(stamp){
  const p=stamp.match(/^\w{3}, (\w{3}) (\d{1,2}), (\d{4}) · (\d{1,2}):(\d{2}) (AM|PM) ET$/);
  if(!p||!month.includes(p[1]))return null;
  const noon=Date.UTC(+p[3],month.indexOf(p[1]),+p[2],+p[4]%12+(p[6]==='PM'?12:0),+p[5]);
  const answers=[4,5].map(offset=>noon+offset*3600000).filter(candidate=>localStamp(candidate)===stamp);
  return answers.length===1?iso(answers[0]):null;
}
const text=html=>html.replace(/<!--[\s\S]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;|\s+/g,' ').replace(/&amp;/g,'&').trim();
function linkFor(game){
  const t=localParts(Date.parse(game.start));
  const date=t.year+'-'+String(month.indexOf(t.month)+1).padStart(2,'0')+'-'+t.day.padStart(2,'0');
  return 'nba/games/'+slugTeam(game.away.name)+'-at-'+slugTeam(game.home.name)+'-'+date+'/';
}
function pastablePlayer(game,player){
  if(game?.status!=='STATUS_SCHEDULED'||!numberId(game.id)||!numberId(game.home?.id)||!numberId(game.away?.id)||
     String(game.home.id)===String(game.away.id)||!Number.isFinite(Date.parse(game.start))||!player?.name||!numberId(player.id))return false;
  return sideNames.some(side=>String(game[side].id)===String(player.team_id));
}
function projectedRoster(game){
  const available=game?.study?.pair?.primary?.player_points??game?.independent_analysis?.advanced?.player_points;
  return sideNames.flatMap(side=>(available?.[side]?.players??[]).filter(p=>p.team_id==null||String(p.team_id)===String(game[side].id))
    .map(p=>({...p,team_id:String(game[side].id)})));
}
function american(value){
  if(!/^[+-]\d{3,5}$/.test(value))return null;
  const price=Number(value);
  return Math.abs(price)>=100?price:null;
}
const single=(iterable)=>{const values=[...iterable];return values.length===1?values[0]:null;};

export function parsePlayerPointQuotes(html,game,player,observedAt){
  if(typeof html!=='string'||html.length>maxBytes||!pastablePlayer(game,player))return [];
  const now=Date.parse(observedAt),tip=Date.parse(game.start);
  if(!Number.isFinite(now)||now>=tip)return [];
  const team=sideNames.find(s=>String(game[s].id)===String(player.team_id));
  const profileUrl=origin+'/nba/props/'+slug(player.name)+'/';
  const roster=projectedRoster(game),local=single(roster.filter(p=>slug(p.name)===slug(player.name)));
  if(!local||String(local.id)!==String(player.id)||local.team_id!==String(player.team_id))return [];
  const profiles=[];
  for(const tag of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig)){
    try{const item=JSON.parse(tag[1]);if(item['@type']==='ProfilePage')profiles.push(item);}catch{return [];}
  }
  const profile=single(profiles),person=profile?.mainEntity;
  if(profile?.url!==profileUrl||person?.['@type']!=='Person'||slug(person.name)!==slug(player.name)||
    slugTeam(person.affiliation?.name)!==slugTeam(game[team].name))return [];
  const lead=single(html.matchAll(/<p class="pv-lead">([\s\S]*?)<\/p>/g))?.[1];
  const mode=single((lead??'').matchAll(/<a href="(nba\/games\/[^"]+)">([\s\S]*?)<\/a>/g));
  if(!mode||mode[1]!==linkFor(game)||!text(mode[2]).endsWith(', '+localStamp(tip)))return [];
  const stamp=single(html.matchAll(/Lines from LineSmart data refreshed (\w{3}, \w{3} \d{1,2}, \d{4}\s*·\s*\d{1,2}:\d{2} [AP]M ET)/g))?.[1];
  const updated=stamp&&sourceInstant(stamp.replace(/\s+/g,' '));
  if(!updated||Date.parse(updated)>now||now-Date.parse(updated)>3600000)return [];
  const blocks=html.split(/<div class="pp-row sx-prop">/).slice(1);
  const block=single(blocks.filter(b=>/^\s*<div class="pp-h">\s*<b>Points<\/b>/.test(b)));
  if(!block||!block.includes('href="'+mode[1]+'"'))return [];
  const table=single(block.split('</table>')[0].matchAll(/<table\b[^>]*>\s*<thead><tr><th>Book<\/th><th>Line<\/th><th>Over<\/th><th>Under<\/th><\/tr><\/thead><tbody>([\s\S]*?)<\/tbody>/g));
  const row=single((table?.[1]??'').matchAll(/<tr data-book="draftkings">([\s\S]*?)<\/tr>/g))?.[1];
  if(!row)return [];
  const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>text(m[1]));
  if(cells.length!==4||cells[0]!=='DraftKings'||!/^\d{1,2}(?:\.5)?$/.test(cells[1]))return [];
  const line=Number(cells[1]),prices=cells.slice(2).map(american);
  if(line<=0||prices.some(p=>p===null))return [];
  const base={verified:true,match_id:String(game.id),home_team_id:String(game.home.id),away_team_id:String(game.away.id),
    event_start:iso(tip),event_url:origin+'/'+mode[1],player_id:String(player.id),team_id:String(player.team_id),player_name:player.name,
    period:'FULL_GAME_OT',market:'PLAYER_POINTS_OT',bookmaker:'DraftKings',provider_id:'draftkings',source:'LineSmart',
    source_url:profileUrl,observed_at:iso(now),provider_updated_at:updated,rules_source_url:rules,
    early_exit_rule:'DK_NBA_FIRST_HALF_INJURY',group_key:profileUrl+'|'+updated+'|'+line};
  return prices.map((price,i)=>({...base,side:i===0?'OVER':'UNDER',line,american_odds:price,decimal_odds:price<0?1+100/(-price):1+price/100}));
}
export function listProjectedOddsPlayers(game){
  return projectedRoster(game).filter(p=>pastablePlayer(game,p)&&p.availability!=='OFFICIAL_OUT'&&p.status!=='OUT'&&p.reported_status!=='OUT')
    .map(p=>({...p,projected_points:p.predicted_points_if_active??p.points_if_active})).filter(p=>Number.isFinite(p.projected_points)&&p.projected_points>=0)
    .sort((a,b)=>b.projected_points-a.projected_points || String(a.id).localeCompare(String(b.id)));
}
function candidates(games,ms){
  // At most one player per game in each round, ranked by this pregame edition.
  const groups=[];
  for(const game of new Map(games.map(g=>[String(g.id),g])).values()){
    const horizon=Date.parse(game.start)-ms;
    if(game.status!=='STATUS_SCHEDULED'||!(horizon>0 && horizon<=6*3600000))continue;
    const rank=listProjectedOddsPlayers(game).map(player=>({game,player,points:player.projected_points}));
    if(rank.length)groups.push(rank);
  }
  const result=[];
  for(let index=0;index<4;index++)result.push(...groups.flatMap(group=>group[index]??[]).sort((a,b)=>b.points-a.points||a.game.start.localeCompare(b.game.start)));
  return result;
}
async function boundedBody(response){
  if(Number(response.headers.get('Content-Length'))>maxBytes)return null;
  const reader=response.body?.getReader();
  if(!reader)return null;
  const decoder=new TextDecoder();
  let length=0,body='';
  while(true){
    const {value,done}=await reader.read();
    if(done)return body+decoder.decode();
    length+=value.byteLength;
    if(length>maxBytes){await reader.cancel();return null;}
    body+=decoder.decode(value,{stream:true});
  }
}
export async function fetchPlayerOddsProfile(game,player,{fetcher=fetch,clock=Date.now}={}){
  const source_url=origin+'/nba/props/'+slug(player.name)+'/';
  let observed_at=iso(clock()),status='INELIGIBLE_PLAYER',quotes=[],retry_after=null;
  const registered=listProjectedOddsPlayers(game).some(p=>String(p.id)===String(player.id)&&p.team_id===String(player.team_id)&&slug(p.name)===slug(player.name));
  if(registered && Date.parse(observed_at)<Date.parse(game.start)){
    try{
      const r=await fetcher(source_url,{redirect:'manual',headers:{Accept:'text/html'},signal:AbortSignal.timeout(5000)});
      if(r.status===429)retry_after=r.headers.get('Retry-After');
      const page=r.ok && (!r.url||r.url===source_url) && /^text\/html\b/i.test(r.headers.get('Content-Type')??'')?await boundedBody(r):null;
      observed_at=iso(clock());
      quotes=page?parsePlayerPointQuotes(page,game,player,observed_at):[];
      status=quotes.length?'OBSERVED':r.ok?'UNVERIFIED_OR_UNAVAILABLE':'HTTP_'+r.status;
    }catch{observed_at=iso(clock());status='SOURCE_UNAVAILABLE';}
  }
  return {quotes,lookup:{match_id:String(game.id),player_id:String(player.id),player_name:player.name,source_url,observed_at,status,retry_after}};
}
export async function fetchPlayerPointQuotes(games,{fetcher=fetch,limit=4,clock=Date.now}={}){
  const quotes=[],lookups=[];
  const cap=Number.isInteger(limit)?Math.max(0,Math.min(4,limit)):4;
  for(const {game,player} of candidates(games,Date.parse(iso(clock()))).slice(0,cap)){
    const result=await fetchPlayerOddsProfile(game,player,{fetcher,clock});
    quotes.push(...result.quotes);lookups.push(result.lookup);
    if(result.lookup.status==='HTTP_429')break;
  }
  return {quotes,lookups};
}
