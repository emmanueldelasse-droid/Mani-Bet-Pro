import test from 'node:test';
import assert from 'node:assert/strict';
import {d1,g,h,iso,tip} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';
import {recordQuotedDecisions,recordQuotedDecisionsWithReceipt,settleQuotedDecisions,oddsStudySummary} from '../odds-study.mjs';

const game={...g,id:'910001211'};
const rules='https://sportsbook.draftkings.com/help/sport-rules/basketball';
function card(){
  const ratings=[25,8,8,20,5,12];
  return {...game,checked_at:new Date().toISOString(),independent_analysis:{advanced:{
    forecast:{status:'SIMULATED_UNCALIBRATED',projected_score:{home:118,away:112},probability_home:.62},
    player_points:{home:{players:ratings.map((rating,i)=>({id:String(1001+i),team_id:'10',name:'Joueur '+i,predicted_points_if_active:rating}))},away:{players:[]}}
  }}};
}
function pair(market,line,odds=[2,2],extra={}){
  const sides=['SPREAD_OT','MONEYLINE_OT'].includes(market)?['HOME','AWAY']:['OVER','UNDER'];
  const prop=market==='PLAYER_POINTS_OT',direct=prop||extra.bookmaker==='Winamax';
  return sides.map((side,i)=>({match_id:game.id,home_team_id:'10',away_team_id:'20',event_start:game.start,period:'FULL_GAME_OT',
    bookmaker:'DraftKings',provider_id:direct?null:'100',source:direct?'MACFLY':'ESPN',
    source_url:direct?'https://sportsbook.draftkings.com/event/12345678':'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20301124&limit=25',
    event_url:'https://www.espn.com/nba/game/_/gameId/'+game.id,player_id:null,market,observed_at:new Date().toISOString(),
    side,line:market==='SPREAD_OT'&&i===1?-line:line,decimal_odds:odds[i],...extra}));
}
test('cotes figées et réglées sur une édition sportive, sans prix inventé et indépendamment pour chaque opérateur',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-7*h});
  const db=d1(),at=offset=>t.mock.timers.setTime(tip+offset);
  at(-5*h);
  const edition=await savePublishedForecast(db,game,new Date().toISOString(),card());
  const props=(id,line,options={})=>pair('PLAYER_POINTS_OT',line,[1.9,1.9],{player_id:id,team_id:'10',...options});
  const quotes=[...pair('MONEYLINE_OT',null,[2,1.70]),...pair('SPREAD_OT',-2.5),...pair('TOTAL_POINTS_OT',216),
    ...props('1001',20.5),...props('1002',14.5,{dnp_rule:'VOID',rules_source_url:rules}),
    ...props('1003',11.5),...props('1004',14.5),...props('1005',5.5),
    ...pair('MONEYLINE_OT',null,[1.6,2.2],{bookmaker:'Winamax',source_url:'https://www.winamax.fr/paris-sportifs/match/876543'})];
  at(-5*h+1000);
  await recordQuotedDecisions(db,edition,quotes);
  await recordQuotedDecisions(db,edition,quotes);
  const frozen=await oddsStudySummary(db,game.id);
  assert.equal(frozen.observations,18);
  assert.equal(frozen.selections,7);
  assert.equal(frozen.decision_rows.length,9);
  assert.equal(frozen.decision_rows.filter(d=>d.selected).every(d=>d.stake_units===1 && d.edition_id===edition.id),true);
  assert.equal(frozen.coverage.projected_players,6);
  assert.equal(frozen.coverage.priced_players,5);
  assert.deepEqual(frozen.unpriced_projections.map(p=>[p.player_id,p.label]),[['1006','Rendement non évaluable']]);
  at(-4*h);
  const better=pair('MONEYLINE_OT',null,[3.75,1.25]);
  await recordQuotedDecisions(db,edition,better);
  const rerun=await oddsStudySummary(db,game.id);
  assert.equal(rerun.observations,20);
  assert.deepEqual(rerun.decision_rows,frozen.decision_rows);
  at(3*h);
  const final={...game,status:'STATUS_FINAL',fetched_at:new Date().toISOString(),home:{...g.home,score:106},away:{...g.away,score:110}};
  const box={game_id:game.id,start:game.start,fetched_at:final.fetched_at,source_url:'https://www.espn.com/nba/boxscore/_/gameId/'+game.id,
    teams:{'10':{totals:{points:106},players:[{id:'1001',minutes:30,points:25},{id:'1004',minutes:20,points:12}],
      did_not_play:[{id:'1002'},{id:'1003'}]},'20':{totals:{points:110},players:[]}}};
  await settleQuotedDecisions(db,final,box);
  await settleQuotedDecisions(db,final,box);
  const stats=await oddsStudySummary(db,game.id,{bookmaker:'DraftKings'});
  assert.deepEqual([stats.selections,stats.wins,stats.losses,stats.pushes,stats.voids,stats.unsettleable,stats.pending],[7,1,2,1,1,2,0]);
  assert.deepEqual([stats.staked_units,stats.settled_units,stats.net_units,stats.roi,stats.max_drawdown_units],[7,5,-1.1,-.22,1.1]);
  assert.equal(stats.best_band,null);
  assert.equal(stats.bands.length,4);
  assert.deepEqual(stats.compared_with_market,[{bookmaker:'DraftKings',games:1,max_correct:0,favorite_correct:1,max_accuracy:0,favorite_accuracy:1}]);
  const other=await oddsStudySummary(db,game.id,{bookmaker:'Winamax',market:'MONEYLINE_OT'});
  assert.equal(other.selections,0);
  assert.equal(other.compared_with_market[0].games,1,'comparer aussi les pronostics sans mise virtuelle');
  assert.equal(other.net_units,null);
  assert.equal(db.prepare('SELECT count(*) n FROM market_study_decisions').first('n'),0,'le registre Winamax historique reste séparé');
  const afterDeadline=pair('MONEYLINE_OT',null,[4,1.2]);
  await recordQuotedDecisions(db,edition,afterDeadline);
  assert.equal((await oddsStudySummary(db,game.id)).observations,20);
});

test('offres incomplètes, futures, conflictuelles et hors délai ne fabriquent aucune sélection',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-8*h});
  const db=d1();
  t.mock.timers.setTime(tip-7*h);
  const edition=await savePublishedForecast(db,game,new Date().toISOString(),card());
  const early=pair('TOTAL_POINTS_OT',200);
  await recordQuotedDecisions(db,edition,early);
  t.mock.timers.setTime(tip-4*h);
  const partial=pair('MONEYLINE_OT',null),future=pair('SPREAD_OT',1.5,[2,2],{observed_at:iso(tip-2*h)});
  const mismatch=pair('SPREAD_OT',1.5,[2,2],{away_team_id:'999'});
  const directOpposite={...partial[1],source:'MACFLY',source_url:'https://sportsbook.draftkings.com/event/12345678'};
  await recordQuotedDecisions(db,edition,[partial[0],directOpposite,...future,...mismatch]);
  let result=await oddsStudySummary(db,game.id);
  assert.equal(result.observations,4);
  assert.equal(result.selections,0);
  assert.equal(result.decision_rows.length,0);
  const absentPrice=pair('TOTAL_POINTS_OT',220).map(q=>({...q,decimal_odds:null}));
  const collision=[...pair('SPREAD_OT',-2.5),...pair('SPREAD_OT',-1.5)];
  await recordQuotedDecisions(db,edition,[...collision,...absentPrice]);
  result=await oddsStudySummary(db,game.id);
  assert.equal(result.selections,0);
  assert.equal(result.decision_rows[0].reason,'CONFLICTING_OFFERS');
  assert.equal(result.quote_rows.every(q=>q.observed_at<=q.received_at),true);
});

test('le bilan global limite les lignes affichées et compte toute la série, y compris les corrections simultanées',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-7*h});const db=d1();
  t.mock.timers.setTime(tip-4*h);const forecast=card(),count=63;
  const roster=Array.from({length:count},(_,i)=>({id:String(1001+i),team_id:'10',name:'Joueur '+i,predicted_points_if_active:25}));
  forecast.independent_analysis.advanced.player_points.home.players=roster;
  const edition=await savePublishedForecast(db,game,iso(Date.now()),forecast);
  const quotes=roster.flatMap(p=>pair('PLAYER_POINTS_OT',20.5,[2,2],{player_id:p.id,team_id:p.team_id}));
  await recordQuotedDecisions(db,edition,quotes);
  const pending=await oddsStudySummary(db);
  assert.equal(pending.decisions,63);assert.equal(pending.observations,126);assert.equal(pending.pending,63);
  assert.equal(pending.decision_rows.length,50);assert.equal(pending.quote_rows.length,50);
  const full=await oddsStudySummary(db,game.id);
  assert.equal(full.decision_rows.length,63);assert.equal(full.quote_rows.length,126);
  assert.equal(full.coverage.priced_players,63);assert.equal(full.unpriced_projections.filter(p=>p.player_id).length,0);
  t.mock.timers.setTime(tip+3*h);
  const result={...game,status:'STATUS_FINAL',fetched_at:iso(Date.now()),home:{...g.home,score:120},away:{...g.away,score:106}};
  const box={game_id:game.id,start:game.start,fetched_at:result.fetched_at,source_url:'https://www.espn.com/nba/boxscore/_/gameId/'+game.id,
    teams:{'10':{totals:{points:120},players:roster.map((p,i)=>({...p,minutes:30,points:i<20?21:20}))},'20':{totals:{points:106},players:[]}}};
  await settleQuotedDecisions(db,result,box);
  t.mock.timers.setTime(tip+4*h);box.fetched_at=iso(Date.now());box.teams['10'].players[20].points=21;
  await settleQuotedDecisions(db,result,box);
  const done=await oddsStudySummary(db,null,{bookmaker:'DraftKings',market:'PLAYER_POINTS_OT'});
  assert.equal(done.wins,21);assert.equal(done.losses,42);assert.equal(done.net_units,-21);
  assert.equal(done.max_drawdown_units,23);assert.equal(done.bands.find(b=>b.id==='2-3').net_units,-21);
  assert.equal(done.priced_games,1);assert.equal(done.observed_games,1);assert.equal(done.dates,1);
  const miss=await oddsStudySummary(db,null,{market:'MONEYLINE_OT'});assert.equal(miss.observations,0);
  assert.deepEqual(miss.bookmakers,['DraftKings']);
});

test('écart court Worker/D1, relecture exacte des deux côtés et refus des heures futures ou hors délai',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-7*h});
  let lag=0;const db=d1({serverClock:()=>Date.now()-lag});
  t.mock.timers.setTime(tip-4*h);
  const edition=await savePublishedForecast(db,game,iso(Date.now()),card());
  t.mock.timers.setTime(Date.now()+1000);lag=8;
  const offer=pair('MONEYLINE_OT',null,[2,1.7],{observed_at:iso(Date.now()-100)});
  const record=(quotes,at=iso(Date.now()))=>recordQuotedDecisionsWithReceipt(db,edition,quotes,at);
  const {receipt}=await record(offer);
  assert.equal(receipt.complete,true);assert.equal(receipt.stored_count,2);
  assert.ok(receipt.quotes.every(q=>q.quote_id>0 && q.received_at>=q.observed_at));
  assert.deepEqual(receipt.quotes.map(q=>q.observed_at),offer.map(q=>q.observed_at));
  assert.deepEqual((await record(offer)).receipt.quotes.map(q=>q.quote_id),receipt.quotes.map(q=>q.quote_id));
  const newer=pair('TOTAL_POINTS_OT',210);
  setTimeout(()=>{lag=0;},1);
  const waited=(await record(newer)).receipt;
  assert.equal(waited.complete,true);assert.equal(waited.quotes[0].observed_at,iso(Date.now()));
  assert.equal((await record(offer,iso(Date.now()+1))).receipt.reason,'FUTURE_REQUEST_TIME');
  assert.equal((await record([{...offer[0],observed_at:iso(Date.now()+1)}])).receipt.quotes[0].reason,'FUTURE_OBSERVATION');
  const badSource=(await record([{...offer[0],source_url:'https://example.org/odds'}])).receipt;
  assert.equal(badSource.quotes[0].quote_id,null);assert.equal(badSource.stored_count,0);
  lag=4;
  const partial=(await record([{...offer[0],decimal_odds:1.88},{...offer[1],observed_at:iso(Date.now()),decimal_odds:2.2}])).receipt;
  assert.equal(partial.complete,false);assert.equal(partial.stored_count,1);
  assert.deepEqual(partial.quotes.map(q=>q.status),['STORED','NOT_FOUND']);
  assert.equal(partial.quotes[1].reason,'DATABASE_CLOCK_BEHIND_OBSERVATION');
  lag=2100;assert.equal((await record(offer)).receipt.reason,'DATABASE_CLOCK_TOO_FAR_BEHIND');
  lag=0;
  const stale=await record(pair('SPREAD_OT',-2.5,[2,2],{observed_at:iso(Date.now()-61*60000)}));
  assert.equal(stale.receipt.complete,true,'le journal conserve le relevé daté');
  assert.equal(stale.decisions.some(r=>JSON.parse(r.payload).market==='SPREAD_OT'),false,'une cote périmée ne déclenche pas de sélection');
  lag=0;t.mock.timers.setTime(tip);assert.equal((await record(offer)).receipt.reason,'TIP_REACHED');
});
