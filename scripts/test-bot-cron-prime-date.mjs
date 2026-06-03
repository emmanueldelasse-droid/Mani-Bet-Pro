#!/usr/bin/env node
/**
 * MBP-PLAYOFF-GATE-FIX (Fix #5 · cron date prime-time NBA) · tests.
 *
 * Vérifie que `_runBotCron` interroge ESPN sur la date Paris ET la date Paris-1,
 * fusionne les deux slates et déduplique par match_id. Sans ce correctif, les
 * matchs prime-time US (classés par ESPN sous la date US = veille en heure Paris)
 * étaient invisibles → games_found=0 → jamais loggés pré-match (finales).
 *
 * Garanties testées (forceRun=true · fenêtre + once-per-day court-circuités) :
 *   1. Un match présent SEULEMENT dans le slate Paris-1 (prime-time) atteint
 *      l'analyse (donc serait loggé). ← cœur du fix
 *   2. Un match du slate Paris (après-midi US) atteint l'analyse. ← non-régression
 *   3. Un match présent dans les DEUX slates n'est traité qu'UNE fois (dédup).
 *   4. Un match STATUS_FINAL (slate veille) est filtré (already_final).
 *   5. fetch sur 2 dates exactement : [Paris, Paris-1].
 *
 * Sandbox vm · pas de réseau · loaders stubbés · KV stub mémoire. Pas de secret.
 * Run · `node scripts/test-bot-cron-prime-date.mjs`  · Exit 0 OK · 1 sinon.
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

// Horloge figée · 2026-06-03T12:00Z → Paris(UTC+2)=14:00 03/06 → dateStr 20260603
// prevDateStr = 02/06 → 20260602
const FIXED_MS = Date.parse('2026-06-03T12:00:00Z');
class FakeDate extends Date {
  constructor(...args) { if (args.length === 0) super(FIXED_MS); else super(...args); }
  static now() { return FIXED_MS; }
}

function loadSandbox() {
  const source = readFileSync(WORKER_PATH, 'utf8');
  const idx = source.indexOf('export default {');
  if (idx < 0) throw new Error('worker.js export default introuvable');
  const patched = source.slice(0, idx) + 'globalThis.__mbp_handlers = {' + source.slice(idx + 'export default {'.length);
  const sandbox = {
    globalThis: {},
    console: { log: () => {}, warn: () => {}, error: () => {} },
    crypto: globalThis.crypto,
    Date: FakeDate, Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
    Error, TypeError, RangeError, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Intl, // Intl requis par _botFormatDate
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
    async get(key) { const v = store.has(key) ? store.get(key) : null; return v; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
    _store: store,
  };
}

const sb = loadSandbox();

// ── Stubs des loaders lourds (on isole la logique de fetch/merge) ───────────
const fetchedDates = [];
sb.espnFetch = async (url) => {
  const m = /dates=(\d{8})/.exec(url);
  const d = m ? m[1] : null;
  fetchedDates.push(d);
  if (d === '20260603') return { __games: [
    { id: 'CURR_AFT',  home: 'Boston Celtics',  away: 'New York Knicks',     status: 'STATUS_SCHEDULED' },
    { id: 'DUP_GAME',  home: 'Denver Nuggets',  away: 'LA Lakers',           status: 'STATUS_SCHEDULED' },
  ] };
  if (d === '20260602') return { __games: [
    { id: 'PRIME_NIGHT', home: 'Oklahoma City Thunder', away: 'San Antonio Spurs', status: 'STATUS_SCHEDULED' },
    { id: 'DUP_GAME',    home: 'Denver Nuggets',        away: 'LA Lakers',          status: 'STATUS_SCHEDULED' },
    { id: 'OLD_FINAL',   home: 'Miami Heat',            away: 'Chicago Bulls',      status: 'STATUS_FINAL' },
  ] };
  return null;
};
// parseESPNMatches contrôlé : transforme __games → matchs, en propageant la date du slate
sb.parseESPNMatches = (data, dateStr) => (data.__games ?? []).map(g => ({
  id: g.id, date: dateStr, datetime: '2026-06-03T00:30:00Z',
  status: g.status, home_team: { name: g.home }, away_team: { name: g.away },
}));

// Loaders de données : no-op safe
const okJson = (obj = {}) => ({ json: async () => obj });
sb.handleNBAInjuriesImpact = async () => okJson({});
sb.handleOddsComparison    = async () => okJson({});
sb.handleNBATeamsStats     = async () => okJson({});
sb._tank01FetchWithFallback = async () => null;
sb.handleNBARecentForm      = async () => null;
sb.handleNBAAIInjuriesBatch = async () => null;

// _botAnalyzeMatch stubbé : enregistre les match_id atteints, ne sauvegarde rien
const analyzed = [];
sb._botAnalyzeMatch = async (match) => { analyzed.push(match.id); return null; };

const kv = makeKVStub();
const env = { PAPER_TRADING: kv };

// forceRun=true → court-circuite fenêtre 2h + once-per-day
await sb._runBotCron(env, true);

// ── Assertions ──────────────────────────────────────────────────────────────
// 5. fetch exactement sur Paris + Paris-1
eq([...fetchedDates].sort(), ['20260602', '20260603'], 'F5 · fetch sur [Paris-1, Paris]');

// 1. match prime-time (slate veille uniquement) atteint l'analyse
assert(analyzed.includes('PRIME_NIGHT'), 'F1 · match prime-time (slate Paris-1) analysé');

// 2. match du slate Paris (après-midi) analysé
assert(analyzed.includes('CURR_AFT'), 'F2 · match slate Paris analysé (non-régression)');

// 3. dédup : DUP_GAME (présent dans les 2 slates) traité une seule fois
eq(analyzed.filter(id => id === 'DUP_GAME').length, 1, 'F3 · doublon traité une seule fois (dédup match_id)');

// 4. STATUS_FINAL filtré
assert(!analyzed.includes('OLD_FINAL'), 'F4 · match STATUS_FINAL filtré (already_final)');

// total : 3 matchs analysés (CURR_AFT, DUP_GAME, PRIME_NIGHT)
eq(analyzed.length, 3, 'F · 3 matchs analysés au total');

// ── Bilan ───────────────────────────────────────────────────────────────────
console.log(`\nbot cron prime-time date · Fix #5`);
console.log(`  assertions: ${assertCount}`);
console.log(`  fail: ${failCount}`);
if (failCount > 0) { console.log('\n  Échecs :'); fails.forEach(f => console.log(`   ✗ ${f}`)); process.exit(1); }
console.log('  ✓ tous les cas OK\n');
process.exit(0);
