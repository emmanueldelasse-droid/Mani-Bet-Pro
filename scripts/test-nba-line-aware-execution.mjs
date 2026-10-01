#!/usr/bin/env node
/**
 * NBA spread/total same-line execution pricing.
 *
 * Scope:
 * - reference market/gate remains historical priority-first;
 * - execution price may improve only among books quoting the exact same line;
 * - a better price on a different spread/total line must never be compared;
 * - backend O/U uses the same rule without changing the reference edge gate.
 */

import './lib/dom-stub.mjs';
import { backend } from './lib/backend-engine.mjs';
import {
  getBestBookOdds,
  computeBettingRecommendations,
} from '../src/engine/engine.nba.betting.js';

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

const market = {
  bookmakers: [
    {
      key: 'pinnacle', title: 'Pinnacle',
      home_spread: 1.80, away_spread: 2.00, spread_line: -5.5,
      over_total: 1.80, under_total: 2.00, total_line: 220,
    },
    {
      key: 'winamax', title: 'Winamax',
      home_spread: 2.05, away_spread: 1.95, spread_line: -5.5,
      over_total: 2.05, under_total: 1.95, total_line: 220,
    },
    {
      key: 'other_book', title: 'Other Book',
      home_spread: 2.50, away_spread: 2.50, spread_line: -4.5,
      over_total: 2.50, under_total: 2.50, total_line: 219.5,
    },
  ],
};

// ── Pure frontend selector ────────────────────────────────────────────────
eq(
  getBestBookOdds(market, 'HOME', 'spreads').bookmaker,
  'Pinnacle',
  'spread reference market remains priority-first without target line'
);
eq(
  getBestBookOdds(market, 'OVER', 'totals').bookmaker,
  'Pinnacle',
  'total reference market remains priority-first without target line'
);

const spreadHome = getBestBookOdds(market, 'HOME', 'spreads', -5.5);
eq(spreadHome.bookmaker, 'Winamax',
  'HOME spread execution selects best price on exact -5.5 line');
eq(spreadHome.decimalOdds, 2.05,
  'HOME spread execution price = 2.05');
eq(spreadHome.priceSelection, 'BEST_AVAILABLE_SAME_LINE_SPREAD',
  'spread execution semantics explicit');

const spreadAway = getBestBookOdds(market, 'AWAY', 'spreads', 5.5);
eq(spreadAway.bookmaker, 'Pinnacle',
  'AWAY +5.5 maps to stored HOME -5.5 line');
eq(spreadAway.decimalOdds, 2.00,
  'AWAY spread picks best exact opposite line price');

const totalOver = getBestBookOdds(market, 'OVER', 'totals', 220);
eq(totalOver.bookmaker, 'Winamax',
  'OVER execution selects best price on exact 220 total');
eq(totalOver.decimalOdds, 2.05,
  'OVER exact-line execution price = 2.05');
eq(totalOver.priceSelection, 'BEST_AVAILABLE_SAME_LINE_TOTAL',
  'total execution semantics explicit');

eq(
  getBestBookOdds(market, 'OVER', 'totals', 221),
  null,
  'no exact target line fails closed rather than using another line'
);

// ── Different-line huge price must never win ─────────────────────────────
assert(spreadHome.decimalOdds < 2.50,
  'different spread line with 2.50 is ignored');
assert(totalOver.decimalOdds < 2.50,
  'different total line with 2.50 is ignored');

// ── Frontend spread gate remains reference-book based ─────────────────────
const strongHomeSignals = [
  { variable: 'net_rating_diff', normalized: 1 },
  { variable: 'efg_diff', normalized: 1 },
  { variable: 'recent_form_ema', normalized: 1 },
  { variable: 'absences_impact', normalized: 1 },
];

const spreadFull = computeBettingRecommendations(
  0.50,
  { home_ml: null, away_ml: null, spread: -5.5, over_under: null },
  { market_odds: market },
  {},
  strongHomeSignals,
  null,
);
const spreadRec = spreadFull.recommendations.find(r => r.type === 'SPREAD' && r.side === 'HOME');
assert(Boolean(spreadRec), 'frontend produces HOME spread recommendation');
eq(spreadRec.odds_decimal, 2.05,
  'frontend spread recommendation displays exact-line best execution price');
eq(spreadRec.odds_source, 'Winamax',
  'frontend spread recommendation displays execution bookmaker');
eq(spreadRec.execution_price_selection, 'BEST_AVAILABLE_SAME_LINE_SPREAD',
  'frontend spread marks line-aware execution');
eq(spreadRec.reference_book, 'Pinnacle',
  'frontend spread retains legacy reference book');
eq(spreadRec.reference_market_line, -5.5,
  'frontend spread records reference line');
eq(spreadRec.reference_line_matches_target, true,
  'frontend spread observes reference-line parity');
eq(spreadRec.implied_prob, 56,
  'frontend spread gate implied probability remains Pinnacle 1.80');
eq(spreadRec.execution_implied_prob, 49,
  'frontend spread separately exposes execution implied probability');

// Compare against reference-only market: gate edge/has_value must be identical.
const referenceOnly = { bookmakers: [market.bookmakers[0]] };
const spreadBaseline = computeBettingRecommendations(
  0.50,
  { home_ml: null, away_ml: null, spread: -5.5, over_under: null },
  { market_odds: referenceOnly },
  {},
  strongHomeSignals,
  null,
);
const spreadBaselineRec = spreadBaseline.recommendations.find(r => r.type === 'SPREAD' && r.side === 'HOME');
eq(spreadRec.edge, spreadBaselineRec.edge,
  'better same-line execution price does not alter spread edge gate');
eq(spreadRec.has_value, spreadBaselineRec.has_value,
  'better same-line execution price does not alter spread has_value');

// ── Frontend total gate remains reference-book based ──────────────────────
const totalFull = computeBettingRecommendations(
  0.50,
  { home_ml: null, away_ml: null, spread: null, over_under: 220 },
  {
    market_odds: market,
    home_season_stats: { avg_pts: 120 },
    away_season_stats: { avg_pts: 120 },
    home_last5_avg_pts: null,
    away_last5_avg_pts: null,
  },
  { absences_impact: { value: 0 }, pace_diff: { value: null } },
  [],
  null,
);
const totalRec = totalFull.recommendations.find(r => r.type === 'OVER_UNDER' && r.side === 'OVER');
assert(Boolean(totalRec), 'frontend produces OVER recommendation');
eq(totalRec.odds_decimal, 2.05,
  'frontend total displays exact-line best execution price');
eq(totalRec.odds_source, 'Winamax',
  'frontend total displays execution bookmaker');
eq(totalRec.execution_price_selection, 'BEST_AVAILABLE_SAME_LINE_TOTAL',
  'frontend total marks line-aware execution');
eq(totalRec.reference_book, 'Pinnacle',
  'frontend total retains legacy reference book');
eq(totalRec.reference_market_line, 220,
  'frontend total records reference line');
eq(totalRec.reference_line_matches_target, true,
  'frontend total observes reference-line parity');

const totalBaseline = computeBettingRecommendations(
  0.50,
  { home_ml: null, away_ml: null, spread: null, over_under: 220 },
  {
    market_odds: referenceOnly,
    home_season_stats: { avg_pts: 120 },
    away_season_stats: { avg_pts: 120 },
    home_last5_avg_pts: null,
    away_last5_avg_pts: null,
  },
  { absences_impact: { value: 0 }, pace_diff: { value: null } },
  [],
  null,
);
const totalBaselineRec = totalBaseline.recommendations.find(r => r.type === 'OVER_UNDER' && r.side === 'OVER');
eq(totalRec.edge, totalBaselineRec.edge,
  'better same-line total execution price does not alter edge gate');
eq(totalRec.has_value, totalBaselineRec.has_value,
  'better same-line total execution price does not alter has_value');

// ── Backend selector parity / O-U integration ─────────────────────────────
const backendOver = backend._botSelectBestSameLineExecutionBook(market, 'totals', 'OVER', 220);
eq(backendOver.decimalOdds, 2.05,
  'backend total selector picks exact-line best price');
eq(backendOver.bookmaker, 'Winamax',
  'backend total selector picks correct bookmaker');

const backendSpreadAway = backend._botSelectBestSameLineExecutionBook(market, 'spreads', 'AWAY', 5.5);
eq(backendSpreadAway.decimalOdds, 2.00,
  'backend AWAY spread selector maps +5.5 to stored HOME -5.5');

eq(
  backend._botSelectBestSameLineExecutionBook(market, 'totals', 'OVER', 221),
  null,
  'backend fails closed when target total line absent'
);

const backendMatch = {
  event_type: 'REGULAR',
  season_type: 2,
  game_datetime: '2026-10-20T23:30:00Z',
  home_season_stats: { ppg: 120, oppg: 110, pace: null, defensive_rating: null },
  away_season_stats: { ppg: 115, oppg: 112, pace: null, defensive_rating: null },
  home_recent: null,
  away_recent: null,
  home_injuries: [],
  away_injuries: [],
  home_rest_days: 2,
  away_rest_days: 2,
  market_odds: market,
};

const backendTotal = backend._botPredictNBATotal(backendMatch);
assert(Boolean(backendTotal.recommendation), 'backend produces O/U recommendation');
eq(backendTotal.recommendation.side, 'OVER',
  'backend reference logic chooses OVER');
eq(backendTotal.recommendation.odds_decimal, 2.05,
  'backend O/U carries best exact-line execution price');
eq(backendTotal.recommendation.odds_source, 'Winamax',
  'backend O/U carries execution bookmaker');
eq(backendTotal.recommendation.execution_price_selection, 'BEST_AVAILABLE_SAME_LINE_TOTAL',
  'backend O/U execution semantics explicit');
eq(backendTotal.recommendation.reference_book, 'Pinnacle',
  'backend O/U retains reference book');

const backendBaseline = backend._botPredictNBATotal({
  ...backendMatch,
  market_odds: referenceOnly,
});
eq(backendTotal.recommendation.edge, backendBaseline.recommendation.edge,
  'backend best execution does not alter reference edge gate');
eq(backendTotal.recommendation.has_value, backendBaseline.recommendation.has_value,
  'backend best execution does not alter has_value');
assert(
  backendTotal.recommendation.expected_value > backendBaseline.recommendation.expected_value,
  'better execution price improves EV only'
);

console.log('\nNBA line-aware execution price');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ best same-line price used without changing reference gates\n');
