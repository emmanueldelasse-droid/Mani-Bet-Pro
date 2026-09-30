#!/usr/bin/env node
/**
 * NBA Moneyline best execution price.
 *
 * Scope is intentionally narrow:
 * - H2H/Moneyline execution price = highest valid decimal quote available.
 * - reference-market edge gate remains unchanged.
 * - spread/total historical selection remains untouched because lines can differ.
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
      home_ml: 1.82, away_ml: 2.02,
      home_spread: 1.80, away_spread: 1.95,
      over_total: 1.88, under_total: 1.94,
    },
    {
      key: 'winamax', title: 'Winamax',
      home_ml: 1.95, away_ml: 1.90,
      home_spread: 2.00, away_spread: 1.82,
      over_total: 2.02, under_total: 1.80,
    },
    {
      key: 'other_book', title: 'Other Book',
      home_ml: 2.05, away_ml: 2.12,
      home_spread: 2.10, away_spread: 1.75,
      over_total: 2.10, under_total: 1.76,
    },
  ],
};

// ── Backend pure selector ─────────────────────────────────────────────────
const homeBack = backend._botSelectBestMoneylineExecutionBook(market, 'HOME');
eq(homeBack.decimalOdds, 2.05,
  'backend HOME selects highest decimal, not priority-first');
eq(homeBack.bookmaker, 'Other Book',
  'backend HOME selects actual best bookmaker');
eq(homeBack.price_selection, 'BEST_AVAILABLE_MONEYLINE',
  'backend selection semantics explicit');

const awayBack = backend._botSelectBestMoneylineExecutionBook(market, 'AWAY');
eq(awayBack.decimalOdds, 2.12,
  'backend AWAY selects highest decimal');
eq(awayBack.bookmaker_key, 'other_book',
  'backend exposes selected bookmaker key');

eq(
  backend._botSelectBestMoneylineExecutionBook({
    bookmakers: [
      { key: 'pinnacle', title: 'Pinnacle', home_ml: 2.00 },
      { key: 'winamax', title: 'Winamax', home_ml: 2.00 },
    ],
  }, 'HOME').bookmaker,
  'Pinnacle',
  'equal prices use priority only as deterministic tie-break'
);

eq(
  backend._botSelectBestMoneylineExecutionBook({
    bookmakers: [
      { key: 'bad1', home_ml: 1 },
      { key: 'bad2', home_ml: null },
      { key: 'bad3', home_ml: 'x' },
    ],
  }, 'HOME'),
  null,
  'invalid prices fail closed'
);

// ── Frontend selector parity for Moneyline ────────────────────────────────
const homeFront = getBestBookOdds(market, 'HOME', 'h2h');
eq(homeFront.decimalOdds, homeBack.decimalOdds,
  'frontend/backend HOME best decimal parity');
eq(homeFront.bookmaker, homeBack.bookmaker,
  'frontend/backend HOME bookmaker parity');

const awayFront = getBestBookOdds(market, 'AWAY', 'h2h');
eq(awayFront.decimalOdds, awayBack.decimalOdds,
  'frontend/backend AWAY best decimal parity');

// Spread/total remain priority-first on purpose in this PR.
eq(
  getBestBookOdds(market, 'HOME', 'spreads').bookmaker,
  'Pinnacle',
  'spread selection unchanged until same-line comparison is implemented'
);
eq(
  getBestBookOdds(market, 'OVER', 'totals').bookmaker,
  'Pinnacle',
  'total selection unchanged until same-line comparison is implemented'
);

// ── Backend recommendation uses best execution quote ─────────────────────
const matchData = {
  odds: { home_ml: -110, away_ml: -110 },
  market_odds: market,
};

const recs = backend._botComputeBettingRecs(0.60, matchData, [], null);
const rec = recs?.recommendations?.find(r => r.type === 'MONEYLINE');
assert(Boolean(rec), 'backend produces expected reference-gated moneyline rec');
eq(rec.side, 'HOME', 'backend recommendation side unchanged');
eq(rec.odds_decimal, 2.05,
  'backend recommendation carries best executable decimal');
eq(rec.odds_source, 'Other Book',
  'backend recommendation carries best executable bookmaker');
eq(rec.odds_book_key, 'other_book',
  'backend recommendation carries bookmaker key');
eq(rec.execution_price_selection, 'BEST_AVAILABLE_MONEYLINE',
  'backend recommendation marks best-price selection');
eq(rec.edge, 8,
  'legacy reference-market edge remains unchanged');
eq(rec.expected_value, 0.23,
  'EV uses selected executable price');

// Better execution price must not create a recommendation if legacy reference
// gate (<5%) did not pass.
const noGate = backend._botComputeBettingRecs(0.56, {
  odds: { home_ml: -110, away_ml: -110 },
  market_odds: {
    bookmakers: [
      { key: 'other_book', title: 'Other Book', home_ml: 2.50, away_ml: 1.50 },
    ],
  },
}, [], null);
eq(noGate.recommendations.length, 0,
  'best price alone does not change recommendation gate');

// Frontend recommendation also uses best H2H execution price.
const front = computeBettingRecommendations(
  0.60,
  { home_ml: -110, away_ml: -110, spread: null, over_under: null },
  { market_odds: market },
  {},
  [],
  null,
);
const frontRec = front.recommendations.find(r => r.type === 'MONEYLINE');
assert(Boolean(frontRec), 'frontend produces moneyline rec');
eq(frontRec.odds_decimal, 2.05,
  'frontend recommendation carries best executable decimal');
eq(frontRec.odds_source, 'Other Book',
  'frontend recommendation carries best executable bookmaker');
eq(frontRec.execution_price_selection, 'BEST_AVAILABLE_MONEYLINE',
  'frontend recommendation selection semantics explicit');

console.log('\nNBA Moneyline best execution price');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ best H2H execution price selected without changing reference edge gate\n');
