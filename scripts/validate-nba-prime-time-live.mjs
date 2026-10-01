#!/usr/bin/env node
/**
 * Live provider proof for PR #241.
 *
 * Executes the real branch worker code with:
 * - clock frozen at 2026-10-03T22:00:00Z = 2026-10-04 00:00 Europe/Paris;
 * - real ESPN scoreboard payloads;
 * - heavy non-discovery providers stubbed;
 * - in-memory KV.
 *
 * Expected real case:
 * Miami Heat @ Toronto Raptors · 2026-10-03 23:00 UTC · PRESEASON.
 * At the frozen clock it is H1 (~60 min to tip), while Paris date is already
 * 20261004. The match must therefore be discovered from ESPN slate 20261003.
 *
 * This is a live-provider validation, not a predictive/backtest test.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', 'worker.js');
const ESPN_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

const FIXED_ISO = '2026-10-03T22:00:00.000Z';
const FIXED_MS = Date.parse(FIXED_ISO);

class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) super(FIXED_MS);
    else super(...args);
  }
  static now() { return FIXED_MS; }
}

let assertions = 0;
let failures = 0;
const assert = (cond, msg) => {
  assertions++;
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  } else {
    console.log('  ✓', msg);
  }
};
const eq = (actual, expected, msg) =>
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);

function loadSandbox(logs) {
  const source = readFileSync(WORKER_PATH, 'utf8');
  const idx = source.indexOf('export default {');
  if (idx < 0) throw new Error('worker export default not found');
  const patched =
    source.slice(0, idx) +
    'globalThis.__mbp_handlers = {' +
    source.slice(idx + 'export default {'.length);

  const consoleProxy = {
    log: (...args) => logs.push(['log', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: (...args) => logs.push(['error', ...args]),
  };

  const sandbox = {
    globalThis: {},
    console: consoleProxy,
    crypto: globalThis.crypto,
    Date: FakeDate,
    Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
    Error, TypeError, RangeError, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Intl,
    Response: globalThis.Response,
    Request: globalThis.Request,
    Headers: globalThis.Headers,
    fetch: globalThis.fetch,
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
      if (opts?.type === 'json' && typeof v === 'string') {
        try { return JSON.parse(v); } catch { return null; }
      }
      return v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
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

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ManiBetPro-live-proof/1.0' },
    });
    if (!response.ok) {
      throw new Error(`ESPN HTTP ${response.status} for ${url}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const runtimeLogs = [];
const sb = loadSandbox(runtimeLogs);
const kv = makeKV();

eq(sb._botFormatDate(new FakeDate()), '20261004',
  'frozen time resolves to Paris date 20261004');
eq(sb._botPreviousCompactDate('20261004'), '20261003',
  'previous ESPN slate is 20261003');

const fetchedDates = [];
sb.espnFetch = async url => {
  const date = new URL(url).searchParams.get('dates');
  fetchedDates.push(date);
  return await fetchJson(`${ESPN_SCOREBOARD}?dates=${date}&limit=25`);
};

// Discovery proof only: isolate expensive/irrelevant providers.
const jsonResp = value => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
sb.handleNBAInjuriesImpact = async () => jsonResp({});
sb.handleOddsComparison = async () => jsonResp({});
sb.handleNBATeamsStats = async () => jsonResp({});
sb._tank01FetchWithFallback = async () => null;
sb.handleNBARecentForm = async () => null;
sb.handleNBAAIInjuriesBatch = async () => null;
sb._botSendTelegram = async () => null;

const analyzed = [];
sb._botAnalyzeMatch = async match => {
  analyzed.push({
    id: match.id,
    date: match.date,
    datetime: match.datetime,
    event_type: match.event_type,
    season_type: match.season_type,
    home: match.home_team?.name ?? null,
    away: match.away_team?.name ?? null,
  });
  return {
    analysis_id: `live-proof-${match.id}`,
    match_id: match.id,
    home: match.home_team?.name ?? null,
    away: match.away_team?.name ?? null,
    confidence_level: 'INCONCLUSIVE',
    betting_recommendations: [],
    best_edge: null,
  };
};
sb._botSaveLog = async (env, log) => {
  await env.PAPER_TRADING.put(`bot_log_${log.match_id}`, JSON.stringify(log));
  return { kv_written: true, d1_written: false };
};

await sb._runBotCron({ PAPER_TRADING: kv }, false);

eq([...new Set(fetchedDates)].sort(), ['20261003', '20261004'],
  'real run fetches Paris + previous ESPN slates');

const target = analyzed.find(m =>
  /Toronto Raptors/i.test(m.home ?? '') &&
  /Miami Heat/i.test(m.away ?? '')
);

assert(Boolean(target), 'Miami @ Toronto discovered by real ESPN payload');

if (target) {
  eq(target.date, '20261003',
    'target retains ESPN US slate date 20261003');
  assert(
    Number.isFinite(Date.parse(target.datetime)) &&
      Math.abs(Date.parse(target.datetime) - Date.parse('2026-10-03T23:00:00.000Z')) <= 15 * 60 * 1000,
    'target datetime is around official 23:00 UTC tip'
  );
  eq(target.event_type, 'PRESEASON',
    'target classified PRESEASON');
  eq(Number(target.season_type), 1,
    'target classified season_type=1');

  const minutesToTip = Math.round((Date.parse(target.datetime) - FIXED_MS) / 60000);
  assert(minutesToTip > 0 && minutesToTip <= 90,
    `target is inside H1 window at frozen runtime (${minutesToTip} min)`);

  const markerRaw = kv._store.get(`nba_checkpoint_${target.id}_H1`);
  assert(Boolean(markerRaw), 'H1 idempotence marker persisted for target');
  if (markerRaw) {
    const marker = JSON.parse(markerRaw);
    eq(marker.checkpoint_id, 'H1', 'persisted checkpoint is H1');
  }

  eq(analyzed.filter(m => m.id === target.id).length, 1,
    'target analyzed exactly once after dual-slate dedup');
}

const cronEntry = runtimeLogs.find(
  row => row[0] === 'log' && row[1] === '[BOT-CRON-LOG]'
);
assert(Boolean(cronEntry), 'structured BOT-CRON-LOG emitted');
if (cronEntry) {
  const payload = JSON.parse(cronEntry[2]);
  eq(payload.fetch_dates, ['20261004', '20261003'],
    'structured cron log records both fetch dates');
  assert(payload.games_analyzed >= 1,
    'cron reports at least one analyzed game');
}

console.log('\nNBA prime-time LIVE provider proof');
console.log(`  frozen_at: ${FIXED_ISO}`);
console.log(`  fetched_dates: ${[...new Set(fetchedDates)].join(', ')}`);
console.log(`  analyzed: ${analyzed.map(m => `${m.away} @ ${m.home} [${m.date}]`).join(' | ')}`);
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);

if (failures > 0) process.exit(1);
console.log('  ✓ live ESPN dual-slate + H1 proof passed\n');
