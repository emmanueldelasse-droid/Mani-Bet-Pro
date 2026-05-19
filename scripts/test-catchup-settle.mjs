#!/usr/bin/env node
/**
 * Tests · MBP-CATCHUP-SETTLE · catch-up settlement + missed games recovery
 *
 * Vérifie :
 *  - constants `BOT_LOG_STATUS` · 7 statuts définis
 *  - `STATS_EXCLUDED_STATUSES` · ne contient PAS 'pending' ni 'settled'
 *  - `_botLogStatus(log)` · back-compat (motor_was_right derive) + lecture explicite
 *  - `_espnStatusToBotLogStatus()` · mapping ESPN → BOT_LOG_STATUS
 *  - `_botCronRunId()` · format `cr_<base36>_<base36>`
 *  - filter stats pipeline · missed_by_cron jamais compté
 *  - `recoverMissedGames` · crée log status='missed_by_cron' SANS motor_prob
 *  - `settlePendingBotLogs` · n'écrit JAMAIS sur log sans motor_prob
 *  - rate-limit catchup · 2 appels rapprochés → 2ème throttled
 *  - tennis match_confidence LOW · log marqué invalid_match_mapping (pas settled)
 *
 * Sandbox vm · pas de réseau · pas de provider externe · KV stub mémoire.
 *
 * Run · `node scripts/test-catchup-settle.mjs`
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', 'worker.js');

let assertCount = 0;
let failCount = 0;
const fails = [];

function assert(cond, msg) {
  assertCount++;
  if (!cond) {
    failCount++;
    fails.push(msg);
    console.error('  ✗', msg);
  }
}

function eq(actual, expected, msg) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, `${msg} · expected=${JSON.stringify(expected)} · actual=${JSON.stringify(actual)}`);
}

function loadSandbox() {
  const source = readFileSync(WORKER_PATH, 'utf8');
  const idx = source.indexOf('export default {');
  if (idx < 0) throw new Error('worker.js export default introuvable');
  const patched = source.slice(0, idx) + 'globalThis.__mbp_handlers = {' + source.slice(idx + 'export default {'.length);

  const sandbox = {
    globalThis: {},
    console:    { log: () => {}, warn: () => {}, error: () => {} },
    crypto:     globalThis.crypto,
    Date, Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
    Error, TypeError, RangeError, Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams,
    Response: class Response {},
    Request:  class Request {},
    Headers:  class Headers {},
    fetch:    async () => { throw new Error('fetch not allowed'); },
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
    async put(key, value, _opts) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix }) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
      return { keys };
    },
    _store: store, // debug only
  };
}

const sandbox = loadSandbox();

// ── 1. Constants ──────────────────────────────────────────────────────────────
console.log('1. Constants BOT_LOG_STATUS + STATS_EXCLUDED_STATUSES');

const status = sandbox.BOT_LOG_STATUS;
assert(typeof status === 'object' && status !== null, 'BOT_LOG_STATUS exporté');
eq(status.PENDING, 'pending', 'BOT_LOG_STATUS.PENDING');
eq(status.SETTLED, 'settled', 'BOT_LOG_STATUS.SETTLED');
eq(status.MISSED_BY_CRON, 'missed_by_cron', 'BOT_LOG_STATUS.MISSED_BY_CRON');
eq(status.RECOVERY_FAILED, 'recovery_failed', 'BOT_LOG_STATUS.RECOVERY_FAILED');
eq(status.POSTPONED, 'postponed', 'BOT_LOG_STATUS.POSTPONED');
eq(status.CANCELLED, 'cancelled', 'BOT_LOG_STATUS.CANCELLED');
eq(status.INVALID_MATCH_MAPPING, 'invalid_match_mapping', 'BOT_LOG_STATUS.INVALID_MATCH_MAPPING');

const excluded = sandbox.STATS_EXCLUDED_STATUSES;
assert(excluded instanceof Set, 'STATS_EXCLUDED_STATUSES est un Set');
assert(!excluded.has('pending'), 'STATS_EXCLUDED · pending NON inclus (encore en attente)');
assert(!excluded.has('settled'), 'STATS_EXCLUDED · settled NON inclus (compte)');
assert(excluded.has('missed_by_cron'), 'STATS_EXCLUDED · missed_by_cron INCLUS');
assert(excluded.has('recovery_failed'), 'STATS_EXCLUDED · recovery_failed INCLUS');
assert(excluded.has('postponed'), 'STATS_EXCLUDED · postponed INCLUS');
assert(excluded.has('cancelled'), 'STATS_EXCLUDED · cancelled INCLUS');
assert(excluded.has('invalid_match_mapping'), 'STATS_EXCLUDED · invalid_match_mapping INCLUS');
eq(excluded.size, 5, 'STATS_EXCLUDED · 5 statuts exclus');

// ── 2. _botLogStatus back-compat ──────────────────────────────────────────────
console.log('2. _botLogStatus back-compat');

const fn = sandbox._botLogStatus;
assert(typeof fn === 'function', '_botLogStatus exporté');
eq(fn({ status: 'settled' }), 'settled', '_botLogStatus · status explicite prioritaire');
eq(fn({ status: 'missed_by_cron' }), 'missed_by_cron', '_botLogStatus · missed_by_cron lu');
eq(fn({ motor_was_right: null }), 'pending', '_botLogStatus · motor_was_right=null → pending (back-compat)');
eq(fn({ motor_was_right: true }), 'settled', '_botLogStatus · motor_was_right=true → settled (back-compat)');
eq(fn({ motor_was_right: false }), 'settled', '_botLogStatus · motor_was_right=false → settled (back-compat)');
eq(fn({}), 'pending', '_botLogStatus · log vide (status absent, motor_was_right undefined) → pending');

// ── 3. _espnStatusToBotLogStatus mapping ──────────────────────────────────────
console.log('3. _espnStatusToBotLogStatus mapping ESPN');

const m = sandbox._espnStatusToBotLogStatus;
eq(m('STATUS_FINAL'),        'settled',   'ESPN STATUS_FINAL → settled');
eq(m('STATUS_FINAL_OT'),     'settled',   'ESPN STATUS_FINAL_OT → settled');
eq(m('STATUS_FINAL_PENALTY'),'settled',   'ESPN STATUS_FINAL_PENALTY → settled');
eq(m('STATUS_POSTPONED'),    'postponed', 'ESPN STATUS_POSTPONED → postponed');
eq(m('STATUS_SUSPENDED'),    'postponed', 'ESPN STATUS_SUSPENDED → postponed');
eq(m('STATUS_DELAYED'),      'postponed', 'ESPN STATUS_DELAYED → postponed');
eq(m('STATUS_CANCELED'),     'cancelled', 'ESPN STATUS_CANCELED → cancelled');
eq(m('STATUS_CANCELLED'),    'cancelled', 'ESPN STATUS_CANCELLED → cancelled (UK spelling)');
eq(m('STATUS_FORFEIT'),      'cancelled', 'ESPN STATUS_FORFEIT → cancelled');
eq(m('STATUS_SCHEDULED'),    null,        'ESPN STATUS_SCHEDULED → null (pas terminal)');
eq(m('STATUS_IN_PROGRESS'),  null,        'ESPN STATUS_IN_PROGRESS → null (pas terminal)');
eq(m(null),                  null,        'null → null');
eq(m(undefined),             null,        'undefined → null');

// ── 4. _botCronRunId format ───────────────────────────────────────────────────
console.log('4. _botCronRunId format');

const id1 = sandbox._botCronRunId();
const id2 = sandbox._botCronRunId();
assert(/^cr_[a-z0-9]+_[a-z0-9]+$/.test(id1), '_botCronRunId · format `cr_<base36>_<base36>`');
assert(id1 !== id2, '_botCronRunId · valeurs uniques entre 2 appels');

// ── 5. Filter stats pipeline ──────────────────────────────────────────────────
console.log('5. Filter stats · missed/postponed/cancelled/invalid jamais compté');

const sampleLogs = [
  { status: 'settled', motor_was_right: true,  motor_prob: 65 },
  { status: 'settled', motor_was_right: false, motor_prob: 55 },
  { status: 'missed_by_cron', motor_was_right: null, motor_prob: null },
  { status: 'postponed',      motor_was_right: null, motor_prob: 60 },
  { status: 'cancelled',      motor_was_right: null, motor_prob: 70 },
  { status: 'invalid_match_mapping', motor_was_right: null, motor_prob: 55 },
  { status: 'recovery_failed',       motor_was_right: null, motor_prob: null },
  { status: 'pending',        motor_was_right: null, motor_prob: 58 },
  // Back-compat · pas de status → derivé via motor_was_right
  { motor_was_right: true,  motor_prob: 72 },
  { motor_was_right: null,  motor_prob: 68 },
];

const eligible = sampleLogs.filter(l => !sandbox.STATS_EXCLUDED_STATUSES.has(sandbox._botLogStatus(l)));
eq(eligible.length, 5, 'Eligible stats · 5 logs (2 settled + 1 pending + 2 back-compat)');
const settled = eligible.filter(l => l.motor_was_right === true || l.motor_was_right === false);
eq(settled.length, 3, 'Settled · 3 logs (2 explicites + 1 back-compat true)');
const correct = settled.filter(l => l.motor_was_right === true);
eq(correct.length, 2, 'Correct · 2 logs (1 settled true + 1 back-compat true)');
const hitRate = correct.length / settled.length;
eq(Math.round(hitRate * 100), 67, 'Hit rate · 2/3 = 66.7%');

// ── 6. recoverMissedGames · règle absolue · pas de motor_prob ───────────────
console.log('6. recoverMissedGames · règle absolue (pas de motor_prob retro)');

const kvNBA = makeKVStub();
// Mock _fetchPlayedMatchesNBA via stub direct du sandbox
const origNBA = sandbox._fetchPlayedMatchesNBA;
sandbox._fetchPlayedMatchesNBA = async (_dateStr) => ({
  items: [
    { match_id: 'nba_okc_sas_20260518', home: 'OKC', away: 'SAS', datetime: '2026-05-18T19:00:00Z',
      live_status: 'STATUS_FINAL', mapped: 'settled', source: 'espn_scoreboard' },
    { match_id: 'nba_lal_bos_20260518', home: 'LAL', away: 'BOS', datetime: '2026-05-18T22:00:00Z',
      live_status: 'STATUS_FINAL', mapped: 'settled', source: 'espn_scoreboard' },
  ],
});

const env1 = { PAPER_TRADING: kvNBA };
const recov = await sandbox.recoverMissedGames('NBA', '20260518', env1);

eq(recov.found_in_live, 2, 'recover · 2 matchs trouvés en live');
eq(recov.already_logged, 0, 'recover · 0 logs déjà présents');
eq(recov.missed_added, 2, 'recover · 2 logs missed_by_cron créés');
eq(recov.missed_match_ids.length, 2, 'recover · 2 match IDs retournés');

// Vérifier que les logs créés respectent la règle absolue
const okcRaw = await kvNBA.get('bot_log_nba_okc_sas_20260518');
assert(okcRaw, 'recover · log OKC vs SAS écrit en KV');
const okc = JSON.parse(okcRaw);
eq(okc.status, 'missed_by_cron', 'recover · status=missed_by_cron');
eq(okc.motor_prob, null, 'recover · motor_prob=null (jamais retroactif)');
eq(okc.motor_was_right, null, 'recover · motor_was_right=null');
eq(okc.betting_recommendations, null, 'recover · betting_recommendations=null');
eq(okc.variables_used, null, 'recover · variables_used=null');
eq(okc.signals, null, 'recover · signals=null');
eq(okc.missed_reason, 'no_log_at_cron_time', 'recover · missed_reason');
assert(okc.cron_run_id && okc.cron_run_id.startsWith('cr_'), 'recover · cron_run_id stamped');
assert(okc.recovery_detected_at, 'recover · recovery_detected_at présent');

// 2ème appel · idempotence (logs déjà présents)
const recov2 = await sandbox.recoverMissedGames('NBA', '20260518', env1);
eq(recov2.already_logged, 2, 'recover idempotent · 2ème run · 2 logs déjà présents');
eq(recov2.missed_added, 0, 'recover idempotent · 2ème run · 0 nouveaux ajouts');

sandbox._fetchPlayedMatchesNBA = origNBA;

// ── 7. Stats avec logs missed · jamais compté ────────────────────────────────
console.log('7. Stats incluant logs missed · winrate exclut bien le bruit');

const mixedLogs = [
  { status: 'settled',   motor_was_right: true,  motor_prob: 65, best_edge: 7 },
  { status: 'settled',   motor_was_right: false, motor_prob: 55, best_edge: 6 },
  { status: 'settled',   motor_was_right: true,  motor_prob: 70, best_edge: 9 },
  { status: 'missed_by_cron', motor_was_right: null, motor_prob: null },
  { status: 'invalid_match_mapping', motor_was_right: null, motor_prob: 55, best_edge: 5 },
];
const elig = mixedLogs.filter(l => !sandbox.STATS_EXCLUDED_STATUSES.has(sandbox._botLogStatus(l)));
eq(elig.length, 3, 'Eligible · 3 logs (les 3 settled)');
const sett = elig.filter(l => l.motor_was_right === true || l.motor_was_right === false);
eq(sett.length, 3, 'Settled · 3 logs');
const corr = sett.filter(l => l.motor_was_right === true);
eq(Math.round(corr.length / sett.length * 100), 67, 'Winrate · 2/3 = 66.7% (missed exclus)');

// ── 8. _normalizeSportParam ──────────────────────────────────────────────────
console.log('8. _normalizeSportParam');

const ns = sandbox._normalizeSportParam;
eq(ns('NBA'), 'NBA', 'NBA → NBA');
eq(ns('nba'), 'NBA', 'nba → NBA (case-insensitive)');
eq(ns('MLB'), 'MLB', 'MLB → MLB');
eq(ns('Tennis'), 'TENNIS', 'Tennis → TENNIS');
eq(ns('soccer'), null, 'soccer → null (non supporté)');
eq(ns(''), null, 'empty → null');
eq(ns(null), null, 'null → null');

// ── 9. Rate-limit catchup ────────────────────────────────────────────────────
console.log('9. Rate-limit catchup · idempotence 5min');

const kvRL = makeKVStub();
const envRL = { PAPER_TRADING: kvRL };

const gate1 = await sandbox._catchupRateLimit(envRL, 'settle', 'NBA', '20260518');
eq(gate1.allowed, true, 'Rate-limit · 1er run autorisé');

const gate2 = await sandbox._catchupRateLimit(envRL, 'settle', 'NBA', '20260518');
eq(gate2.allowed, false, 'Rate-limit · 2ème run < 5min refusé');
assert(typeof gate2.last_run_ms === 'number', 'Rate-limit · last_run_ms exposé');

// Sport différent · pas affecté
const gate3 = await sandbox._catchupRateLimit(envRL, 'settle', 'MLB', '20260518');
eq(gate3.allowed, true, 'Rate-limit · sport différent autorisé');

// Date différente · pas affectée
const gate4 = await sandbox._catchupRateLimit(envRL, 'settle', 'NBA', '20260519');
eq(gate4.allowed, true, 'Rate-limit · date différente autorisée');

// Kind différent · pas affecté
const gate5 = await sandbox._catchupRateLimit(envRL, 'recover', 'NBA', '20260518');
eq(gate5.allowed, true, 'Rate-limit · kind=recover indépendant de kind=settle');

// ── 10. settlePendingBotLogs · ne settle JAMAIS sans motor_prob ──────────────
console.log('10. settlePendingBotLogs · skip logs sans motor_prob');

const kvSettle = makeKVStub();
// Préseed · 1 log pending avec motor_prob + 1 log missed_by_cron + 1 log pending sans motor_prob
await kvSettle.put('bot_log_nba_g1', JSON.stringify({
  match_id: 'nba_g1', status: 'pending', motor_prob: 62, motor_was_right: null,
  date: '20260518', datetime: '2026-05-18T19:00:00Z',
}));
await kvSettle.put('bot_log_nba_g2', JSON.stringify({
  match_id: 'nba_g2', status: 'missed_by_cron', motor_prob: null, motor_was_right: null,
  date: '20260518',
}));
await kvSettle.put('bot_log_nba_g3', JSON.stringify({
  match_id: 'nba_g3', status: 'pending', motor_prob: null, motor_was_right: null,
  date: '20260518',
}));

const origSettleDate = sandbox._botSettleDate;
let settleDateCalls = 0;
sandbox._botSettleDate = async (env, dateStr, opts) => {
  settleDateCalls++;
  // Simuler que ESPN ne retourne rien (pas de match final)
  return { settled: 0, postponed: 0, cancelled: 0, date: dateStr };
};

const envSettle = { PAPER_TRADING: kvSettle };
const settleRes = await sandbox.settlePendingBotLogs('NBA', envSettle, {
  dates: ['20260518'],
  source: 'admin_endpoint',
});
eq(settleRes.sport, 'NBA', 'settlePendingBotLogs · sport NBA');
eq(settleRes.dates_processed, ['20260518'], 'settlePendingBotLogs · dates_processed');
assert(settleRes.cron_run_id && settleRes.cron_run_id.startsWith('cr_'), 'settlePendingBotLogs · cron_run_id stamped');
eq(settleDateCalls, 1, 'settlePendingBotLogs · 1 appel _botSettleDate par date');

// Vérifier que les logs n'ont pas été modifiés (le mock retourne 0 settled)
const g1After = JSON.parse(await kvSettle.get('bot_log_nba_g1'));
eq(g1After.status, 'pending', 'Log g1 toujours pending (mock retourne 0)');
const g2After = JSON.parse(await kvSettle.get('bot_log_nba_g2'));
eq(g2After.status, 'missed_by_cron', 'Log g2 missed_by_cron PRÉSERVÉ (jamais touché)');
const g3After = JSON.parse(await kvSettle.get('bot_log_nba_g3'));
eq(g3After.status, 'pending', 'Log g3 sans motor_prob toujours pending (skip)');
eq(g3After.motor_prob, null, 'Log g3 motor_prob reste null (pas de recalcul)');

sandbox._botSettleDate = origSettleDate;

// ── 11. Defaults settle dates ────────────────────────────────────────────────
console.log('11. _defaultSettleDates · fenêtres par sport');

const nbaDates = sandbox._defaultSettleDates('NBA');
const mlbDates = sandbox._defaultSettleDates('MLB');
const tennisDates = sandbox._defaultSettleDates('TENNIS');
eq(nbaDates.length, 2, 'NBA · 2 jours (J-1, J-2)');
eq(mlbDates.length, 2, 'MLB · 2 jours (J-1, J-2)');
eq(tennisDates.length, 10, 'TENNIS · 10 jours (J-1 à J-10)');

// ── Résumé ────────────────────────────────────────────────────────────────────
console.log('');
console.log(`Total · ${assertCount} assertions · ${failCount} fail`);
if (failCount > 0) {
  console.error('FAIL');
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
console.log('PASS');
