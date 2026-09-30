#!/usr/bin/env node
/**
 * NBA canonical season identity.
 *
 * Verifies that one season id follows a match from ESPN normalization through
 * raw analysis data, engine output, worker log/history fields and season-scoped
 * recent-form cache metadata.
 *
 * No network · no secrets.
 */

import './lib/dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';
import {
  getNBASeasonIdentity,
  getNBASeasonId,
  getNBASeasonStartYear,
} from '../src/config/sports.config.js';
import { ProviderNBA } from '../src/providers/provider.nba.js';
import { DataOrchestrator } from '../src/orchestration/data.orchestrator.js';
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

// ── 1. Canonical date → NBA season ───────────────────────────────────────
eq(getNBASeasonIdentity('2026-10-03'), {
  season_id: '2026-27', start_year: 2026, end_year: 2027,
}, 'preseason Oct 2026 => 2026-27');
eq(getNBASeasonId('2026-10-20T23:00:00Z'), '2026-27',
  'regular season Oct 2026 => 2026-27');
eq(getNBASeasonId('2027-05-15T00:30:00Z'), '2026-27',
  'playoffs May 2027 => 2026-27');
eq(getNBASeasonId('2026-09-30'), '2025-26',
  'offseason Sep 2026 remains attached to prior season');
eq(getNBASeasonStartYear('2027-01-15'), 2026,
  'January 2027 BallDontLie season param => 2026');
eq(getNBASeasonId('20261003'), '2026-27',
  'compact ESPN date supported');
eq(getNBASeasonId('not-a-date'), null,
  'invalid date fails closed');

// ── 2. Backend helper parity ──────────────────────────────────────────────
for (const d of ['2026-10-03', '2026-10-20T23:00:00Z', '2027-05-15', '2026-09-30', '20261003']) {
  eq(backend._botGetNBASeasonId(d), getNBASeasonId(d),
    `backend/frontend season parity · ${d}`);
}

// ── 3. ESPN parser stamps season_id from actual event datetime ───────────
const event = {
  id: 'SEASON_TEST',
  date: '2026-10-03T23:00:00Z',
  name: 'New York Knicks at Boston Celtics',
  season: { type: 1 },
  status: { type: { name: 'STATUS_SCHEDULED', detail: 'Scheduled' } },
  competitions: [{
    seasonType: 1,
    competitors: [
      { id: '2', homeAway: 'home', team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS' }, records: [], statistics: [] },
      { id: '18', homeAway: 'away', team: { id: '18', displayName: 'New York Knicks', abbreviation: 'NYK' }, records: [], statistics: [] },
    ],
    odds: [],
  }],
};
const parsed = backend.parseESPNMatches({ events: [event] }, '20261003')[0];
eq(parsed?.season_id, '2026-27',
  'worker ESPN parser adds season_id');

// ── 4. Front provider preserves/falls back season_id ─────────────────────
const normalized = ProviderNBA._normalizeMatches({ matches: [{
  id: 'P1',
  date: '2026-10-03',
  datetime: '2026-10-03T23:00:00Z',
  season_type: 1,
  event_type: 'PRESEASON',
  home_team: {}, away_team: {},
}] }, '2026-10-03');
eq(normalized?.matches?.[0]?.season_id, '2026-27',
  'ProviderNBA normalized match contains season_id');

// ── 5. RawData + engine analysis retain season_id ────────────────────────
const raw = DataOrchestrator.buildRawData({
  id: 'RAW1',
  date: '2027-05-15',
  datetime: '2027-05-15T00:30:00Z',
  season_type: 3,
  event_type: 'POSTSEASON',
  season_id: '2026-27',
  home_team: { name: 'Boston Celtics' },
  away_team: { name: 'New York Knicks' },
  home_season_stats: {},
  away_season_stats: {},
}, {}, null, null);
eq(raw.season_id, '2026-27',
  'DataOrchestrator rawData retains season_id');

const fixture = structuredClone(FIXTURES[0].data);
fixture.game_datetime = '2026-10-20T23:00:00Z';
fixture.game_date = '20261020';
fixture.event_type = 'REGULAR';
fixture.season_type = 2;
fixture.season_id = '2026-27';
const engineResult = EngineNBA.compute(fixture);
eq(engineResult.season_id, '2026-27',
  'EngineNBA analysis exposes season_id');

const backendResult = backend._botEngineCompute(fixture);
eq(backendResult.season_id, '2026-27',
  'backend analysis exposes season_id');

// ── 6. Critical regression: requested date, not system date, scopes BDL ──
const orchestratorSource = readFileSync(resolve(ROOT, 'src/orchestration/data.orchestrator.js'), 'utf8');
assert(
  orchestratorSource.includes('const season = getNBASeasonStartYear(date);'),
  'orchestrator recent-form season derives from analyzed date'
);
assert(
  !orchestratorSource.includes('const season  = _getCurrentNBASeason();'),
  'legacy system-clock season selection removed'
);

// ── 7. Persistent history/cache surfaces ─────────────────────────────────
const workerSource = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
assert(
  workerSource.includes("season_id:   analysis.season_id ?? match.season_id ?? _botGetNBASeasonId(match.datetime ?? match.date)"),
  'persistent NBA bot log contains season_id'
);
assert(
  workerSource.includes("'season_id', 'season_type', 'event_type', 'nba_phase'"),
  'NBA CSV history export contains season_id'
);
assert(
  workerSource.includes('season_id: seasonId, matches'),
  'BDL recent-form KV cache stores season_id metadata'
);
assert(
  workerSource.includes('season_id: cached.season_id ?? seasonId'),
  'BDL cache read returns season_id metadata'
);

// ── 8. Identity remains semantic only ────────────────────────────────────
eq(engineResult.nba_phase, 'regular',
  'season_id does not alter event phase classification');
eq(backendResult.nba_phase, 'regular',
  'backend phase remains regular');

console.log('\nNBA canonical season identity');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ season_id propagated and recent-form season scoped to match date\n');
