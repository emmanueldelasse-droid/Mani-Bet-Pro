// Observations only. This adapter neither requests prices nor replays them from historical scores.
import {playerIdentity} from './identity.mjs';

const markets=['MONEYLINE_OT','SPREAD_OT','TOTAL_POINTS_OT','PLAYER_POINTS_OT'];
const gameSides=['HOME','AWAY'], totalSides=['OVER','UNDER'];
const draftKingsRules='https://boothillcasino.com/wp-content/uploads/2026/10/KS-DKE-House-Rules-v13.0-EN-CLEAN-9.2.26.pdf';
const espnBase='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const iso=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value) &&
  Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const id=value=>typeof value==='string' && /^\d{1,16}$/.test(value);
const num=Number.isFinite;

function page(raw) {
  try {const u=new URL(raw); return u.protocol==='https:' && !u.username && !u.password && !u.port ? u:null;}
  catch{return null;}
}
function scoreboardURL(raw){
  const u=page(raw);
  return u && u.origin+u.pathname===espnBase && /^\d{8}$/.test(u.searchParams.get('dates')??'') &&
    [...u.searchParams.keys()].every(k=>k==='dates'||k==='limit');
}
function standardSides(market){return market==='MONEYLINE_OT'||market==='SPREAD_OT'?gameSides:totalSides;}
function verifiedPair(base,sides){
  const order=standardSides(base.market);
  if(!Array.isArray(sides)||sides.length!==2)return [];
  const pair=order.map(side=>sides.find(s=>s?.side===side));
  if(pair.some(s=>!s || !num(s.decimal_odds) || s.decimal_odds<=1))return [];
  const [a,b]=pair.map(s=>s.line);
  if(base.market==='MONEYLINE_OT'){if(a!==null||b!==null)return [];}
  else if(!num(a)||!num(b)||(base.market==='SPREAD_OT'?a!==-b:a!==b || a<0))return [];
  const group_key=JSON.stringify([base.match_id,base.bookmaker,base.market,base.player_id,a,base.observed_at]);
  return pair.map(s=>({...base,...s,group_key}));
}
// Drop conflicting simultaneous prices. Repeated identical rows provide one pair.
function uniquePairs(rows){
  const groups=new Map();
  for(let i=0;i<rows.length;i+=2){
    const pair=rows.slice(i,i+2),key=pair[0].group_key,old=groups.get(key);
    if(!groups.has(key))groups.set(key,pair);
    else if(old && old.some((s,n)=>s.decimal_odds!==pair[n].decimal_odds))groups.set(key,null);
  }
  return [...groups.values()].filter(Boolean).flat();
}

function american(value){
  if(typeof value==='string' && /^(?:EVEN|EV)$/i.test(value))return 100;
  if(typeof value!=='string'|| !/^[+-]?\d+$/.test(value))return null;
  const n=Number(value);return Number.isSafeInteger(n)&&Math.abs(n)>=100?n:null;
}
function espnLine(value,side,market){
  if(market==='MONEYLINE_OT')return value===undefined?null:NaN;
  if(typeof value!=='string')return NaN;
  const match=market==='SPREAD_OT'?/^([+-]?\d+(?:\.\d+)?)$/.exec(value):
    (side==='OVER'?/^o(\d+(?:\.\d+)?)$/i:/^u(\d+(?:\.\d+)?)$/i).exec(value);
  return match?Number(match[1]):NaN;
}
const definitions=[
  ['moneyline','Moneyline','MONEYLINE_OT'],['pointSpread','Spread','SPREAD_OT'],['total','Total','TOTAL_POINTS_OT']
];
function espnMarkets(offer,base) {
  // Only this named bookmaker has a verified full-game settlement convention.
  if(String(offer?.provider?.id)!=='100'||offer.provider.name!=='DraftKings' ||
    String(offer.homeTeamOdds?.team?.id)!==base.home_team_id || String(offer.awayTeamOdds?.team?.id)!==base.away_team_id)return [];
  const found=[];
  for(const [key,display,market] of definitions){
    const data=offer[key], sides=standardSides(market);
    if(data?.displayName!==display||Object.keys(data).some(k=>!['displayName','shortDisplayName',...sides.map(s=>s.toLowerCase())].includes(k)))continue;
    const quotes=sides.map(side=>{
      // ESPN calls its currently displayed pre-tip prices "close". Never fall back to "open".
      const price=data[side.toLowerCase()]?.close;
      const odd=american(price?.odds);if(odd===null)return null;
      return {side,line:espnLine(price.line,side,market),american_odds:odd,decimal_odds:odd>0?1+odd/100:1+100/Math.abs(odd)};
    });
    found.push(...verifiedPair({...base,market},quotes));
  }
  return found;
}
const scheduled=status=>status?.type?.name==='STATUS_SCHEDULED' && status.type.state==='pre' && status.type.completed===false;
export function parseObservedEspnOdds(scoreboard,sourceUrl){
  const quotes=[],coverage=[],observed_at=iso(scoreboard?._fetched_at);
  if(!observed_at||!scoreboardURL(sourceUrl)||!Array.isArray(scoreboard.events)||!Array.isArray(scoreboard.leagues)||
    !scoreboard.leagues.some(l=>String(l?.id)==='46'&&l.slug==='nba'))return {quotes,coverage};
  for(const event of scoreboard.events){
    if(!event||!Array.isArray(event.competitions)||event.competitions.length!==1)continue;
    const comp=event.competitions[0],tip=iso(comp?.date);
    if(!id(event.id)||event.id!==comp?.id||!tip||tip!==iso(event.date)||observed_at>=tip||
      !scheduled(event.status)||!scheduled(comp.status)||comp.timeValid===false)continue;
    const teamId=side=>{
      const teams=Array.isArray(comp.competitors)?comp.competitors.filter(t=>t?.homeAway===side):[];
      return teams.length===1 && id(teams[0].id) && teams[0].id===teams[0].team?.id ? teams[0].id:null;
    };
    const home_team_id=teamId('home'),away_team_id=teamId('away');
    if(!home_team_id||!away_team_id||home_team_id===away_team_id)continue;
    const base={match_id:event.id,event_start:tip,home_team_id,away_team_id,bookmaker:'DraftKings',provider_id:'100',
      period:'FULL_GAME_OT',player_id:null,observed_at,source:'ESPN',source_url:sourceUrl,
      event_url:'https://www.espn.com/nba/game/_/gameId/'+event.id,rules_source_url:draftKingsRules};
    const found=Array.isArray(comp.odds)?uniquePairs(comp.odds.flatMap(o=>espnMarkets(o,base))):[];
    quotes.push(...found);
    coverage.push({match_id:event.id,observed_at,source_url:sourceUrl,markets:Object.fromEntries(markets.map(m=>[m,found.some(q=>q.market===m)?'OBSERVED':'UNAVAILABLE']))});
  }
  return {quotes,coverage};
}

export function directPage(bookmaker,url){
  const u=page(url);
  if(!u)return false;
  if(bookmaker==='Winamax')return /^(?:www\.)?winamax\.fr$/.test(u.hostname) && /^\/paris-sportifs\/match\/\d+(?:\/|$)/.test(u.pathname);
  return bookmaker==='DraftKings' && u.hostname==='sportsbook.draftkings.com' && /^\/event\/(?:[a-z0-9-]+\/)?\d+(?:\/|$)/i.test(u.pathname);
}
function playerOnRoster(quote,rosters){
  if(!id(quote.player_id) || ![quote.home_team_id,quote.away_team_id].includes(quote.team_id) || !playerIdentity(quote.player_name))return false;
  const roster=rosters instanceof Map?rosters.get(quote.team_id):
    Array.isArray(rosters)?rosters.find(pair=>Array.isArray(pair)&&pair[0]===quote.team_id)?.[1]:null;
  return Array.isArray(roster?.players) && roster.players.some(p=>String(p?.id)===quote.player_id && playerIdentity(p.name)===playerIdentity(quote.player_name));
}
export function directDnpTerms(book,url){
  const u=page(url);
  if(!u)return false;
  if(book==='DraftKings')return url===draftKingsRules || (u.hostname==='sportsbook.draftkings.com'&&u.pathname==='/help/sport-rules/basketball')
    || (u.hostname==='www.goldennugget.com'&&u.pathname==='/lake-charles/casino/draftkings-sportsbook-bar-grill/draftkings-sportsbook-house-rules/');
  if(book!=='Winamax')return false;
  return (/^(?:www\.)?winamax\.fr$/.test(u.hostname) && /^\/(?:paris-sportifs\/reglement(?:\/|$)|les-paris-sportifs_reglement(?:[-_\/]|$))/.test(u.pathname)) ||
    (u.hostname==='operator-front-static-cdn.winamax.fr' && /^\/img\/content\/(?:betting|poker)\/\d{4}\/[^/]*cgu[^/]*\/[^/]*(?:reglement|rglement)[^/]*paris[^/]*sportifs[^/]*\.pdf$/i.test(u.pathname));
}
export function quotesFromResearch(report,game,receivedAt,rosters=null){
  const received=iso(receivedAt),generated=iso(report?.generated_at),tip=iso(game?.start);
  if(report?.schema_version!=='max-research-v1'||report.experiment_id!=null||!received||!generated||!tip||
    received>=tip||generated>received||report.match_id!==String(game.id)||game.status!=='STATUS_SCHEDULED'||
    !Array.isArray(report.verified_sportsbook_quotes)||!Array.isArray(report.sources))return [];
  const match_id=String(game.id),home_team_id=String(game.home?.id),away_team_id=String(game.away?.id);
  if(!id(match_id)||!id(home_team_id)||!id(away_team_id)||home_team_id===away_team_id)return [];
  const out=[];
  for(const q of report.verified_sportsbook_quotes){
    const when=iso(q?.observed_at);
    if(!when||when>generated||q.verified!==true||q.period!=='FULL_GAME_OT'||!markets.includes(q.market)||
      q.match_id!==match_id||q.home_team_id!==home_team_id||q.away_team_id!==away_team_id||iso(q.event_start)!==tip||
      !directPage(q.bookmaker,q.source_url)||
      !report.sources.some(s=>s?.kind==='MARKET'&&s.url===q.source_url&&iso(s.checked_at)===when))continue;
    const isPlayer=q.market==='PLAYER_POINTS_OT';
    if(isPlayer?!playerOnRoster(q,rosters):q.player_id!=null)continue;
    const terms=isPlayer&&q.dnp_rule==='VOID'&&directDnpTerms(q.bookmaker,q.rules_source_url) &&
      report.sources.some(s=>s?.url===q.rules_source_url&&iso(s.checked_at)&&iso(s.checked_at)<=generated);
    const base={match_id,home_team_id,away_team_id,event_start:tip,bookmaker:q.bookmaker,market:q.market,period:q.period,
      player_id:isPlayer?q.player_id:null,observed_at:when,source:'MACFLY',source_url:q.source_url,event_url:q.source_url,
      ...(isPlayer?{team_id:q.team_id,player_name:q.player_name}:{}),...(terms?{dnp_rule:'VOID',rules_source_url:q.rules_source_url}:{})};
    const sides=Array.isArray(q.sides)?q.sides.map(s=>s&&({side:s.side,line:s.line,decimal_odds:s.decimal_odds})):null;
    out.push(...verifiedPair(base,sides));
  }
  return uniquePairs(out);
}
