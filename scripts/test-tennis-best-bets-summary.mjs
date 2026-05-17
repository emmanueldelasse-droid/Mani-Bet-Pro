#!/usr/bin/env node
/**
 * MBP · test summary best bets tennis · pure function.
 *
 * Couvre · classification correcte · hit rate basé sur best_side===result_winner
 * (PAS motor_was_right · contrarian-incompatible) · exclusion stricte des value
 * ideas et no_bet du hit rate · décisions seuil 50 · 50-54 · 55+ · ROI flat.
 *
 * Lancement · node scripts/test-tennis-best-bets-summary.mjs
 * Exit · 0 OK · 1 fail.
 */

import { summarizeTennisBestBets, _CONST } from './lib/tennis-best-bets-summary.mjs';

const results = [];
function expect(label, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ label, expected, actual, ok });
}

// ── Helpers fixtures ────────────────────────────────────────────────────────

function mkLog({
  match_id, date, motor_prob = 60, confidence = 'MEDIUM', dq = 0.72,
  bestSide = null, bestEdge = null, bestOdds = null, bestKelly = null,
  isContrarian = false, resultWinner = null, motorWasRight = null,
  recs = null, tournament = 'Test Open', p1 = 'P One', p2 = 'P Two',
}) {
  const best = bestSide ? {
    type: 'MONEYLINE', side: bestSide, edge: bestEdge,
    odds_decimal: bestOdds, motor_prob, kelly_stake: bestKelly,
    is_contrarian: isContrarian,
  } : null;
  return {
    match_id, p1, p2, tournament, date,
    motor_prob, confidence_level: confidence, data_quality: dq,
    best_side: bestSide, best_edge: bestEdge,
    betting_recommendations: recs === null
      ? (best ? { best, recommendations: [best] } : null)
      : { best, recommendations: recs },
    result_winner: resultWinner,
    motor_was_right: motorWasRight,
    settled_at: motorWasRight === null ? null : '2026-05-17T20:00:00Z',
  };
}

// ── 1. Hit rate calculé · best_side===result_winner (pas motor_was_right) ──

const logs1 = [
  // Best bet HOME · settled · gagné
  mkLog({ match_id: '1', bestSide: 'HOME', bestEdge: 7, bestOdds: 1.85,
          resultWinner: 'HOME', motorWasRight: true }),
  // Best bet AWAY · settled · gagné
  mkLog({ match_id: '2', bestSide: 'AWAY', bestEdge: 6, bestOdds: 2.10,
          resultWinner: 'AWAY', motorWasRight: false }),  // motor_prob>50 → home prédit · AWAY gagne → motor wrong · MAIS bet AWAY gagne
  // Best bet HOME · settled · perdu
  mkLog({ match_id: '3', bestSide: 'HOME', bestEdge: 5, bestOdds: 1.95,
          resultWinner: 'AWAY', motorWasRight: false }),
  // Best bet · pending
  mkLog({ match_id: '4', bestSide: 'HOME', bestEdge: 8, bestOdds: 1.75,
          resultWinner: null, motorWasRight: null }),
];

const s1 = summarizeTennisBestBets(logs1);
expect('Hit rate · 2 wins / 3 settled = 66.7%', 66.7, s1.performance_best_bets.hit_rate);
expect('Best bets total = 4',                    4,    s1.volume.recommended_bets_total);
expect('Best bets settled = 3',                  3,    s1.volume.recommended_bets_settled);
expect('Wins = 2 (contrarian-safe)',             2,    s1.performance_best_bets.wins);
expect('Pending = 1',                            1,    s1.performance_best_bets.pending);

// ── 2. Value idea exclue du hit rate ───────────────────────────────────────

const logs2 = [
  mkLog({ match_id: '1', bestSide: 'HOME', bestEdge: 7, bestOdds: 1.90,
          resultWinner: 'HOME', motorWasRight: true }),  // 1 best bet win
  // Value idea · recos sans best · settled · ne doit PAS compter
  {
    match_id: '2', date: '2026-05-17', p1: 'A', p2: 'B', tournament: 'X',
    motor_prob: 55, confidence_level: 'LOW', data_quality: 0.62,
    best_side: null, best_edge: null,
    betting_recommendations: {
      best: null,
      recommendations: [{ type: 'MONEYLINE', side: 'AWAY', edge: 6, motor_prob: 45, is_contrarian: true }],
    },
    result_winner: 'AWAY', motor_was_right: false,  // settled mais value idea
  },
];

const s2 = summarizeTennisBestBets(logs2);
expect('Value idea · best_bets_total exclut value', 1, s2.volume.recommended_bets_total);
expect('Value idea · counted separately',           1, s2.volume.value_ideas_not_selected_total);
expect('Value idea · hit_rate basé seulement sur best bets', 100, s2.performance_best_bets.hit_rate);

// ── 3. No bet exclu du hit rate ────────────────────────────────────────────

const logs3 = [
  mkLog({ match_id: '1', bestSide: 'HOME', bestEdge: 7, bestOdds: 1.85,
          resultWinner: 'AWAY', motorWasRight: false }),  // best bet lost
  { match_id: '2', date: '2026-05-17', p1: 'A', p2: 'B',
    motor_prob: 50, confidence_level: 'INCONCLUSIVE', data_quality: 0.40,
    best_side: null, best_edge: null,
    betting_recommendations: null,
    result_winner: 'HOME', motor_was_right: false },
];

const s3 = summarizeTennisBestBets(logs3);
expect('No bet · best_bets_total exclut no_bet', 1, s3.volume.recommended_bets_total);
expect('No bet · counted separately',            1, s3.volume.no_bet_analysis_total);
expect('No bet · hit_rate basé seulement sur best bets', 0, s3.performance_best_bets.hit_rate);

// ── 4. Décision · sample < 50 → INSUFFICIENT ───────────────────────────────

const decisionSmall = summarizeTennisBestBets(logs1);
expect('Decision · n=3 (<50) → INSUFFICIENT', 'INSUFFICIENT_SAMPLE', decisionSmall.decision.status);

// ── 5. Décision · 50 settled · hit < 50% → ALERT ──────────────────────────

const fifty49 = Array.from({ length: 50 }, (_, i) => mkLog({
  match_id: `bad-${i}`,
  bestSide: 'HOME', bestEdge: 6, bestOdds: 1.90,
  resultWinner: i < 24 ? 'HOME' : 'AWAY',  // 24/50 = 48% < 50%
  motorWasRight: i < 24,
}));
const sBad = summarizeTennisBestBets(fifty49);
expect('Decision · n=50 · hit=48% < 50% → ALERT', 'ALERT_BELOW_50', sBad.decision.status);
expect('Decision · hit_rate 48',                  48, sBad.performance_best_bets.hit_rate);

// ── 6. Décision · 50-54% → NEUTRAL ─────────────────────────────────────────

const fifty52 = Array.from({ length: 50 }, (_, i) => mkLog({
  match_id: `neu-${i}`,
  bestSide: 'HOME', bestEdge: 6, bestOdds: 1.90,
  resultWinner: i < 26 ? 'HOME' : 'AWAY',  // 26/50 = 52%
  motorWasRight: i < 26,
}));
const sNeu = summarizeTennisBestBets(fifty52);
expect('Decision · hit=52% → NEUTRAL', 'NEUTRAL_ZONE', sNeu.decision.status);

// ── 7. Décision · hit >= 55% → POSITIVE_SIGNAL ─────────────────────────────

const fifty58 = Array.from({ length: 50 }, (_, i) => mkLog({
  match_id: `pos-${i}`,
  bestSide: 'HOME', bestEdge: 7, bestOdds: 1.85,
  resultWinner: i < 29 ? 'HOME' : 'AWAY',  // 29/50 = 58%
  motorWasRight: i < 29,
}));
const sPos = summarizeTennisBestBets(fifty58);
expect('Decision · hit=58% → POSITIVE',           'POSITIVE_SIGNAL', sPos.decision.status);
expect('Decision · seuil POSITIVE atteint à 55%', true,              sPos.performance_best_bets.hit_rate >= _CONST.HIT_POSITIVE_SIGNAL);

// ── 8. ROI flat stake · 2 wins @ 1.90 + 1 loss = net positive ──────────────

const roiLogs = [
  mkLog({ match_id: '1', bestSide: 'HOME', bestEdge: 7, bestOdds: 1.90,
          resultWinner: 'HOME', motorWasRight: true }),  // +0.90
  mkLog({ match_id: '2', bestSide: 'HOME', bestEdge: 6, bestOdds: 2.00,
          resultWinner: 'HOME', motorWasRight: true }),  // +1.00
  mkLog({ match_id: '3', bestSide: 'AWAY', bestEdge: 5, bestOdds: 2.10,
          resultWinner: 'HOME', motorWasRight: true }),  // -1.00
];
const sRoi = summarizeTennisBestBets(roiLogs);
expect('ROI · available',         true, sRoi.roi.available);
expect('ROI · profit_units = 0.9', 0.9,  sRoi.roi.profit_units);
expect('ROI · roi_pct = 30',       30,   sRoi.roi.roi_pct);

// ── 9. ROI non calculable · pas de odds_decimal ────────────────────────────

const roiNoOdds = [
  mkLog({ match_id: '1', bestSide: 'HOME', bestEdge: 7, bestOdds: null,
          resultWinner: 'HOME', motorWasRight: true }),
];
const sRoiNone = summarizeTennisBestBets(roiNoOdds);
expect('ROI · non calculable si odds manquantes', false, sRoiNone.roi.available);

// ── 10. Contrarian segment · safe avec contrarian:true ────────────────────

const contLogs = [
  mkLog({ match_id: '1', bestSide: 'AWAY', bestEdge: 6, bestOdds: 3.5,
          isContrarian: true, resultWinner: 'AWAY', motorWasRight: false }),  // contrarian win
  mkLog({ match_id: '2', bestSide: 'HOME', bestEdge: 5, bestOdds: 1.95,
          isContrarian: false, resultWinner: 'HOME', motorWasRight: true }),  // non-contrarian win
];
const sCont = summarizeTennisBestBets(contLogs);
expect('Contrarian · 1 win',         1,    sCont.segments.contrarian_vs_non.contrarian.wins);
expect('Non-contrarian · 1 win',     1,    sCont.segments.contrarian_vs_non.non_contrarian.wins);
expect('Contrarian · hit=100%',      100,  sCont.segments.contrarian_vs_non.contrarian.hit_rate);

// ── 11. Side segment · HOME vs AWAY ─────────────────────────────────────────

expect('Side HOME total',  1, sCont.segments.by_side.HOME.total);
expect('Side AWAY total',  1, sCont.segments.by_side.AWAY.total);

// ── 12. Logs vides · safe ──────────────────────────────────────────────────

const sEmpty = summarizeTennisBestBets([]);
expect('Empty · total_logs=0',          0, sEmpty.volume.total_logs);
expect('Empty · hit_rate null',         null, sEmpty.performance_best_bets.hit_rate);
expect('Empty · decision INSUFFICIENT', 'INSUFFICIENT_SAMPLE', sEmpty.decision.status);

// ── REPORT ─────────────────────────────────────────────────────────────────

console.log('Tennis best bets summary · tests');
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
  }
}
console.log('');
console.log(`Résumé · ${results.length - fails}/${results.length} pass · ${fails} fail`);
process.exit(fails > 0 ? 1 : 0);
