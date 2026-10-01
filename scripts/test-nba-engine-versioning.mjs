#!/usr/bin/env node
/**
 * NBA engine versioning.
 *
 * Verifies that frontend/backend use one canonical engine generation label and
 * that the persisted/exported analysis schema is explicitly versioned.
 *
 * No network · no secrets.
 */

import './lib/dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';
import { EngineNBA } from '../src/engine/engine.nba.js';
import { EngineCore } from '../src/engine/engine.core.js';
import {
  NBA_ENGINE_VERSION,
  NBA_ANALYSIS_SCHEMA_VERSION,
} from '../src/config/sports.config.js';

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

eq(NBA_ENGINE_VERSION, 'nba-2026.10.01-baseline',
  'canonical NBA engine baseline');
eq(NBA_ANALYSIS_SCHEMA_VERSION, 'nba-analysis-v1',
  'canonical NBA analysis schema version');

const fixture = structuredClone(FIXTURES[0].data);
fixture.game_datetime = '2026-10-20T23:00:00Z';
fixture.game_date = '20261020';
fixture.event_type = 'REGULAR';
fixture.season_type = 2;
fixture.season_id = '2026-27';

// Frontend engine.
const front = EngineNBA.compute(fixture);
eq(front.engine_version, NBA_ENGINE_VERSION,
  'EngineNBA stamps canonical engine version');
eq(front.analysis_schema_version, NBA_ANALYSIS_SCHEMA_VERSION,
  'EngineNBA stamps canonical analysis schema version');

// Backend engine parity.
const back = backend._botEngineCompute(fixture);
eq(back.engine_version, NBA_ENGINE_VERSION,
  'backend stamps same engine version');
eq(back.analysis_schema_version, NBA_ANALYSIS_SCHEMA_VERSION,
  'backend stamps same analysis schema version');

// EngineCore must retain versions, including analysis wrapper output.
const core = EngineCore.compute('NBA', fixture);
eq(core.engine_version, NBA_ENGINE_VERSION,
  'EngineCore retains engine version');
eq(core.analysis_schema_version, NBA_ANALYSIS_SCHEMA_VERSION,
  'EngineCore retains analysis schema version');

// Static guards on persistence surfaces.
const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
assert(
  worker.includes("const NBA_ENGINE_VERSION = 'nba-2026.10.01-baseline';"),
  'worker uses same explicit engine version'
);
assert(
  worker.includes("const NBA_ANALYSIS_SCHEMA_VERSION = 'nba-analysis-v1';"),
  'worker uses same explicit analysis schema version'
);
assert(
  worker.includes('engine_version: analysis.engine_version ?? NBA_ENGINE_VERSION'),
  'KV log includes engine version'
);
assert(
  worker.includes('analysis_schema_version: analysis.analysis_schema_version ?? NBA_ANALYSIS_SCHEMA_VERSION'),
  'KV log includes analysis schema version'
);
assert(
  worker.includes('engine_version, analysis_schema_version'),
  'D1 insert contains version columns'
);
assert(
  worker.includes("'engine_version', 'analysis_schema_version'"),
  'CSV export contains version columns'
);
assert(
  worker.includes('nba_engine_version: NBA_ENGINE_VERSION'),
  'operational health exposes current engine version'
);
assert(
  worker.includes('nba_analysis_schema_version: NBA_ANALYSIS_SCHEMA_VERSION'),
  'operational health exposes current analysis schema version'
);

// Historical D1 rows must be segmentable by engine version.
const migration = readFileSync(
  resolve(ROOT, 'migrations/0005_nba_engine_version.sql'),
  'utf8'
);
assert(
  migration.includes('ALTER TABLE nba_analysis_history ADD COLUMN engine_version TEXT;'),
  'D1 migration adds engine_version'
);
assert(
  migration.includes('ALTER TABLE nba_analysis_history ADD COLUMN analysis_schema_version TEXT;'),
  'D1 migration adds analysis_schema_version'
);
assert(
  migration.includes('idx_nba_analysis_engine_version'),
  'D1 migration indexes engine-version calibration slice'
);

console.log('\nNBA engine versioning');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ engine generations are explicit and calibration-segmentable\n');
