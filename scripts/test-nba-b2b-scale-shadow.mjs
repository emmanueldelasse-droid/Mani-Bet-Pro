#!/usr/bin/env node
/**
 * NBA back-to-back scale shadow.
 *
 * Backend canonical production value remains ±0.6.
 * Frontend historical value remains ±1.
 * This suite measures the counterfactual score delta without changing decisions.
 */

import './lib/dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';
import { extractVariables } from '../src/engine/engine.nba.variables.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let assertions = 0;
let failures = 0;
const assert = (cond, msg) => {
  assertions++;
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};
const eq = (a, e, msg) =>
  assert(JSON.stringify(a) === JSON.stringify(e),
    `${msg} · expected=${JSON.stringify(e)} actual=${JSON.stringify(a)}`);

function makeFixture(homeB2B, awayB2B, eventType = 'REGULAR', seasonType = 2) {
  const fx = structuredClone(FIXTURES[0].data);
  fx.home_back_to_back = homeB2B;
  fx.away_back_to_back = awayB2B;
  fx.game_datetime = eventType === 'POSTSEASON'
    ? '2027-05-10T23:00:00Z'
    : '2026-10-20T23:00:00Z';
  fx.game_date = eventType === 'POSTSEASON' ? '20270510' : '20261020';
  fx.event_type = eventType;
  fx.season_type = seasonType;
  fx.season_id = '2026-27';
  fx.__ema_lambda = eventType === 'POSTSEASON' ? 0.92 : 0.85;
  return fx;
}

// ── Regular season · home B2B ───────────────────────────────────────────────
const homeB2B = makeFixture(true, false);
const bHomeVars = backend._botExtractVariables(homeB2B, 0.85);
const fHomeVars = extractVariables(homeB2B);

eq(bHomeVars.back_to_back.value, -0.6,
  'backend production home B2B remains -0.6');
eq(fHomeVars.back_to_back.value, -1,
  'frontend historical home B2B remains -1');

const regularWeights = backend._botGetWeights(homeB2B).weights;
eq(regularWeights.back_to_back, 0.02,
  'regular B2B weight remains 0.02');

const homeShadow = backend._botBuildB2BScaleShadow(bHomeVars, regularWeights);
eq(homeShadow.status, 'AVAILABLE', 'home B2B shadow available');
eq(homeShadow.backend_value, -0.6, 'shadow records backend value');
eq(homeShadow.frontend_scale_shadow_value, -1,
  'shadow counterfactual uses frontend scale');
eq(homeShadow.weight, 0.02, 'shadow records active regular weight');
eq(homeShadow.drives_decision, false, 'B2B shadow is observation-only');

const currentHomeScore = backend._botComputeScore(bHomeVars, regularWeights).score;
eq(homeShadow.weighted_sum_score_current, currentHomeScore,
  'shadow current score equals real weighted-sum score');

const homeShadowVars = structuredClone(bHomeVars);
homeShadowVars.back_to_back.value = -1;
const manualHomeShadowScore = backend._botComputeScore(homeShadowVars, regularWeights).score;
eq(homeShadow.weighted_sum_score_shadow, manualHomeShadowScore,
  'counterfactual score matches manual frontend-scale substitution');
eq(
  homeShadow.score_delta,
  Math.round((manualHomeShadowScore - currentHomeScore) * 10000) / 10000,
  'home B2B score delta exact'
);
assert(Math.abs(homeShadow.score_delta) <= 0.005,
  'regular scale divergence impact stays around <=0.5 probability point');

// ── Regular season · away B2B ───────────────────────────────────────────────
const awayB2B = makeFixture(false, true);
const bAwayVars = backend._botExtractVariables(awayB2B, 0.85);
const fAwayVars = extractVariables(awayB2B);
eq(bAwayVars.back_to_back.value, 0.6,
  'backend production away B2B remains +0.6');
eq(fAwayVars.back_to_back.value, 1,
  'frontend historical away B2B remains +1');

const awayShadow = backend._botBuildB2BScaleShadow(bAwayVars, regularWeights);
eq(awayShadow.frontend_scale_shadow_value, 1,
  'away counterfactual uses +1');
assert(Math.abs(awayShadow.score_delta) <= 0.005,
  'away regular scale divergence impact stays around <=0.5 probability point');

// ── Both / neither B2B ──────────────────────────────────────────────────────
const both = makeFixture(true, true);
const bothVars = backend._botExtractVariables(both, 0.85);
const bothShadow = backend._botBuildB2BScaleShadow(bothVars, regularWeights);
eq(bothVars.back_to_back.value, 0,
  'both B2B => neutral production value');
eq(bothShadow.frontend_scale_shadow_value, 0,
  'both B2B => neutral frontend-scale shadow');
eq(bothShadow.score_delta, 0,
  'neutral B2B has zero counterfactual delta');

// ── Playoffs · weight zero ──────────────────────────────────────────────────
const playoff = makeFixture(true, false, 'POSTSEASON', 3);
const playoffVars = backend._botExtractVariables(playoff, 0.92);
const playoffWeights = backend._botGetWeights(playoff).weights;
eq(playoffWeights.back_to_back, 0,
  'playoff B2B weight remains zero');
const playoffShadow = backend._botBuildB2BScaleShadow(playoffVars, playoffWeights);
eq(playoffShadow.backend_value, -0.6,
  'playoff still observes backend raw B2B value');
eq(playoffShadow.frontend_scale_shadow_value, -1,
  'playoff shadow still observes scale mismatch');
eq(playoffShadow.score_delta, 0,
  'playoff scale mismatch has zero weighted-score effect while weight=0');

// ── Engine decision path remains current backend scale ──────────────────────
const engineResult = backend._botEngineCompute(homeB2B);
eq(engineResult.variables_used.back_to_back.value, -0.6,
  'engine scoring input remains backend -0.6');
eq(engineResult.back_to_back_scale_shadow?.drives_decision, false,
  'engine exposes observation-only B2B shadow');
eq(
  engineResult.back_to_back_scale_shadow?.weighted_sum_score_current,
  currentHomeScore,
  'engine shadow reports current weighted score without substituting it'
);

// Missing value fails closed.
const unavailable = backend._botBuildB2BScaleShadow({
  back_to_back: { value: null, quality: 'MISSING' },
}, regularWeights);
eq(unavailable.status, 'UNAVAILABLE',
  'missing B2B produces unavailable shadow');
eq(unavailable.drives_decision, false,
  'unavailable shadow cannot drive decision');

// Persistence/export guards.
const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
assert(worker.includes('back_to_back_scale_shadow: analysis.back_to_back_scale_shadow ?? null'),
  'KV log carries B2B scale shadow');
assert(worker.includes('b2b_backend_value, b2b_frontend_scale_shadow'),
  'D1 insert carries B2B shadow metrics');
assert(worker.includes("'b2b_backend_value', 'b2b_frontend_scale_shadow'"),
  'CSV export carries B2B shadow metrics');

const migration = readFileSync(
  resolve(ROOT, 'migrations/0007_nba_b2b_scale_shadow.sql'),
  'utf8'
);
assert(migration.includes('b2b_weighted_score_shadow REAL'),
  'D1 migration adds counterfactual weighted score');
assert(migration.includes('b2b_score_delta REAL'),
  'D1 migration adds score delta');

console.log('\nNBA back-to-back scale shadow');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ backend decision scale preserved · frontend-scale counterfactual observed only\n');
