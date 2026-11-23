import test from 'node:test';
import assert from 'node:assert/strict';
import {coherentGameForecast,publishedGame,publishedSlate} from '../publication-runtime.mjs';
import {projectPlayerPoints} from '../points.mjs';
import {rotationTrial} from '../experiments.mjs';
import {studyPair} from '../evaluation-study.mjs';
import {fixture,g} from './study-journey-fixture.mjs';

test('la même projection conditionnelle alimente carte, intervalles, seuils, scénarios et rapport',()=>{
  const ctx=fixture();
  const at=ctx.sourceAt,rosters=new Map(ctx.rosters);
  const official=[{team_id:'10',player:'Joueur 10 1',status:'QUESTIONABLE',source_url:'https://official.nba.com/'}];
  const points=projectPlayerPoints(ctx.game,ctx.boxes,ctx.injuries,official,ctx.forecast,at);
  const trial=rotationTrial(ctx.game,ctx.boxes,rosters,official,[],ctx.forecast,at,ctx.medical);
  const original={...g,checked_at:at,official_medical:ctx.medical,
    independent_analysis:{advanced:{forecast:{probability_home:.999},player_points:{away:{players:[]},home:{players:[]}}}}};
  const pair=studyPair(ctx.game,at,'same-input',ctx.forecast,points,trial);
  // The real journal is compact: it records an identity and rounded expected values per player.
  for(const side of ['home','away'])pair.primary.player_points={...pair.primary.player_points,[side]:{
    players:points[side].players.map(p=>({id:p.id,predicted_points_if_active:p.predicted_points_if_active,
      projected_minutes_if_active:p.projected_minutes_if_active}))}};
  if(pair.variant)pair.variant.player_points=Object.fromEntries(['home','away'].map(s=>[s,{players:trial.teams[s].players.map(p=>({
    id:p.id,predicted_points_if_active:p.points_if_active,projected_minutes_if_active:p.minutes_if_active}))}]));
  const card={integrated_at:at,pair};
  const updated=coherentGameForecast(original,{studyUpdate:{card,context:ctx,points,trial,official,roles:[]},rosters});
  assert.equal(original.independent_analysis.advanced.forecast.probability_home,.999);
  const adv=updated.independent_analysis.advanced,p=adv.player_points.home.players.find(x=>x.id==='1001');
  const section=id=>updated.automatic_report.sections.find(s=>s.section_id===id).data;
  assert.deepEqual(adv.forecast,pair.primary.forecast);
  assert.deepEqual(section(10).forecast,adv.forecast);
  assert.deepEqual(section(10).player_points,adv.player_points);
  assert.equal(p.predicted_points_if_active,section(5).home.find(x=>x.id===p.id).points_if_active);
  assert.equal(p.scenarios.available.points,p.predicted_points_if_active);
  assert.equal(p.scenarios.out.minutes,0);
  assert.ok(p.predicted_interval_80_if_active && Number.isFinite(p.probability_points_at_least_if_active['20']));
  assert.throws(()=>coherentGameForecast({...original,study:card}),/EDITION_TEAM_FORECAST_MISMATCH/);
});

test('la lecture sans édition masque les projections à venir et une édition conserve ses chiffres malgré un nouveau score',async()=>{
  const unsealed={...g,independent_analysis:{advanced:{forecast:{probability_home:0.6}}},study:{pair:{}}};
  const env={};
  const pending=await publishedGame(env,unsealed),slate=await publishedSlate(env,{games:[unsealed]});
  assert.equal(pending.publication_status,'AWAITING_PREGAME_PUBLICATION');
  assert.equal(pending.independent_analysis,undefined);
  assert.deepEqual(slate.games[0],pending);
  const edition={id:42,as_of:g.start,published_at:g.start,tip:g.start,content_hash:'test',visible:unsealed};
  const final={...unsealed,status:'STATUS_FINAL',home:{...unsealed.home,score:111},study:{prompt_experiments:[{id:'lab'}]},
    independent_analysis:{advanced:{forecast:{probability_home:.001}}}};
  const visible=await publishedGame(env,final,edition);
  assert.equal(visible.status,'STATUS_FINAL');
  assert.equal(visible.home.score,111);
  assert.equal(visible.independent_analysis.advanced.forecast.probability_home,.6);
  assert.equal(visible.publication.id,42);
  assert.deepEqual(visible.study.prompt_experiments,[{id:'lab'}]);
  const postponed={...unsealed,start:'2031-12-01T00:00:00.000Z'};
  assert.equal((await publishedGame(env,postponed,edition)).publication,null);
});
