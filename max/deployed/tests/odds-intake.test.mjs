import test from 'node:test';
import assert from 'node:assert/strict';
import {d1,g,h,iso,tip} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';
import {submitObservedMarkets,submitObservedMarketGroups,sealObservedMarkets,resumeObservedMarkets} from '../odds-intake.mjs';
function setup(t){
  t.mock.timers.enable({apis:['Date'],now:tip-4*h});const db=d1(),sent=[];
  return {db,sent,env:{MAX_JOURNAL:db,MAX_RESEARCH_QUEUE:{sendBatch:async m=>sent.push(...m)}}};
}
async function game(db,n){
  const game={...g,id:String(900000010+n)},at=iso(Date.now());
  return savePublishedForecast(db,game,at,{...game,checked_at:at,independent_analysis:{advanced:{
    forecast:{status:'SIMULATED_UNCALIBRATED',probability_home:.60,projected_score:{home:110,away:100}}}}});
}
function quotes(e,home=2){
  const observed_at=iso(Date.now());
  return ['HOME','AWAY'].map((side,i)=>({source:'ESPN',provider_id:'100',bookmaker:'DraftKings',market:'MONEYLINE_OT',side,line:null,
    decimal_odds:i?1.9:home,match_id:e.match_id,home_team_id:g.home.id,away_team_id:g.away.id,event_start:e.tip,period:'FULL_GAME_OT',
    source_url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20301124&limit=25',
    event_url:'https://www.espn.com/nba/game/_/gameId/'+e.match_id,observed_at}));
}
test('all nine complete groups survive fan-out failure, recover, and verify exact individual receipts without duplicate stakes',async t=>{
  const {env,db,sent}=setup(t),groups=[];
  for(let i=0;i<9;i++){const edition=await game(db,i);groups.push({edition,quotes:quotes(edition)});}
  const fail={...env,MAX_RESEARCH_QUEUE:{sendBatch:async()=>{throw Error('subrequest limit');}}};
  const staged=await submitObservedMarketGroups(fail,groups);
  assert.equal(staged.filter(r=>r.stashed&&r.dispatch_error).length,9);
  assert.equal(db.prepare('SELECT count(*) n FROM odds_intake').first().n,9);
  assert.equal(db.prepare('SELECT count(*) n FROM odds_study_quotes').first().n,0);
  assert.equal((await resumeObservedMarkets(env)).groups,9);assert.equal(sent.length,9);
  for(const msg of sent){const complete=await sealObservedMarkets(env,msg.body.id);
    assert.equal(complete.status,'SEALED');assert.equal(complete.receipt.stored_count,2);
    assert.ok(complete.receipt.quotes.every(q=>q.status==='STORED'&&q.quote_id&&q.received_at));
  }
  const duplicate=await submitObservedMarkets(env,groups[0].edition,groups[0].quotes.toReversed());
  assert.equal(duplicate.id,staged[0].id);assert.equal(duplicate.status,'SEALED');
  await sealObservedMarkets(env,staged[0].id);assert.equal(db.prepare('SELECT count(*) n FROM odds_study_decisions').first().n,9);
  assert.throws(()=>db.prepare("UPDATE odds_intake SET quotes_json='[]' WHERE id=?").bind(duplicate.id).run(),/FROZEN/);
  assert.throws(()=>db.prepare('DELETE FROM odds_intake_history WHERE intake_id=?').bind(duplicate.id).run(),/FROZEN/);
});
test('later message processed first gives the same bookmaker first choice to the earlier complete quote',async t=>{
  const {env,db}=setup(t),edition=await game(db,1);
  const first=await submitObservedMarkets(env,edition,quotes(edition,2.20));
  t.mock.timers.setTime(Date.now()+1000);
  const second=await submitObservedMarkets(env,edition,quotes(edition,1.50));
  assert.equal((await sealObservedMarkets(env,second.id)).status,'SEALED');
  assert.equal((await sealObservedMarkets(env,first.id)).status,'SEALED');
  const result=JSON.parse(db.prepare('SELECT payload FROM odds_study_decisions').first().payload);
  assert.equal(result.decimal_odds,2.20);assert.equal(result.selected,true);
});
test('partial validation, bounded retry and post-tip stage retain errors and create no retroactive decision',async t=>{
  const {env,db}=setup(t),edition=await game(db,1);
  const raw=quotes(edition);raw[0].source_url='https://example.com/unrelated';
  const invalid=await submitObservedMarkets({MAX_JOURNAL:db},edition,raw);
  assert.equal(invalid.status,'ISSUE');assert.equal(invalid.receipt.stored_count,1);assert.equal(invalid.receipt.quotes.filter(q=>!q.quote_id).length,1);
  const again=await sealObservedMarkets(env,invalid.id,{retryIssue:true});assert.equal(again.attempts,2);
  const staged=await submitObservedMarkets(env,edition,quotes(edition,1.8));
  t.mock.timers.setTime(tip);assert.equal((await sealObservedMarkets(env,staged.id)).status,'EXPIRED');
  assert.equal(db.prepare('SELECT count(*) n FROM odds_study_decisions').first().n,0);
  assert.equal((await resumeObservedMarkets(env)).groups,0);
});

test('a quota failure is audited four times, then a deliberate replay can seal the same prices once',async t=>{
  const {env,db}=setup(t),edition=await game(db,1),prices=quotes(edition);
  const item=await submitObservedMarkets(env,edition,prices);
  function stmt(sql,inner){
    return {bind(...args){return stmt(sql,inner.bind(...args));},first(){if(sql.includes('AS activated_at,p.parameters'))throw Error('D1 temporary quota');return inner.first();},
      all:()=>inner.all(),run:()=>inner.run()};
  }
  const proxy={prepare(sql){return stmt(sql,db.prepare(sql));},batch:ops=>db.batch(ops)};
  const unavailable={...env,MAX_JOURNAL:proxy};
  for(const [i,delay] of [0,10,45,120].entries()){
    t.mock.timers.setTime(Date.now()+delay*1000);
    const trial=await sealObservedMarkets(unavailable,item.id);
    assert.equal(trial.status,i===3?'ISSUE':'RETRY');assert.equal(trial.attempts,i+1);assert.match(trial.reason,/quota/);
  }
  assert.equal((await resumeObservedMarkets(env)).groups,0);
  const repaired=await sealObservedMarkets(env,item.id,{retryIssue:true});
  assert.equal(repaired.status,'SEALED');assert.equal(repaired.receipt.decisions.length,1);
  assert.equal(repaired.receipt.quotes[0].observed_at,prices[0].observed_at);
  assert.equal((await sealObservedMarkets(env,item.id)).attempts,5);
});
