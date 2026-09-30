#!/usr/bin/env node
/**
 * NBA parlay safety gate.
 *
 * Sans modèle de corrélation / probabilité conjointe validé, aucune paire de
 * legs ne doit produire edge, Kelly ou recommandation exploitable.
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

const strongLegs = [
  {
    type: 'OVER_UNDER',
    side: 'OVER',
    line: 226.5,
    edge: 12,
    odds_decimal: 1.95,
    motor_prob: 62,
    has_value: true,
  },
  {
    type: 'PLAYER_POINTS',
    player: 'Test Player',
    side: 'OVER',
    line: 24.5,
    edge: 11,
    odds_decimal: 1.91,
    motor_prob: 64,
    has_value: true,
  },
  {
    type: 'MONEYLINE',
    side: 'HOME',
    edge: 9,
    odds_decimal: 1.80,
    motor_prob: 65,
    has_value: true,
  },
];

// Même avec des legs artificiellement très forts, aucun parlay n'est produit.
const out = backend._botBuildParlayRecs(strongLegs);
check('parlay builder retourne un tableau', Array.isArray(out));
eq('parlay builder désactivé', out.length, 0);

// Cas vides / incomplets restent sûrs.
eq('parlay null safe', backend._botBuildParlayRecs(null), []);
eq('parlay un seul leg', backend._botBuildParlayRecs([strongLegs[0]]), []);

// Aucun objet exploitable ne peut être dérivé du résultat.
check('aucun has_value true', !out.some(x => x?.has_value === true));
check('aucun Kelly', !out.some(x => x?.kelly_stake != null));
check('aucun motor_prob conjoint', !out.some(x => x?.motor_prob != null));

console.log('\nNBA parlay safety gate');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ aucune recommandation PARLAY exploitable tant que les corrélations ne sont pas validées\n');
process.exit(0);
