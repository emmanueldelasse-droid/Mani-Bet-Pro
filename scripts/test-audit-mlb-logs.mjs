#!/usr/bin/env node
/**
 * Tests · MBP-AUDIT-MLB · script audit MLB
 *
 * Vérifie ·
 *  - wilsonCI · IC binomial Wilson correct
 *  - americanToDecimal / americanToImplied conversions
 *  - filterEligible exclut 5 statuts
 *  - status_breakdown · compteurs corrects
 *  - hit_rate global respecte exclusions
 *  - rolling window · ordre settled_at DESC
 *  - edge_buckets · sampling correct
 *  - motor_prob_buckets + Brier per bucket
 *  - favorite/underdog · classification ok
 *  - home/away · ok
 *  - data_quality · 3 labels MLB
 *  - ROI flat-stake · formule (odds-1 si win sinon -1)
 *  - drawdown · max DD + streaks
 *  - variables_presence · counts
 *  - pitcher_data_source · available=false si pas dans logs
 *  - generateConclusion · 5 verdicts possibles selon contexte
 *
 * Run · `node scripts/test-audit-mlb-logs.mjs`
 */

import {
  wilsonCI,
  americanToDecimal,
  americanToImplied,
  logStatus,
  isStatsExcluded,
  isSettled,
  filterEligible,
  filterSettled,
  computeStatusBreakdown,
  computeHitRate,
  computeRollingWindow,
  computeEdgeBuckets,
  computeMotorProbBuckets,
  computeFavoriteUnderdog,
  computeHomeAway,
  computeDataQualityBuckets,
  computeROI,
  computeBrier,
  computeDrawdown,
  computeVariablesPresence,
  computePitcherDataSource,
  generateConclusion,
  auditMlbLogs,
  STATS_EXCLUDED_STATUSES,
  JUICE_BREAKEVEN_5PCT,
  SAMPLE_INSUFFICIENT,
} from './lib/audit-mlb-summary.mjs';

let assertCount = 0;
let failCount = 0;
const fails = [];

function assert(cond, msg) {
  assertCount++;
  if (!cond) { failCount++; fails.push(msg); console.error('  ✗', msg); }
}
function eq(actual, expected, msg) {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}
function approx(actual, expected, eps, msg) {
  assert(Math.abs(actual - expected) <= eps,
    `${msg} · expected≈${expected} actual=${actual} eps=${eps}`);
}

// ── 1. wilsonCI ──────────────────────────────────────────────────────────────
console.log('1. wilsonCI · IC binomial Wilson');
{
  const ci0 = wilsonCI(0, 0);
  eq(ci0.center_pct, null, 'n=0 · center_pct null');
  eq(ci0.low_pct, null,    'n=0 · low_pct null');

  const ci1 = wilsonCI(50, 100);
  approx(ci1.center_pct, 50,    1,   'n=100 k=50 · center ≈ 50%');
  assert(ci1.low_pct < 50,  'borne basse < 50 quand p=50%');
  assert(ci1.high_pct > 50, 'borne haute > 50 quand p=50%');

  // 49.8% sur 315 → IC ≈ [44.2%, 55.3%] (chiffres v6.94 worker.js)
  const ci2 = wilsonCI(157, 315);
  approx(ci2.center_pct, 49.8, 0.2, '315 logs 49.8% · center');
  approx(ci2.low_pct,    44.4, 0.5, '315 logs · borne basse ~44%');
  approx(ci2.high_pct,   55.2, 0.5, '315 logs · borne haute ~55%');

  // 54.7% sur 64 → IC ≈ [42.6%, 66.3%]
  const ci3 = wilsonCI(35, 64);
  approx(ci3.center_pct, 54.7, 0.5, '64 logs 54.7% · center');
  approx(ci3.low_pct,    42.6, 1.0, '64 logs · borne basse ~42.6%');
  approx(ci3.high_pct,   66.3, 1.0, '64 logs · borne haute ~66.3%');
}

// ── 2. conversions American odds ─────────────────────────────────────────────
console.log('2. americanToDecimal / americanToImplied');
{
  approx(americanToDecimal(-150), 1.6667, 0.001, '-150 → 1.667');
  approx(americanToDecimal(+200), 3.0,    0.001, '+200 → 3.0');
  approx(americanToDecimal(-110), 1.909,  0.001, '-110 → 1.909');
  eq(americanToDecimal(null),   null,  'null → null');
  approx(americanToImplied(-150), 0.6,    0.001, '-150 → 60% implied');
  approx(americanToImplied(+150), 0.4,    0.001, '+150 → 40% implied');
}

// ── 3. logStatus back-compat ─────────────────────────────────────────────────
console.log('3. logStatus back-compat');
{
  eq(logStatus({ status: 'settled' }),         'settled', 'status explicite');
  eq(logStatus({ status: 'missed_by_cron' }),  'missed_by_cron');
  eq(logStatus({ motor_was_right: null }),     'pending', 'derive null → pending');
  eq(logStatus({ motor_was_right: true }),     'settled', 'derive true → settled');
  eq(logStatus({ motor_was_right: false }),    'settled', 'derive false → settled');
  eq(logStatus({}),                            'pending', 'log vide → pending');
}

// ── 4. STATS_EXCLUDED_STATUSES ───────────────────────────────────────────────
console.log('4. STATS_EXCLUDED_STATUSES alignement (5 statuts)');
{
  assert(STATS_EXCLUDED_STATUSES.has('missed_by_cron'),        'inclut missed_by_cron');
  assert(STATS_EXCLUDED_STATUSES.has('recovery_failed'),       'inclut recovery_failed');
  assert(STATS_EXCLUDED_STATUSES.has('postponed'),             'inclut postponed');
  assert(STATS_EXCLUDED_STATUSES.has('cancelled'),             'inclut cancelled');
  assert(STATS_EXCLUDED_STATUSES.has('invalid_match_mapping'), 'inclut invalid_match_mapping');
  assert(!STATS_EXCLUDED_STATUSES.has('settled'),              'EXCLUT settled');
  assert(!STATS_EXCLUDED_STATUSES.has('pending'),              'EXCLUT pending');
  eq(STATS_EXCLUDED_STATUSES.size, 5,                          'taille = 5');
  assert(isStatsExcluded({ status: 'missed_by_cron' }), 'isStatsExcluded missed_by_cron');
  assert(!isStatsExcluded({ status: 'settled' }),       'isStatsExcluded NON sur settled');
}

// ── 5. Fixture base · construire dump réaliste ───────────────────────────────
console.log('5. Fixture base · dump synthétique');

function mkLog(opts) {
  // helper · log minimal MLB-like
  return {
    match_id: opts.id ?? `m${Math.random()}`,
    status: opts.status ?? 'settled',
    motor_was_right: opts.was_right ?? null,
    home_prob: opts.home_prob ?? null,
    motor_prob: opts.motor_prob ?? null,
    best_edge: opts.best_edge ?? null,
    best_side: opts.best_side ?? null,
    result_winner: opts.result_winner ?? null,
    data_quality: opts.dq ?? null,
    odds_at_analysis: opts.odds ?? null,
    settled_at: opts.settled_at ?? null,
    logged_at: opts.logged_at ?? '2026-05-18T19:00:00Z',
    variables: opts.variables ?? null,
    pitcher_data_source: opts.pitcher_data_source ?? null,
  };
}

const fixture = [
  // 10 settled · 6 wins 4 losses · HOME bias intentionnel
  mkLog({ id: 'g1',  status: 'settled', was_right: true,  home_prob: 65, best_edge: 8, best_side: 'HOME', result_winner: 'HOME', dq: 'HIGH',
          odds: { home_ml: -150, away_ml: +130 }, settled_at: '2026-05-18T22:00:00Z',
          variables: { pitcher_fip_diff: 0.5, last10_form_pct: 0.55, ops_adv_pct: 0.02 },
          pitcher_data_source: 'fip' }),
  mkLog({ id: 'g2',  status: 'settled', was_right: true,  home_prob: 62, best_edge: 7, best_side: 'HOME', result_winner: 'HOME', dq: 'HIGH',
          odds: { home_ml: -130, away_ml: +110 }, settled_at: '2026-05-17T22:00:00Z',
          variables: { pitcher_fip_diff: 0.3, last10_form_pct: 0.50, ops_adv_pct: null },
          pitcher_data_source: 'fip' }),
  mkLog({ id: 'g3',  status: 'settled', was_right: false, home_prob: 58, best_edge: 6, best_side: 'HOME', result_winner: 'AWAY', dq: 'MEDIUM',
          odds: { home_ml: -110, away_ml: -110 }, settled_at: '2026-05-16T22:00:00Z',
          variables: { pitcher_fip_diff: 0.1, last10_form_pct: 0.45, ops_adv_pct: 0.01 },
          pitcher_data_source: 'era' }),
  mkLog({ id: 'g4',  status: 'settled', was_right: true,  home_prob: 70, best_edge: 12, best_side: 'HOME', result_winner: 'HOME', dq: 'HIGH',
          odds: { home_ml: -200, away_ml: +170 }, settled_at: '2026-05-15T22:00:00Z',
          variables: { pitcher_fip_diff: 0.8 } }),
  mkLog({ id: 'g5',  status: 'settled', was_right: false, home_prob: 55, best_edge: 5, best_side: 'HOME', result_winner: 'AWAY', dq: 'MEDIUM',
          odds: { home_ml: -120, away_ml: +100 }, settled_at: '2026-05-14T22:00:00Z',
          variables: { pitcher_fip_diff: 0.2 } }),
  mkLog({ id: 'g6',  status: 'settled', was_right: true,  home_prob: 60, best_edge: 9, best_side: 'AWAY', result_winner: 'AWAY', dq: 'HIGH',
          odds: { home_ml: -140, away_ml: +120 }, settled_at: '2026-05-13T22:00:00Z',
          variables: { pitcher_fip_diff: -0.3 } }),
  mkLog({ id: 'g7',  status: 'settled', was_right: true,  home_prob: 63, best_edge: 8, best_side: 'HOME', result_winner: 'HOME', dq: 'HIGH',
          odds: { home_ml: -135, away_ml: +115 }, settled_at: '2026-05-12T22:00:00Z',
          variables: { pitcher_fip_diff: 0.4 } }),
  mkLog({ id: 'g8',  status: 'settled', was_right: false, home_prob: 67, best_edge: 11, best_side: 'HOME', result_winner: 'AWAY', dq: 'HIGH',
          odds: { home_ml: -180, away_ml: +150 }, settled_at: '2026-05-11T22:00:00Z',
          variables: {} }),
  mkLog({ id: 'g9',  status: 'settled', was_right: true,  home_prob: 56, best_edge: 5, best_side: 'AWAY', result_winner: 'AWAY', dq: 'MEDIUM',
          odds: { home_ml: -125, away_ml: +105 }, settled_at: '2026-05-10T22:00:00Z',
          variables: {} }),
  mkLog({ id: 'g10', status: 'settled', was_right: false, home_prob: 64, best_edge: 7, best_side: 'HOME', result_winner: 'AWAY', dq: 'MEDIUM',
          odds: { home_ml: -160, away_ml: +135 }, settled_at: '2026-05-09T22:00:00Z',
          variables: {} }),
  // 5 statuts exclus · jamais comptés
  mkLog({ id: 'm1', status: 'missed_by_cron' }),
  mkLog({ id: 'm2', status: 'missed_by_cron' }),
  mkLog({ id: 'r1', status: 'recovery_failed' }),
  mkLog({ id: 'p1', status: 'postponed', home_prob: 60 }),
  mkLog({ id: 'c1', status: 'cancelled', home_prob: 65 }),
  mkLog({ id: 'i1', status: 'invalid_match_mapping' }),
  // 2 pending
  mkLog({ id: 'pn1', status: 'pending', home_prob: 62 }),
  mkLog({ id: 'pn2', status: 'pending', home_prob: 58 }),
];

// ── 6. filterEligible · status_breakdown ─────────────────────────────────────
console.log('6. filterEligible + status_breakdown');
{
  const elig = filterEligible(fixture);
  eq(elig.length, 12, 'eligible · 10 settled + 2 pending');
  const sb = computeStatusBreakdown(fixture);
  eq(sb.settled, 10, 'breakdown · 10 settled');
  eq(sb.missed_by_cron, 2, 'breakdown · 2 missed');
  eq(sb.recovery_failed, 1, 'breakdown · 1 recovery_failed');
  eq(sb.postponed, 1, 'breakdown · 1 postponed');
  eq(sb.cancelled, 1, 'breakdown · 1 cancelled');
  eq(sb.invalid_match_mapping, 1, 'breakdown · 1 invalid');
  eq(sb.pending, 2, 'breakdown · 2 pending');
}

// ── 7. filterSettled ─────────────────────────────────────────────────────────
console.log('7. filterSettled · uniquement motor_was_right resolved');
{
  const sett = filterSettled(fixture);
  eq(sett.length, 10, 'settled · 10 logs');
  for (const l of sett) {
    assert(l.motor_was_right === true || l.motor_was_right === false,
           `${l.match_id} · motor_was_right boolean`);
  }
}

// ── 8. computeHitRate ────────────────────────────────────────────────────────
console.log('8. computeHitRate · 6/10 = 60% sur fixture');
{
  const sett = filterSettled(fixture);
  const hr = computeHitRate(sett);
  eq(hr.n, 10, 'n=10');
  eq(hr.k, 6,  'k=6');
  approx(hr.center_pct, 57.2, 1, 'center ~57.2% (Wilson · shift vers 0.5 sur petit n)');
  assert(hr.low_pct < 60 && hr.low_pct > 25, 'borne basse cohérente');
  assert(hr.high_pct < 90 && hr.high_pct > 60, 'borne haute cohérente');
}

// ── 9. computeRollingWindow ──────────────────────────────────────────────────
console.log('9. computeRollingWindow · tri DESC settled_at');
{
  const sett = filterSettled(fixture);
  const last5 = computeRollingWindow(sett, 5);
  eq(last5.window, 5, 'window=5');
  eq(last5.n, 5, 'n=5 (5 derniers settled)');
  // last 5 = g1-g5 (settled_at 18→14 mai · DESC). g1=W g2=W g3=L g4=W g5=L → 3W 2L
  eq(last5.k, 3, 'k=3 sur les 5 plus récents (g1W g2W g3L g4W g5L)');

  const last100 = computeRollingWindow(sett, 100);
  eq(last100.n, 10, 'window>n · retourne tous les settled');
}

// ── 10. computeEdgeBuckets ──────────────────────────────────────────────────
console.log('10. computeEdgeBuckets · 4 buckets');
{
  const sett = filterSettled(fixture);
  const buckets = computeEdgeBuckets(sett);
  eq(buckets.length, 4, '4 buckets');
  // edge=5-7 inclut g3(6),g5(5),g9(5) → 3 logs · 1W (g9)
  const b5_7 = buckets.find(b => b.bucket === 'edge_5_7');
  eq(b5_7.n, 3, 'edge_5_7 · n=3');
  eq(b5_7.k, 1, 'edge_5_7 · k=1');
  // edge=7-10 inclut g1(8),g2(7),g6(9),g7(8),g10(7) → 5 logs · 4W
  const b7_10 = buckets.find(b => b.bucket === 'edge_7_10');
  eq(b7_10.n, 5, 'edge_7_10 · n=5');
  eq(b7_10.k, 4, 'edge_7_10 · k=4');
  // edge=10+ inclut g4(12), g8(11) → 2 logs · 1W
  const b10 = buckets.find(b => b.bucket === 'edge_10_plus');
  eq(b10.n, 2, 'edge_10+ · n=2');
}

// ── 11. computeMotorProbBuckets + Brier ──────────────────────────────────────
console.log('11. computeMotorProbBuckets + Brier per bucket');
{
  const sett = filterSettled(fixture);
  const buckets = computeMotorProbBuckets(sett);
  eq(buckets.length, 5, '5 buckets motor_prob');
  // bucket 55_60 · g3(58),g5(55),g9(56) → n=3
  const b55 = buckets.find(b => b.bucket === '55_60');
  eq(b55.n, 3, '55_60 · n=3');
  assert(b55.brier_score != null, 'Brier calculable bucket 55_60');
  // bucket 70_80 · g4(70) → n=1
  const b70 = buckets.find(b => b.bucket === '70_80');
  eq(b70.n, 1, '70_80 · n=1');
}

// ── 12. computeFavoriteUnderdog ──────────────────────────────────────────────
console.log('12. computeFavoriteUnderdog');
{
  const sett = filterSettled(fixture);
  const fu = computeFavoriteUnderdog(sett);
  // Tous logs ont odds · best_side HOME ou AWAY · home_ml négatif partout → HOME=favori
  // best_side=HOME (8 logs) + HOME favori → best_was_favorite · 5W (g1 g2 g4 g7) attendu calcul
  // best_side=AWAY (2 logs · g6 g9) + AWAY = outsider → best_was_underdog · 2W
  assert(fu.best_was_favorite.wins + fu.best_was_favorite.losses === 8, 'favorite · 8 paris (HOME side)');
  assert(fu.best_was_underdog.wins + fu.best_was_underdog.losses === 2, 'underdog · 2 paris (AWAY side)');
  eq(fu.best_was_underdog.wins, 2, 'underdog · 2W (g6, g9)');
  eq(fu.no_odds_available, 0,    'aucun skip · toutes odds OK');
}

// ── 13. computeHomeAway ──────────────────────────────────────────────────────
console.log('13. computeHomeAway');
{
  const sett = filterSettled(fixture);
  const ha = computeHomeAway(sett);
  eq(ha.best_side_home.n, 8, 'best_side=HOME · 8 logs');
  eq(ha.best_side_away.n, 2, 'best_side=AWAY · 2 logs');
  eq(ha.no_best_side, 0, 'no_best_side · 0');
}

// ── 14. computeDataQualityBuckets ────────────────────────────────────────────
console.log('14. computeDataQualityBuckets');
{
  const sett = filterSettled(fixture);
  const dq = computeDataQualityBuckets(sett);
  eq(dq.HIGH.n, 6, 'HIGH · 6 logs');   // g1 g2 g4 g6 g7 g8
  eq(dq.MEDIUM.n, 4, 'MEDIUM · 4 logs'); // g3 g5 g9 g10
  eq(dq.LOW.n, 0, 'LOW · 0 logs');
}

// ── 15. computeROI ───────────────────────────────────────────────────────────
console.log('15. computeROI flat-stake');
{
  const sett = filterSettled(fixture);
  const roi = computeROI(sett);
  assert(roi.calculable, 'ROI calculable');
  eq(roi.n, 10, 'ROI · 10 logs');
  eq(roi.wins, 6, 'ROI · 6 wins');
  eq(roi.losses, 4, 'ROI · 4 losses');
  // Vérification calcul (rough) · 6 wins à odds variées · 4 losses -1u chacun
  assert(typeof roi.roi_pct === 'number', 'ROI pct numérique');
  assert(roi.avg_decimal_odds > 1 && roi.avg_decimal_odds < 3, 'avg odds cohérent');

  // Cas no odds
  const noOdds = sett.map(l => ({ ...l, odds_at_analysis: null }));
  const roi2 = computeROI(noOdds);
  eq(roi2.calculable, false, 'ROI · non calculable sans odds');
  eq(roi2.reason, 'no_odds_in_logs', 'raison · no_odds_in_logs');
}

// ── 16. computeBrier ─────────────────────────────────────────────────────────
console.log('16. computeBrier global');
{
  const sett = filterSettled(fixture);
  const br = computeBrier(sett);
  assert(br.calculable, 'Brier calculable');
  eq(br.n, 10, 'Brier · 10 logs');
  assert(br.value >= 0 && br.value <= 1, 'Brier ∈ [0,1]');
}

// ── 17. computeDrawdown ──────────────────────────────────────────────────────
console.log('17. computeDrawdown + streaks');
{
  const sett = filterSettled(fixture);
  const dd = computeDrawdown(sett);
  assert(dd.calculable, 'drawdown calculable');
  eq(dd.n, 10, 'drawdown · 10 paris');
  assert(typeof dd.final_equity_units === 'number', 'final_equity numérique');
  assert(dd.max_losing_streak >= 1, 'max_losing_streak >= 1');
  assert(dd.max_winning_streak >= 1, 'max_winning_streak >= 1');
  assert(dd.max_drawdown_units >= 0, 'max_drawdown >= 0');
}

// ── 18. computeVariablesPresence ─────────────────────────────────────────────
console.log('18. computeVariablesPresence');
{
  const elig = filterEligible(fixture);
  const vp = computeVariablesPresence(elig);
  // pitcher_fip_diff présent dans g1-g7 (g8 vide, g9-g10 vide aussi · pending pas de vars)
  assert(vp.pitcher_fip_diff != null, 'pitcher_fip_diff détecté');
  assert(vp.pitcher_fip_diff.present >= 5, 'pitcher_fip_diff présent >= 5 logs');
  // last10_form_pct présent uniquement g1-g3
  assert(vp.last10_form_pct != null, 'last10_form_pct détecté');
  assert(vp.last10_form_pct.present === 3, 'last10_form_pct présent 3 logs');
  // ops_adv_pct · g1 valeur ok · g2 null · g3 ok · n=3 mais 1 missing
  assert(vp.ops_adv_pct != null, 'ops_adv_pct détecté');
}

// ── 19. computePitcherDataSource ─────────────────────────────────────────────
console.log('19. computePitcherDataSource');
{
  const elig = filterEligible(fixture);
  const pds = computePitcherDataSource(elig);
  assert(pds.available, 'pds dispo dans fixture (3 logs g1 g2 g3)');
  eq(pds.logs_with_field, 3, 'pds · 3 logs avec champ');
  eq(pds.breakdown.fip, 2, 'pds · 2 fip');
  eq(pds.breakdown.era, 1, 'pds · 1 era');
  eq(pds.breakdown['fallback_4.20'], 0, 'pds · 0 fallback');

  // Cas sans champ · tous logs sans pitcher_data_source
  const noPds = elig.map(l => ({ ...l, pitcher_data_source: null }));
  const pds2 = computePitcherDataSource(noPds);
  eq(pds2.available, false, 'pds · non disponible si aucun log');
}

// ── 20. generateConclusion · 5 verdicts ──────────────────────────────────────
console.log('20. generateConclusion · 5 verdicts possibles');
{
  // SAMPLE_INSUFFISANT · n < 100
  const c1 = generateConclusion({
    settled_eligible: 50,
    hit_rate_global: wilsonCI(30, 50),
    roi: { calculable: false },
  });
  eq(c1.verdict, 'SAMPLE_INSUFFISANT', 'verdict SAMPLE_INSUFFISANT si n<100');

  // EDGE_DEMONTRE · borne basse > 52.4%
  const c2 = generateConclusion({
    settled_eligible: 500,
    hit_rate_global: wilsonCI(310, 500), // ~62% · borne basse ~58%
    roi: { calculable: true, roi_pct: 8.5 },
  });
  eq(c2.verdict, 'EDGE_DEMONTRE', 'verdict EDGE_DEMONTRE si borne basse > 52.4%');

  // DESACTIVATION · borne haute < 50%
  const c3 = generateConclusion({
    settled_eligible: 500,
    hit_rate_global: wilsonCI(220, 500), // ~44% · borne haute ~48%
    roi: { calculable: true, roi_pct: -10 },
  });
  eq(c3.verdict, 'DESACTIVATION_RECOMMANDEE', 'verdict DESACTIVATION si borne haute < 50%');

  // DESACTIVATION via ROI < -5%
  const c4 = generateConclusion({
    settled_eligible: 200,
    hit_rate_global: wilsonCI(102, 200), // ~51%
    roi: { calculable: true, roi_pct: -7, n: 200 },
  });
  eq(c4.verdict, 'DESACTIVATION_RECOMMANDEE', 'verdict DESACTIVATION si ROI<-5% sur n>=100');

  // MONITORING via ROI marginal
  const c5 = generateConclusion({
    settled_eligible: 200,
    hit_rate_global: wilsonCI(105, 200), // ~52.5%
    roi: { calculable: true, roi_pct: -2, n: 200 },
  });
  eq(c5.verdict, 'MONITORING_RECOMMANDE', 'verdict MONITORING si ROI -2% sur n>=100');

  // EDGE_NON_DEMONTRE · indistinguable
  const c6 = generateConclusion({
    settled_eligible: 200,
    hit_rate_global: wilsonCI(104, 200), // ~52% · borne basse ~45%
    roi: { calculable: false },
  });
  eq(c6.verdict, 'EDGE_NON_DEMONTRE', 'verdict EDGE_NON_DEMONTRE si IC ambigu');
}

// ── 21. auditMlbLogs orchestrateur ───────────────────────────────────────────
console.log('21. auditMlbLogs · orchestrateur complet');
{
  const audit = auditMlbLogs(fixture);
  eq(audit.total_logs_kv, 18, 'total_logs_kv · 18');
  eq(audit.total_eligible, 12, 'total_eligible · 12 (18 - 6 exclus)');
  eq(audit.settled_eligible, 10, 'settled_eligible · 10');
  eq(audit.pending, 2, 'pending · 2');
  eq(audit.excluded_count, 6, 'excluded · 6 (2 missed + 1 recovery + 1 postponed + 1 cancelled + 1 invalid)');
  assert(audit.conclusion.verdict === 'SAMPLE_INSUFFISANT',
         'conclusion · SAMPLE_INSUFFISANT (n=10 < 100)');

  // Accepte aussi wrapper { logs: [...] }
  const audit2 = auditMlbLogs({ logs: fixture, available: true });
  eq(audit2.total_logs_kv, 18, 'wrapper accepté · 18 logs');

  // Accepte aussi réponse /mlb/bot/logs { available, logs, stats }
  const audit3 = auditMlbLogs({ available: true, logs: fixture, stats: {} });
  eq(audit3.total_logs_kv, 18, 'wrapper /mlb/bot/logs accepté');
}

// ── 22. Bandeau "DECISION REQUIRES CREATOR APPROVAL" ────────────────────────
console.log('22. Bandeau approval · uniquement si DESACTIVATION_RECOMMANDEE');
{
  const { formatReport } = await import('./lib/audit-mlb-summary.mjs');
  const BANNER = 'DECISION REQUIRES CREATOR APPROVAL · ChatGPT review obligatoire';

  // Construire un summary minimal par verdict pour tester formatReport
  function buildSummary(verdict, reasons = []) {
    return {
      total_logs_kv: 200, total_eligible: 200, settled_eligible: 200, pending: 0,
      excluded_count: 0, status_breakdown: { settled: 200 },
      hit_rate_global: { n: 200, k: 100, center_pct: 50, low_pct: 43, high_pct: 57 },
      rolling: {
        last_25:  { window: 25,  available: 25,  n: 25,  k: 12, center_pct: 48, low_pct: 30, high_pct: 67 },
        last_50:  { window: 50,  available: 50,  n: 50,  k: 25, center_pct: 50, low_pct: 36, high_pct: 64 },
        last_100: { window: 100, available: 100, n: 100, k: 50, center_pct: 50, low_pct: 40, high_pct: 60 },
      },
      trend_quartiles: { available: false, reason: 'sample_too_small_for_quartiles' },
      edge_buckets: [], motor_prob_buckets: [],
      favorite_underdog: {
        no_odds_available: 0,
        best_was_favorite: { wins: 0, losses: 0 },
        best_was_underdog: { wins: 0, losses: 0 },
        favorite_ci: { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
        underdog_ci: { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
      },
      home_away: {
        best_side_home: { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
        best_side_away: { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
        no_best_side: 0,
      },
      data_quality: {
        HIGH:   { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
        MEDIUM: { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
        LOW:    { n: 0, k: 0, center_pct: null, low_pct: null, high_pct: null },
        missing_data_quality: 0,
      },
      roi: { calculable: false, reason: 'no_odds_in_logs', n: 0, skipped_no_odds: 0, skipped_no_side: 0 },
      brier: { calculable: false, n: 0, value: null },
      drawdown: { calculable: false, reason: 'no_odds_in_logs' },
      variables_presence: {},
      pitcher_data_source: { available: false, reason: 'not_logged', logs_inspected: 0 },
      conclusion: { verdict, reasons, action: 'test' },
    };
  }

  // DESACTIVATION_RECOMMANDEE → bandeau PRÉSENT
  const repDes = formatReport(buildSummary('DESACTIVATION_RECOMMANDEE', ['IC borne haute < 50%']));
  assert(repDes.includes(BANNER), 'bandeau approval PRÉSENT pour DESACTIVATION_RECOMMANDEE');
  assert(repDes.includes('1. Partager ces résultats avec ChatGPT'), 'bandeau · étape 1 ChatGPT');
  assert(repDes.includes('3. Validation créateur EXPLICITE'),       'bandeau · étape 3 créateur explicite');
  assert(repDes.includes('AIDE À LA DÉCISION'),                     'bandeau · clarification aide décision');

  // 4 autres verdicts → bandeau ABSENT
  for (const v of ['EDGE_DEMONTRE', 'EDGE_NON_DEMONTRE', 'MONITORING_RECOMMANDE', 'SAMPLE_INSUFFISANT']) {
    const rep = formatReport(buildSummary(v));
    assert(!rep.includes(BANNER), `bandeau approval ABSENT pour ${v}`);
  }
}

// ── Résumé ────────────────────────────────────────────────────────────────────
console.log('');
console.log(`Total · ${assertCount} assertions · ${failCount} fail`);
if (failCount > 0) {
  console.error('FAIL');
  for (const f of fails) console.error('  -', f);
  process.exit(1);
}
console.log('PASS');
