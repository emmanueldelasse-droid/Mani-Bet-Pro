import {parseObservedEspnOdds,quotesFromResearch} from './observed-odds.mjs';
import {readPublishedForecast} from './published-forecasts.mjs';
import {recordQuotedDecisions} from './odds-study.mjs';
import {schedulePlayerOddsCoverage} from './player-odds-coverage.mjs';

const scoreboard='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const now=()=>new Date().toISOString();

export async function captureOddsForEdition(env,edition,boards){
  if(!edition)return;
  const quotes=boards.flatMap(board=>parseObservedEspnOdds(board,board._source_url).quotes)
    .filter(q=>String(q.match_id)===edition.match_id);
  if(quotes.length)await recordQuotedDecisions(env.MAX_JOURNAL,edition,quotes,now());
}

export async function captureReportOdds(env,id,receipt,ctx){
  if(!receipt?.report_json)return;
  const raw=JSON.parse(receipt.report_json);
  if(!raw.verified_sportsbook_quotes?.length)return;
  const edition=await readPublishedForecast(env.MAX_JOURNAL,id);
  if(!edition)return;
  const quotes=quotesFromResearch(raw,edition.visible,receipt.received_at,ctx?.rosters);
  if(quotes.length)await recordQuotedDecisions(env.MAX_JOURNAL,edition,quotes,now());
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
  await capturePlayerMarkets(env,games,fetcher);
  await env.MAX_STATE.put(key,JSON.stringify({observed_at:board._fetched_at,games:games.length}),{expirationTtl:172800});
}
