#!/usr/bin/env node
/**
 * NBA O/U event phase.
 *
 * Le moteur total doit utiliser la phase DU MATCH, pas l'horloge système.
 * Aucun poids/seuil n'est modifié : on vérifie seulement l'ajustement playoff
 * historique de -4.5 pts.
 */

import { backend } from './lib/backend-engine.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition) {
  if (condition) pass++;
  else { fail++; failures.push(label); console.error('  ✗', label); }
}
function approx(label, actual, expected, eps = 1e-9) {
  check(`${label} · expected≈${expected} actual=${actual}`,
    typeof actual === 'number' && Math.abs(actual - expected) <= eps);
}

function base(event_type, season_type, game_datetime) {
  return {
    event_type,
    season_type,
    game_datetime,
    home_season_stats: { ppg: 115, oppg: 112, pace: null, defensive_rating: null },
    away_season_stats: { ppg: 113, oppg: 114, pace: null, defensive_rating: null },
    home_recent: null,
    away_recent: null,
    home_injuries: [],
    away_injuries: [],
    home_rest_days: 2,
    away_rest_days: 2,
    market_odds: null,
  };
}

const regular = backend._botPredictNBATotal(
  base('REGULAR', 2, '2026-11-15T00:30:00Z')
);
const playoff = backend._botPredictNBATotal(
  base('PLAYOFF', 3, '2027-05-15T00:30:00Z')
);
const preseason = backend._botPredictNBATotal(
  base('PRESEASON', 1, '2026-10-03T23:00:00Z')
);

check('regular · total available', typeof regular.est_total === 'number');
check('playoff · total available', typeof playoff.est_total === 'number');
check('preseason · total available', typeof preseason.est_total === 'number');

approx('playoff · historical adjustment exactly -4.5', playoff.est_total, regular.est_total - 4.5, 1e-9);
approx('preseason · no playoff adjustment', preseason.est_total, regular.est_total, 1e-9);

check(
  'playoff · adjustment audit present',
  playoff.adjustments.some(a => a?.name === 'playoff_defense' && a?.delta === -4.5)
);
check(
  'regular · no playoff adjustment',
  !regular.adjustments.some(a => a?.name === 'playoff_defense')
);
check(
  'preseason · no playoff adjustment',
  !preseason.adjustments.some(a => a?.name === 'playoff_defense')
);

console.log('\nNBA O/U event phase');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ O/U utilise la phase réelle du match\n');
process.exit(0);
