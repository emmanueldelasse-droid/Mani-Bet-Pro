#!/usr/bin/env node
/**
 * NBA immutable D1 history · dual-write safety.
 *
 * Uses Node 22's SQLite implementation to execute the real migration, then
 * adapts it to the Cloudflare D1 prepare().bind().run() interface.
 *
 * Verifies:
 * - multiple analysis_id rows for the same match are retained;
 * - analysis rows reject UPDATE and DELETE;
 * - retrying the same analysis_id is idempotent (INSERT OR IGNORE);
 * - settlement is separate and can be updated on force re-settle;
 * - KV remains the latest-snapshot path;
 * - missing/failing D1 never prevents KV persistence.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backend } from './lib/backend-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const migrations = [
  '0001_nba_immutable_history.sql',
  '0002_nba_analysis_checkpoints.sql',
  '0003_nba_verified_closing_line.sql',
  '0004_nba_match_outcomes.sql',
  '0005_nba_engine_version.sql',
  '0006_nba_recent_form_ema_shadow.sql',
].map(name => readFileSync(resolve(ROOT, 'migrations', name), 'utf8'));

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

class MemoryKV {
  constructor() { this.map = new Map(); }
  async put(key, value) { this.map.set(key, value); }
  async get(key) { return this.map.get(key) ?? null; }
}

function makeD1Adapter(db) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async run() {
              const stmt = db.prepare(sql);
              const result = stmt.run(...params);
              return { success: true, meta: { changes: result.changes } };
            },
          };
        },
      };
    },
  };
}

const db = new DatabaseSync(':memory:');
for (const migration of migrations) db.exec(migration);
const d1 = makeD1Adapter(db);
const kv = new MemoryKV();
const env = { PAPER_TRADING: kv, MANI_HISTORY_DB: d1 };

function makeLog(id, bestEdge = 6.5) {
  return {
    analysis_id: id,
    logged_at: '2026-10-20T20:00:00.000Z',
    match_id: 'ESPN_GAME_1',
    season_id: '2026-27',
    season_type: 2,
    event_type: 'REGULAR',
    nba_phase: 'regular',
    engine_version: 'nba-2026.10.01-baseline',
    analysis_schema_version: 'nba-analysis-v1',
    recent_form_ema_shadow: {
      status: 'AVAILABLE',
      lambda: 0.85,
      legacy_value: 1.7,
      decay_lambda_value: 0.3,
      delta: -1.4,
      drives_decision: false,
    },
    datetime: '2026-10-20T23:30:00.000Z',
    home: 'Boston Celtics',
    away: 'New York Knicks',
    status: 'pending',
    checkpoint_id: 'H2',
    checkpoint_minutes_to_tip: 132,
    motor_prob: 58,
    model_raw_score: 0.57,
    decision_prob: 0.58,
    probability_status: 'UNCALIBRATED_SCORE',
    confidence_level: 'MEDIUM',
    data_quality: 0.91,
    data_quality_observed: { weighted_quality_score: 0.79 },
    best_edge: bestEdge,
    best_market: 'MONEYLINE',
    best_side: 'HOME',
    result_home_score: null,
    result_away_score: null,
    result_winner: null,
    result_margin: null,
    result_total: null,
    motor_was_right: null,
    spread_was_right: null,
    ou_was_right: null,
    ou_model_was_right: null,
    clv_post_match: null,
    clv_status: 'UNAVAILABLE_NO_CLOSING_ODDS',
    clv_method: null,
    settled_at: null,
  };
}

// 1) First analysis goes to KV + D1.
const logA = makeLog('analysis-A', 6.5);
await backend._botSaveLog(env, logA);

eq(
  db.prepare('SELECT COUNT(*) AS n FROM nba_analysis_history').get().n,
  1,
  'first analysis inserted into D1'
);
eq(
  db.prepare('SELECT season_id FROM nba_analysis_history WHERE analysis_id = ?').get('analysis-A').season_id,
  '2026-27',
  'season_id retained in immutable history'
);
eq(
  db.prepare('SELECT checkpoint_id, checkpoint_minutes_to_tip FROM nba_analysis_history WHERE analysis_id = ?').get('analysis-A'),
  { checkpoint_id: 'H2', checkpoint_minutes_to_tip: 132 },
  'checkpoint metadata retained in immutable history'
);
eq(
  db.prepare('SELECT engine_version, analysis_schema_version FROM nba_analysis_history WHERE analysis_id = ?').get('analysis-A'),
  {
    engine_version: 'nba-2026.10.01-baseline',
    analysis_schema_version: 'nba-analysis-v1',
  },
  'engine and analysis schema versions retained in immutable history'
);
eq(
  db.prepare('SELECT recent_form_ema_legacy, recent_form_ema_decay_shadow, recent_form_ema_shadow_delta, recent_form_ema_lambda FROM nba_analysis_history WHERE analysis_id = ?').get('analysis-A'),
  {
    recent_form_ema_legacy: 1.7,
    recent_form_ema_decay_shadow: 0.3,
    recent_form_ema_shadow_delta: -1.4,
    recent_form_ema_lambda: 0.85,
  },
  'EMA shadow values retained in immutable history'
);
eq(
  JSON.parse(await kv.get('bot_log_ESPN_GAME_1')).analysis_id,
  'analysis-A',
  'KV receives latest analysis snapshot'
);

// 2) Same match, second analysis => second immutable row, KV latest overwritten.
const logB = makeLog('analysis-B', 8.2);
logB.logged_at = '2026-10-20T22:00:00.000Z';
await backend._botSaveLog(env, logB);

eq(
  db.prepare('SELECT COUNT(*) AS n FROM nba_analysis_history WHERE match_id = ?').get('ESPN_GAME_1').n,
  2,
  'two analyses of same match are both retained'
);
eq(
  JSON.parse(await kv.get('bot_log_ESPN_GAME_1')).analysis_id,
  'analysis-B',
  'KV still keeps only latest snapshot per match'
);

// 3) Retrying same analysis_id is idempotent and cannot mutate history.
const retryB = makeLog('analysis-B', 99);
retryB.logged_at = '2026-10-20T22:05:00.000Z';
await backend._botSaveLog(env, retryB);
eq(
  db.prepare('SELECT COUNT(*) AS n FROM nba_analysis_history').get().n,
  2,
  'retry does not duplicate analysis_id'
);
eq(
  db.prepare('SELECT best_edge FROM nba_analysis_history WHERE analysis_id = ?').get('analysis-B').best_edge,
  8.2,
  'retry cannot mutate immutable analysis row'
);

// 4) Database-level immutability blocks manual UPDATE/DELETE too.
let updateBlocked = false;
try {
  db.prepare('UPDATE nba_analysis_history SET best_edge = 1 WHERE analysis_id = ?').run('analysis-A');
} catch (_) { updateBlocked = true; }
assert(updateBlocked, 'UPDATE trigger blocks mutation');

let deleteBlocked = false;
try {
  db.prepare('DELETE FROM nba_analysis_history WHERE analysis_id = ?').run('analysis-A');
} catch (_) { deleteBlocked = true; }
assert(deleteBlocked, 'DELETE trigger blocks mutation');

// 5) Settlement is separate and may be corrected on force re-settle.
logB.status = 'settled';
logB.settled_at = '2026-10-21T10:00:00.000Z';
logB.result_home_score = 118;
logB.result_away_score = 110;
logB.result_winner = 'HOME';
logB.result_margin = 8;
logB.result_total = 228;
logB.motor_was_right = true;
logB.settlement_source = 'cron_nightly';
logB.clv_post_match = 3.4;
logB.clv_status = 'AVAILABLE';
logB.clv_method = 'TAKEN_PRICE_VS_CLOSING_PRICE';
logB.closing_snapshot_at = '2026-10-20T23:15:00.000Z';
logB.closing_snapshot_age_minutes = 15;
logB.closing_source = 'espn_scoreboard';
logB.closing_provider_name = 'DraftKings';
logB.closing_home_ml = -120;
logB.closing_away_ml = 105;
await backend._botPersistSettlementD1(env, logB);

let settlement = db.prepare(
  'SELECT result_home_score, motor_was_right FROM nba_analysis_settlements WHERE analysis_id = ?'
).get('analysis-B');
eq(settlement.result_home_score, 118, 'settlement inserted separately');
eq(settlement.motor_was_right, 1, 'boolean settlement normalized to integer');
eq(
  db.prepare('SELECT clv_status, closing_snapshot_age_minutes, closing_source, closing_home_ml FROM nba_analysis_settlements WHERE analysis_id = ?').get('analysis-B'),
  {
    clv_status: 'AVAILABLE',
    closing_snapshot_age_minutes: 15,
    closing_source: 'espn_scoreboard',
    closing_home_ml: -120,
  },
  'verified closing quote metadata persists with settlement'
);

// Canonical match outcome is stored once and links ALL immutable checkpoints.
await backend._botPersistMatchOutcomeD1(env, logB);

eq(
  db.prepare('SELECT COUNT(*) AS n FROM nba_match_outcomes WHERE match_id = ?').get('ESPN_GAME_1').n,
  1,
  'one canonical outcome row stored per match'
);
eq(
  db.prepare('SELECT result_home_score, result_winner, closing_home_ml FROM nba_match_outcomes WHERE match_id = ?').get('ESPN_GAME_1'),
  { result_home_score: 118, result_winner: 'HOME', closing_home_ml: -120 },
  'match outcome retains official result and closing quote'
);
eq(
  db.prepare(`
    SELECT COUNT(*) AS n
    FROM nba_analysis_history a
    JOIN nba_match_outcomes o ON o.match_id = a.match_id
    WHERE a.match_id = ?
  `).get('ESPN_GAME_1').n,
  2,
  'both checkpoint analyses link to the same official match outcome'
);
eq(
  db.prepare(`
    SELECT COUNT(*) AS n
    FROM nba_analysis_history a
    LEFT JOIN nba_match_outcomes o ON o.match_id = a.match_id
    WHERE a.match_id = ? AND o.match_id IS NULL
  `).get('ESPN_GAME_1').n,
  0,
  'no immutable checkpoint remains outcome-orphaned once match settles'
);

logB.result_home_score = 119;
logB.result_margin = 9;
logB.settlement_source = 'manual_force';
await backend._botPersistSettlementD1(env, logB);
await backend._botPersistMatchOutcomeD1(env, logB);
settlement = db.prepare(
  'SELECT result_home_score, settlement_source FROM nba_analysis_settlements WHERE analysis_id = ?'
).get('analysis-B');
eq(settlement.result_home_score, 119, 'force re-settle updates settlement row');
eq(settlement.settlement_source, 'manual_force', 'settlement provenance updated');
eq(
  db.prepare('SELECT result_home_score, settlement_source FROM nba_match_outcomes WHERE match_id = ?').get('ESPN_GAME_1'),
  { result_home_score: 119, settlement_source: 'manual_force' },
  'force re-settle updates one canonical match outcome row'
);
eq(
  db.prepare('SELECT COUNT(*) AS n FROM nba_match_outcomes WHERE match_id = ?').get('ESPN_GAME_1').n,
  1,
  'force re-settle never duplicates match outcome'
);
eq(
  db.prepare('SELECT best_edge FROM nba_analysis_history WHERE analysis_id = ?').get('analysis-B').best_edge,
  8.2,
  'settlement never mutates original analysis'
);

// 6) No D1 binding: KV remains fully operational.
const kvOnly = new MemoryKV();
const logC = makeLog('analysis-C', 5.1);
await backend._botSaveLog({ PAPER_TRADING: kvOnly }, logC);
eq(
  JSON.parse(await kvOnly.get('bot_log_ESPN_GAME_1')).analysis_id,
  'analysis-C',
  'missing D1 binding does not block KV'
);

// Match outcome helper also fails closed when D1 is absent.
eq(
  await backend._botPersistMatchOutcomeD1({ PAPER_TRADING: kvOnly }, {
    match_id: 'ESPN_GAME_1',
    status: 'settled',
  }),
  { written: false, reason: 'D1_BINDING_OR_MATCH_ID_UNAVAILABLE' },
  'missing D1 binding makes match outcome persistence a no-op'
);

// 7) Broken D1: helper fails closed, KV remains written.
const brokenD1 = { prepare() { throw new Error('D1 unavailable'); } };
const kvWithBrokenD1 = new MemoryKV();
const logD = makeLog('analysis-D', 5.2);
await backend._botSaveLog({ PAPER_TRADING: kvWithBrokenD1, MANI_HISTORY_DB: brokenD1 }, logD);
eq(
  JSON.parse(await kvWithBrokenD1.get('bot_log_ESPN_GAME_1')).analysis_id,
  'analysis-D',
  'D1 write error does not block KV'
);

// 8) Migration has required indexes/tables.
const tables = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
).all().map(r => r.name);
assert(tables.includes('nba_analysis_history'), 'analysis table exists');
assert(tables.includes('nba_analysis_settlements'), 'settlement table exists');
assert(tables.includes('nba_match_outcomes'), 'canonical match outcome table exists');

console.log('\nNBA immutable D1 history');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ immutable dual-write behavior verified\n');
