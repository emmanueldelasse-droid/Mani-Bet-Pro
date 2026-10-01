#!/usr/bin/env node
/**
 * NBA recent-form EMA shadow observability.
 *
 * Production behavior MUST stay on the historical formula:
 *   ema = lambda * newest_result + (1-lambda) * previous_ema
 *
 * Shadow compares a decay-lambda interpretation:
 *   ema = (1-lambda) * newest_result + lambda * previous_ema
 *
 * The shadow is observation-only and must never enter variables_used/scoring.
 */

import './lib/dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';
import {
  extractVariables,
  computeRecentFormEMAShadow,
} from '../src/engine/engine.nba.variables.js';
import { EngineNBA } from '../src/engine/engine.nba.js';

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

const recent = winsNewestFirst => ({
  matches: winsNewestFirst.map((won, i) => ({
    date: `2026-10-${String(19 - i).padStart(2, '0')}`,
    won,
    is_home: i % 2 === 0,
  })),
});

const home = recent([true, false, false, false, false]);
const away = recent([false, false, false, false, false]);

// Regular-season lambda 0.85.
// Latest result contribution under current behavior = 85%.
const shadow85 = computeRecentFormEMAShadow(home, away, 0.85);
eq(shadow85.status, 'AVAILABLE', 'frontend shadow available');
eq(shadow85.lambda, 0.85, 'regular lambda observed');
eq(shadow85.legacy_value, 1.7, 'legacy current EMA diff remains 1.70');
eq(shadow85.decay_lambda_value, 0.3, 'decay-lambda shadow diff is 0.30');
eq(shadow85.delta, -1.4, 'shadow delta is explicit');
eq(shadow85.latest_result_weight_legacy, 0.85,
  'legacy formula gives latest result 85% weight');
eq(shadow85.latest_result_weight_decay, 0.15,
  'decay interpretation gives latest result 15% weight');
eq(shadow85.drives_decision, false,
  'frontend shadow is explicitly observation-only');

// Playoff lambda 0.92.
const shadow92 = computeRecentFormEMAShadow(home, away, 0.92);
eq(shadow92.legacy_value, 1.84, 'playoff legacy diff = 1.84');
eq(shadow92.decay_lambda_value, 0.16, 'playoff decay shadow diff = 0.16');
eq(shadow92.delta, -1.68, 'playoff shadow delta = -1.68');
eq(shadow92.latest_result_weight_legacy, 0.92,
  'playoff legacy latest weight = 92%');
eq(shadow92.latest_result_weight_decay, 0.08,
  'playoff decay latest weight = 8%');

// Production frontend variable remains the legacy value.
const vars = extractVariables({
  home_recent: home,
  away_recent: away,
  __ema_lambda: 0.85,
});
eq(vars.recent_form_ema.value, 1.7,
  'production frontend recent_form_ema is unchanged');

// Backend parity.
const backShadow = backend._botComputeRecentFormEMAShadow(home, away, 0.85);
eq(backShadow.legacy_value, shadow85.legacy_value,
  'backend/frontend legacy shadow value parity');
eq(backShadow.decay_lambda_value, shadow85.decay_lambda_value,
  'backend/frontend decay shadow value parity');
eq(backShadow.delta, shadow85.delta,
  'backend/frontend shadow delta parity');
eq(backShadow.drives_decision, false,
  'backend shadow is observation-only');

const backVars = backend._botExtractVariables({
  home_recent: home,
  away_recent: away,
}, 0.85);
eq(backVars.recent_form_ema.value, 1.7,
  'production backend recent_form_ema is unchanged');

// Engine output exposes shadow but variables_used contains only production signal.
const fixture = structuredClone(FIXTURES[0].data);
fixture.home_recent = home;
fixture.away_recent = away;
fixture.game_datetime = '2026-10-20T23:00:00Z';
fixture.game_date = '20261020';
fixture.event_type = 'REGULAR';
fixture.season_type = 2;
fixture.season_id = '2026-27';

const frontEngine = EngineNBA.compute(fixture);
eq(frontEngine.recent_form_ema_shadow?.legacy_value, 1.7,
  'EngineNBA exposes legacy comparison');
eq(frontEngine.recent_form_ema_shadow?.decay_lambda_value, 0.3,
  'EngineNBA exposes decay comparison');
eq(frontEngine.variables_used?.recent_form_ema?.value, 1.7,
  'EngineNBA scoring variable remains legacy');
assert(!Object.prototype.hasOwnProperty.call(
  frontEngine.variables_used ?? {}, 'recent_form_ema_decay_shadow'
), 'frontend shadow is not injected as a scoring variable');

const backEngine = backend._botEngineCompute(fixture);
eq(backEngine.recent_form_ema_shadow?.legacy_value, 1.7,
  'backend engine exposes legacy comparison');
eq(backEngine.recent_form_ema_shadow?.decay_lambda_value, 0.3,
  'backend engine exposes decay comparison');
eq(backEngine.variables_used?.recent_form_ema?.value, 1.7,
  'backend scoring variable remains legacy');
assert(!Object.prototype.hasOwnProperty.call(
  backEngine.variables_used ?? {}, 'recent_form_ema_decay_shadow'
), 'backend shadow is not injected as a scoring variable');

// Missing data fails closed, still no decision role.
const missing = computeRecentFormEMAShadow(null, away, 0.85);
eq(missing.status, 'UNAVAILABLE', 'missing recent form shadow unavailable');
eq(missing.drives_decision, false, 'missing shadow still cannot drive decision');

// Persistence/export guards.
const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
assert(worker.includes('recent_form_ema_shadow: analysis.recent_form_ema_shadow ?? null'),
  'KV log carries EMA shadow');
assert(worker.includes('recent_form_ema_legacy, recent_form_ema_decay_shadow'),
  'D1 analysis insert carries flattened EMA shadow');
assert(worker.includes("'recent_form_ema_legacy', 'recent_form_ema_decay_shadow'"),
  'CSV export carries EMA comparison fields');

const migration = readFileSync(
  resolve(ROOT, 'migrations/0006_nba_recent_form_ema_shadow.sql'),
  'utf8'
);
assert(migration.includes('recent_form_ema_decay_shadow REAL'),
  'D1 migration adds decay shadow field');
assert(migration.includes('recent_form_ema_shadow_delta REAL'),
  'D1 migration adds delta field');

console.log('\nNBA recent-form EMA shadow');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ legacy scoring preserved · decay-lambda comparison is observation-only\n');
