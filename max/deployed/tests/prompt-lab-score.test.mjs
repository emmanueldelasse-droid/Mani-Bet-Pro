import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {capturePromptPair,readPromptScore,settlePromptGame,summarizePromptScore} from '../prompt-lab-score.mjs';

const start=Date.parse('2030-11-23T00:00:00Z'), hour=3600000, day=24*hour;
const iso=value=>new Date(value).toISOString();
function database(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.function('strftime',{deterministic:true},(_format,value)=>value==='now'?iso(Date.now()):iso(value));
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=ON');
  sqlite.exec(readFileSync(new URL('../prompt-lab.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../prompt-lab-score.sql',import.meta.url),'utf8'));
  const statement=(sql,args=[])=>({bind(...values){return statement(sql,values);},first(){return sqlite.prepare(sql).get(...args)??null;},
    run(){return sqlite.prepare(sql).run(...args);},all(){return {results:sqlite.prepare(sql).all(...args)};}});
  return {sqlite,prepare:statement,batch(statements){sqlite.exec('BEGIN');try{
    const result=statements.map(s=>s.all());sqlite.exec('COMMIT');return result;
  }catch(e){sqlite.exec('ROLLBACK');throw e;}}};
}
const game={id:'901230000',status:'STATUS_SCHEDULED',start:iso(start+hour*4),home:{id:'h'},away:{id:'a'}};
const exp={id:'minutes-101',target:'MINUTES_LIMIT',metric:'minutes_mae',created_at:iso(start),
  cohort:{start:iso(start),end:game.start},criterion:{min_games:1,min_dates:1,min_gain:0.2},
  targets:[{match_id:game.id,tip:game.start}]};
function arm(at,engine,players){
  return {game_id:game.id,at:iso(at),input_id:'sha-context-and-normal-receipts',
    forecast:{engine_version:engine,probability_home:0.55,projected_score:{home:107,away:105}},
    player_points:{home:{players:players.map(([id,minutes,status])=>({id,name:'Joueur '+id,team_id:'h',status,
      projected_minutes_if_active:minutes,predicted_points_if_active:minutes/2}))},away:{players:[]}}};
}
function arms(at){
  return {experiment:exp,game,asOf:iso(at),primary:arm(at,'principal',[['1',34],['99',38]]),
    control:arm(at,'rotation',[['1',24],['2',12],['99',38]]),variant:arm(at,'rotation',[['1',10,'LIMITED'],['2',15],['99',0,'OUT']]),
    receipt_ids:[31],facts:[{receipt_id:31,match_id:game.id,checked_at:iso(at-1000),received_at:iso(at-200)}]};
}
function seed(db){
  const body=JSON.stringify(exp);
  db.prepare('INSERT INTO prompt_lab_inbox(payload) VALUES (?)').bind(body).run();
  db.prepare("INSERT INTO prompt_lab_experiments(id,status,received_at,plan_json) VALUES(?, 'ACTIVE',?,?)")
    .bind(exp.id,iso(Date.now()),body).run();
}
test('three arms are prospective, retries preserve capture; both gains use exactly the same observed players',async t=>{
  t.mock.timers.enable({apis:['Date'],now:start});
  const db=database();seed(db);
  t.mock.timers.setTime(start+hour);
  const data=arms(Date.now());
  const first=await capturePromptPair(db,{...data,delivery_key:'context:receipt-31'});
  t.mock.timers.setTime(start+hour+1000);
  const repeated=await capturePromptPair(db,{...arms(Date.now()),delivery_key:'context:receipt-31'});
  assert.equal(first.id,repeated.id);
  const pre=await readPromptScore(db,exp);
  assert.equal(pre.forecast_games,1);assert.equal(pre.evaluated_games,0);assert.equal(pre.changed_games,1);
  assert.equal(pre.researched_games,1);assert.equal(pre.no_finding_games,0);
  assert.equal(pre.player_changes.changed_status,2);assert.equal(pre.player_changes.changed_minutes,3);
  assert.equal(pre.player_changes.control_verified,0);assert.equal(pre.player_changes.variant_verified,2);
  assert.equal(pre.decision,'POURSUIVRE');
  t.mock.timers.setTime(start+hour*6);
  const actual={...game,status:'STATUS_FINAL',fetched_at:iso(Date.now()),home:{id:'h',score:110},away:{id:'a',score:103}};
  const box={game_id:game.id,fetched_at:actual.fetched_at,teams:{h:{players:[
    {id:'1',minutes:10,points:4},{id:'2',minutes:12,points:6}
  ]},a:{players:[]}}};
  assert.equal(await capturePromptPair(db,{...data,delivery_key:'attempt-after-tip'}),null);
  await settlePromptGame(db,actual,null);
  assert.equal((await readPromptScore(db,exp)).exclusions.AWAITING_BOXSCORE,1);
  await settlePromptGame(db,actual,box);
  await settlePromptGame(db,actual,null);
  const score=await readPromptScore(db,exp);
  // Player 2 has no reference projection. Player 99 did not enter the box. Neither is scored as zero.
  assert.equal(score.closed_games,1);assert.equal(score.evaluated_cases,1);assert.equal(score.evaluated_games,1);
  assert.deepEqual([score.primary,score.control,score.variant],[24,14,0]);
  assert.equal(score.gain,14);assert.equal(score.gain_vs_primary,24);
  assert.equal(score.interval_95,null);assert.equal(score.decision,'ABANDONNER');
});
test('asynchronous arms, mismatched engines and background, and post-cutoff research are marked and never scored',async t=>{
  t.mock.timers.enable({apis:['Date'],now:start});const db=database();seed(db);
  for(const [i,issue] of ['DIFFERENT_INSTANT','DIFFERENT_ENGINE','DIFFERENT_BACKGROUND_INPUTS','INVALID_EXPERIMENT_FACT'].entries()){
    const at=start+(i+1)*60000;t.mock.timers.setTime(at);
    const data=arms(at);
    if(i===0)data.variant.at=iso(at+1);
    if(i===1)data.control.forecast.engine_version='other';
    if(i===2)data.primary.input_id='different';
    if(i===3)data.facts[0].received_at=iso(at+1000);
    await capturePromptPair(db,data);
    assert.equal((await readPromptScore(db,exp)).matches[0].exclusion,issue);
  }
  const other={...game,id:'901230001'},forged={...exp,targets:[{match_id:other.id,tip:game.start}]};
  assert.equal(await capturePromptPair(db,{...arms(Date.now()),experiment:forged,game:other}),null);
  t.mock.timers.setTime(start+80*hour);
  const absent=await readPromptScore(db,exp);
  assert.equal(absent.decision,'ABANDONNER');assert.equal(absent.evaluated_cases,0);assert.equal(absent.evaluated_games,0);
});
test('single terminal review requires sufficient dates, complete cohort, a material paired gain and no primary degradation',()=>{
  const targets=Array.from({length:20},(_,i)=>({match_id:String(i),tip:iso(start+(i+1)*day)}));
  const end=targets.at(-1).tip,plan={...exp,metric:'brier',targets,cohort:{start:iso(start),end},criterion:{min_dates:20,min_games:20,min_gain:.02}};
  const captures=targets.map(t=>({...t,changed:true,extra_fact_count:1}));
  const rows=targets.map(t=>({...t,payload:{cases:1,totals:[0.15,0.2,0.1]}}));
  const view=(r,when)=>summarizePromptScore(plan,captures,r,when);
  assert.equal(view(rows,iso(Date.parse(end)-1)).decision,'POURSUIVRE');
  const good=view(rows,end);assert.deepEqual(good.interval_95,[.1,.1]);
  assert.equal(good.decision,'PROPOSER_ADOPTION');assert.equal(good.adoption_applied,false);
  assert.equal(view(rows.map(r=>({...r,payload:{cases:1,totals:[.05,.2,.1]}})),end).decision,'ABANDONNER');
  assert.equal(view(rows.slice(1),end).decision,'POURSUIVRE');
  assert.equal(view(rows.slice(1),iso(Date.parse(end)+3*day)).decision,'ABANDONNER');
});
