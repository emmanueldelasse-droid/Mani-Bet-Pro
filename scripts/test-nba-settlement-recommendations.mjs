#!/usr/bin/env node
/**
 * NBA recommendation settlement schema.
 *
 * Vérifie le schéma réellement produit aujourd'hui :
 * betting_recommendations.recommendations[].
 * Aucun fetch, aucune recommandation rétroactive.
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

// Moneyline exploitable.
{
  const recs = [{ type: 'MONEYLINE', side: 'HOME', has_value: true }];
  const s = backend._botSettleMarketRecommendations(recs, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('ML · result WIN', recs[0].result, 'WIN');
  eq('ML · was_right true', recs[0].was_right, true);
  eq('ML · count', s.moneyline_settled, 1);
  eq('ML · summary true', s.moneyline_was_right, true);
}

// Spread HOME -5.5 couvre de 10.
{
  const recs = [{ type: 'SPREAD', side: 'HOME', spread_line: -5.5, has_value: true }];
  const s = backend._botSettleMarketRecommendations(recs, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('Spread home · WIN', recs[0].result, 'WIN');
  eq('Spread home · was_right true', recs[0].was_right, true);
  eq('Spread home · summary true', s.spread_was_right, true);
  eq('Spread home · count', s.spread_settled, 1);
}

// Spread AWAY +5.5 ne couvre pas une défaite de 10.
{
  const recs = [{ type: 'SPREAD', side: 'AWAY', spread_line: 5.5, has_value: true }];
  const s = backend._botSettleMarketRecommendations(recs, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('Spread away · LOSS', recs[0].result, 'LOSS');
  eq('Spread away · false', recs[0].was_right, false);
  eq('Spread away · summary false', s.spread_was_right, false);
}

// Spread PUSH.
{
  const recs = [{ type: 'SPREAD', side: 'HOME', spread_line: -10, has_value: true }];
  const s = backend._botSettleMarketRecommendations(recs, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('Spread push · PUSH', recs[0].result, 'PUSH');
  eq('Spread push · was_right null', recs[0].was_right, null);
  eq('Spread push · summary null', s.spread_was_right, null);
}

// O/U win + loss.
{
  const over = [{ type: 'OVER_UNDER', side: 'OVER', line: 215.5, has_value: true }];
  const s1 = backend._botSettleMarketRecommendations(over, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('O/U over · WIN', over[0].result, 'WIN');
  eq('O/U over · summary true', s1.ou_was_right, true);

  const under = [{ type: 'OVER_UNDER', side: 'UNDER', ou_line: 215.5, has_value: true }];
  const s2 = backend._botSettleMarketRecommendations(under, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('O/U under · LOSS', under[0].result, 'LOSS');
  eq('O/U under · summary false', s2.ou_was_right, false);
}

// O/U PUSH.
{
  const recs = [{ type: 'OVER_UNDER', side: 'OVER', market_total: 220, has_value: true }];
  const s = backend._botSettleMarketRecommendations(recs, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  eq('O/U push · PUSH', recs[0].result, 'PUSH');
  eq('O/U push · was_right null', recs[0].was_right, null);
  eq('O/U push · summary null', s.ou_was_right, null);
}

// Recommandation non exploitable = jamais settlée/statistiquement comptée.
{
  const recs = [{ type: 'OVER_UNDER', side: 'OVER', line: 215.5, has_value: false }];
  const s = backend._botSettleMarketRecommendations(recs, {
    winner: 'HOME', margin: 10, total_points: 220,
  });
  check('non-value · result untouched', recs[0].result === undefined);
  check('non-value · was_right untouched', recs[0].was_right === undefined);
  eq('non-value · count 0', s.total_settled, 0);
}

// Player Points : WIN / LOSS / PUSH, avec PUSH neutre.
{
  const overWin = { type: 'PLAYER_POINTS', side: 'OVER', line: 24.5, has_value: true };
  eq('PP over · helper settled', backend._botSettlePlayerPointRecommendation(overWin, 27, 34), true);
  eq('PP over · WIN', overWin.result, 'WIN');
  eq('PP over · true', overWin.was_right, true);
  eq('PP over · actual pts', overWin.actual_pts, 27);
  eq('PP over · actual mins', overWin.actual_mins, 34);

  const underLoss = { type: 'PLAYER_POINTS', side: 'UNDER', line: 24.5, has_value: true };
  backend._botSettlePlayerPointRecommendation(underLoss, 27, 34);
  eq('PP under · LOSS', underLoss.result, 'LOSS');
  eq('PP under · false', underLoss.was_right, false);

  const push = { type: 'PLAYER_POINTS', side: 'OVER', line: 25, has_value: true };
  backend._botSettlePlayerPointRecommendation(push, 25, 30);
  eq('PP push · PUSH', push.result, 'PUSH');
  eq('PP push · null', push.was_right, null);
}

console.log('\nNBA recommendation settlement');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ recommendations[] settlées par marché · PUSH neutres\n');
process.exit(0);
