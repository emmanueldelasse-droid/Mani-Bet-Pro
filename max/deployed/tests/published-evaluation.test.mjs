import test from 'node:test';
import assert from 'node:assert/strict';
import {d1,g,iso,h,tip} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';
import {assessPublished,readPublishedAssessment} from '../published-evaluation.mjs';
import {parseBoxscore} from '../advanced.mjs';

const pred=(id,name,minutes,points,extra={})=>({id,name,team_id:g.home.id,projected_minutes_if_active:minutes,predicted_points_if_active:points,...extra});
function card(time,home){
  const group={home:{players:[
    pred('8','Aline',20,10,{availability:'OFFICIAL_UNCERTAIN',status:'QUESTIONABLE',
      scenarios:{available:{minutes:20,points:10},limited:{minutes:12,points:6},out:{minutes:0,points:0}}}),
    pred('9','Bea',22,14),pred('10','Camille',24,12,{availability:'OFFICIAL_OUT'}),
    pred('11','Dani',null,null)]},away:{players:[]}};
  const forecast={engine_version:'main',probability_home:.56,projected_score:{home,away:100}};
  return {...g,checked_at:iso(time),study:{pair:{primary:{at:iso(time),game_id:g.id,forecast,player_points:group}}},
    independent_analysis:{advanced:{player_points:group}}};
}
const final=at=>({...g,status:'STATUS_FINAL',fetched_at:iso(at),home:{...g.home,score:113},away:{...g.away,score:98}});
function finalBox(at){return {game_id:g.id,fetched_at:iso(at),start:g.start,source_url:'https://www.espn.com/test-box',
  teams:{[g.home.id]:{players:[{id:'8',name:'Aline',minutes:12,points:10}],did_not_play:[{id:'10',name:'Camille',reason:'Coach'}]},
    [g.away.id]:{players:[]}}};}

test('seule une édition publiée compte ; un score exact peut masquer des erreurs de minutes et de rendement',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-2*h});const db=d1();
  const first=await savePublishedForecast(db,g,iso(Date.now()),card(Date.now(),103));
  t.mock.timers.setTime(tip-h);const last=await savePublishedForecast(db,g,iso(Date.now()),card(Date.now(),110));
  assert.equal(await readPublishedAssessment(db,g.id),null);
  t.mock.timers.setTime(tip+4*h);
  const score=final(Date.now()),box=finalBox(Date.now());
  const review=await assessPublished(db,score,box);
  assert.equal(review.edition_id,last.id);assert.equal(review.coverage.listed_players,4);
  assert.equal(review.game.winner.correct,true);assert.equal(review.game.winner.brier,.1936);
  assert.deepEqual(review.game.home,{forecast:110,actual:113,error:-3});
  assert.deepEqual(review.game.margin,{forecast:10,actual:15,error:-5});
  const [p,unknown,out,noSample]=review.players;
  assert.equal(p.points.error,0);assert.equal(p.minutes.error,8);
  assert.equal(p.minutes_points,4);assert.equal(p.production_error,-4);assert.equal(p.offsetting_errors,true);
  assert.equal(p.scenarios.find(s=>s.label==='limited').applicability,'UNVERIFIED_CONDITION');
  assert.equal(p.scenarios.find(s=>s.label==='limited').points.error,null);
  assert.deepEqual(review.findings.find(f=>f.category==='OFFSETTING_PLAYER_ERRORS').player_ids,['8']);
  assert.equal(unknown.participation,'UNKNOWN');assert.equal(unknown.points.actual,null);
  assert.equal(out.participation,'CONFIRMED_DNP');assert.equal(out.points.error,0);assert.equal(out.minutes.error,null);
  assert.equal(noSample.points.forecast,null);assert.equal(noSample.points.error,null);
  const previous=await readPublishedAssessment(db,g.id,first.id);
  assert.equal(previous.game.home.error,-10);assert.equal(previous.box_observation_id,review.box_observation_id);
  assert.equal(await readPublishedAssessment(db,'900000002',first.id),null);
  assert.equal(db.prepare('SELECT count(*) n FROM published_final_observations').first().n,2);
  t.mock.timers.setTime(tip+5*h);
  assert.equal((await assessPublished(db,final(Date.now()),finalBox(Date.now()))).assessment_key,review.assessment_key);
  assert.equal(db.prepare('SELECT count(*) n FROM published_final_observations').first().n,2);
  const corrected=final(Date.now());corrected.home.score++;
  const changed=await assessPublished(db,corrected,null);
  assert.notEqual(changed.assessment_key,review.assessment_key);assert.equal(changed.box_observation_id,null);
  assert.equal(changed.coverage.measured_minutes,0);
  await assessPublished(db,score,box);
  assert.deepEqual((await readPublishedAssessment(db,g.id)).assessment_key,changed.assessment_key);
});
test('aucune rétroprediction ni feuille non horodatée ; le contrôle des scénarios exige une condition observée',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-h});const db=d1();
  const ordinary=card(Date.now(),103),player=ordinary.study.pair.primary.player_points.home.players[0];
  ordinary.automatic_report={sections:[{section_id:6,data:{scenarios:{players:[{
    team:'home',team_id:g.home.id,player:player.name,player_id:player.id,
    variants:{absent:{player_minutes:0,player_points_if_active:0,projected_score_hypothesis:{home:100}}}
  }]}}}]};
  await savePublishedForecast(db,g,iso(Date.now()),ordinary);
  t.mock.timers.setTime(tip+3*h);
  const result=final(Date.now());
  assert.equal(await assessPublished(db,{...result,fetched_at:undefined},null),null);
  assert.equal((await assessPublished(db,result,finalBox(tip-10))).box_observation_id,null);
  const actual=finalBox(Date.now());actual.teams[g.home.id].players=[];
  actual.teams[g.home.id].did_not_play.push({id:player.id});
  const review=await assessPublished(db,result,actual),p=review.players[0];
  assert.equal(p.participation,'CONFIRMED_DNP');assert.equal(p.points.actual,0);assert.equal(p.points.error,null);
  assert.equal(p.scenarios.find(s=>s.label==='out').points.error,0);
  assert.equal(review.team_scenarios[0].variants[0].team_score.error,-13);
  assert.equal(await assessPublished(db,{...result,id:'888888888'},actual),null);
  assert.equal(await readPublishedAssessment(db,'888888888'),null);
});
test('seule une mention ESPN didNotPlay identifie un absent confirmé dans la feuille validée',()=>{
  const event=final(tip+3*h);
  const sheet={boxscore:{players:['home','away'].map(side=>({team:{id:g[side].id},statistics:[
    {labels:['MIN','PTS'],athletes:Array.from({length:5},(_,i)=>({athlete:{id:side+i,displayName:'Titulaire '+i},stats:['48',String(i===0?event[side].score:0)]}))},
    {labels:[],athletes:[{athlete:{id:'declared',displayName:'Joueur absent'},didNotPlay:true,reason:'Coach'},
      {athlete:{id:'omitted',displayName:'Joueur sans données'},stats:[]}]}
  ]}))}};
  const box=parseBoxscore(sheet,event);
  assert.deepEqual(box.teams[g.home.id].did_not_play,[{id:'declared',name:'Joueur absent',team_id:g.home.id,reason:'Coach'}]);
  assert.equal(box.teams[g.home.id].players.length,5);
});
test('les seuils, intervalles de score et détails conditionnels viennent de la même édition affichée',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-h});const db=d1(),visible=card(Date.now(),110);
  const advanced=visible.independent_analysis.advanced;
  advanced.forecast={...visible.study.pair.primary.forecast,interval_80:{home:[104,117],away:[100,120],total:[200,225]}};
  advanced.player_points=structuredClone(advanced.player_points);
  Object.assign(advanced.player_points.home.players[0],{
    predicted_interval_80_if_active:[5,15],probability_points_at_least_if_active:{10:.65,15:.35}
  });
  advanced.player_points.home.players[1].probability_points_at_least_if_active={5:.9};
  await savePublishedForecast(db,g,iso(Date.now()),visible);
  t.mock.timers.setTime(tip+3*h);const review=await assessPublished(db,final(Date.now()),finalBox(Date.now()));
  assert.deepEqual(review.game.intervals_80.home,{low:104,high:117,nominal:.80,covered:true});
  assert.equal(review.game.intervals_80.away.covered,false);assert.equal(review.game.intervals_80.total.covered,true);
  assert.equal(review.players[0].interval_80_if_active.covered,true);
  assert.deepEqual(review.players[0].thresholds_if_active,[
    {at_least:10,probability:.65,actual:true,brier:.1225},{at_least:15,probability:.35,actual:false,brier:.1225}]);
  assert.deepEqual(review.players[1].thresholds_if_active,[{at_least:5,probability:.9,actual:null,brier:null}]);
});
