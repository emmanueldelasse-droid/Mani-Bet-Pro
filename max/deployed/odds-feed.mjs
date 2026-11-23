import {parseObservedEspnOdds,quotesFromResearch} from './observed-odds.mjs';
import {readPublishedForecast} from './published-forecasts.mjs';
import {recordQuotedDecisions} from './odds-study.mjs';
import {submitObservedMarketGroups,resumeObservedMarkets} from './odds-intake.mjs';
import {schedulePlayerOddsCoverage} from './player-odds-coverage.mjs';
import {fetchUnibetBoard} from './unibet-public.mjs';

const scoreboard='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const now=()=>new Date().toISOString();

export async function captureOddsForEdition(env,edition,boards){
  if(!edition)return;
  const quotes=boards.flatMap(board=>parseObservedEspnOdds(board,board._source_url).quotes)
    .filter(q=>String(q.match_id)===edition.match_id);
  await stageQuoteGroups(env,edition,quotes);
}

export async function captureReportOdds(env,id,receipt,ctx){
  if(!receipt?.report_json)return;
  const raw=JSON.parse(receipt.report_json);
  if(!raw.verified_sportsbook_quotes?.length)return;
  const edition=await readPublishedForecast(env.MAX_JOURNAL,id);
  if(!edition)return;
  const quotes=quotesFromResearch(raw,edition.visible,receipt.received_at,ctx?.rosters);
  await stageQuoteGroups(env,edition,quotes);
}

async function stageQuoteGroups(env,edition,quotes){
  const groups=new Map();
  for(const q of quotes){
    const key=JSON.stringify([q.source,q.bookmaker,q.observed_at]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(q);
  }
  if(groups.size)await submitObservedMarketGroups(env,[...groups.values()].map(rows=>({edition,quotes:rows})));
}

export async function capturePlayerMarkets(env,games,fetcher){
  const future=games.filter(g=>g.status==='STATUS_SCHEDULED' && Date.now()<Date.parse(g.start)
    && Date.parse(g.start)-Date.now()<=6*3600000);
  if(!future.length)return;
  if(env.MAX_RESEARCH_QUEUE){
    return schedulePlayerOddsCoverage(env,future,{fetcher});
  }
  const {fetchPlayerPointQuotes}=await import('./player-odds.mjs');
  const result=await fetchPlayerPointQuotes(future,{fetcher,limit:4});
  const byMatch=new Map();
  for(const q of result.quotes){
    const id=String(q.match_id);
    if(!byMatch.has(id))byMatch.set(id,[]);
    byMatch.get(id).push(q);
  }
  for(const [id,quotes] of byMatch){
    const edition=await readPublishedForecast(env.MAX_JOURNAL,id);
    if(edition)await recordQuotedDecisions(env.MAX_JOURNAL,edition,quotes,now());
  }
  return result;
}

const boardKey='max:odds:unibet:last';
async function recordBoardCheck(db,check,retryOf=null){
  await db.prepare('INSERT OR IGNORE INTO odds_first_party_checks(checked_at,retry_of,payload) VALUES(?,?,?)')
    .bind(check.checked_at,retryOf,JSON.stringify(check)).run();
}
async function readFrenchBook(env,upcoming,fetcher,retryOf=null){
  const {quotes,lookups}=await fetchUnibetBoard(upcoming,{fetcher});
  const offers=new Map();
  for(const quote of quotes){
    const id=String(quote.match_id);
    if(!offers.has(id))offers.set(id,[]);
    offers.get(id).push(quote);
  }
  if(offers.size){
    const heads=await env.MAX_JOURNAL.prepare(`SELECT p.id,p.match_id,p.tip
      FROM published_forecast_heads h JOIN published_forecasts p ON p.id=h.edition_id
      WHERE h.match_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...offers.keys()])).all();
    await submitObservedMarketGroups(env,heads.results.map(edition=>({edition,quotes:offers.get(edition.match_id)})));
  }
  const readAt=lookups?.[0]?.observed_at;
  const verified=readAt?await env.MAX_JOURNAL.prepare(`SELECT match_id FROM odds_study_quotes
    WHERE bookmaker='Unibet' AND market='MONEYLINE_OT' AND observed_at=? AND json_extract(payload,'$.source')='Unibet.fr'
    GROUP BY match_id,group_key HAVING COUNT(DISTINCT side)=2`).bind(readAt).all():{results:[]};
  const sealed=new Set(verified.results.map(q=>q.match_id));
  const check={source:'Unibet.fr',checked_at:now(),games_checked:upcoming.length,games_with_observed_prices:offers.size,
    observed_match_ids:[...offers.keys()],
    games_with_saved_prices:[...offers.keys()].filter(id=>sealed.has(id)).length,
    missing_receipts:[...offers.keys()].filter(id=>!sealed.has(id)),lookups};
  await recordBoardCheck(env.MAX_JOURNAL,check,retryOf);
  await env.MAX_STATE.put(boardKey,JSON.stringify(check),{expirationTtl:86400*14});
}

export async function recoverFrenchBoard(env,failedAt,fetcher){
  if(typeof failedAt!=='string'||!Number.isFinite(Date.parse(failedAt)))return;
  const db=env.MAX_JOURNAL.withSession?env.MAX_JOURNAL.withSession('first-primary'):env.MAX_JOURNAL;
  const current=await env.MAX_STATE.get(boardKey,{type:'json'});
  if(current?.checked_at!==failedAt || current.games_with_observed_prices!==0 ||
    !current.lookups?.some(row=>row.reason==='BOARD_FETCH_FAILED' && row.http_status==null && row.bytes===0))return;
  if(await db.prepare('SELECT 1 AS found FROM odds_first_party_checks WHERE retry_of=?').bind(failedAt).first())return;
  await recordBoardCheck(db,current);
  const at=now(),until=new Date(Date.parse(at)+6*3600000).toISOString();
  const heads=await db.prepare(`SELECT h.match_id FROM published_forecast_heads h JOIN published_forecasts p ON h.edition_id=p.id
    WHERE p.tip>? AND p.tip<=? ORDER BY p.tip,h.match_id`).bind(at,until).all();
  const games=[];
  for(const row of heads.results){
    const edition=await readPublishedForecast(db,row.match_id);
    if(edition && edition.tip>now())games.push(edition.visible);
  }
  if(games.length)await readFrenchBook(env,games,fetcher,failedAt);
}

export async function captureScheduledMarkets(env,games,fetcher){
  if(env.MAX_RESEARCH_QUEUE)await resumeObservedMarkets(env);
  const upcoming=games.filter(g=>g.status==='STATUS_SCHEDULED' && Date.now()<Date.parse(g.start)
    && Date.parse(g.start)-Date.now()<=6*3600000);
  if(!upcoming.length)return;
  const results=await Promise.allSettled([readFrenchBook(env,upcoming,fetcher),capturePlayerMarkets(env,upcoming,fetcher)]);
  for(const result of results)if(result.status==='rejected')throw result.reason;
}

export async function readLastFrenchBoard(env){
  const db=env.MAX_JOURNAL.withSession?env.MAX_JOURNAL.withSession('first-primary'):env.MAX_JOURNAL;
  const latest=await db.prepare('SELECT payload FROM odds_first_party_checks ORDER BY checked_at DESC LIMIT 1').first();
  const check=latest?JSON.parse(latest.payload):await env.MAX_STATE.get(boardKey,{type:'json'});
  const observed=check?.lookups?.[0]?.observed_at;
  if(!observed||check.lookups[0].status!=='OBSERVED')return check;
  const tally=await db.prepare(`SELECT match_id FROM odds_study_quotes WHERE bookmaker='Unibet' AND market='MONEYLINE_OT' AND observed_at=?
    AND json_extract(payload,'$.source')='Unibet.fr' GROUP BY match_id,group_key HAVING count(DISTINCT side)=2`).bind(observed).all();
  const sealed=new Set(tally.results.map(row=>row.match_id));
  return {...check,games_with_saved_prices:sealed.size,
    missing_receipts:check.observed_match_ids?.filter(id=>!sealed.has(id))??null};
}

export async function recoverIncompleteBoards(env,date,checkedAt,fetcher){
  if(typeof date!=='string'||!/^\d{8}$/.test(date)||typeof checkedAt!=='string')return;
  const db=env.MAX_JOURNAL.withSession?env.MAX_JOURNAL.withSession('first-primary'):env.MAX_JOURNAL;
  const origin=await db.prepare('SELECT payload FROM odds_first_party_checks WHERE checked_at=?').bind(checkedAt).first();
  if(!origin)return;
  const old=JSON.parse(origin.payload),seen=old.lookups?.[0]?.observed_at;
  if(!seen||old.lookups[0].status!=='OBSERVED'||seen.slice(0,10).replaceAll('-','')!==date)return;
  const nowStamp=now(),age=Date.parse(nowStamp)-Date.parse(seen);
  if(age<0||age>6*3600000)return;
  const key='max:odds:missing-board-receipts:'+date+':'+checkedAt;
  if(await env.MAX_STATE.get(key))return;
  const horizon=new Date(Date.parse(nowStamp)+6*3600000).toISOString();
  const saved=await db.prepare(`SELECT h.match_id, p.tip AS start,
    json_extract(p.payload,'$.home') home,json_extract(p.payload,'$.away') away FROM published_forecast_heads h
    JOIN published_forecasts p ON p.id=h.edition_id WHERE p.tip>? AND p.tip<=? ORDER BY p.tip,h.match_id`).bind(nowStamp,horizon).all();
  const games=saved.results.map(r=>({id:r.match_id,start:r.start,status:'STATUS_SCHEDULED',home:JSON.parse(r.home),away:JSON.parse(r.away)}));
  if(!games.length)return;
  const done=await db.prepare(`SELECT match_id,bookmaker,market FROM odds_study_quotes WHERE observed_at>=? AND
    json_extract(payload,'$.source') IN ('ESPN','Unibet.fr') GROUP BY match_id,bookmaker,market,observed_at,group_key
    HAVING count(DISTINCT side)=2`).bind(new Date(Date.parse(nowStamp)-6*3600000).toISOString()).all();
  const missing=games.filter(g=>new Set(done.results.filter(r=>r.match_id===g.id&&r.bookmaker==='DraftKings').map(r=>r.market)).size<3);
  if(missing.length){
    const url=scoreboard+'?dates='+date+'&limit=25';
    const res=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12500)});
    if(!res.ok)throw Error('ODDS_BOARD_HTTP_'+res.status);
    const board=await res.json();
    if(!Array.isArray(board.events))throw Error('ODDS_BOARD_INVALID');
    board._fetched_at=now();board._source_url=url;
    for(const game of missing){
      const edition=await readPublishedForecast(db,game.id);
      if(edition?.tip>now())await captureOddsForEdition(env,edition,[board]);
    }
  }
  if(new Set(done.results.filter(r=>r.bookmaker==='Unibet').map(r=>r.match_id)).size<old.games_with_observed_prices &&
    !await db.prepare('SELECT 1 found FROM odds_first_party_checks WHERE retry_of=?').bind(checkedAt).first()){
    await readFrenchBook(env,games,fetcher,checkedAt);
  }
  await env.MAX_STATE.put(key,now(),{expirationTtl:86400});
}

// One initial observation on the already published board, through the private Queue.
// Normal updates are made by the existing six-hour collector.
export async function bootstrapObservedOdds(env,date,fetcher){
  if(typeof date!=='string'||!/^\d{8}$/.test(date))return;
  const midnight=Date.parse(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T00:00:00Z');
  if(!Number.isFinite(midnight)||Math.abs(midnight-Date.now())>36*3600000)return;
  const key='max:odds:initial-board:v1:'+date;
  if(await env.MAX_STATE.get(key))return;
  const url=scoreboard+'?dates='+date+'&limit=25';
  const response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12500)});
  if(!response.ok)throw Error('ODDS_BOARD_HTTP_'+response.status);
  const board=await response.json();
  if(!Array.isArray(board.events))throw Error('ODDS_BOARD_INVALID');
  board._fetched_at=now();board._source_url=url;
  const games=[];
  for(const event of board.events){
    const edition=await readPublishedForecast(env.MAX_JOURNAL,String(event.id));
    if(!edition || edition.tip<=now())continue;
    await captureOddsForEdition(env,edition,[board]);games.push(edition.visible);
  }
  await captureScheduledMarkets(env,games,fetcher);
  await env.MAX_STATE.put(key,JSON.stringify({observed_at:board._fetched_at,games:games.length}),{expirationTtl:172800});
}
