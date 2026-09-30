#!/usr/bin/env node
/**
 * NBA market observability.
 *
 * Vérifie que no-vig / EV / séparation raw-vs-decision sont ajoutés sans
 * modifier les seuils ni l'ancien edge utilisé pour décider.
 */

import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';

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
function approx(label, actual, expected, eps = 1e-4) {
  check(`${label} · expected≈${expected} actual=${actual}`,
    typeof actual === 'number' && Math.abs(actual - expected) <= eps);
}

// 1) No-vig : deux probabilités brutes avec marge sont renormalisées à 1.
{
  const pHome = 1 / 1.80;
  const pAway = 1 / 2.10;
  const fair = backend._botNoVigPair(pHome, pAway);

  check('no-vig · pair exists', fair !== null);
  approx('no-vig · fair sum=1', fair.fair_a + fair.fair_b, 1);
  check('no-vig · overround positive', fair.overround > 0);
  check('no-vig · raw sum > 1', pHome + pAway > 1);
}

// 2) Moneyline : l'ancien edge reste calculé sur implied RAW.
// -110/-110 → implied raw 52.38% chacun.
// score=60% → ancien edge = round(7.619 pts) = 8.
// no-vig = 50% → edge_no_vig = 10 pts.
// AUCUN changement de seuil/décision.
{
  const score = 0.60;
  const data = {
    odds: { home_ml: -110, away_ml: -110 },
    market_odds: null,
  };

  const out = backend._botComputeBettingRecs(score, data, [], null);
  eq('ML · exactement 1 reco comme avant', out.recommendations.length, 1);
  const rec = out.recommendations[0];

  eq('ML · side HOME inchangé', rec.side, 'HOME');
  eq('ML · edge legacy inchangé', rec.edge, 8);
  approx('ML · market raw', rec.market_raw_prob, 0.5238, 0.0001);
  approx('ML · market fair no-vig', rec.market_fair_prob_no_vig, 0.5, 0.0001);
  approx('ML · edge no-vig', rec.edge_no_vig, 10, 0.01);
  check('ML · odds decimal present', rec.odds_decimal > 1);
  approx('ML · EV formula', rec.expected_value, score * rec.odds_decimal - 1, 0.0001);
  eq('ML · has_value unchanged', rec.has_value, true);
}

// 3) Le seuil legacy reste inchangé : score 57% vs -110 = 4.62 pts raw → pas de reco,
// même si no-vig montrerait 7 pts. Cette PR est OBSERVATION ONLY.
{
  const out = backend._botComputeBettingRecs(
    0.57,
    { odds: { home_ml: -110, away_ml: -110 }, market_odds: null },
    [],
    null
  );
  eq('ML · no-vig ne change pas le seuil existant', out.recommendations.length, 0);
}

// 4) Engine : score modèle avant marché distinct du score de décision après shrinkage.
{
  const base = structuredClone(FIXTURES.find(f => f.id === 'high_signal_home').data);
  base.event_type = 'REGULAR';
  base.season_type = 2;
  base.game_datetime = '2026-11-15T00:30:00Z';

  // Marché artificiellement opposé au modèle pour forcer le shrinkage critique.
  base.odds = { home_ml: 300, away_ml: -400 };
  base.market_odds = null;

  const out = backend._botEngineCompute(base);
  eq('engine · calibrated prob explicitement absent', out.model_calibrated_prob, null);
  eq('engine · probability status honnête', out.probability_status, 'UNCALIBRATED_SCORE');
  check('engine · raw score exists', typeof out.model_raw_score === 'number');
  check('engine · decision prob exists', typeof out.decision_prob === 'number');
  approx('engine · score legacy = decision_prob', out.score, out.decision_prob, 1e-9);
  check('engine · critical market divergence triggered', out.market_divergence?.flag === 'critical');
  check('engine · raw model separated from shrunk decision', out.model_raw_score !== out.decision_prob);
  approx(
    'engine · no-vig fair pair sums to 1',
    out.market_divergence.market_fair_prob_no_vig_home + out.market_divergence.market_fair_prob_no_vig_away,
    1,
    0.0002
  );
}

// 5) O/U : champs no-vig + EV ajoutés, ancien edge reste le gate.
{
  const data = {
    event_type: 'REGULAR',
    season_type: 2,
    game_datetime: '2026-11-15T00:30:00Z',
    home_season_stats: { ppg: 118, oppg: 112, pace: null, defensive_rating: null },
    away_season_stats: { ppg: 115, oppg: 114, pace: null, defensive_rating: null },
    home_recent: null,
    away_recent: null,
    home_injuries: [],
    away_injuries: [],
    home_rest_days: 2,
    away_rest_days: 2,
    market_odds: {
      bookmakers: [{
        key: 'pinnacle', title: 'Pinnacle',
        total_line: 220.5,
        over_total: 1.91,
        under_total: 1.91,
      }],
    },
  };
  const out = backend._botPredictNBATotal(data);
  check('OU · recommendation produced for strong synthetic diff', out.recommendation !== null);
  const rec = out.recommendation;
  check('OU · raw edge retained', typeof rec.edge === 'number');
  approx('OU · raw market prob', rec.market_raw_prob, 1 / 1.91, 0.0001);
  approx('OU · no-vig fair = 50%', rec.market_fair_prob_no_vig, 0.5, 0.0001);
  check('OU · edge_no_vig observed', typeof rec.edge_no_vig === 'number');
  approx('OU · EV formula', rec.expected_value, (rec.motor_prob / 100) * rec.odds_decimal - 1, 0.02);
}

// 6) Player props : verified quote conserve le chemin existant + expose no-vig/EV.
{
  const prediction = {
    available: true,
    home_players: [{
      name: 'Test Player',
      team: 'Home Team',
      projected_pts: 30,
      pts_stdev: 5,
      confidence: { score: 0.9, label: 'high' },
    }],
    away_players: [],
  };
  const lines = {
    'test player': {
      player_name: 'Test Player',
      line: 24.5,
      market_verified: true,
      market_source: 'test_book',
      over: { decimal: 1.91, book: 'test_book' },
      under: { decimal: 1.91, book: 'test_book' },
      confidence: 'VERIFIED',
    },
  };

  const out = backend._botMatchPlayerPropsToLines(prediction, lines, 'Home Team', 'Away Team');
  eq('PP · 1 reco', out.recommendations.length, 1);
  const rec = out.recommendations[0];
  approx('PP · fair no-vig 50%', rec.market_fair_prob_no_vig, 0.5, 0.0001);
  check('PP · edge_no_vig observed', typeof rec.edge_no_vig === 'number');
  approx('PP · EV formula', rec.expected_value, (rec.motor_prob / 100) * rec.odds_decimal - 1, 0.02);
  eq('PP · legacy edge preserved', rec.edge, rec.edge_raw);
}

console.log('\nNBA market observability');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ raw model / decision / no-vig / EV exposés sans changement de gate\n');
process.exit(0);
