#!/usr/bin/env node
/**
 * MBP-NBA-PLAYOFF-GATE-LOG · Option A · tests observabilité.
 *
 * Vérifie que les patches d'audit (Option A · audit ks7cN) ne modifient
 * AUCUN comportement métier · uniquement la visibilité ·
 *
 *   1. Hard-block playoff toujours actif (score=null, score_method
 *      MISSING_ABSENCES_PLAYOFF) quand absences non confirmées.
 *   2. `rejection_reason` désormais exposé (au lieu de null implicite).
 *   3. Logger.warn 'NBA_PLAYOFF_GATE_BLOCKED' émis avec match_id + phase.
 *   4. Mapping UI `formatRejection('MISSING_ABSENCES_PLAYOFF')` retourne
 *      le libellé FR explicite.
 *   5. Saison régulière inchangée · gate ne se déclenche pas même sans
 *      absences confirmées · score calculé normalement.
 *
 * Lancement · `node scripts/test-nba-playoff-gate.mjs`
 * Exit · 0 si OK · 1 sinon.
 *
 * Read-only sur le moteur · ne modifie aucun comportement.
 */

import './lib/dom-stub.mjs';

import { EngineNBA }     from '../src/engine/engine.nba.js';
import { Logger }        from '../src/utils/utils.logger.js';
import { formatRejection } from '../src/ui/ui.match-detail.helpers.js';
import { getNBAWeights } from '../src/config/sports.config.js';

const REGULAR_DATE = new Date(2026, 0, 15); // 15 janvier · saison régulière
const PLAYOFF_DATE = new Date(2026, 4, 18); // 18 mai · playoffs · cas OKC vs SAS

// ── INTERCEPTION DES LOGS ───────────────────────────────────────────────────
// Logger.warn appelle console.warn · on intercepte pour vérifier l'émission.
const capturedWarns = [];
const originalWarn  = console.warn;
console.warn = function intercept(...args) {
  capturedWarns.push(args);
};

function lastWarnEvent() {
  // _log() construit le prefix `[MBP/WARN] <event>` puis data en 3e arg
  for (let i = capturedWarns.length - 1; i >= 0; i--) {
    const a = capturedWarns[i];
    if (typeof a[0] === 'string' && a[0].includes('NBA_PLAYOFF_GATE_BLOCKED')) {
      return { prefix: a[0], data: a[2] ?? a[1] };
    }
  }
  return null;
}

// ── FIXTURES MINIMALES ──────────────────────────────────────────────────────
function baseMatchData(overrides = {}) {
  return Object.assign({
    match_id: 'TEST_OKC_SAS',
    home_season_stats: {
      name: 'Oklahoma City Thunder',
      net_rating: 5.2,
      defensive_rating: 110.5,
      pace: 99.5,
      efg_pct: 0.55,
      ts_pct: 0.59,
      win_pct: 0.65,
      avg_pts: 115,
      games_played: 60,
      home_win_pct: 0.70,
      away_win_pct: 0.55,
    },
    away_season_stats: {
      name: 'San Antonio Spurs',
      net_rating: 1.5,
      defensive_rating: 113.0,
      pace: 100.0,
      efg_pct: 0.53,
      ts_pct: 0.57,
      win_pct: 0.50,
      avg_pts: 110,
      games_played: 60,
      home_win_pct: 0.55,
      away_win_pct: 0.45,
    },
    home_recent: null,
    away_recent: null,
    home_injuries: null,
    away_injuries: null,
    odds: null,
    market_odds: null,
    advanced_stats: null,
    absences_confirmed: false,
  }, overrides);
}

// Forcer la phase via monkey-patch Date · getNBAWeights() lit `new Date()`
// si aucun argument · on appelle d'abord pour préchauffer le cache puis on
// passe explicitement la date dans le matchData via `__phase_date`. Comme
// engine.nba.js fait `getNBAWeights()` sans argument, on monkey-patch
// globalThis.Date temporairement.
function withForcedDate(forced, fn) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(forced.getTime());
      return new RealDate(...args);
    }
    static now() { return forced.getTime(); }
  };
  try { return fn(); }
  finally { globalThis.Date = RealDate; }
}

// ── ASSERTIONS ──────────────────────────────────────────────────────────────
const results = [];
function check(name, cond, detail = null) {
  results.push({ name, status: cond ? 'PASS' : 'FAIL', detail });
}

// ── TEST 1 · playoff + absences_confirmed=false → hard-block ────────────────
capturedWarns.length = 0;
const playoffResult = withForcedDate(PLAYOFF_DATE, () =>
  EngineNBA.compute(baseMatchData({ absences_confirmed: false }))
);

check(
  'playoff_gate · phase détectée correctement',
  playoffResult.nba_phase === 'playoff',
  `phase=${playoffResult.nba_phase}`,
);
check(
  'playoff_gate · score reste null (comportement métier inchangé)',
  playoffResult.score === null,
  `score=${playoffResult.score}`,
);
check(
  'playoff_gate · score_method=MISSING_ABSENCES_PLAYOFF',
  playoffResult.score_method === 'MISSING_ABSENCES_PLAYOFF',
  `score_method=${playoffResult.score_method}`,
);
check(
  'playoff_gate · debug.playoff_gate inchangé',
  playoffResult.debug?.playoff_gate === 'absences_not_confirmed',
  `debug=${JSON.stringify(playoffResult.debug)}`,
);

// ── TEST 2 · rejection_reason exposé (PATCH 2) ──────────────────────────────
check(
  'patch2 · rejection_reason exposé',
  playoffResult.rejection_reason === 'MISSING_ABSENCES_PLAYOFF',
  `rejection_reason=${playoffResult.rejection_reason}`,
);

// ── TEST 3 · Logger NBA_PLAYOFF_GATE_BLOCKED appelé (PATCH 1) ───────────────
const warn = lastWarnEvent();
check(
  'patch1 · Logger.warn NBA_PLAYOFF_GATE_BLOCKED émis',
  warn !== null,
  warn ? `prefix=${warn.prefix}` : 'aucun warn capté',
);
check(
  'patch1 · payload.match_id présent',
  warn?.data?.match_id === 'TEST_OKC_SAS',
  `match_id=${warn?.data?.match_id}`,
);
check(
  'patch1 · payload.phase=playoff',
  warn?.data?.phase === 'playoff',
  `phase=${warn?.data?.phase}`,
);
check(
  'patch1 · payload.absences_confirmed=false',
  warn?.data?.absences_confirmed === false,
  `absences_confirmed=${warn?.data?.absences_confirmed}`,
);
check(
  'patch1 · payload.score_method=MISSING_ABSENCES_PLAYOFF',
  warn?.data?.score_method === 'MISSING_ABSENCES_PLAYOFF',
  `score_method=${warn?.data?.score_method}`,
);
check(
  'patch1 · payload.home + away présents',
  warn?.data?.home === 'Oklahoma City Thunder' && warn?.data?.away === 'San Antonio Spurs',
  `home=${warn?.data?.home} · away=${warn?.data?.away}`,
);

// ── TEST 4 · UI mapping (PATCH 5) ───────────────────────────────────────────
const label = formatRejection('MISSING_ABSENCES_PLAYOFF');
check(
  'patch5 · formatRejection mappe MISSING_ABSENCES_PLAYOFF',
  label === 'Données blessures non confirmées (playoff)',
  `label="${label}"`,
);
// Vérifier que les mappings existants ne sont pas cassés
check(
  'patch5 · mapping existant ABSENCES_NOT_CONFIRMED inchangé',
  formatRejection('ABSENCES_NOT_CONFIRMED') === 'Absences non confirmées',
);
check(
  'patch5 · mapping inconnu retourne la raison brute',
  formatRejection('SOME_UNKNOWN_REASON') === 'SOME_UNKNOWN_REASON',
);

// ── TEST 5 · saison régulière · gate jamais déclenché ───────────────────────
capturedWarns.length = 0;
const regularResult = withForcedDate(REGULAR_DATE, () =>
  EngineNBA.compute(baseMatchData({ absences_confirmed: false }))
);
check(
  'regular_season · phase=regular',
  regularResult.nba_phase === 'regular',
  `phase=${regularResult.nba_phase}`,
);
check(
  'regular_season · gate NON déclenché malgré absences_confirmed=false',
  regularResult.score_method !== 'MISSING_ABSENCES_PLAYOFF',
  `score_method=${regularResult.score_method}`,
);
check(
  'regular_season · rejection_reason absent (saison régulière)',
  regularResult.rejection_reason === undefined,
  `rejection_reason=${regularResult.rejection_reason}`,
);
check(
  'regular_season · aucun Logger.warn NBA_PLAYOFF_GATE_BLOCKED émis',
  lastWarnEvent() === null,
);

// ── TEST 6 · playoff + absences_confirmed=true · gate franchi ──────────────
capturedWarns.length = 0;
const playoffOkResult = withForcedDate(PLAYOFF_DATE, () =>
  EngineNBA.compute(baseMatchData({ absences_confirmed: true }))
);
check(
  'playoff · absences confirmées · gate franchi · score calculé',
  playoffOkResult.score_method !== 'MISSING_ABSENCES_PLAYOFF',
  `score_method=${playoffOkResult.score_method}`,
);
check(
  'playoff · gate franchi · pas de rejection_reason',
  playoffOkResult.rejection_reason === undefined,
  `rejection_reason=${playoffOkResult.rejection_reason}`,
);
check(
  'playoff · gate franchi · pas de Logger.warn',
  lastWarnEvent() === null,
);

// ── RESTAURATION ────────────────────────────────────────────────────────────
console.warn = originalWarn;

// ── RÉSUMÉ ──────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.status === 'PASS').length;
const failed = results.filter(r => r.status === 'FAIL').length;

console.log(`\nNBA playoff gate · Option A · observabilité`);
console.log('='.repeat(72));
for (const r of results) {
  const tag = r.status === 'PASS' ? '✓' : '✗';
  console.log(`  ${tag} ${r.status.padEnd(4)} · ${r.name}${r.detail && r.status === 'FAIL' ? ' · ' + r.detail : ''}`);
}
console.log('='.repeat(72));
console.log(`Résumé · ${passed} passed · ${failed} failed`);

if (failed > 0) {
  console.error(`\nFAIL · ${failed} test(s) en échec`);
  process.exit(1);
}
console.log('OK · observabilité ajoutée sans changement métier');
process.exit(0);
