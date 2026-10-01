#!/usr/bin/env node
/**
 * NBA prime-time ESPN slate discovery.
 *
 * Purpose:
 * ESPN groups games by US calendar date. A prime-time US game can therefore
 * occur after midnight in Paris while still belonging to the prior ESPN slate.
 *
 * This test isolates discovery only:
 * - Paris date + prior calendar date are fetched;
 * - matches are merged and deduplicated by ESPN id;
 * - current slate wins on duplicates;
 * - prior-slate prime-time games reach analysis;
 * - final games remain filtered;
 * - no rest/B2B/scoring behavior is modified here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', 'worker.js');

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

// 2026-10-04 01:00 UTC = 03:00 Paris (CEST).
const FIXED_MS = Date.parse('2026-10-04T01:00:00.000Z');
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_MS);
    else super(...args);
  }
  static now() { return FIXED_MS; }
}

function loadSandbox() {
  const source = readFileSync(WORKER_PATH, 'utf8');
  const idx = source.indexOf('export default {');
  if (idx < 0) throw new Error('worker export default not found');
  const patched =
    source.slice(0, idx) +
    'globalThis.__mbp_handlers = {' +
    source.slice(idx + 'export default {'.length);

  const sandbox = {
    globalThis: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    crypto: globalThis.crypto,
    Date: FakeDate,
    Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
    Error, TypeError, RangeError, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Intl,
    Response: class Response {},
    Request: class Request {},
    Headers: class Headers {},
    fetch: async () => { throw new Error('network forbidden'); },
    atob, btoa, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'worker.js' });
  return sandbox;
}

function makeKV() {
  const store = new Map();
  return {
    async get(key, opts) {
      const v = store.has(key) ? store.get(key) : null;
      if (opts?.type === 'json' && typeof v === 'string') return JSON.parse(v);
      return v;
    },
    async put(key, value) { store.set(key, value); },
    async list({ prefix }) {
      return {
        keys: [...store.keys()]
          .filter(k => k.startsWith(prefix))
          .map(name => ({ name })),
      };
    },
    _store: store,
  };
}

const sb = loadSandbox();

// Calendar helper must be timezone-independent.
eq(sb._botPreviousCompactDate('20261004'), '20261003',
  'prior compact date for Oct 4');
eq(sb._botPreviousCompactDate('20260101'), '20251231',
  'prior compact date crosses year boundary');
eq(sb._botPreviousCompactDate('bad'), null,
  'invalid compact date fails closed');

const fetchedDates = [];
sb.espnFetch = async (url) => {
  const d = new URL(url).searchParams.get('dates');
  fetchedDates.push(d);

  if (d === '20261004') {
    return { __games: [
      {
        id: 'CURR',
        home: 'Boston Celtics',
        away: 'New York Knicks',
        status: 'STATUS_SCHEDULED',
        datetime: '2026-10-04T18:00:00.000Z',
      },
      {
        id: 'DUP',
        home: 'Denver Nuggets',
        away: 'Los Angeles Lakers',
        status: 'STATUS_SCHEDULED',
        datetime: '2026-10-04T19:00:00.000Z',
      },
    ] };
  }

  if (d === '20261003') {
    return { __games: [
      {
        id: 'PRIME',
        home: 'Golden State Warriors',
        away: 'Phoenix Suns',
        status: 'STATUS_SCHEDULED',
        datetime: '2026-10-04T01:30:00.000Z',
      },
      {
        id: 'DUP',
        home: 'Denver Nuggets',
        away: 'Los Angeles Lakers',
        status: 'STATUS_SCHEDULED',
        datetime: '2026-10-04T19:00:00.000Z',
      },
      {
        id: 'FINAL',
        home: 'Miami Heat',
        away: 'Chicago Bulls',
        status: 'STATUS_FINAL',
        datetime: '2026-10-03T23:00:00.000Z',
      },
    ] };
  }

  return null;
};

sb.parseESPNMatches = (data, dateStr) =>
  (data?.__games ?? []).map(g => ({
    id: g.id,
    date: dateStr,
    datetime: g.datetime,
    status: g.status,
    event_type: 'PRESEASON',
    season_type: 1,
    season_id: '2026-27',
    home_team: { name: g.home },
    away_team: { name: g.away },
  }));

// Heavy providers are irrelevant for discovery.
const jsonResp = value => ({ json: async () => value });
sb.handleNBAInjuriesImpact = async () => jsonResp({});
sb.handleOddsComparison = async () => jsonResp({});
sb.handleNBATeamsStats = async () => jsonResp({});
sb._tank01FetchWithFallback = async () => null;
sb.handleNBARecentForm = async () => null;
sb.handleNBAAIInjuriesBatch = async () => null;

const analyzed = [];
sb._botAnalyzeMatch = async match => {
  analyzed.push({ id: match.id, date: match.date, datetime: match.datetime });
  return null;
};

const kv = makeKV();
await sb._runBotCron({ PAPER_TRADING: kv }, true);

// Exactly both requested slates.
eq([...fetchedDates].sort(), ['20261003', '20261004'],
  'cron fetches Paris date and prior ESPN date');

// Prior-slate prime-time game is visible to analysis.
assert(analyzed.some(m => m.id === 'PRIME'),
  'prior-slate prime-time game reaches analysis');

// Current-slate game is still visible.
assert(analyzed.some(m => m.id === 'CURR'),
  'current Paris slate game reaches analysis');

// Duplicate appears only once.
eq(analyzed.filter(m => m.id === 'DUP').length, 1,
  'duplicate ESPN event analyzed once');

// Current slate has priority on duplicate.
eq(analyzed.find(m => m.id === 'DUP')?.date, '20261004',
  'current slate wins duplicate priority');

// Final from prior slate stays filtered.
assert(!analyzed.some(m => m.id === 'FINAL'),
  'final prior-slate game remains filtered');

// Prior-slate event preserves actual datetime + ESPN slate date.
const prime = analyzed.find(m => m.id === 'PRIME');
eq(prime?.date, '20261003',
  'prime-time game preserves ESPN slate date');
eq(prime?.datetime, '2026-10-04T01:30:00.000Z',
  'prime-time game preserves actual datetime');

// Heartbeat still runs under the clean fix.
assert(kv._store.has('nba_cron_heartbeat_v1'),
  'NBA scheduler heartbeat remains written');

console.log('\nNBA prime-time slate discovery');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ dual-date discovery cleanly isolated\n');
