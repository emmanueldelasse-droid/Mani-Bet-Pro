import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateStudyGame, studyPair, summarizeStudy } from '../evaluation-study.mjs';

const game = { id:'12345', start:'2030-03-10T21:00:00Z', status:'STATUS_FINAL',
  home:{ id:'h', score:115 }, away:{ id:'a', score:100 } };
const at = '2030-03-10T20:00:00Z';
const box = { game_id:game.id, teams:{ h:{players:[{id:'1',name:'Test Player',points:21,minutes:35}]}, a:{players:[]} } };
function makePair() {
  const base = {probability_home:.7, projected_score:{home:120,away:110}};
  const player = {id:'1', projected_minutes_if_active:30, predicted_points_if_active:18};
  const trial = {match_id:game.id, state:'SHADOW_FORECAST', forecast:{probability_home:.8,projected_score:{home:112,away:106}},
    teams:{home:{players:[{id:'1', minutes_if_active:35,points_if_active:17.5}]},away:{players:[]}}};
  return studyPair(game, at, 'frozen-input', base, { home:{players:[player]}, away:{players:[]} }, trial);
}

test('compares the deployed primary and challenger shape at a single instant', () => {
  const pair = makePair(), row = evaluateStudyGame({game,box,pair});
  assert.equal(row.exclusion,null);
  const p = row.players.rows[0];
  assert.equal(p.primary.minutes_error,-5);
  assert.equal(p.primary.minutes_points,-3);
  assert.equal(p.primary.production_error,0);
  assert.equal(p.variant.production_error,-3.5);
  const s = summarizeStudy([row,row]);
  assert.equal(s.analyzed_games,1);
  assert.equal(s.paired_games,1);
  assert.equal(s.primary.accuracy_pct,100);
  assert.equal(s.variant.total_mae,3);
  assert.equal(s.primary.total_mae,15);
  assert.equal(s.gain.player_mae,-0.5);
  assert.equal(s.gain.minutes_mae,5);
  assert.equal(s.primary.calibration[3].announced,.7);
  assert.equal(s.variant.calibration[4].observed,1);
  assert.equal(s.audits[0].primary_correct,true);
  assert.equal(s.audits[0].primary_total_error,15);
  assert.equal(s.audits[0].largest_minutes_miss.primary.name,'Test Player');
  assert.equal(s.audits[0].largest_minutes_miss.primary.points_error_from_minutes,-3);
  assert.equal(s.review.auto_promotion,false);
});

test('excludes mismatched, unverified and late pairs and still counts coverage', () => {
  for (const [change,wanted] of [
    [{at:'2030-03-10T20:16:00Z'},'OVER_15_MINUTES'],
    [{at:'2030-03-10T20:15:00Z'},'DIFFERENT_INSTANT'],
    [{at:game.start},'INVALID_OR_LATE_CAPTURE'],
    [{input_id:null},'UNVERIFIED_INPUTS'],
    [{input_id:'other'},'DIFFERENT_INPUTS'],
    [{game_id:'67890'},'WRONG_MATCH']
  ]) {
    const pair=makePair(); Object.assign(pair.variant,change);
    const summary=summarizeStudy([evaluateStudyGame({game,box,pair})]);
    assert.equal(summary.paired_games,0); assert.equal(summary.excluded[wanted],1);
    assert.equal(summary.primary.accuracy_pct,null);
  }
  const pair=makePair(); pair.variant=null;
  assert.equal(evaluateStudyGame({game,box,pair}).exclusion,'MISSING_CAPTURE');
  assert.equal(evaluateStudyGame({game:{...game,status:'IN_PROGRESS'},pair}),null);
});

test('an absent box affects only player metrics and a pick at 50% abstains', () => {
  const pair=makePair(); pair.primary.forecast.probability_home=.5;
  const records=[evaluateStudyGame({game,pair})];
  const s=summarizeStudy(records);
  assert.equal(s.games_with_box,0);
  assert.equal(s.player_pairs,0);
  assert.equal(s.primary.player_mae,null);
  assert.equal(s.primary.accuracy_n,0);
  assert.equal(s.primary.brier,.25); assert.equal(s.variant.accuracy_n,0);
});

test('classifies controlled MacFly revisions, previously known facts and late facts', () => {
  const pair=makePair();
  const r={group_id:'g',at,kinds:['role','absence'],player_ids:['1'],controlled:true,
    before:pair.primary,after:pair.variant};
  const row=evaluateStudyGame({game,box,pair,revisions:[
    r,r,{...r,group_id:'old',already_known:true},{...r,group_id:'late',at:game.start},
    {...r,group_id:'earlier',before:{...r.before,at:'2030-03-10T19:40:00Z'},controlled:false},
    {...r,group_id:'wrong pair',before:{...r.before,input_id:'different'}}
  ]});
  const s=summarizeStudy([row]);
  assert.equal(row.revisions.length,4); assert.equal(s.macfly.already_known_groups,1);
  assert.equal(s.macfly.controlled.length,1);
  assert.equal(s.macfly.descriptive.length,1); assert.equal(s.macfly.excluded_groups,1);
  const group=s.macfly.controlled[0];
  assert.deepEqual(group.kinds,['absence','role']);
  assert.equal(group.groups,1); assert.equal(group.gain.total_mae,12);
  assert.equal(group.gain.production_mae,-3.5);
  assert.equal(group.intervals.brier.approximate_95pct,null);
});

test('one missing player in a final box cannot count as a correctly predicted zero', () => {
  const pair=makePair();
  const boxWithoutPlayer={...box,teams:{h:{players:[]},a:{players:[]}}};
  const s=summarizeStudy([evaluateStudyGame({game,box:boxWithoutPlayer,pair})]);
  assert.equal(s.player_pairs,0); assert.equal(s.absent_or_missing,1);
});

test('reports an observed false absence and only measures rate where minutes were projected', () => {
  const pair=makePair(); pair.variant.player_points.home.players[0].status='OUT';
  const s=summarizeStudy([evaluateStudyGame({game,box,pair})]);
  assert.equal(s.counts.player_mae,1); assert.equal(s.counts.minutes_mae,1);
  assert.equal(s.counts.production_mae,0);
  assert.equal(s.variant.incorrect_absence_among_paired,1);
  assert.equal(s.variant.player_mae,21);
});

test('historical audit reproduces the delay and errors for the Pacers at Knicks example', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/historical-example.json',import.meta.url),'utf8'));
  const g = fixture.game, real = g.final_score.home + g.final_score.away;
  assert.equal(real,219);
  assert.equal(g.p1.home + g.p1.away - real,.5);
  assert.equal(Number((g.p2.home + g.p2.away - real).toFixed(2)),-7.03);
  assert.equal(g.player.primary_minutes - g.player.actual_minutes,13);
  assert.equal(fixture.official_player.minutes_seconds,'01:24');
  const archived=fixture.archive_comparison;
  assert.equal(archived.pairs,301);
  assert.equal(archived.delayed.filter(r => Math.abs(Date.parse(r.variant_at)-Date.parse(r.primary_at))>900000).length,15);
  assert.equal(archived.final_exclusions.length,2);
  for (const x of archived.final_exclusions)
    assert.equal(Number((Math.abs(Date.parse(x.variant_at)-Date.parse(x.primary_at))/60000).toFixed(3)),x.gap_minutes);
});
