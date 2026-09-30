#!/usr/bin/env node
/**
 * NBA per-game checkpoint scheduler.
 *
 * Verifies:
 * - H6/H4/H2/H1 window classification from actual tip time;
 * - per-match checkpoint keys are stable;
 * - idempotence is per match + checkpoint, not per day;
 * - checkpoint markers are only written after persistence;
 * - legacy daily BOT_RUN_KEY gate is gone from NBA cron;
 * - Telegram is restricted to H1 (manual runs keep legacy behavior).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const workerSource = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');

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

const BASE = Date.parse('2026-10-20T12:00:00.000Z');
const matchAt = (minutes) => ({
  id: 'GAME1',
  datetime: new Date(BASE + minutes * 60000).toISOString(),
});

const cp = (minutes) => backend._botCheckpointForMatch(matchAt(minutes), BASE)?.id ?? null;

// Exact/non-overlapping windows.
eq(cp(421), null, '>7h => no checkpoint');
eq(cp(420), 'H6', '420min => H6');
eq(cp(301), 'H6', '301min => H6');
eq(cp(300), 'H4', '300min => H4');
eq(cp(181), 'H4', '181min => H4');
eq(cp(180), 'H2', '180min => H2');
eq(cp(91), 'H2', '91min => H2');
eq(cp(90), 'H1', '90min => H1');
eq(cp(1), 'H1', '1min => H1');
eq(cp(0), null, 'tip reached => no checkpoint');
eq(cp(-10), null, 'past tip => no checkpoint');
eq(backend._botCheckpointForMatch({ id: 'X', datetime: 'bad-date' }, BASE), null,
  'invalid tip datetime fails closed');

// Stable idempotence key.
eq(
  backend._botCheckpointKey('401585123', 'H2'),
  'nba_checkpoint_401585123_H2',
  'checkpoint key is match + checkpoint'
);
eq(backend._botCheckpointKey(null, 'H2'), null,
  'missing match id => no checkpoint key');

class MemoryKV {
  constructor() { this.map = new Map(); }
  async get(key) { return this.map.get(key) ?? null; }
  async put(key, value, opts = {}) { this.map.set(key, value); this.lastOpts = opts; }
}
const kv = new MemoryKV();
const env = { PAPER_TRADING: kv };

eq(await backend._botCheckpointAlreadyDone(env, 'GAME1', 'H4'), false,
  'fresh checkpoint is not done');

const checkpoint = backend._botCheckpointForMatch(matchAt(240), BASE);
eq(checkpoint.id, 'H4', '240min classified H4');

eq(await backend._botMarkCheckpointDone(env, 'GAME1', checkpoint, {
  analysis_id: 'analysis-1',
  cron_run_id: 'cron-1',
}), true, 'checkpoint marker can be written');

eq(await backend._botCheckpointAlreadyDone(env, 'GAME1', 'H4'), true,
  'same match/checkpoint becomes idempotent');
eq(await backend._botCheckpointAlreadyDone(env, 'GAME1', 'H2'), false,
  'same match remains eligible for later checkpoint');
eq(await backend._botCheckpointAlreadyDone(env, 'GAME2', 'H4'), false,
  'other match remains independent');

const marker = JSON.parse(await kv.get('nba_checkpoint_GAME1_H4'));
eq(marker.analysis_id, 'analysis-1', 'checkpoint marker records analysis id');
eq(marker.checkpoint_id, 'H4', 'checkpoint marker records checkpoint id');
eq(kv.lastOpts?.expirationTtl, 72 * 3600, 'checkpoint marker TTL is 72h');

// Source-level regression guards around _runBotCron.
const nbaStart = workerSource.indexOf('async function _runBotCron');
const nbaEnd = workerSource.indexOf('async function _botAnalyzeMatch', nbaStart);
const nbaCron = workerSource.slice(nbaStart, nbaEnd);

assert(!nbaCron.includes('if (lastRunDate.date === dateStr)'),
  'NBA cron no longer uses daily last-run gate');
assert(!nbaCron.includes('const firstMatchTime = matches'),
  'NBA cron no longer gates on first game of slate');
assert(nbaCron.includes('checkpointByMatch'),
  'NBA cron selects checkpoints per match');
assert(nbaCron.includes("_botCheckpointAlreadyDone(env, match.id, checkpoint.id)"),
  'NBA cron checks idempotence per match+checkpoint');
assert(nbaCron.includes("_botMarkCheckpointDone(env, match.id, checkpoint"),
  'NBA cron marks checkpoint after analysis persistence');
assert(nbaCron.includes("logs.filter(l => l.checkpoint_id === 'H1')"),
  'Telegram normal-run notifications restricted to H1');
assert(nbaCron.includes('forceRun ? logs :'),
  'manual force run keeps legacy notification behavior');

// BOT_RUN_KEY remains only as telemetry in NBA cron.
assert(nbaCron.includes('checkpoint_mode: true'),
  'BOT_RUN_KEY stores checkpoint telemetry');
assert(!nbaCron.includes('await env.PAPER_TRADING.get(BOT_RUN_KEY)'),
  'BOT_RUN_KEY is never read as a gate in NBA cron');

console.log('\nNBA per-game checkpoints');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ H6/H4/H2/H1 scheduler is per-game and idempotent\n');
