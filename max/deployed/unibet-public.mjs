// Read a single public, server-rendered French NBA board. Quotes come from active,
// named outcomes on that page; structured events supply the tip and team order.
export const UNIBET_BOARD='https://www.unibet.fr/paris-basketball/usa/nba';
const origin='https://www.unibet.fr',maxBytes=384*1024;
const route=/^\/paris-basketball\/usa\/nba\/(\d+)\/[a-z0-9-]+-vs-[a-z0-9-]+$/;
const paris=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const utc=ms=>new Date(ms).toISOString();
const once=values=>values.length===1?values[0]:null;
const clean=value=>String(value??'').replace(/<!--[\s\S]*?-->|<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const normalized=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const byClass=(html,tag,cls)=>[...html.matchAll(new RegExp('<'+tag+'\\b[^>]*class="[^"]*\\b'+cls+'\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/'+tag+'>','gi'))].map(m=>clean(m[1]));
const abbreviation={NO:'NOP',NY:'NYK',SA:'SAS',GS:'GSW',PHO:'PHX',UTAH:'UTA',WSH:'WAS',BRK:'BKN',LA:'LA',LAC:'LA',LAL:'LA'};
function teamMatches(team,label){
  if(!team?.name||!team?.abbreviation||!label)return false;
  const parts=label.trim().split(/\s+/),ab=parts.shift();
  if(normalized(team.name)===normalized(label))return true;
  if((abbreviation[ab]??ab)!==(abbreviation[team.abbreviation]??team.abbreviation))return false;
  let nickname=normalized(parts.join(' '));
  if(nickname==='twolves')nickname='timberwolves';
  return nickname.length>1&&normalized(team.name).endsWith(nickname);
}
function tipMatches(stamp,tip){
  if(typeof stamp!=='string')return false;
  if(/(?:Z|[+-]\d\d:\d\d)$/.test(stamp))return Date.parse(stamp)===tip;
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(stamp))return false;
  const parts=Object.fromEntries(paris.formatToParts(tip).map(x=>[x.type,x.value]));
  const local=parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute+':'+parts.second;
  // An offset-free local time repeated during the autumn clock change cannot identify either instant.
  const repeated=[tip-3600000,tip+3600000].some(other=>paris.format(other)===paris.format(tip));
  return !repeated&&stamp===local;
}
const future=(g,ms)=>g?.status==='STATUS_SCHEDULED'&&/^\d{5,15}$/.test(g.id)&&
  /^\d+$/.test(g.home?.id)&&/^\d+$/.test(g.away?.id)&&String(g.home.id)!==String(g.away.id)&&Date.parse(g.start)>ms;
function boardRule(html){
  return [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].some(m=>{
    const text=normalized(m[1]);
    return text.includes('vainqueurdumatchfaceaface') && text.includes('prolongationseventuellesovertimeincluses');
  });
}
function eventsByUrl(html){
  const entries=new Map();
  for(const script of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)){
    let data;try{data=JSON.parse(script[1]);}catch{continue;}
    for(const event of (Array.isArray(data)?data:(data?.['@graph']??[data]))){
      if(event?.['@type']!=='SportsEvent'||event.sport!=='Basketball'||event.superEvent?.name!=='NBA'||
        event.superEvent.url!==UNIBET_BOARD||event['@id']!==event.url+'#event'||
        event.homeTeam?.['@type']!=='SportsTeam'||event.awayTeam?.['@type']!=='SportsTeam')continue;
      entries.set(event.url,entries.has(event.url)?null:event);
    }
  }
  return entries;
}
function boardPrices(block,event){
  const labels=byClass(block,'span','psel-opponent__name');
  if(labels.length!==2||labels[0]!==event.homeTeam.name||labels[1]!==event.awayTeam.name||
    once(byClass(block,'p','psel-bet-option'))!=='Face à Face - Match')return null;
  const prices=new Map(),buttons=[...block.matchAll(/<button\b([^>]*\baria-disabled="(?:true|false)"[^>]*)>([\s\S]*?)<\/button>/gi)];
  if(buttons.length!==2)return null;
  for(const [,attr,contents] of buttons){
    if(!/class="[^"]*\bpsel-outcome--rating\b/.test(attr)||!(/aria-disabled="false"/.test(attr))||
      /(?:^|\s)disabled(?:\s|>|=|$)/.test(attr))return null;
    const label=once(byClass(contents,'span','psel-outcome__label')),value=once(byClass(contents,'span','psel-outcome__data'));
    if(!labels.includes(label)||!/^\d{1,5}(?:,\d{1,3})?$/.test(value??''))return null;
    const odds=Number(value.replace(',','.'));if(!Number.isFinite(odds)||odds<=1||prices.has(label))return null;
    prices.set(label,odds);
  }
  return prices;
}
export function parseUnibetBoard(html,games,observedAt){
  const now=Date.parse(observedAt);
  if(typeof html!=='string'||html.length>maxBytes||!Array.isArray(games)||!Number.isFinite(now)||!boardRule(html))return [];
  const events=eventsByUrl(html),offers=new Map();
  for(const block of html.matchAll(/<psel-event-main\b[^>]*>([\s\S]*?)<\/psel-event-main>/gi)){
    const link=once([...block[1].matchAll(/<a\b[^>]*\bclass="psel-event__link"[^>]*\bhref="([^"]+)"[^>]*>/gi)])?.[1];
    const key=route.exec(link??'')?.[1];if(!key)continue;
    const eventUrl=origin+link,event=events.get(eventUrl);
    if(!event)continue;
    const matching=games.filter(g=>future(g,now)&&tipMatches(event.startDate,Date.parse(g.start))&&
      teamMatches(g.home,event.homeTeam.name)&&teamMatches(g.away,event.awayTeam.name));
    const game=once(matching);if(!game)continue;
    const prices=boardPrices(block[1],event);
    // Duplicate blocks for one ESPN fixture could represent competing editions. Leave the fixture unevaluated.
    if(!prices||offers.has(game.id)){offers.set(game.id,null);continue;}
    const base={match_id:String(game.id),event_start:utc(Date.parse(game.start)),home_team_id:String(game.home.id),away_team_id:String(game.away.id),
      bookmaker:'Unibet',source:'Unibet.fr',provider_id:'unibet-fr',bookmaker_event_id:key,market:'MONEYLINE_OT',period:'FULL_GAME_OT',
      source_url:UNIBET_BOARD,event_url:eventUrl,rules_source_url:UNIBET_BOARD,player_id:null,line:null,observed_at:utc(now),
      group_key:'unibet-fr|'+key+'|MONEYLINE_OT|'+utc(now)};
    offers.set(game.id,['HOME','AWAY'].map(side=>({...base,side,decimal_odds:prices.get(side==='HOME'?event.homeTeam.name:event.awayTeam.name)})));
  }
  return [...offers.values()].filter(Boolean).flat();
}
export async function fetchUnibetBoard(games,{fetcher=fetch,clock=Date.now}={}){
  const now=()=>new Date(clock()).getTime();
  if(!Array.isArray(games)||!games.some(g=>future(g,now())))return {quotes:[],lookups:[]};
  const record={source_url:UNIBET_BOARD,status:'UNAVAILABLE',http_status:null,retry_after:null,observed_at:null,bytes:0,matched_games:0};
  const failed=reason=>({quotes:[],lookups:[{...record,reason}]});
  try{
    const response=await fetcher(UNIBET_BOARD,{headers:{Accept:'text/html'},redirect:'error',signal:AbortSignal.timeout(9000)});
    record.http_status=response.status;record.retry_after=response.headers.get('Retry-After');record.observed_at=utc(now());
    if(!response.ok)return failed('HTTP_'+response.status);
    if((response.url&&response.url!==UNIBET_BOARD)||!/^text\/html(?:\s*;|$)/i.test(response.headers.get('content-type')??''))return failed('UNEXPECTED_DOCUMENT');
    if(Number(response.headers.get('Content-Length'))>maxBytes){await response.body?.cancel();return failed('BOARD_TOO_LARGE');}
    const date=Date.parse(response.headers.get('Date')??''),age=Number(response.headers.get('Age')??0);
    if(!Number.isFinite(age)||age<0||age>300 || Number.isFinite(date)&&(date>now()+5000||now()-date>305000))return failed('STALE_DOCUMENT');
    const reader=response.body?.getReader();if(!reader)return failed('EMPTY_BODY');
    const decoder=new TextDecoder();let html='';
    while(true){
      const {value,done}=await reader.read();if(done)break;
      record.bytes+=value.byteLength;
      if(record.bytes>maxBytes){await reader.cancel();return failed('BOARD_TOO_LARGE');}
      html+=decoder.decode(value,{stream:true});
    }
    html+=decoder.decode();
    record.observed_at=utc(now());
    const quotes=parseUnibetBoard(html,games,record.observed_at);
    record.status=quotes.length?'OBSERVED':'NO_VERIFIED_MARKET';
    record.matched_games=new Set(quotes.map(q=>q.match_id)).size;
    record.document_date=Number.isFinite(date)?utc(date):null;record.age_seconds=age;
    return {quotes,lookups:[record]};
  }catch{return failed('BOARD_FETCH_FAILED');}
}
