#!/usr/bin/env node
/**
 * NBA backend spread shadow parity.
 *
 * Goal:
 * - compute the same spread projection as the frontend;
 * - persist it for observation/backtest;
 * - never inject it into betting_recommendations or "best".
 */

import './lib/dom-stub.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';
import { computeBettingRecommendations } from '../src/engine/engine.nba.betting.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');

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
      home_ml: 1.85, away_ml: 2.00,
    },
    {
      key: 'winamax', title: 'Winamax',
      home_spread: 2.05, away_spread: 1.95, spread_line: -5.5,
      home_ml: 1.90, away_ml: 1.95,
    },
    {
      key: 'other_book', title: 'Other Book',
      home_spread: 2.50, away_spread: 2.50, spread_line: -4.5,
      home_ml: 2.10, away_ml: 1.80,
    },
  ],
};

const signals = [
  { variable: 'net_rating_diff', normalized: 1 },
  { variable: 'efg_diff', normalized: 1 },
  { variable: 'recent_form_ema', normalized: 1 },
  { variable: 'absences_impact', normalized: 1 },
];

const matchData = {
  odds: { spread: -5.5, home_ml: null, away_ml: null },
  market_odds: market,
};

const shadow = backend._botPredictNBASpreadShadow(matchData, signals);
eq(shadow.available, true, 'spread shadow available');
eq(shadow.research_only, true, 'spread shadow is research-only');
eq(shadow.drives_recommendation, false, 'spread shadow cannot drive recommendation');
eq(shadow.method, 'FRONTEND_SPREAD_PARITY_SHADOW_V1', 'shadow method versioned');
eq(shadow.reference_spread_line, -5.5, 'shadow uses reference spread line');
eq(shadow.signal_adjustment, 8, 'frontend-equivalent adjustment capped at +8');
eq(shadow.home.line, -5.5, 'HOME line retained');
eq(shadow.away.line, 5.5, 'AWAY line mirrored');
eq(shadow.home.reference_book, 'Pinnacle', 'legacy reference book retained');
eq(shadow.home.reference_market_line, -5.5, 'reference market line exposed');
eq(shadow.home.reference_line_matches_target, true, 'reference line parity observable');
eq(shadow.home.execution_book, 'Winamax', 'same-line best execution book observed');
eq(shadow.home.execution_odds_decimal, 2.05, 'same-line best execution price observed');
eq(shadow.home.execution_price_selection, 'BEST_AVAILABLE_SAME_LINE_SPREAD',
  'shadow execution semantics explicit');
assert(shadow.home.would_have_value_at_legacy_5pct_gate,
  'shadow records whether legacy frontend gate would pass');

// Frontend parity on motor probability / edge.
const front = computeBettingRecommendations(
  0.50,
  { home_ml: null, away_ml: null, spread: -5.5, over_under: null },
  { market_odds: market },
  {},
  signals,
  null,
);
const frontHome = front.recommendations.find(r => r.type === 'SPREAD' && r.side === 'HOME');
assert(Boolean(frontHome), 'frontend produces comparable HOME spread rec');
eq(Math.round(shadow.home.motor_prob * 100), frontHome.motor_prob,
  'backend shadow HOME motor probability matches frontend');
eq(Math.round(shadow.home.edge), frontHome.edge,
  'backend shadow HOME edge matches frontend');
eq(shadow.home.execution_odds_decimal, frontHome.odds_decimal,
  'backend shadow execution price matches frontend');
eq(shadow.home.execution_book, frontHome.odds_source,
  'backend shadow execution bookmaker matches frontend');

// Neutral signals => 50/50, still observation only.
const neutral = backend._botPredictNBASpreadShadow(matchData, []);
eq(neutral.home.motor_prob, 0.5, 'neutral signals => HOME 50%');
eq(neutral.away.motor_prob, 0.5, 'neutral signals => AWAY 50%');
eq(neutral.drives_recommendation, false, 'neutral shadow still non-decision');

// Missing line fails closed.
eq(
  backend._botPredictNBASpreadShadow({ odds: {}, market_odds: { bookmakers: [] } }, signals),
  {
    available: false,
    reason: 'NO_REFERENCE_SPREAD_LINE',
    research_only: true,
    drives_recommendation: false,
  },
  'missing spread line fails closed'
);

// Observability of a legacy line mismatch.
const mismatch = backend._botPredictNBASpreadShadow({
  odds: { spread: -5.5 },
  market_odds: {
    bookmakers: [
      {
        key: 'pinnacle', title: 'Pinnacle',
        home_spread: 1.90, away_spread: 1.90, spread_line: -4.5,
      },
      {
        key: 'winamax', title: 'Winamax',
        home_spread: 2.00, away_spread: 1.85, spread_line: -5.5,
      },
    ],
  },
}, signals);
eq(mismatch.home.reference_line_matches_target, false,
  'shadow detects legacy reference-book line mismatch');
eq(mismatch.home.execution_book, 'Winamax',
  'same-line execution remains correctly identified despite reference mismatch');

// Static safety: shadow is attached after engine compute and stored separately.
assert(
  worker.includes('analysis.spread_prediction_shadow = _botPredictNBASpreadShadow('),
  'analyze path computes spread shadow'
);
assert(
  worker.includes('spread_prediction_shadow: analysis.spread_prediction_shadow ?? null'),
  'spread shadow persisted in log'
);
assert(
  worker.includes('drives_recommendation: false'),
  'source explicitly marks shadow non-decision'
);

// Backend canonical rec builder still has no SPREAD recommendation constructor.
const recStart = worker.indexOf('function _botComputeBettingRecs');
const totalStart = worker.indexOf('function _botSelectBestSameLineExecutionBook', recStart);
const recBlock = worker.slice(recStart, totalStart);
assert(!recBlock.includes("type: 'SPREAD'"),
  'canonical backend betting rec builder still does not emit SPREAD');

// Shadow is not merged into recommendations.
const analyzeStart = worker.indexOf('async function _botAnalyzeMatch');
const saveStart = worker.indexOf('function _botD1Json', analyzeStart);
const analyzeBlock = worker.slice(analyzeStart, saveStart);
assert(!analyzeBlock.includes('betting_recommendations.recommendations.push(analysis.spread_prediction_shadow'),
  'shadow is never pushed into betting recommendations');

// CSV fields available for offline diagnosis.
for (const field of [
  'spread_shadow_line',
  'spread_shadow_home_prob',
  'spread_shadow_away_prob',
  'spread_shadow_best_side',
  'spread_shadow_best_edge',
]) {
  assert(worker.includes(field), `CSV exposes ${field}`);
}

console.log('\nNBA spread shadow parity');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ spread parity observable without enabling backend spread bets\n');
