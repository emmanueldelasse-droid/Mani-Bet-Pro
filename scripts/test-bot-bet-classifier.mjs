#!/usr/bin/env node
/**
 * MBP · test classifier UI lecture produit recommandations.
 *
 * Couvre les 3 catégories définies par la règle ChatGPT 2026-05-17 ·
 *   recommended_bet · value_idea_not_selected · no_bet_analysis
 *
 * Pure unitaire · import du module pur sans dépendance navigateur.
 * Aucun moteur · aucun code backend touché par le test.
 *
 * Lancement · `node scripts/test-bot-bet-classifier.mjs`
 * Exit · 0 OK · 1 fail.
 */

import {
  BET_CATEGORY,
  classifyLogBet,
  resolveSidePlayerName,
  buildRecommendedView,
  buildValueIdeasView,
} from '../src/ui/ui.bot.classifier.js';

const results = [];
function expect(label, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  results.push({ label, expected, actual, ok });
}

// ── Fixtures réalistes (inspirés des exemples Hamburg/Strasbourg 17/05/2026) ──

const LOG_RECOMMENDED_HOME = {
  match_id: 'STR-1',
  p1: 'Diane Parry', p2: 'Emma Raducanu',
  motor_prob: 62, confidence_level: 'MEDIUM', data_quality: 0.78,
  best_side: 'HOME', best_edge: 8, best_market: 'MONEYLINE',
  betting_recommendations: {
    best: { type: 'MONEYLINE', side: 'HOME', edge: 8, odds_decimal: 1.95, motor_prob: 62, kelly_stake: 0.012, is_contrarian: false },
    recommendations: [
      { type: 'MONEYLINE', side: 'HOME', edge: 8, odds_decimal: 1.95, motor_prob: 62, is_contrarian: false },
    ],
  },
};

const LOG_RECOMMENDED_AWAY = {
  match_id: 'HAM-1',
  p1: 'Miomir Kecmanovic', p2: 'Karen Khachanov',
  motor_prob: 42, confidence_level: 'MEDIUM', data_quality: 0.72,
  best_side: 'AWAY', best_edge: 7, best_market: 'MONEYLINE',
  betting_recommendations: {
    best: { type: 'MONEYLINE', side: 'AWAY', edge: 7, odds_decimal: 2.10, motor_prob: 58, kelly_stake: 0.008, is_contrarian: false },
    recommendations: [
      { type: 'MONEYLINE', side: 'AWAY', edge: 7, odds_decimal: 2.10, motor_prob: 58, is_contrarian: false },
    ],
  },
};

const LOG_VALUE_IDEA_CONTRARIAN = {
  match_id: 'STR-2',
  p1: 'Madison Keys', p2: 'Cristina Bucsa',
  motor_prob: 72, confidence_level: 'LOW', data_quality: 0.62,
  best_side: null, best_edge: null,
  betting_recommendations: {
    best: null,
    recommendations: [
      { type: 'MONEYLINE', side: 'AWAY', edge: 6, odds_decimal: 4.50, motor_prob: 28, is_contrarian: true },
    ],
  },
};

const LOG_VALUE_IDEA_NONCONTRARIAN = {
  match_id: 'HAM-2',
  p1: 'Justin Engel', p2: 'Ugo Humbert',
  motor_prob: 45, confidence_level: 'LOW', data_quality: 0.60,
  best_side: null, best_edge: null,
  betting_recommendations: {
    best: null,
    recommendations: [
      { type: 'MONEYLINE', side: 'HOME', edge: 5, odds_decimal: 2.50, motor_prob: 45, is_contrarian: false },
    ],
  },
};

const LOG_NO_BET = {
  match_id: 'HAM-3',
  p1: 'Player A', p2: 'Player B',
  motor_prob: 50, confidence_level: 'INCONCLUSIVE', data_quality: 0.45,
  best_side: null, best_edge: null,
  betting_recommendations: null,
};

const LOG_NO_BET_EMPTY_RECS = {
  match_id: 'HAM-4',
  p1: 'Player C', p2: 'Player D',
  motor_prob: 50, confidence_level: 'INCONCLUSIVE', data_quality: 0.50,
  best_side: null, best_edge: null,
  betting_recommendations: { recommendations: [], best: null },
};

// ── 1. classifyLogBet · classification correcte par cas ───────────────────

expect('RECOMMENDED · best + best_side',     BET_CATEGORY.RECOMMENDED, classifyLogBet(LOG_RECOMMENDED_HOME));
expect('RECOMMENDED · best_side AWAY',        BET_CATEGORY.RECOMMENDED, classifyLogBet(LOG_RECOMMENDED_AWAY));
expect('VALUE_IDEA · contrarian',             BET_CATEGORY.VALUE_IDEA,  classifyLogBet(LOG_VALUE_IDEA_CONTRARIAN));
expect('VALUE_IDEA · non-contrarian',         BET_CATEGORY.VALUE_IDEA,  classifyLogBet(LOG_VALUE_IDEA_NONCONTRARIAN));
expect('NO_BET · betting_recommendations null', BET_CATEGORY.NO_BET,    classifyLogBet(LOG_NO_BET));
expect('NO_BET · recommendations vide',       BET_CATEGORY.NO_BET,      classifyLogBet(LOG_NO_BET_EMPTY_RECS));
expect('NO_BET · null/undefined safe',        BET_CATEGORY.NO_BET,      classifyLogBet(null));
expect('NO_BET · objet vide safe',            BET_CATEGORY.NO_BET,      classifyLogBet({}));

// Cas frontière · best_side défini mais best object null
// Selon règle · "best_side existe OU best non null" · les 2 sont OR donc OK
const LOG_ONLY_BEST_SIDE = {
  match_id: 'X-1',
  best_side: 'HOME',
  betting_recommendations: { best: null, recommendations: [{ type: 'MONEYLINE', side: 'HOME', edge: 5 }] },
};
expect('RECOMMENDED · best_side seul (best=null)', BET_CATEGORY.RECOMMENDED, classifyLogBet(LOG_ONLY_BEST_SIDE));

// Cas frontière · best présent mais best_side absent (rare)
const LOG_ONLY_BEST = {
  match_id: 'X-2',
  betting_recommendations: { best: { type: 'MONEYLINE', side: 'AWAY', edge: 6 }, recommendations: [] },
};
expect('RECOMMENDED · best seul (best_side=null)', BET_CATEGORY.RECOMMENDED, classifyLogBet(LOG_ONLY_BEST));

// ── 2. resolveSidePlayerName · alias tennis vs NBA/MLB ────────────────────

expect('Tennis · HOME → p1',           'Diane Parry', resolveSidePlayerName(LOG_RECOMMENDED_HOME, 'HOME'));
expect('Tennis · AWAY → p2',           'Karen Khachanov', resolveSidePlayerName(LOG_RECOMMENDED_AWAY, 'AWAY'));
expect('NBA · HOME → home (fallback)', 'Lakers', resolveSidePlayerName({ home: 'Lakers', away: 'Warriors' }, 'HOME'));
expect('NBA · AWAY → away',            'Warriors', resolveSidePlayerName({ home: 'Lakers', away: 'Warriors' }, 'AWAY'));
expect('OVER pass-through',            'OVER', resolveSidePlayerName(LOG_RECOMMENDED_HOME, 'OVER'));
expect('Side null safe',               '', resolveSidePlayerName(LOG_RECOMMENDED_HOME, null));
expect('Log null safe',                'HOME', resolveSidePlayerName(null, 'HOME'));

// ── 3. buildRecommendedView · vue normalisée pour RECOMMENDED ─────────────

const recView = buildRecommendedView(LOG_RECOMMENDED_HOME);
expect('Recommended view · category',     BET_CATEGORY.RECOMMENDED, recView.category);
expect('Recommended view · side_label',   'Diane Parry',            recView.side_label);
expect('Recommended view · edge',          8,                       recView.edge);
expect('Recommended view · market_type',  'MONEYLINE',              recView.market_type);
expect('Recommended view · is_contrarian', false,                   recView.is_contrarian);
expect('Recommended view · confidence',   'MEDIUM',                 recView.confidence);

expect('Recommended view · null si VALUE_IDEA', null, buildRecommendedView(LOG_VALUE_IDEA_CONTRARIAN));
expect('Recommended view · null si NO_BET',     null, buildRecommendedView(LOG_NO_BET));

// ── 4. buildValueIdeasView · liste idées non retenues ─────────────────────

const ideasContrarian = buildValueIdeasView(LOG_VALUE_IDEA_CONTRARIAN);
expect('Value ideas · 1 entrée',                 1,                       ideasContrarian.length);
expect('Value ideas · category',                 BET_CATEGORY.VALUE_IDEA, ideasContrarian[0].category);
expect('Value ideas · is_contrarian true',       true,                    ideasContrarian[0].is_contrarian);
expect('Value ideas · side_label (AWAY → p2)',   'Cristina Bucsa',        ideasContrarian[0].side_label);

const ideasNonContrarian = buildValueIdeasView(LOG_VALUE_IDEA_NONCONTRARIAN);
expect('Value ideas non-contrarian · 1 entrée',      1,                  ideasNonContrarian.length);
expect('Value ideas non-contrarian · is_contrarian', false,              ideasNonContrarian[0].is_contrarian);
expect('Value ideas non-contrarian · side_label',    'Justin Engel',     ideasNonContrarian[0].side_label);

expect('Value ideas · [] si RECOMMENDED', [], buildValueIdeasView(LOG_RECOMMENDED_HOME));
expect('Value ideas · [] si NO_BET',      [], buildValueIdeasView(LOG_NO_BET));

// ── REPORT ─────────────────────────────────────────────────────────────────

console.log('Bot bet classifier · tests');
console.log('');
let fails = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`  PASS · ${r.label}`);
  } else {
    fails++;
    console.log(`  FAIL · ${r.label}`);
    console.log(`        attendu = ${JSON.stringify(r.expected)}`);
    console.log(`        obtenu  = ${JSON.stringify(r.actual)}`);
  }
}
console.log('');
console.log(`Résumé · ${results.length - fails}/${results.length} pass · ${fails} fail`);
process.exit(fails > 0 ? 1 : 0);
