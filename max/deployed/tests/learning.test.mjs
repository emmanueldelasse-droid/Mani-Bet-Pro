import test from 'node:test';
import assert from 'node:assert/strict';
import {d1,g,iso,h,tip} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';
import {assessPublished} from '../published-evaluation.mjs';
import {processLearningReview,readLearning} from '../learning.mjs';
import {processPromptInbox} from '../prompt-lab-store.mjs';

const games=[g,{...g,id:'900000088'}];
function card(game){
  const at=iso(Date.now());
  return {...game,checked_at:at,study:{pair:{primary:{game_id:game.id,at,forecast:{probability_home:.62,projected_score:{home:110,away:108}},
    player_points:{home:{players:[{id:'88',team_id:game.home.id,name:'Joueur test',projected_minutes_if_active:30,predicted_points_if_active:15}]},away:{players:[]}}}}}};
}
async function prepare(db,t){
  t.mock.timers.enable({apis:['Date'],now:tip-h});
  for(const game of games)await savePublishedForecast(db,game,iso(Date.now()),card(game));
  assert.deepEqual((await readLearning(db,{queue:true})).pending,[]);
  t.mock.timers.setTime(tip+3*h);
  const scores=[];
  for(const game of games){
    const score={...game,status:'STATUS_FINAL',fetched_at:iso(Date.now()),home:{...game.home,score:118},away:{...game.away,score:99}};
    const box={game_id:game.id,fetched_at:iso(Date.now()),teams:{[game.home.id]:{players:[{id:'88',minutes:20,points:15}]},[game.away.id]:{players:[]}}};
    scores.push({score,box});await assessPublished(db,score,box);
  }
  return scores;
}
const review=p=>({id:'aud-'+p.assessment_key.replaceAll(':','-'),match_id:p.match_id,edition_id:p.edition_id,assessment_key:p.assessment_key,
  author:'Analyste Max',categories:['PLAYER_MINUTES','CORRECT_WITH_OFFSET'],priority_category:'PLAYER_MINUTES',
  finding:'30 minutes prévues contre 20 observées. Les 15 points annoncés ont été marqués.',hypothesis:'Une rotation différente reste à vérifier.',
  action:'RESEARCH_TEST',evidence:[{kind:'PLAYER',player_id:'88'}]});
const send=(db,x)=>db.prepare('INSERT INTO learning_inbox(payload) VALUES(?)').bind(JSON.stringify(x)).run();

test('isolated measurement, immutable audit, two separate matches, corrected score invalidates only the affected lesson',async t=>{
  const db=d1(),results=await prepare(db,t);
  const source=await readLearning(db,{queue:true});assert.equal(source.pending.length,2);
  const [pa,pb]=source.pending.map(review);
  send(db,pa);send(db,pa);
  assert.throws(()=>send(db,{...pa,finding:'Édité'}),/LEARNING_SUBMISSION_CONFLICT/);
  assert.throws(()=>send(db,{...pa,id:pa.id+'b'}),/LEARNING_SUBMISSION_CONFLICT/);
  const accepted=await processLearningReview(db,pa.id);
  assert.equal(accepted.status,'ACCEPTED');assert.equal(accepted.observations.find(o=>o.measure==='minutes').error,10);
  assert.deepEqual(await processLearningReview(db,pa.id),accepted);
  assert.equal((await readLearning(db)).lessons.length,0);
  send(db,pb);await processLearningReview(db,pb.id);
  const all=await readLearning(db,{queue:true});
  assert.deepEqual(all.counts,{audited_matches:2,pending_reviews:0,lessons:1});
  assert.deepEqual(all.pending,[]);assert.equal(all.lessons[0].id,'PLAYER_MINUTES-RESEARCH_TEST');
  assert.equal(all.lessons[0].match_count,2);assert.equal(all.lessons[0].experiment_id,null);
  assert.throws(()=>db.prepare('DELETE FROM learning_reviews WHERE id=?').bind(pa.id).run(),/LEARNING_IMMUTABLE/);
  assert.throws(()=>db.prepare("UPDATE learning_inbox SET payload='{}' WHERE id=?").bind(pa.id).run(),/LEARNING_IMMUTABLE/);
  t.mock.timers.setTime(tip+4*h);
  const {score}=results[0],correction={...score,fetched_at:iso(Date.now()),home:{...score.home,score:119}};
  await assessPublished(db,correction,null);
  const after=await readLearning(db,{queue:true,matchId:score.id});
  assert.equal(after.pending.length,1);assert.equal(after.reviews[0].current,false);
  assert.equal(after.lessons.length,0);assert.equal(after.pending[0].review.box_observation_id,null);
  assert.notEqual(after.pending[0].assessment_key,pa.assessment_key);
  const op={...review(after.pending[0]),id:'corrected-observation',priority_category:'DATA_GAP',categories:['DATA_GAP'],
    action:'DATA_REPAIR',evidence:[{kind:'MATCH'}],finding:'Cette feuille ne correspond plus au score corrigé.'};
  send(db,op);assert.equal((await processLearningReview(db,op.id)).status,'ACCEPTED');
  const history=await readLearning(db,{matchId:score.id});
  assert.deepEqual(history.reviews.map(x=>x.current),[true,false]);
  assert.equal(history.counts.audited_matches,2);
});

test('unmeasured category, unknown player or final, late review of stale observations are rejected and repairable',async t=>{
  const db=d1();await prepare(db,t);
  const [candidate]=(await readLearning(db,{queue:true})).pending;
  const original=review(candidate);
  for(const [id,patch,reason] of [
    ['unknown-category',{categories:['HUNCH'],priority_category:'HUNCH'},'INVALID_CATEGORY_OR_ACTION'],
    ['wrong-player',{evidence:[{kind:'PLAYER',player_id:'900'}]},'CATEGORY_OR_PLAYER_NOT_SUPPORTED'],
    ['wrong-winner',{categories:['WINNER'],priority_category:'WINNER',evidence:[{kind:'MATCH'}]},'CATEGORY_OR_PLAYER_NOT_SUPPORTED'],
    ['wrong-edition',{edition_id:567},'ASSESSMENT_UNAVAILABLE_OR_SUPERSEDED'],
    ['invented-final',{match_id:'900000089'},'ASSESSMENT_UNAVAILABLE_OR_SUPERSEDED']]){
    send(db,{...original,id,...patch});const out=await processLearningReview(db,id);
    assert.equal(out.status,'REJECTED');assert.equal(out.reason,reason);
  }
  send(db,original);assert.equal((await processLearningReview(db,original.id)).status,'ACCEPTED');
});

test('only a registered MacFly test supported by two audited matches links to the recurring lesson',async t=>{
  const db=d1();await prepare(db,t);
  const pending=(await readLearning(db,{queue:true})).pending;
  for(const item of pending){
    const input=review(item);send(db,input);await processLearningReview(db,input.id);
  }
  const id='macfly-recurring-test',evidence=[];
  for(const item of pending){
    const game=games.find(g=>g.id===item.match_id),pre=iso(tip-h);
    const p={after:{primary:{players:[{player_id:'88',team_id:game.home.id,name:'Joueur test',official_for_game:false}]}},facts:[]};
    const written=db.prepare('INSERT INTO max_forecast_versions(match_id,as_of,tip,integrated_at,payload) VALUES (?,?,?,?,?)')
      .bind(game.id,pre,game.start,pre,JSON.stringify(p)).run();
    evidence.push({match_id:game.id,player_id:'88',version_id:written.meta.last_row_id,observation:'La capture du joueur ne contient pas son statut.'});
  }
  const raw={id,author:'MacFly',action:'TEST',target:'AVAILABILITY',diagnosis:'MISSING',evidence,learning_ref:'PLAYER_MINUTES-RESEARCH_TEST',
    problem:'Disponibilité absente dans deux prévisions aux minutes éloignées des minutes jouées.',hypothesis:'Un statut vérifié aiderait les projections.',
    prompt:'Rechercher le statut dans le bulletin NBA à l’heure de la collecte.',metric:'minutes_mae',criterion:{min_games:1,min_dates:1,min_gain:0.5},
    cohort:{start:iso(tip+23*h),end:iso(tip+25*h)},targets:[{match_id:'900000177',tip:iso(tip+24*h),source_url:'https://www.espn.com/nba/game/_/gameId/900000177'}]};
  db.prepare('INSERT INTO prompt_lab_inbox(payload) VALUES(?)').bind(JSON.stringify(raw)).run();
  assert.equal((await readLearning(db)).lessons[0].experiment_id,null);
  const [registered]=await processPromptInbox(db,id);assert.equal(registered.status,'ACTIVE');
  const result=(await readLearning(db)).lessons[0];
  assert.equal(result.experiment_id,id);assert.equal(result.status,'TEST_REGISTERED');assert.equal(result.experiment.metric,'minutes_mae');
  assert.equal(result.experiment.evaluated_games,0);assert.equal(result.experiment.adoption_applied,false);
});

test('a guessed result key submitted before the observed final is never credited',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-h});
  const db=d1(),edition=await savePublishedForecast(db,g,iso(Date.now()),card(g));
  const input={...review({edition_id:edition.id,match_id:g.id,assessment_key:edition.id+':1:0'}),id:'guessed-result',
    categories:['ON_TARGET'],priority_category:'ON_TARGET',action:'MONITOR',evidence:[{kind:'MATCH'}],finding:'Le favori gagne.'};
  send(db,input);t.mock.timers.setTime(tip+3*h);
  await assessPublished(db,{...g,status:'STATUS_FINAL',fetched_at:iso(Date.now()),home:{...g.home,score:118},away:{...g.away,score:99}},null);
  assert.equal((await processLearningReview(db,input.id)).status,'REJECTED');
  const next={...input,id:'observe-after-result'};send(db,next);
  assert.equal((await processLearningReview(db,next.id)).status,'ACCEPTED');
});
