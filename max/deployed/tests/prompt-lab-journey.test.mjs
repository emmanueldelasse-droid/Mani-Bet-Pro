// Local integration of the same queue, D1 SQL, match projections and API used by the Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../quality-worker.mjs';
import {validateResearch} from '../worker.mjs';
import {parseBoxscore} from '../advanced.mjs';
import {insertResearch} from '../research-journal.mjs';
import {refreshStudy,settleStudy} from '../study-runtime.mjs';
import {d1,fixture,g,h,iso,players,report,teams,tip} from './study-journey-fixture.mjs';

const day=24*h;
const earlier=(id,days)=>({...g,id,start:iso(tip-days*day)});
const promptText='Au passage habituel, vérifier si une source officielle gratuite chiffre le plafond de minutes.\nConsigner la valeur exacte et l’heure, ou signaler « non trouvé ».';

function officialFinal(game,at) {
  const final={...game,status:'STATUS_FINAL',fetched_at:iso(at),
    home:{...game.home,score:120},away:{...game.away,score:108}};
  // Fictitious final with 240 minutes per team, including the named player's 10-minute limit.
  const homeMinutes=[10,0,28,28,28,26,20,20,20,20,20,20];
  const raw={_fetched_at:iso(at),boxscore:{players:teams.map(team=>({team:{id:team.id},statistics:[{
    names:['MIN','PTS'],athletes:players[team.id].map((p,i)=>{
      const mins=team.id==='10'?homeMinutes[i]:20;
      const points=team.id==='10'?(i===1?0:i===2?20:10):9;
      return {athlete:{id:p.id,displayName:p.name},didNotPlay:mins===0,stats:[String(mins),String(points)]};
    })
  }]}))}};
  const box=parseBoxscore(raw,final);
  assert.ok(box);return {final,box};
}

test('consigne MacFly : diagnostic, deux collectes isolées, trois prévisions simultanées, résultat et décision',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-4*day});
  const db=d1(), past=[earlier('910000101',3),earlier('910000102',2)];
  const match=earlier('910000103',0),neutral=earlier('910000104',0);
  const slate={games:[match,neutral]};
  const env={MAX_JOURNAL:db,MAX_STATE:{get:async key=>key==='max:slate:latest'?structuredClone(slate):null}};
  const setTime=n=>t.mock.timers.setTime(n);
  const deliver=async body=>{
    let acknowledged=0;
    await worker.queue({messages:[{body,ack(){acknowledged++;}}]},env,{});
    assert.equal(acknowledged,1);
  };
  const api=async path=>{
    const response=await worker.fetch(new Request('https://example.test'+path),env,{});
    assert.equal(response.status,200,path);return response.json();
  };
  const readLab=()=>api('/api/research-experiments');
  const card=()=>api('/api/game?id='+match.id);
  const propose=async document=>{
    db.prepare('INSERT INTO prompt_lab_inbox(payload) VALUES (?)').bind(JSON.stringify(document)).run();
    await deliver({type:'prompt_lab_review',proposal_id:document.id});
  };
  const capture=game=>refreshStudy(db,fixture(game),validateResearch,{persistContext:true});
  const evidence=[];
  for(const game of past){
    const gameTip=Date.parse(game.start);
    setTime(gameTip-7*h);await capture(game);
    const version=db.prepare('SELECT id FROM max_forecast_versions WHERE match_id=?').bind(game.id).first();
    setTime(gameTip+3*h);
    const {final,box}=officialFinal(game,gameTip+3*h);
    await settleStudy(db,final,box);
    evidence.push({match_id:game.id,version_id:version.id,player_id:'1001',
      observation:'Le joueur a disputé dix minutes pour vingt prévues et aucun plafond officiel ne figurait dans la capture.'});
  }
  setTime(tip-7*h);
  await capture(match);await capture(neutral);
  const review={id:'local-already-known',author:'MacFly',action:'NO_PROMPT',target:'AVAILABILITY',
    diagnosis:'ALREADY_USED',problem:'Vérifier si l’absence faisait déjà partie de la fiche.',
    evidence:[{...evidence[0],player_id:'1002',observation:'La carte donnait déjà zéro minute à ce joueur absent.'}],
    reason:'Le statut officiel figurait dans la projection originale.'};
  await propose(review);await propose(review);
  const initial=await readLab();
  assert.equal(initial.active_id,null);
  assert.deepEqual(initial.reviews.map(r=>r.id),[review.id]);
  const plan={id:'local-minutes-limit',author:'MacFly',action:'TEST',target:'MINUTES_LIMIT',
    problem:'Projection de vingt minutes sur deux rencontres où le joueur en a disputé dix.',
    diagnosis:'MISSING',hypothesis:'Un plafond vérifié avant la rencontre peut réduire l’écart de minutes.',prompt:promptText,evidence,
    targets:[match,neutral].map(game=>({match_id:game.id,tip:game.start,player_ids:['1001']})),
    cohort:{start:iso(tip-6*h),end:iso(tip+day)},metric:'minutes_mae',criterion:{min_games:2,min_dates:1,min_gain:.2}};
  await propose(plan);await propose(plan);
  const before=await readLab();
  assert.equal(before.active_id,plan.id);
  assert.equal(before.experiments.length,1);
  assert.equal(before.experiments[0].prompt,promptText);
  setTime(tip-5*h);
  const runId='synthetic-2030-11-23T20';
  const normal={...report(tip-5*h-1000,[],false,match),collection_run_id:runId};
  const receipt=await insertResearch(db,normal);
  await deliver({match_id:match.id,generated_at:receipt.generated_at});
  const other=await insertResearch(db,{...report(tip-5*h-1000,[],false,neutral),collection_run_id:runId});
  await deliver({match_id:neutral.id,generated_at:other.generated_at});
  const savedMain=(await card()).study;
  assert.equal((await readLab()).experiments[0].trace[0].state,'NOT_READ');
  assert.equal(db.prepare('SELECT count(*) n FROM prompt_lab_reads').first('n'),0);
  setTime(tip-4*h-10*60000);
  const canonical=db.prepare("SELECT json_extract(plan_json,'$.prompt') AS prompt FROM prompt_lab_experiments WHERE status='ACTIVE'").first('prompt');
  const submitRead=(base,text=canonical,run=runId)=>db.prepare('INSERT INTO prompt_lab_reads(experiment_id,baseline_receipt_id,prompt_text,run_id) VALUES(?,?,?,?)')
    .bind(plan.id,base.id,text,run).run();
  assert.throws(()=>submitRead(receipt,'Autre consigne'),/INVALID_EXPERIMENT_READ/);
  assert.throws(()=>submitRead(receipt,canonical,'other-run'),/INVALID_EXPERIMENT_READ/);
  submitRead(receipt);submitRead(other);
  const readOf=base=>db.prepare('SELECT id,received_at,prompt_text FROM prompt_lab_reads WHERE experiment_id=? AND baseline_receipt_id=? AND run_id=?')
    .bind(plan.id,base.id,runId).first();
  const read=readOf(receipt),otherRead=readOf(other);
  assert.equal(read.prompt_text,canonical);
  assert.equal((await readLab()).experiments[0].trace[0].state,'READ_PENDING');
  const notifyRead=base=>deliver({type:'prompt_lab_read',experiment_id:plan.id,baseline_receipt_id:base.id});
  setTime(tip-4*h-5*60000);
  await notifyRead(receipt);await notifyRead(other);
  const checked=db.prepare('SELECT confirmed_at FROM prompt_lab_read_confirmations WHERE read_id=?').bind(read.id).first('confirmed_at');
  assert.equal(checked,iso(tip-4*h-5*60000));
  assert.equal((await readLab()).experiments[0].trace[0].state,'READ');
  submitRead(receipt);await notifyRead(receipt);
  assert.throws(()=>submitRead(receipt,canonical+' autre'),/PROMPT_READ_CONFLICT/);
  const source='https://www.nba.com/pacers/news/local-integration-example';
  const generatedAt=iso(tip-4*h-1000),checkedAt=iso(tip-4*h-60000);
  const extra={schema_version:'max-research-v1',experiment_id:plan.id,match_id:match.id,generated_at:generatedAt,
    summary:'Scénario fictif : plafond chiffré de dix minutes.',sources:[{url:source,title:'Source NBA fictive',kind:'OFFICIAL',
      published_at:iso(tip-4*h-120000),checked_at:checkedAt}],
    verified_role_facts:[{match_id:match.id,event_start:match.start,team_id:'10',player_id:'1001',player:players['10'][0].name,
      minutes_limit:10,source_url:source,checked_at:checkedAt}]};
  setTime(tip-4*h);
  await assert.rejects(insertResearch(db,extra),/USE_PROMPT_LAB_SUPPLEMENT_INGRESS/);
  const envelope={experiment_id:plan.id,baseline_receipt_id:receipt.id,read_id:read.id,outcome:'FOUND',report:extra};
  const signal={type:'prompt_lab_supplement',match_id:match.id,experiment_id:plan.id,generated_at:extra.generated_at};
  const write=(payload=envelope)=>db.prepare('INSERT INTO prompt_lab_supplements(envelope) VALUES (?)').bind(JSON.stringify(payload)).run();
  assert.throws(()=>write({...envelope,read_id:otherRead.id}),/CONFIRMED_PROMPT_READ_REQUIRED/);
  assert.throws(()=>write({...envelope,read_id:null}),/CONFIRMED_PROMPT_READ_REQUIRED/);
  write();await deliver(signal);
  const link={id:plan.id,problem:plan.problem,changed:true,branch:'experimental'};
  assert.deepEqual((await card()).study,{...savedMain,prompt_experiments:[link]},'seul le lien de lecture figure sur la carte principale');
  assert.deepEqual((await api('/api/slate')).games.find(g=>g.id===match.id).study.prompt_experiments,[link]);
  const snapshot=await readLab();
  const applied=snapshot.experiments[0].trace.find(r=>r.match_id===match.id);
  assert.equal(applied.read_id,read.id);
  assert.equal(applied.baseline_receipt_id,receipt.id);
  assert.equal(applied.standard_integrated_at,iso(tip-5*h));
  assert.ok(applied.standard_version_id);
  assert.equal(applied.state,'FOUND');
  assert.equal(applied.changed,true);
  assert.equal(applied.confirmed_at,checked);
  assert.equal(applied.sources[0].checked_at,checkedAt);
  assert.equal(applied.integrated_at,iso(tip-4*h));
  assert.equal(applied.as_of,iso(tip-4*h));
  assert.ok(applied.version_id);
  const readPair=id=>JSON.parse(db.prepare('SELECT payload FROM prompt_lab_pairs WHERE experiment_id=? AND match_id=? ORDER BY as_of DESC,id DESC LIMIT 1')
    .bind(plan.id,id).first('payload'));
  const pair=readPair(match.id);
  const projection=a=>a.player_points.home.players.find(p=>p.id==='1001').projected_minutes_if_active;
  assert.equal(pair.exclusion,null);
  assert.equal(pair.control.at,pair.primary.at);
  assert.equal(pair.variant.at,pair.primary.at);
  assert.equal(pair.primary.input_id,pair.variant.input_id);
  assert.equal(pair.control.forecast.engine_version,pair.variant.forecast.engine_version);
  assert.deepEqual([projection(pair.primary),projection(pair.control),projection(pair.variant)],[20,28,10]);
  assert.equal(pair.facts.length,1);
  write();await deliver(signal);
  assert.deepEqual((await readLab()).experiments[0].score,snapshot.experiments[0].score);
  assert.equal(db.prepare('SELECT count(*) n FROM macfly_inbox').first('n'),2);
  assert.equal(db.prepare('SELECT count(*) n FROM prompt_lab_supplements').first('n'),1);
  setTime(tip-3*h);
  const miss={...extra,match_id:neutral.id,generated_at:iso(tip-3*h-1000),summary:'Aucun plafond annoncé dans le bulletin consulté.',verified_role_facts:[]};
  write({experiment_id:plan.id,baseline_receipt_id:other.id,read_id:otherRead.id,outcome:'NO_FINDING',report:miss});
  await deliver({...signal,match_id:neutral.id,generated_at:miss.generated_at});
  await capture(neutral);
  const noFinding=(await readLab()).experiments[0].trace.find(r=>r.match_id===neutral.id);
  assert.equal(noFinding.state,'NO_FINDING');
  assert.equal(noFinding.changed,false);
  assert.deepEqual(readPair(neutral.id).control,readPair(neutral.id).variant);
  setTime(tip+3*h);
  for(const game of [match,neutral]){
    const {final,box}=officialFinal(game,tip+3*h);
    await settleStudy(db,final,box);
    await settleStudy(db,final,box);
  }
  const latest=await readLab(), score=latest.experiments[0].score;
  assert.equal(score.evaluated_games,2);
  assert.equal(score.evaluated_cases,2,'un seul joueur ciblé par match');
  assert.ok(latest.experiments[0].trace.every(r=>r.outcome_used && r.outcome_pair_id && r.evaluated_cases===1));
  assert.ok(score.control>score.variant,'le nouveau plafond doit améliorer la prévision de temps de jeu');
  assert.equal(score.changed_games,1);
  assert.equal(score.adoption_applied,false);
  assert.equal(score.decision,'POURSUIVRE');
  assert.equal(latest.experiments[0].status,'ACTIVE');
  assert.equal((await card()).study.decision.ruleId,savedMain.decision.ruleId);
  setTime(tip+day+1);
  // Only a normal background review can close the experiment; opening the screen is read-only.
  await readLab();
  assert.equal(db.prepare('SELECT status FROM prompt_lab_experiments WHERE id=?').bind(plan.id).first('status'),'ACTIVE');
  await deliver({type:'prompt_lab_review',proposal_id:plan.id});
  const closed=await readLab();
  const {prompt_lab}=await api('/api/study');
  assert.equal(prompt_lab.evaluated_matches,2);
  assert.equal(prompt_lab.projection_changes,1);
  slate.games=[];
  const archived=await card();
  assert.equal(archived.match_id,match.id);
  assert.equal(archived.start,match.start);
  assert.deepEqual(archived.study.prompt_experiments,[link]);
  assert.equal(closed.active_id,null);
  assert.equal(closed.experiments[0].score.decision,'NON_CONCLUANTE');
  assert.equal(closed.experiments[0].score.evaluated_games,2);
  assert.equal(closed.auto_adoption,false);
  assert.equal(closed.experiments[0].status_history.at(-1).status,'INCONCLUSIVE');
  assert.deepEqual((await api('/api/research-experiments?id='+plan.id)).experiments,[closed.experiments[0]]);
  await deliver(signal);
  assert.deepEqual(await readLab(),closed);
});
