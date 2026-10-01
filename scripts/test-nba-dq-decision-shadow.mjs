#!/usr/bin/env node
/**
 * NBA weighted data-quality decision shadow.
 *
 * Current production gate remains legacy coverage score:
 *   missing_variables / total only, threshold 0.55.
 *
 * Shadow asks what confidence/gate would do with weighted quality semantics.
 * It MUST remain observation-only.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';

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

const analysis = {
  score: 0.75,
  confidence_penalty: null,
};

const varsWithQuality = quality => ({
  a: { value: 1, quality, source: 'fixture' },
  b: { value: 1, quality, source: 'fixture' },
});

// ── Case 1 · present but LOW_SAMPLE ─────────────────────────────────────────
const lowSampleDQ = backend._botBuildDataQualitySnapshot(
  varsWithQuality('LOW_SAMPLE'),
  [],
);
eq(lowSampleDQ.legacy_coverage_score, 1,
  'legacy coverage counts LOW_SAMPLE as fully present');
eq(lowSampleDQ.weighted_quality_score, 0.4,
  'weighted DQ discounts LOW_SAMPLE to 0.4');

const lowSampleShadow = backend._botBuildDataQualityDecisionShadow(
  analysis,
  lowSampleDQ,
);
eq(lowSampleShadow.current_confidence, 'HIGH',
  'current legacy DQ yields HIGH at score 0.75');
eq(lowSampleShadow.weighted_confidence_shadow, 'INCONCLUSIVE',
  'weighted DQ counterfactual would gate LOW_SAMPLE data');
eq(lowSampleShadow.current_below_gate, false,
  'legacy coverage remains above 0.55');
eq(lowSampleShadow.weighted_below_gate_shadow, true,
  'weighted quality falls below 0.55');
eq(lowSampleShadow.gate_would_change, true,
  'gate-change signal is explicit');
eq(lowSampleShadow.confidence_would_change, true,
  'confidence-change signal is explicit');
eq(lowSampleShadow.drives_decision, false,
  'weighted DQ shadow cannot drive decision');
eq(lowSampleShadow.threshold, 0.55,
  'shadow observes existing threshold without changing it');

// ── Case 2 · PARTIAL changes confidence but not hard gate ───────────────────
const partialDQ = backend._botBuildDataQualitySnapshot(
  varsWithQuality('PARTIAL'),
  [],
);
eq(partialDQ.legacy_coverage_score, 1,
  'legacy coverage PARTIAL remains 1');
eq(partialDQ.weighted_quality_score, 0.6,
  'weighted PARTIAL score is 0.6');

const partialShadow = backend._botBuildDataQualityDecisionShadow(
  analysis,
  partialDQ,
);
eq(partialShadow.current_confidence, 'HIGH',
  'legacy PARTIAL current confidence HIGH');
eq(partialShadow.weighted_confidence_shadow, 'MEDIUM',
  'weighted PARTIAL counterfactual confidence MEDIUM');
eq(partialShadow.weighted_below_gate_shadow, false,
  'weighted PARTIAL remains above hard gate');
eq(partialShadow.gate_would_change, false,
  'hard gate unchanged for weighted 0.6');
eq(partialShadow.confidence_would_change, true,
  'confidence still changes HIGH to MEDIUM');

// ── Case 3 · VERIFIED has no behavioral counterfactual ──────────────────────
const verifiedDQ = backend._botBuildDataQualitySnapshot(
  varsWithQuality('VERIFIED'),
  [],
);
const verifiedShadow = backend._botBuildDataQualityDecisionShadow(
  analysis,
  verifiedDQ,
);
eq(verifiedDQ.legacy_coverage_score, 1,
  'verified legacy score 1');
eq(verifiedDQ.weighted_quality_score, 1,
  'verified weighted score 1');
eq(verifiedShadow.current_confidence, 'HIGH',
  'verified current confidence HIGH');
eq(verifiedShadow.weighted_confidence_shadow, 'HIGH',
  'verified shadow confidence HIGH');
eq(verifiedShadow.gate_would_change, false,
  'verified gate unchanged');
eq(verifiedShadow.confidence_would_change, false,
  'verified confidence unchanged');

// ── Existing gate remains authoritative ─────────────────────────────────────
eq(
  backend._botComputeConfidence(analysis, lowSampleDQ.legacy_coverage_score),
  'HIGH',
  'production confidence helper still uses caller-provided legacy DQ'
);
eq(
  backend._botComputeConfidence(analysis, lowSampleDQ.weighted_quality_score),
  'INCONCLUSIVE',
  'weighted result only changes when explicitly passed as counterfactual'
);

// Boundary 0.55 remains allowed by current rule.
const boundaryShadow = backend._botBuildDataQualityDecisionShadow(analysis, {
  legacy_coverage_score: 0.55,
  weighted_quality_score: 0.55,
});
eq(boundaryShadow.current_below_gate, false,
  'current threshold 0.55 is inclusive');
eq(boundaryShadow.weighted_below_gate_shadow, false,
  'shadow observes same inclusive boundary');

// Persistence/export/source guards.
const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
assert(
  worker.includes('const confidenceLevel = _botComputeConfidence(analysis, dataQuality);'),
  'production confidence remains based on legacy dataQuality variable'
);
assert(
  worker.includes('data_quality_decision_shadow: dataQualityDecisionShadow'),
  'KV log carries DQ decision shadow'
);
assert(
  worker.includes('dq_weighted_confidence_shadow, dq_weighted_below_gate'),
  'D1 insert carries DQ decision shadow'
);
assert(
  worker.includes("'dq_weighted_quality_shadow', 'dq_weighted_confidence_shadow'"),
  'CSV export carries weighted DQ counterfactual'
);

const migration = readFileSync(
  resolve(ROOT, 'migrations/0008_nba_dq_decision_shadow.sql'),
  'utf8'
);
assert(migration.includes('dq_gate_would_change INTEGER'),
  'D1 migration adds gate-change flag');
assert(migration.includes('dq_confidence_would_change INTEGER'),
  'D1 migration adds confidence-change flag');

console.log('\nNBA weighted data-quality decision shadow');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ legacy DQ gate preserved · weighted DQ counterfactual observed only\n');
