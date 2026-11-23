// Exercise failure paths with the Worker's real D1/Queue ingress and fixed clocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../quality-worker.mjs';
import {validateResearch} from '../worker.mjs';
import {insertResearch} from '../research-journal.mjs';
import {refreshStudy} from '../study-runtime.mjs';
import {readPromptExecutionTrace} from '../prompt-lab-runner.mjs';
import {d1,fixture,g,h,iso,players,report,tip} from './study-journey-fixture.mjs';

test('les faits déjà connus, hors périmètre, antidatés, tardifs et les sources inaccessibles ont des traces distinctes',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-7*h});
  const db=d1(),env={MAX_JOURNAL:db};
  const games=Array.from({length:6},(_,i)=>({...g,id:String(910000310+i)}));
  const plan={id:'read-regression',action:'TEST',prompt:'Vérifier le temps de jeu du joueur ciblé.',target:'MINUTES_LIMIT',
    targets:games.map(game=>({match_id:game.id,tip:game.start,player_ids:['1001']})),metric:'minutes_mae',
    cohort:{start:iso(tip-7*h),end:iso(tip+h)},criterion:{min_games:6,min_dates:1,min_gain:.2}};
  const body=JSON.stringify(plan);
  db.prepare('INSERT INTO prompt_lab_inbox(payload) VALUES(?)').bind(body).run();
  db.prepare("INSERT INTO prompt_lab_experiments(id,status,received_at,plan_json) SELECT id,'ACTIVE',received_at,payload FROM prompt_lab_inbox").run();
  const queue=async message=>{
    let acks=0;
    await worker.queue({messages:[{body:message,ack(){acks++;}}]},env,{});
    assert.equal(acks,1);
  };
  const setTime=offset=>t.mock.timers.setTime(tip+offset);
  const source='https://www.nba.com/pacers/news/synthetic-staff-notes';
  const research=(game,at,i=0)=>{
    const base=report(at,[],false,game),checked_at=iso(at-60000);
    return {...base,sources:[{url:source,kind:'OFFICIAL',title:'Source fictive de l’équipe',checked_at}],
      verified_role_facts:[{match_id:game.id,event_start:game.start,player_id:players['10'][i].id,player:players['10'][i].name,
        team_id:'10',minutes_limit:12,source_url:source,checked_at}]};
  };
  const receipts=[],reads=[],run='fixture-2030-11-23-20';
  for(const game of games)await refreshStudy(db,fixture(game),validateResearch,{persistContext:true});
  setTime(-5*h);
  for(const [i,game] of games.entries()){
    // Only the first ordinary report already contains the target's verified twelve-minute limit.
    const normal=i===0?research(game,tip-5*h-1000):report(tip-5*h-1000,[],false,game);
    const receipt=await insertResearch(db,{...normal,collection_run_id:run});
    await queue({match_id:game.id,generated_at:receipt.generated_at});
    receipts.push(receipt.id);
  }
  setTime(-4.5*h);
  for(const baseline of receipts){
    db.prepare('INSERT INTO prompt_lab_reads(experiment_id,baseline_receipt_id,prompt_text,run_id) VALUES(?,?,?,?)').bind(plan.id,baseline,plan.prompt,run).run();
    const read=db.prepare('SELECT id FROM prompt_lab_reads WHERE baseline_receipt_id=?').bind(baseline).first('id');
    reads.push(read);
  }
  setTime(-4.25*h);
  for(const baseline of receipts)await queue({type:'prompt_lab_read',experiment_id:plan.id,baseline_receipt_id:baseline});
  const encode=(i,extra,outcome)=>({experiment_id:plan.id,baseline_receipt_id:receipts[i],read_id:reads[i],
    outcome,report:{...extra,experiment_id:plan.id}});
  const save=async payload=>{
    db.prepare('INSERT INTO prompt_lab_supplements(envelope) VALUES(?)').bind(JSON.stringify(payload)).run();
    await queue({type:'prompt_lab_supplement',experiment_id:plan.id,match_id:payload.report.match_id,generated_at:payload.report.generated_at});
  };
  setTime(-4*h);
  const negative=(i,issue)=>({...research(games[i],tip-4*h-1000),sources:[],verified_role_facts:[],access_issue:issue});
  await save(encode(0,research(games[0],tip-4*h-1000),'FOUND'));
  await save(encode(1,research(games[1],tip-4*h-1000,2),'FOUND'));
  const stale=research(games[2],tip-4*h-1000);
  stale.sources[0].checked_at=iso(tip-4.5*h);
  await save(encode(2,stale,'FOUND'));
  await save(encode(3,negative(3,'Le site public était inaccessible pendant le passage.'),'NO_FINDING'));
  await save(encode(4,negative(4,undefined),'NO_FINDING'));
  setTime(-3.5*h);
  const afterRead=await insertResearch(db,{...report(tip-3.5*h-1000,[],false,games[3]),collection_run_id:run});
  await queue({match_id:games[3].id,generated_at:afterRead.generated_at});
  assert.throws(()=>db.prepare('INSERT INTO prompt_lab_reads(experiment_id,baseline_receipt_id,prompt_text,run_id) VALUES(?,?,?,?)')
    .bind(plan.id,afterRead.id,plan.prompt,run).run(),/BASELINE_AFTER_PROMPT_READ/);
  assert.equal(db.prepare("SELECT json_extract(payload,'$.exclusion') reason FROM prompt_lab_pairs WHERE match_id=? ORDER BY as_of DESC,id DESC LIMIT 1")
    .bind(games[3].id).first('reason'),'BASELINE_AFTER_PROMPT_READ');
  // Receipt and confirmation predate tip-off. An old document arriving after tip-off is still late.
  setTime(60000);
  await save(encode(5,research(games[5],tip-3*h-1000),'FOUND'));
  const rows=await readPromptExecutionTrace(db,plan.id);
  assert.deepEqual(rows.map(r=>r.state),['ALREADY_KNOWN','NOT_INTEGRATED','NOT_INTEGRATED','NO_FINDING','NOT_INTEGRATED','NOT_INTEGRATED']);
  assert.equal(rows[0].facts[0].effect,'ALREADY_KNOWN');
  assert.equal(rows[0].changed,false);
  assert.match(rows[1].reason,/Joueur hors/);
  assert.match(rows[2].reason,/heure de vérification/);
  assert.match(rows[3].reason,/inaccessible/);
  assert.match(rows[4].reason,/Aucune vérification/);
  assert.match(rows[5].reason,/après le début/);
  assert.equal(rows[5].received_at,iso(tip+60000));
  for(const index of [1,2,4,5]){
    assert.equal(rows[index].version_id,null);
    assert.equal(rows[index].outcome_used,false);
    assert.equal(rows[index].standard_integrated_at,iso(tip-5*h));
  }
});
