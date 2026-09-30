#!/usr/bin/env node
/**
 * NBA Data Quality observability parity.
 *
 * Goal:
 * - keep backend decision gate on the historical coverage score;
 * - expose a second weighted score for observation only;
 * - use the same canonical quality weights as EngineCore frontend;
 * - surface degraded/fallback/freshness metadata without changing prediction.
 */

import './lib/dom-stub.mjs';
import { backend } from './lib/backend-engine.mjs';
import { EngineCore } from '../src/engine/engine.core.js';
import { getSportConfig } from '../src/config/sports.config.js';

let assertions = 0;
let failures = 0;
const assert = (cond, msg) => {
  assertions++;
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};
const eq = (actual, expected, msg) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);

const config = getSportConfig('NBA');
if (!config) throw new Error('NBA config unavailable');

const canonicalQualities = [
  'VERIFIED',
  'WEIGHTED',
  'PARTIAL',
  'ESTIMATED',
  'LOW_SAMPLE',
  'UNCALIBRATED',
  'INSUFFICIENT_SAMPLE',
  'MISSING',
];

const variables = {};
for (let i = 0; i < config.variables.length; i++) {
  const id = config.variables[i].id;
  const quality = canonicalQualities[i % canonicalQualities.length];
  variables[id] = {
    value: quality === 'MISSING' ? null : 0.1 + i / 100,
    quality,
    source: quality === 'ESTIMATED' ? 'espn_scoreboard_proxy' : 'fixture',
    fetched_at: i < 2 ? '2026-09-30T20:00:00Z' : null,
  };
}

const missing = Object.entries(variables)
  .filter(([, v]) => v.quality === 'MISSING')
  .map(([id]) => id);

const backendObs = backend._botBuildDataQualitySnapshot(variables, missing);
const frontendObs = EngineCore._assessDataQuality({
  variables_used: variables,
  missing_variables: missing,
  missing_critical: [],
}, config);

// 1. Weighted semantics must match the frontend's already-existing quality scale.
eq(
  backendObs.weighted_quality_score,
  frontendObs.score,
  'weighted score backend observation == frontend EngineCore score'
);

// 2. Legacy score must remain the exact old backend formula.
const expectedLegacy = Math.round(
  (1 - missing.length / Object.keys(variables).length) * 100
) / 100;
eq(
  backendObs.legacy_coverage_score,
  expectedLegacy,
  'legacy coverage score unchanged'
);

// 3. New score cannot drive decisions yet.
eq(backendObs.drives_decision, false,
  'weighted quality is observation-only');
eq(backendObs.decision_score_field, 'data_quality',
  'decision field remains historical data_quality');

// 4. LOW_SAMPLE / ESTIMATED / INSUFFICIENT_SAMPLE are explicitly degraded.
for (const q of ['LOW_SAMPLE', 'ESTIMATED', 'INSUFFICIENT_SAMPLE']) {
  const id = Object.keys(variables).find(k => variables[k].quality === q);
  if (id) {
    assert(backendObs.degraded_variables.includes(id),
      `${q} appears in degraded_variables`);
  }
}

// 5. Fallback observability.
const estimatedId = Object.keys(variables).find(k => variables[k].quality === 'ESTIMATED');
if (estimatedId) {
  assert(backendObs.fallback_variables.includes(estimatedId),
    'ESTIMATED/proxy variable appears in fallback_variables');
  eq(backendObs.breakdown[estimatedId].fallback, true,
    'fallback flag set in breakdown');
}

// 6. Freshness is observed, never scored yet.
eq(backendObs.freshness.timestamped_variables, 2,
  'timestamped variables counted');
eq(
  backendObs.freshness.variables_without_timestamp,
  Object.keys(variables).length - 2,
  'missing timestamps counted'
);
eq(backendObs.freshness.scoring_status, 'NOT_SCORED',
  'freshness does not affect DQ score yet');

// 7. Historical backend alias OK is canonicalized only for observation.
const okObs = backend._botBuildDataQualitySnapshot({
  legacy_ok: { value: 0.2, quality: 'OK', source: 'legacy' },
}, []);
eq(okObs.breakdown.legacy_ok.quality, 'VERIFIED',
  'legacy quality OK canonicalized to VERIFIED in observation');
eq(okObs.weighted_quality_score, 1,
  'legacy OK scores as verified for observation');

// 8. Unknown quality fails closed in observation, but does NOT alter the gate.
const unknownObs = backend._botBuildDataQualitySnapshot({
  odd: { value: 1, quality: 'SOMETHING_NEW', source: 'fixture' },
}, []);
eq(unknownObs.breakdown.odd.quality, 'UNKNOWN',
  'unknown quality classified explicitly');
eq(unknownObs.weighted_quality_score, 0,
  'unknown quality receives zero observational weight');
eq(unknownObs.legacy_coverage_score, 1,
  'unknown quality does not silently change historical gate behavior');

// 9. Snapshot schema is explicit/versioned.
eq(backendObs.schema_version, 'nba_dq_observation_v1',
  'DQ observation schema versioned');

console.log('\nNBA data quality observability');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ weighted observability added without changing decision gate\n');
