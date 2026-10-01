#!/usr/bin/env node
/**
 * Operational health dashboard regression tests.
 *
 * No network · no secrets.
 * Verifies freshness semantics and static safety guarantees:
 * /health is KV-only and cannot create provider load.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');

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

const NOW = Date.parse('2026-10-03T12:00:00.000Z');

// ── Freshness helpers ─────────────────────────────────────────────────────
eq(
  backend._healthAgeMinutes('2026-10-03T11:30:00.000Z', NOW),
  30,
  'age helper computes minutes'
);
eq(
  backend._healthAgeMinutes(null, NOW),
  null,
  'missing timestamp => unknown age'
);

eq(
  backend._healthFreshness('2026-10-03T10:30:00.000Z', 90, NOW).status,
  'FRESH',
  '90-minute NBA heartbeat boundary is fresh'
);
eq(
  backend._healthFreshness('2026-10-03T10:29:00.000Z', 90, NOW).status,
  'STALE',
  '91-minute NBA heartbeat is stale'
);
eq(
  backend._healthFreshness('2026-10-03T11:25:00.000Z', 35, NOW).status,
  'FRESH',
  '35-minute odds heartbeat boundary is fresh'
);
eq(
  backend._healthFreshness('2026-10-03T11:24:00.000Z', 35, NOW).status,
  'STALE',
  '36-minute odds heartbeat is stale'
);
eq(
  backend._healthFreshness(null, 90, NOW).status,
  'UNKNOWN',
  'missing heartbeat is unknown'
);
eq(
  backend._healthFreshness('2026-10-03T12:01:00.000Z', 90, NOW).status,
  'CLOCK_SKEW',
  'future heartbeat detects clock skew'
);

// ── Timestamp extraction ──────────────────────────────────────────────────
eq(
  backend._healthExtractTimestamp({ ran_at: '2026-10-03T11:00:00Z' }),
  '2026-10-03T11:00:00Z',
  'ran_at preferred'
);
eq(
  backend._healthExtractTimestamp({ fetched_at: '2026-10-03T10:00:00Z' }),
  '2026-10-03T10:00:00Z',
  'fetched_at supported'
);
eq(
  backend._healthExtractTimestamp({ _ts: 1791021600000 }),
  1791021600000,
  '_ts numeric cache timestamp supported'
);
eq(
  backend._healthExtractTimestamp({ foo: 'bar' }),
  null,
  'cache without timestamp remains unknown'
);

// ── Route is operational health, GET-only ────────────────────────────────
assert(
  worker.includes("if (path === '/health' && request.method === 'GET')"),
  '/health is GET-only'
);
assert(
  worker.includes('return await handleOperationalHealth(env, origin);'),
  '/health delegates to operational health handler'
);

// ── Health must stay read-only and network-free ──────────────────────────
const healthStart = worker.indexOf('async function handleOperationalHealth');
const routerStart = worker.indexOf('// ── ROUTER PRINCIPAL', healthStart);
if (healthStart < 0 || routerStart < 0) throw new Error('handleOperationalHealth block not found');
const healthBlock = worker.slice(healthStart, routerStart);

const wrangler = readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8');
assert(
  wrangler.includes('"binding": "CF_VERSION_METADATA"'),
  'Cloudflare version metadata binding configured'
);
assert(
  healthBlock.includes('env?.CF_VERSION_METADATA?.id'),
  'health exposes deployed Worker version id'
);
assert(
  healthBlock.includes('env?.CF_VERSION_METADATA?.timestamp'),
  'health exposes deployed Worker version timestamp'
);
assert(
  !healthBlock.includes("version: '6.85.0'"),
  'health no longer relies on stale hardcoded Worker version'
);

for (const forbidden of [
  'espnFetch(',
  'fetch(',
  'fetchTimeout(',
  'handleOddsComparison(',
  'handleNBATeamsStats(',
  'handleNBAInjuriesImpact(',
  '_tank01FetchWithFallback(',
  'bdlFetchWithRetry(',
]) {
  assert(!healthBlock.includes(forbidden),
    `health handler has no external/provider call: ${forbidden}`);
}

// ── Scheduler heartbeats are independently written ───────────────────────
const nbaCronStart = worker.indexOf('async function _runBotCron');
const analyzeStart = worker.indexOf('async function _botAnalyzeMatch', nbaCronStart);
const nbaCron = worker.slice(nbaCronStart, analyzeStart);

assert(
  nbaCron.includes('NBA_CRON_HEARTBEAT_KEY'),
  'NBA cron writes its heartbeat'
);
const heartbeatPos = nbaCron.indexOf('NBA_CRON_HEARTBEAT_KEY');
const firstEspnFetchPos = nbaCron.indexOf('espnFetch(');
assert(
  heartbeatPos >= 0 && firstEspnFetchPos >= 0 && heartbeatPos < firstEspnFetchPos,
  'NBA heartbeat is written before ESPN/provider dependency'
);

const oddsStart = worker.indexOf('async function _runOddsSnapshot');
const aiPropsStart = worker.indexOf('// Cron AI player props', oddsStart);
const oddsBlock = worker.slice(oddsStart, aiPropsStart);
assert(
  oddsBlock.includes('ODDS_SNAPSHOT_HEARTBEAT_KEY'),
  'odds snapshot cron writes heartbeat'
);
assert(
  oddsBlock.includes('nba_snapshots_written: nbaCount'),
  'odds heartbeat records NBA write count'
);
assert(
  oddsBlock.includes('mlb_snapshots_written: mlbCount'),
  'odds heartbeat records MLB write count'
);

// ── Operational thresholds are explicit ─────────────────────────────────
assert(
  healthBlock.includes("_healthFreshness(nbaHeartbeat?.ran_at ?? null, 90, nowMs)"),
  'NBA hourly scheduler stale threshold = 90min'
);
assert(
  healthBlock.includes("_healthFreshness(oddsHeartbeat?.ran_at ?? null, 35, nowMs)"),
  '15-minute odds scheduler stale threshold = 35min'
);
assert(
  healthBlock.includes('nowMs > tipMs + 6 * 3600 * 1000'),
  'pending settlement overdue threshold = 6h after tip'
);

// ── Health status separates issues and non-blocking warnings ─────────────
assert(
  healthBlock.includes("issues.push('NBA_CRON_HEARTBEAT_NOT_FRESH')"),
  'stale NBA cron is an issue'
);
assert(
  healthBlock.includes("issues.push('ODDS_SNAPSHOT_HEARTBEAT_NOT_FRESH')"),
  'stale odds cron is an issue'
);
assert(
  healthBlock.includes("issues.push('NBA_SETTLEMENT_OVERDUE')"),
  'overdue settlement is an issue'
);
assert(
  healthBlock.includes("warnings.push('D1_HISTORY_BINDING_NOT_CONFIGURED')"),
  'missing optional D1 is warning, not issue'
);
assert(
  healthBlock.includes("status: issues.length === 0 ? 'ok' : 'degraded'"),
  'global health is based on issues only'
);

// ── Useful observability surfaces ────────────────────────────────────────
for (const field of [
  'status_breakdown',
  'checkpoint_breakdown_latest_snapshots',
  'checkpoint_keys_72h',
  'overdue_settlements_6h_after_tip',
  'provider_cache',
  'd1_history_configured',
  'latest_analysis_freshness',
]) {
  assert(healthBlock.includes(field), `health exposes ${field}`);
}

console.log('\nOperational health dashboard');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ read-only health observability verified\n');
