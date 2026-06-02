#!/usr/bin/env node
/**
 * MBP-PLAYOFF-GATE-FIX (Fix #4 · recovery auto dans le cron nightly) · tests.
 *
 * Vérifie que `_runNightlySettle` déclenche désormais `recoverMissedGames('NBA')`
 * sur les dates récentes (J-1..J-3) → backfill automatique des trous du cron
 * pré-match (ex. finales de conférence). Avant le fix, recoverMissedGames
 * n'était appelé que manuellement (/bot/recover-missed) → trous permanents.
 *
 * Garanties testées :
 *   1. Un match NBA joué jamais loggé → log `missed_by_cron` créé par le nightly
 *      (sans motor_prob · règle absolue · exclu stats).
 *   2. Un match déjà loggé (pending) n'est PAS écrasé par la recovery.
 *   3. Idempotence multi-jours : pas de doublon (already_logged sur J-2/J-3).
 *   4. La clé NIGHTLY_SETTLE_RUN_KEY reste posée (idempotence nightly préservée).
 *   5. Hors fenêtre 10-11h UTC → ni settle ni recovery (comportement inchangé).
 *
 * Sandbox vm · pas de réseau · KV stub mémoire · settlePendingBotLogs neutralisé
 * (on isole la nouvelle logique de recovery). Pas de secret.
 *
 * Run · `node scripts/test-nightly-recover.mjs`  · Exit 0 OK · 1 sinon.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', 'worker.js');

let assertCount = 0, failCount = 0;
const fails = [];
const assert = (cond, msg) => { assertCount++; if (!cond) { failCount++; fails.push(msg); console.error('  ✗', msg); } };
const eq = (a, e, msg) => assert(JSON.stringify(a) === JSON.stringify(e), `${msg} · expected=${JSON.stringify(e)} · actual=${JSON.stringify(a)}`);

// Date figée dans la fenêtre nightly (10-11h UTC) · 2026-06-03T10:30Z
const FIXED_MS = Date.parse('2026-06-03T10:30:00Z');
class FakeDate extends Date {
  constructor(...args) { if (args.length === 0) super(FIXED_MS); else super(...args); }
  static now() { return FIXED_MS; }
}

function loadSandbox(DateImpl = Date) {
  const source = readFileSync(WORKER_PATH, 'utf8');
  const idx = source.indexOf('export default {');
  if (idx < 0) throw new Error('worker.js export default introuvable');
  const patched = source.slice(0, idx) + 'globalThis.__mbp_handlers = {' + source.slice(idx + 'export default {'.length);
  const sandbox = {
    globalThis: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    crypto: globalThis.crypto,
    Date: DateImpl, Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
    Error, TypeError, RangeError, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams,
    Response: class Response {}, Request: class Request {}, Headers: class Headers {},
    fetch: async () => { throw new Error('fetch not allowed'); },
    atob, btoa, TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(patched, sandbox, { filename: 'worker.js' });
  return sandbox;
}

function makeKVStub(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
    _store: store,
  };
}

// ── Cas A · fenêtre 10-11h UTC · recovery déclenchée ───────────────────────
{
  const sb = loadSandbox(FakeDate);
  // Neutraliser le settle (on isole la recovery)
  sb.settlePendingBotLogs = async () => ({ settled: 0, postponed: 0, cancelled: 0 });
  // Mock matchs NBA joués (mêmes items pour toutes les dates J-1..J-3)
  sb._fetchPlayedMatchesNBA = async (_d) => ({ items: [
    { match_id: '401873200', home: 'OKC', away: 'SAS', datetime: '2026-06-02T01:00:00Z',
      live_status: 'STATUS_FINAL', source: 'espn_scoreboard' },
    { match_id: '401873201', home: 'IND', away: 'NYK', datetime: '2026-06-02T01:30:00Z',
      live_status: 'STATUS_FINAL', source: 'espn_scoreboard' },
  ] });

  // Un match déjà loggé (pending réel) qui ne doit PAS être écrasé
  const existingPending = JSON.stringify({
    match_id: '401873202', status: 'pending', home: 'BOS', away: 'MIA',
    motor_prob: 61, motor_was_right: null, signals: [{ x: 1 }],
  });
  const kv = makeKVStub({ 'bot_log_401873202': existingPending });
  // Étendre le mock pour inclure aussi le match déjà loggé dans les "joués"
  sb._fetchPlayedMatchesNBA = async (_d) => ({ items: [
    { match_id: '401873200', home: 'OKC', away: 'SAS', live_status: 'STATUS_FINAL', source: 'espn' },
    { match_id: '401873201', home: 'IND', away: 'NYK', live_status: 'STATUS_FINAL', source: 'espn' },
    { match_id: '401873202', home: 'BOS', away: 'MIA', live_status: 'STATUS_FINAL', source: 'espn' },
  ] });

  const env = { PAPER_TRADING: kv };

  await sb._runNightlySettle(env);

  const log200 = JSON.parse(kv._store.get('bot_log_401873200'));
  const log201 = JSON.parse(kv._store.get('bot_log_401873201'));
  const log202 = JSON.parse(kv._store.get('bot_log_401873202'));

  // 1. trous backfillés en missed_by_cron
  eq(log200.status, 'missed_by_cron', 'A1 · 401873200 → missed_by_cron créé');
  eq(log201.status, 'missed_by_cron', 'A1 · 401873201 → missed_by_cron créé');
  // règle absolue · pas de motor_prob rétroactif
  eq(log200.motor_prob, null, 'A2 · missed log SANS motor_prob');
  assert(log200.motor_was_right === null, 'A2 · missed log motor_was_right null');

  // 2. match déjà loggé NON écrasé (reste pending avec motor_prob d'origine)
  eq(log202.status, 'pending', 'A3 · log existant préservé (pas écrasé)');
  eq(log202.motor_prob, 61, 'A3 · motor_prob d\'origine intact');

  // 4. clé nightly posée (idempotence)
  assert(kv._store.get('bot_nightly_settle_last_run') != null, 'A4 · NIGHTLY_SETTLE_RUN_KEY posée');

  // 3. idempotence multi-jours · exactement 3 logs au total (pas de doublon)
  const botLogs = [...kv._store.keys()].filter(k => k.startsWith('bot_log_'));
  eq(botLogs.length, 3, 'A5 · 3 logs au total (2 créés + 1 existant · pas de doublon J-1/J-2/J-3)');
}

// ── Cas B · hors fenêtre (08h UTC) · aucune action ─────────────────────────
{
  class OffWindowDate extends Date {
    constructor(...args) { if (args.length === 0) super(Date.parse('2026-06-03T08:00:00Z')); else super(...args); }
    static now() { return Date.parse('2026-06-03T08:00:00Z'); }
  }
  const sb = loadSandbox(OffWindowDate);
  let recoverCalled = false;
  sb.settlePendingBotLogs = async () => { recoverCalled = true; return {}; };
  sb._fetchPlayedMatchesNBA = async () => { recoverCalled = true; return { items: [] }; };
  const kv = makeKVStub();
  await sb._runNightlySettle({ PAPER_TRADING: kv });
  assert(!recoverCalled, 'B1 · hors fenêtre 10-11h UTC → ni settle ni recovery');
  eq([...kv._store.keys()].length, 0, 'B2 · aucune écriture KV hors fenêtre');
}

// ── Bilan ───────────────────────────────────────────────────────────────────
console.log(`\nnightly recover · Fix #4`);
console.log(`  assertions: ${assertCount}`);
console.log(`  fail: ${failCount}`);
if (failCount > 0) { console.log('\n  Échecs :'); fails.forEach(f => console.log(`   ✗ ${f}`)); process.exit(1); }
console.log('  ✓ tous les cas OK\n');
process.exit(0);
