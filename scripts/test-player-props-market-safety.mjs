#!/usr/bin/env node
/**
 * NBA Player Props market safety.
 *
 * Règle : une projection IA n'est jamais une cote bookmaker.
 * Aucun prix synthétique → aucun implied probability → aucun edge/Kelly/reco.
 */

import { backend } from './lib/backend-engine.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition) {
  if (condition) pass++;
  else { fail++; failures.push(label); console.error('  ✗', label); }
}
function eq(label, actual, expected) {
  check(`${label} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const cachedPayload = {
  fetched_at: Date.parse('2026-10-03T18:00:00Z'),
  by_game: {
    'NY@BOS': {
      players: [{
        name: 'Test Player',
        team: 'BOS',
        line: 24.5,
        source: 'example_projection_source',
        confidence: 'high',
      }],
    },
  },
};

const env = {
  PAPER_TRADING: {
    async get(key, options) {
      if (key !== 'ai_player_props_20261003') return null;
      return options?.type === 'json' ? cachedPayload : JSON.stringify(cachedPayload);
    },
  },
};

// 1) AI cache remains usable as projection metadata, with zero synthetic odds.
const ai = await backend._getAIPlayerPropsLines('20261003', 'NY@BOS', env);
eq('AI · available', ai?.available, true);
eq('AI · projection_only', ai?.projection_only, true);
eq('AI · market_available false', ai?.market_available, false);

const aiLine = ai?.lines?.['test player'];
eq('AI · projection_line retained', aiLine?.projection_line, 24.5);
eq('AI · market_verified false', aiLine?.market_verified, false);
check('AI · no over bookmaker quote', !Object.prototype.hasOwnProperty.call(aiLine ?? {}, 'over'));
check('AI · no under bookmaker quote', !Object.prototype.hasOwnProperty.call(aiLine ?? {}, 'under'));
check('AI · no decimal 1.91 anywhere', !JSON.stringify(ai).includes('1.91'));

const prediction = {
  available: true,
  home_players: [{
    name: 'Test Player',
    team: 'Boston Celtics',
    projected_pts: 30,
    pts_stdev: 5,
    confidence: { score: 0.9, label: 'high' },
  }],
  away_players: [],
};

// 2) Defense in depth: even if a future caller injects fake 1.91 prices,
// market_verified=false must prevent market enrichment and recommendation.
const hostileSynthetic = {
  'test player': {
    player_name: 'Test Player',
    line: 24.5,
    market_verified: false,
    over: { decimal: 1.91, book: 'ai:synthetic' },
    under: { decimal: 1.91, book: 'ai:synthetic' },
    confidence: 'high',
  },
};

const blocked = backend._botMatchPlayerPropsToLines(
  prediction, hostileSynthetic, 'Boston Celtics', 'New York Knicks'
);
eq('synthetic · recommendations blocked', blocked.recommendations.length, 0);
check('synthetic · no market object attached',
  blocked.enriched.home_players[0]?.market === undefined);

// 3) Verified bookmaker quote still follows the existing path.
const realMarket = {
  'test player': {
    player_name: 'Test Player',
    line: 24.5,
    market_verified: true,
    market_source: 'test_bookmaker',
    over: { decimal: 1.91, book: 'test_bookmaker' },
    under: { decimal: 1.91, book: 'test_bookmaker' },
    confidence: 'VERIFIED',
  },
};

const allowed = backend._botMatchPlayerPropsToLines(
  prediction, realMarket, 'Boston Celtics', 'New York Knicks'
);
check('real market · market object attached',
  allowed.enriched.home_players[0]?.market !== undefined);
check('real market · recommendation can be produced',
  allowed.recommendations.length === 1);
eq('real market · recommendation type', allowed.recommendations[0]?.type, 'PLAYER_POINTS');
eq('real market · source preserved', allowed.recommendations[0]?.odds_source, 'test_bookmaker');
check('real market · positive edge retained', allowed.recommendations[0]?.edge >= 5);
check('real market · Kelly only exists with verified odds',
  typeof allowed.recommendations[0]?.kelly_stake === 'number');

console.log('\nNBA Player Props market safety');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ AI projection-only · verified bookmaker market required for edge/Kelly/reco\n');
process.exit(0);
