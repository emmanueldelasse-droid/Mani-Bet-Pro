#!/usr/bin/env node
/**
 * CLV semantics.
 *
 * CLV = price taken vs closing price. model_prob vs market is NOT CLV.
 */

import { readFileSync } from 'node:fs';
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

// Pris -110 puis clôture -130 : le marché s'est raccourci → CLV positif.
{
  const clv = backend._computePriceCLV(-110, -130);
  check('good CLV · result exists', clv !== null);
  check('good CLV · price ratio positive', clv.price_ratio_pct > 0);
  check('good CLV · implied movement positive', clv.implied_prob_change_pts > 0);
  eq('good CLV · taken decimal', clv.odds_taken_decimal, 1.909);
  eq('good CLV · closing decimal', clv.closing_odds_decimal, 1.769);
}

// Pris -130 puis clôture -110 : on a pris un moins bon prix que la clôture.
{
  const clv = backend._computePriceCLV(-130, -110);
  check('bad CLV · price ratio negative', clv.price_ratio_pct < 0);
  check('bad CLV · implied movement negative', clv.implied_prob_change_pts < 0);
}

// Cotes positives.
{
  const clv = backend._computePriceCLV(150, 120);
  check('positive odds · CLV positive when taken price better', clv.price_ratio_pct > 0);
}

// Inputs invalides.
eq('invalid taken odds', backend._computePriceCLV(0, -110), null);
eq('invalid closing odds', backend._computePriceCLV(-110, 0), null);

// Anti-régression statique : l'ancien faux CLV modèle-vs-closing ne doit pas revenir.
const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
check('bot CLV auto explicitly unavailable',
  worker.includes("log.clv_status        = 'UNAVAILABLE_NO_CLOSING_ODDS'"));
check('bot preserves model-vs-market under honest name',
  worker.includes('log.model_vs_market_at_analysis_pts = modelVsMarketAtAnalysisPts'));
check('NBA fake CLV formula removed',
  !worker.includes('clvPostMatch = Math.round((log.motor_prob / 100 - impliedHome)'));
check('paper CLV method explicit',
  worker.includes("bet.clv_method = 'TAKEN_PRICE_VS_CLOSING_PRICE'"));
check('paper CLV no longer requires motor_prob',
  !worker.includes('closingOdds !== null && bet.motor_prob !== null'));

const ui = readFileSync(new URL('../src/ui/ui.bot.js', import.meta.url), 'utf8');
check('UI requires verified CLV status', ui.includes("log.clv_status === 'AVAILABLE'"));
check('UI requires CLV method', ui.includes('!!log.clv_method'));

const paperEngine = readFileSync(new URL('../src/paper/paper.engine.js', import.meta.url), 'utf8');
check('local paper CLV uses price helper',
  paperEngine.includes('_computeLocalPriceCLV(bet.odds_taken, closingOdds)'));
check('local paper CLV no longer depends on motor_prob',
  !paperEngine.includes('closingOdds !== null && bet.motor_prob !== null'));
check('paper metrics ignore legacy unverified CLV',
  paperEngine.includes("b.clv_status === 'AVAILABLE'") &&
  paperEngine.includes("b.clv_method === 'TAKEN_PRICE_VS_CLOSING_PRICE'"));

const historyUi = readFileSync(new URL('../src/ui/ui.history.js', import.meta.url), 'utf8');
check('history UI only shows verified CLV',
  historyUi.includes("bet.clv_status === 'AVAILABLE'") &&
  historyUi.includes("bet.clv_method === 'TAKEN_PRICE_VS_CLOSING_PRICE'"));
check('history UI labels metric as CLV',
  historyUi.includes("_metricCell('CLV moyen'"));
check('history UI no longer exposes legacy Valeur cote label',
  !historyUi.includes('Valeur cote : '));

console.log('\nCLV semantics');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ CLV = taken price vs closing price · model-vs-market séparé\n');
process.exit(0);
