#!/usr/bin/env node
/**
 * Backend NBA rest/B2B correctness.
 *
 * Regression covered:
 * - Worker used to force home_back_to_back/away_back_to_back to false.
 * - new Date('YYYYMMDD') is invalid in V8, so compact ESPN slate dates could
 *   silently produce null rest_days.
 *
 * This test executes the real worker helpers in a VM and verifies the production
 * integration wiring without network or secrets.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', 'worker.js');
const source = readFileSync(WORKER_PATH, 'utf8');

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
  assert(Object.is(actual, expected), `${msg} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);

const exportIdx = source.indexOf('export default {');
if (exportIdx < 0) throw new Error('worker.js export default introuvable');
const patched = source.slice(0, exportIdx) +
  'globalThis.__mbp_handlers = {' +
  source.slice(exportIdx + 'export default {'.length);

const sandbox = {
  globalThis: {},
  console: { log: () => {}, warn: () => {}, error: () => {} },
  crypto: globalThis.crypto,
  Date, Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
  Error, TypeError, RangeError, Promise,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL, URLSearchParams, Intl,
  Response: class Response {}, Request: class Request {}, Headers: class Headers {},
  fetch: async () => { throw new Error('fetch not allowed'); },
  atob, btoa, TextEncoder, TextDecoder,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(patched, sandbox, { filename: 'worker.js' });

const oneDayAgo = { matches: [{ date: '2026-10-20' }] };
const twoDaysAgo = { matches: [{ date: '2026-10-20' }] };

// Compact ESPN slate date.
eq(sandbox._botComputeRestDays(oneDayAgo, '20261021'), 0,
  'YYYYMMDD · lendemain = 0 jour de repos');
eq(sandbox._botIsBackToBack(oneDayAgo, '20261021'), true,
  'YYYYMMDD · lendemain = back-to-back');

// ISO/dashed date.
eq(sandbox._botComputeRestDays(twoDaysAgo, '2026-10-22'), 1,
  'YYYY-MM-DD · deux jours après = 1 jour de repos');
eq(sandbox._botIsBackToBack(twoDaysAgo, '2026-10-22'), false,
  'YYYY-MM-DD · deux jours après = pas B2B');

// ISO datetime keeps calendar-day semantics.
eq(sandbox._botComputeRestDays(oneDayAgo, '2026-10-21T00:30:00Z'), 0,
  'ISO datetime · comparaison par jour de calendrier');
eq(sandbox._botIsBackToBack(oneDayAgo, '2026-10-21T00:30:00Z'), true,
  'ISO datetime · B2B stable malgré heure');

// Invalid/incoherent inputs fail closed.
eq(sandbox._botComputeRestDays(oneDayAgo, '20260230'), null,
  'date impossible => repos inconnu');
eq(sandbox._botIsBackToBack(oneDayAgo, '20260230'), null,
  'date impossible => B2B inconnu');
eq(sandbox._botComputeRestDays({ matches: [{ date: '2026-10-22' }] }, '20261021'), null,
  'dernier match postérieur => repos inconnu');
eq(sandbox._botIsBackToBack({ matches: [] }, '20261021'), null,
  'historique absent => B2B inconnu');

// Production backend must consume the helpers instead of hard-coded false.
assert(
  source.includes('home_back_to_back:   _botIsBackToBack(homeRecent, match.date ?? match.datetime)'),
  'worker canonical · home_back_to_back branché sur historique réel'
);
assert(
  source.includes('away_back_to_back:   _botIsBackToBack(awayRecent, match.date ?? match.datetime)'),
  'worker canonical · away_back_to_back branché sur historique réel'
);
assert(!source.includes('home_back_to_back:   false'),
  'worker canonical · home B2B n’est plus forcé à false');
assert(!source.includes('away_back_to_back:   false'),
  'worker canonical · away B2B n’est plus forcé à false');

console.log('\nNBA backend rest/B2B correctness');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ tous les cas OK\n');
