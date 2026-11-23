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
    targets:[match,neutral].map(game=>({match_id:game.id,tip:game.start})),
    cohort:{start:iso(tip-6*h),end:iso(tip+day)},metric:'minutes_mae',criterion:{min_games:2,min_dates:1,min_gain:.2}};
  await propose(plan);await propose(plan);
  const before=await readLab();
  assert.equal(before.active_id,plan.id);
  assert.equal(before.experiments.length,1);
  assert.equal(before.experiments[0].prompt,promptText);
  setTime(tip-5*h);
  const normal=report(tip-5*h-1000,[],false,match);
  const receipt=await insertResearch(db,normal);
  await deliver({match_id:match.id,generated_at:receipt.generated_at});
  const savedMain=(await card()).study;
  const source='https://www.nba.com/pacers/news/local-integration-example';
  const generatedAt=iso(tip-4*h-1000),checkedAt=iso(tip-4*h-60000);
  const extra={schema_version:'max-research-v1',experiment_id:plan.id,match_id:match.id,generated_at:generatedAt,
    summary:'Scénario fictif : plafond chiffré de dix minutes.',sources:[{url:source,title:'Source NBA fictive',kind:'OFFICIAL',
      published_at:iso(tip-4*h-120000),checked_at:checkedAt}],
    verified_role_facts:[{match_id:match.id,event_start:match.start,team_id:'10',player_id:'1001',player:players['10'][0].name,
      minutes_limit:10,source_url:source,checked_at:checkedAt}]};
  setTime(tip-4*h);
  await assert.rejects(insertResearch(db,extra),/USE_PROMPT_LAB_SUPPLEMENT_INGRESS/);
  const envelope={experiment_id:plan.id,baseline_receipt_id:receipt.id,outcome:'FOUND',report:extra};
  const signal={type:'prompt_lab_supplement',match_id:match.id,experiment_id:plan.id,generated_at:extra.generated_at};
  const write=()=>db.prepare('INSERT INTO prompt_lab_supplements(envelope) VALUES (?)').bind(JSON.stringify(envelope)).run();
  write();await deliver(signal);
  assert.deepEqual((await card()).study,savedMain,'les entrées expérimentales doivent rester privées au test');
  const snapshot=await readLab();
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
  assert.equal(db.prepare('SELECT count(*) n FROM macfly_inbox').first('n'),1);
  assert.equal(db.prepare('SELECT count(*) n FROM prompt_lab_supplements').first('n'),1);
  setTime(tip-3*h);
  await capture(neutral); // eligible match even though the extra prompt finds nothing
  assert.deepEqual(readPair(neutral.id).control,readPair(neutral.id).variant);
  setTime(tip+3*h);
  for(const game of [match,neutral]){
    const {final,box}=officialFinal(game,tip+3*h);
    await settleStudy(db,final,box);
    await settleStudy(db,final,box);
  }
  const latest=await readLab(), score=latest.experiments[0].score;
  assert.equal(score.evaluated_games,2);
  assert.ok(score.evaluated_cases>0);
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
  assert.equal(closed.active_id,null);
  assert.equal(closed.experiments[0].score.decision,'ABANDONNER');
  assert.equal(closed.experiments[0].score.evaluated_games,2);
  assert.equal(closed.auto_adoption,false);
  await deliver(signal);
  assert.deepEqual(await readLab(),closed);
});
