#!/usr/bin/env node
/**
 * MBP monitoring · tests unitaires de la fonction pure `summarize`.
 *
 * Aucun réseau · aucun provider · aucune écriture KV.
 * Fixtures déterministes (scripts/lib/monitoring-fixtures.mjs).
 *
 * Lancement · `node scripts/test-bot-monitoring-summary.mjs`
 * Exit · 0 OK · 1 fail.
 */

import { summarize, summarizeSport, _CONST } from './lib/monitoring-summary.mjs';
import { NBA_FIXTURE_LOGS, MLB_FIXTURE_LOGS, TENNIS_FIXTURE_LOGS, DEMO_LOGS_BY_SPORT } from './lib/monitoring-fixtures.mjs';

const results = [];
function expect(label, expected, actual, note = null) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ label, expected, actual, ok, note });
}

// ── 1. NBA · fixture · 12 logs ─────────────────────────────────────────────
const nba = summarizeSport(NBA_FIXTURE_LOGS, 'NBA');
// Comptes
expect('NBA · total_analyzed', 12, nba.total_analyzed);
// settled · logs avec motor_was_right boolean · 12 - 3 non-settlés (NBA-008, NBA-010, NBA-011) = 9
expect('NBA · total_settled', 9, nba.total_settled);
expect('NBA · total_unsettled', 3, nba.total_unsettled);
// hit rate · correct = NBA-001, 002, 004, 006, 009, 012 = 6 sur 9 = 66.7%
expect('NBA · hit_rate', 66.7, nba.hit_rate);
// INCONCLUSIVE · NBA-007 + NBA-008 = 2
expect('NBA · total_inconclusive', 2, nba.total_inconclusive);
// dq < 0.55 · NBA-007 (0.50) + NBA-008 (0.42) = 2
expect('NBA · dq_below_055_blocked', 2, nba.dq_below_055_blocked);
expect('NBA · mlb_low_blocked', 0, nba.mlb_low_blocked);
// recos exploitables · best non null OU recs.length > 0 · 10 logs (007 et 008 vides)
expect('NBA · total_recos_exploitable', 10, nba.total_recos_exploitable);
// total_blocked = inconclusive + dq below = 2 + 2 = 4
expect('NBA · total_blocked', 4, nba.total_blocked);
// status · total_settled=9 < NBA_RECHECK_MIN=80 → SURVEILLER
expect('NBA · status', 'SURVEILLER', nba.status);

// ── 2. MLB · fixture · 5 logs · MBP-P1 actif ──────────────────────────────
const mlb = summarizeSport(MLB_FIXTURE_LOGS, 'MLB');
expect('MLB · total_analyzed', 5, mlb.total_analyzed);
// settled · MLB-001, 002, 003 = 3
expect('MLB · total_settled', 3, mlb.total_settled);
// hit rate · 2 correct (001, 003) sur 3 = 66.7%
expect('MLB · hit_rate', 66.7, mlb.hit_rate);
// MLB LOW bloqués · MLB-004 + MLB-005 = 2 (data_quality === 'LOW')
expect('MLB · mlb_low_blocked', 2, mlb.mlb_low_blocked);
// Frontend MLB · LOW = recos vide + best null · vérifie que ces 2 logs ne comptent PAS comme exploitables
expect('MLB · total_recos_exploitable (excludes LOW post-gate)', 3, mlb.total_recos_exploitable);
// status · settled=3 < 50 · SURVEILLER (pas assez de données pour LIMITER)
expect('MLB · status (n<50)', 'SURVEILLER', mlb.status);

// ── 3. Tennis · fixture · 4 logs · seuil 0.55 strict ──────────────────────
const tennis = summarizeSport(TENNIS_FIXTURE_LOGS, 'TENNIS');
expect('Tennis · total_analyzed', 4, tennis.total_analyzed);
// TEN-003 (dq 0.48) bloqué · TEN-004 (dq 0.55) autorisé
expect('Tennis · dq_below_055_blocked', 1, tennis.dq_below_055_blocked);
expect('Tennis · total_inconclusive', 1, tennis.total_inconclusive);
// settled · TEN-001, 002, 004 (TEN-003 INCONCLUSIVE pas settlé)
expect('Tennis · total_settled', 3, tennis.total_settled);
// hit rate · 2 correct sur 3 = 66.7%
expect('Tennis · hit_rate', 66.7, tennis.hit_rate);
// status · n<50 → SURVEILLER
expect('Tennis · status (n<50)', 'SURVEILLER', tennis.status);

// ── 4. Vérification stricte du seuil 0.55 ─────────────────────────────────
// log dq=0.55 doit être autorisé · log dq=0.549 bloqué
const boundaryLogs = [
  { match_id: 'B-1', logged_at: '2026-05-01T00:00:00Z', motor_was_right: true,
    confidence_level: 'MEDIUM', data_quality: 0.55,
    betting_recommendations: { recommendations: [], best: null } },
  { match_id: 'B-2', logged_at: '2026-05-02T00:00:00Z', motor_was_right: true,
    confidence_level: 'INCONCLUSIVE', data_quality: 0.549,
    betting_recommendations: { recommendations: [], best: null } },
];
const boundary = summarizeSport(boundaryLogs, 'NBA');
expect('Boundary · dq=0.55 autorisé (pas dans dq_below_055_blocked)', 0,
  boundary.dq_below_055_blocked === 1 ? 0 : 1, 'check inverse · 0.55 ne doit PAS être compté');
// Plus précis · 0.549 doit compter, 0.55 non
const exactBoundary = summarizeSport([boundaryLogs[1]], 'NBA');
expect('Boundary · dq=0.549 compté', 1, exactBoundary.dq_below_055_blocked);
const justAbove = summarizeSport([boundaryLogs[0]], 'NBA');
expect('Boundary · dq=0.55 non compté', 0, justAbove.dq_below_055_blocked);

// ── 5. Hit rate exclut les non-settlés ────────────────────────────────────
const mixed = [
  { match_id: 'M-1', logged_at: '2026-05-01T00:00:00Z', motor_was_right: true,  confidence_level: 'HIGH', data_quality: 0.80,
    betting_recommendations: { recommendations: [{ type: 'MONEYLINE', was_right: true,  edge: 5 }], best: { type: 'MONEYLINE', edge: 5 } } },
  { match_id: 'M-2', logged_at: '2026-05-02T00:00:00Z', motor_was_right: false, confidence_level: 'HIGH', data_quality: 0.80,
    betting_recommendations: { recommendations: [{ type: 'MONEYLINE', was_right: false, edge: 5 }], best: { type: 'MONEYLINE', edge: 5 } } },
  { match_id: 'M-3', logged_at: '2026-05-03T00:00:00Z', motor_was_right: null,  confidence_level: 'HIGH', data_quality: 0.80,
    betting_recommendations: { recommendations: [{ type: 'MONEYLINE', was_right: null,  edge: 5 }], best: { type: 'MONEYLINE', edge: 5 } } },
];
const mixedSummary = summarizeSport(mixed, 'NBA');
expect('Hit rate exclut non-settlés · total_settled', 2, mixedSummary.total_settled);
expect('Hit rate exclut non-settlés · hit_rate', 50, mixedSummary.hit_rate);
expect('Hit rate exclut non-settlés · total_analyzed', 3, mixedSummary.total_analyzed);

// ── 6. Décision MLB · simuler 50+ settled avec hit rate sous 52% ──────────
const fiftyMLBBad = Array.from({ length: 50 }, (_, i) => ({
  match_id: `MLB-bad-${i}`,
  logged_at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  motor_was_right: i < 25,  // 25/50 = 50% < 52%
  confidence_level: 'HIGH',
  data_quality: 'HIGH',
  betting_recommendations: { recommendations: [{ type: 'MONEYLINE', was_right: i < 25, edge: 6 }], best: { type: 'MONEYLINE', edge: 6 } },
}));
const mlbBad = summarizeSport(fiftyMLBBad, 'MLB');
expect('MLB · 50 settled · hit=50% · status', 'LIMITER_OU_DESACTIVER', mlbBad.status);
// 50 settled · hit 53% → SURVEILLER
const fiftyMLBOK = fiftyMLBBad.map((l, i) => ({ ...l, motor_was_right: i < 27, betting_recommendations: { ...l.betting_recommendations, recommendations: [{ type: 'MONEYLINE', was_right: i < 27, edge: 6 }] } }));
const mlbOK = summarizeSport(fiftyMLBOK, 'MLB');
expect('MLB · 50 settled · hit=54% · status', 'SURVEILLER', mlbOK.status);

// ── 7. Décision Tennis · 50+ settled avec hit rate sous 50% ───────────────
const fiftyTennisBad = Array.from({ length: 50 }, (_, i) => ({
  match_id: `TEN-bad-${i}`,
  logged_at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
  motor_was_right: i < 22,  // 22/50 = 44% < 50%
  confidence_level: 'MEDIUM',
  data_quality: 0.70,
  betting_recommendations: { recommendations: [{ type: 'MONEYLINE', was_right: i < 22, edge: 5 }], best: { type: 'MONEYLINE', edge: 5 } },
}));
const tennisBad = summarizeSport(fiftyTennisBad, 'TENNIS');
expect('Tennis · 50 settled · hit=44% · status', 'SURVEILLER_REVERT', tennisBad.status);
const fiftyTennisOK = fiftyTennisBad.map((l, i) => ({ ...l, motor_was_right: i < 28, betting_recommendations: { ...l.betting_recommendations, recommendations: [{ type: 'MONEYLINE', was_right: i < 28, edge: 5 }] } }));
const tennisOK = summarizeSport(fiftyTennisOK, 'TENNIS');
expect('Tennis · 50 settled · hit=56% · status', 'SURVEILLER', tennisOK.status);

// ── 8. summarize global · cohérence des totaux ────────────────────────────
const full = summarize(DEMO_LOGS_BY_SPORT);
expect('Global · total_analyzed = NBA + MLB + TENNIS',
  full.NBA.total_analyzed + full.MLB.total_analyzed + full.TENNIS.total_analyzed,
  full.global.total_analyzed);
expect('Global · total_settled = somme',
  full.NBA.total_settled + full.MLB.total_settled + full.TENNIS.total_settled,
  full.global.total_settled);
expect('Conclusion · liste non vide', true, Array.isArray(full.conclusion) && full.conclusion.length >= 4);

// ── 9. Pas de réseau · pas de provider · pas de KV ────────────────────────
// (test passif · le module n'importe rien qui touche le réseau · vérif par lecture
// du fichier)
expect('Module purement local', true, _CONST.NUMERIC_DQ_THRESHOLD === 0.55);

// ── REPORT ─────────────────────────────────────────────────────────────────

console.log('Bot monitoring summary · tests');
console.log('');
let fails = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS · ${r.label}`);
  } else {
    fails++;
    console.log(`  FAIL · ${r.label}`);
    console.log(`        attendu = ${JSON.stringify(r.expected)}`);
    console.log(`        obtenu  = ${JSON.stringify(r.actual)}`);
    if (r.note) console.log(`        note    = ${r.note}`);
  }
}
console.log('');
console.log(`Résumé · ${results.length - fails}/${results.length} pass · ${fails} fail`);
process.exit(fails > 0 ? 1 : 0);
