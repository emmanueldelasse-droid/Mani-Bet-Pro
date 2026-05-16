#!/usr/bin/env node
/**
 * MBP-A.2 · Test parité backend ↔ frontend NBA.
 *
 * Anti-régression structurel · couvre :
 *   - poids regular + playoff (lus directement des 2 sources · pas hardcodés)
 *   - extraction variables (11 vars NBA)
 *   - normalisation
 *   - score pondéré (sans `star_absence_modifier` · sans cap · brut)
 *   - confidence NBA (utilise la vraie fonction `EngineCore._computeConfidenceLevel`
 *     importée frontend · validation alignement MBP-FIX-A.2.1 distance-based)
 *   - home_away_split (aligné MBP-FIX-A.2.2 · 4 vars + clamp [-0.50, 0.50])
 *   - back_to_back numérique (MED-1 · divergence connue -0.6/+0.6 vs -1/+1)
 *   - data_quality (divergence structurelle backend simple vs frontend pondéré)
 *
 * Strictement read-only sur le moteur. Charge worker.js via vm sandbox sans
 * le modifier. Importe les modules frontend directement (Logger fonctionne
 * via stub dom-stub.mjs chargé en premier).
 *
 * Lancement · `node scripts/test-nba-engine-parity.mjs`
 * Exit · 0 si OK ou divergences connues uniquement · 1 sinon.
 */

import './lib/dom-stub.mjs';  // DOIT être en premier · stub window pour Logger
import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';

import { getNBAWeights } from '../src/config/sports.config.js';

import {
  extractVariables   as frontExtractVariables,
  normalizeVariables as frontNormalizeVariables,
} from '../src/engine/engine.nba.variables.js';

import {
  computeScore as frontComputeScore,
} from '../src/engine/engine.nba.score.js';

import { EngineCore } from '../src/engine/engine.core.js';

// ── DATES FORCÉES POUR LIRE LES 2 PHASES NBA ────────────────────────────────
// Frontend `getNBAWeights(date)` accepte un paramètre date. Backend
// `_botGetWeights()` lit la date courante via `_botGetNBAPhase()` ·
// `backend.getWeightsForPhase(phase)` monkey-patche temporairement.
// Source-of-truth · les 2 fonctions sont lues directement · aucune table de
// poids dupliquée dans le test.
const REGULAR_DATE = new Date(2026, 0, 15); // 15 janvier · saison régulière
const PLAYOFF_DATE = new Date(2026, 4, 15); // 15 mai · playoffs

function getWeightsBothSides(phase) {
  const date = phase === 'regular' ? REGULAR_DATE : PLAYOFF_DATE;
  const front = getNBAWeights(date);
  const back  = backend.getWeightsForPhase(phase);
  return { front, back };
}

// ── CONFIG TOLÉRANCES ────────────────────────────────────────────────────────

const TOL = {
  score:           0.005,
  contribution:    0.005,
  variable:        0.001,
  home_away_split: 0.001,
  absences_impact: 0.005,
  data_quality:    0.301,   // divergence structurelle assumée
  weight:          1e-9,    // poids · attendu strict equality (chiffres exacts)
};

// ── HELPERS ASSERTIONS ───────────────────────────────────────────────────────

const results = [];

function record(caseName, field, backendValue, frontendValue, options = {}) {
  const { tol = 0, status = null, note = null, known = false } = options;
  let computedStatus = status;
  let diff = null;

  if (computedStatus === null) {
    if (backendValue === null && frontendValue === null) {
      computedStatus = 'PASS';
    } else if (backendValue === null || frontendValue === null) {
      computedStatus = known ? 'KNOWN-DIVERGENCE' : 'FAIL';
      diff = 'null mismatch';
    } else if (typeof backendValue === 'number' && typeof frontendValue === 'number') {
      diff = Math.abs(backendValue - frontendValue);
      const within = diff <= tol;
      computedStatus = within ? 'PASS' : (known ? 'KNOWN-DIVERGENCE' : 'FAIL');
    } else {
      const eq = backendValue === frontendValue;
      computedStatus = eq ? 'PASS' : (known ? 'KNOWN-DIVERGENCE' : 'FAIL');
      if (!eq) diff = `'${backendValue}' vs '${frontendValue}'`;
    }
  }

  results.push({ case: caseName, field, backend: backendValue, frontend: frontendValue, diff, status: computedStatus, note });
}

// ── PARITÉ DES POIDS · backend ↔ frontend ───────────────────────────────────
// Lecture directe des fonctions des 2 côtés · aucune valeur hardcodée dans le
// test. Si une table de poids change dans worker.js OU sports.config.js sans
// l'autre, le test FAIL.

const ALL_WEIGHT_KEYS = [
  'net_rating_diff', 'efg_diff', 'recent_form_ema', 'home_away_split',
  'absences_impact', 'win_pct_diff', 'defensive_diff',
  'back_to_back', 'rest_days_diff', 'b2b_cumul_diff', 'travel_load_diff',
];

function checkWeightsParity() {
  for (const phase of ['regular', 'playoff']) {
    const { front, back } = getWeightsBothSides(phase);
    const caseLabel = `weights__${phase}`;

    record(caseLabel, 'phase', back.phase, front.phase, { tol: 0 });
    record(caseLabel, 'score_cap', back.score_cap, front.score_cap, { tol: TOL.weight });
    record(caseLabel, 'ema_lambda', back.ema_lambda, front.ema_lambda, { tol: TOL.weight });

    for (const k of ALL_WEIGHT_KEYS) {
      const bv = back.weights[k] ?? null;
      const fv = front.weights[k] ?? null;
      record(caseLabel, `weight.${k}`, bv, fv, { tol: TOL.weight });
    }
  }
}

// ── RUN UN CAS ───────────────────────────────────────────────────────────────

function runCaseForPhase(fx, phaseName) {
  const { back: weights } = getWeightsBothSides(phaseName);
  const caseLabel = `${fx.id}__${phaseName}`;

  // ── EXTRACTION BACKEND ─────────────────────────────────────────────────────
  const bVars = backend._botExtractVariables(fx.data, weights.ema_lambda);
  const bNorm = backend._botNormalizeVariables(bVars);
  const bScored = backend._botComputeScore(bVars, weights.weights);

  // Backend data quality · 1 - missing/total (worker.js:3615)
  const totalVarsB = Object.keys(bVars).length;
  const missingB = Object.values(bVars).filter(v => v.quality === 'MISSING').length;
  const bDataQuality = totalVarsB > 0 ? Math.round((1 - missingB / totalVarsB) * 100) / 100 : null;

  const bConfidence = backend._botComputeConfidence(
    { score: bScored.score, confidence_penalty: null },
    bDataQuality
  );

  // ── EXTRACTION FRONTEND ────────────────────────────────────────────────────
  const fData = Object.assign({}, fx.data, { __ema_lambda: weights.ema_lambda });
  const fVars = frontExtractVariables(fData);
  const fNorm = frontNormalizeVariables(fVars);
  const fScored = frontComputeScore(fVars, weights.weights);

  // Frontend data quality · moyenne pondérée 8 niveaux (engine.core.js:258)
  const QUALITY_SCORES = {
    'VERIFIED': 1.0, 'WEIGHTED': 0.9, 'PARTIAL': 0.6, 'ESTIMATED': 0.5,
    'LOW_SAMPLE': 0.4, 'UNCALIBRATED': 0.2, 'INSUFFICIENT_SAMPLE': 0.1, 'MISSING': 0.0,
  };
  const NBA_VAR_IDS = Object.keys(bVars);
  let dqSum = 0;
  for (const id of NBA_VAR_IDS) {
    const q = fVars[id]?.quality ?? 'MISSING';
    dqSum += QUALITY_SCORES[q] ?? 0;
  }
  const fDataQuality = Math.round((dqSum / NBA_VAR_IDS.length) * 1000) / 1000;

  // VRAIE fonction frontend · EngineCore._computeConfidenceLevel('NBA', ...)
  // signature · (predictive, robustness, dataQuality, penaltyScore, sport)
  // Pour NBA, robustness est ignoré dans la branche distance-based.
  const fConfidence = EngineCore._computeConfidenceLevel(fScored.score, null, fDataQuality, 0, 'NBA');

  // ── VARIABLES · valeur brute ──────────────────────────────────────────────
  const varsToCompare = [
    'net_rating_diff', 'efg_diff', 'recent_form_ema', 'home_away_split',
    'absences_impact', 'win_pct_diff', 'defensive_diff',
    'rest_days_diff', 'b2b_cumul_diff', 'travel_load_diff',
  ];
  for (const v of varsToCompare) {
    record(caseLabel, `var.${v}`, bVars[v]?.value ?? null, fVars[v]?.value ?? null, {
      tol: v === 'home_away_split' ? TOL.home_away_split
         : v === 'absences_impact' ? TOL.absences_impact
         : TOL.variable,
    });
  }

  // ── BACK-TO-BACK · MED-1 divergence connue ────────────────────────────────
  const bB2B = bVars.back_to_back?.value ?? null;
  const fB2B = fVars.back_to_back?.value ?? null;
  const b2bKnownDivergence = !!fx.expects?.back_to_back_known_divergence;
  record(caseLabel, 'var.back_to_back', bB2B, fB2B, {
    tol: TOL.variable,
    known: b2bKnownDivergence,
    note: b2bKnownDivergence ? 'MED-1 · attendu · backend -0.6/+0.6 · frontend -1/+1' : null,
  });

  // ── NORMALISATION ─────────────────────────────────────────────────────────
  for (const v of varsToCompare) {
    record(caseLabel, `norm.${v}`, bNorm[v], fNorm[v], { tol: TOL.contribution });
  }
  record(caseLabel, 'norm.back_to_back', bNorm.back_to_back, fNorm.back_to_back, {
    tol: TOL.contribution,
    known: b2bKnownDivergence,
    note: b2bKnownDivergence ? 'MED-1 · norm hérite divergence raw' : null,
  });

  // ── SCORE ─────────────────────────────────────────────────────────────────
  const b2bAffectsScore = b2bKnownDivergence && weights.weights.back_to_back > 0;
  record(caseLabel, 'score.weighted_sum', bScored.score, fScored.score, {
    tol:   TOL.score,
    known: b2bAffectsScore,
    note:  b2bAffectsScore ? 'MED-1 · score décale via contribution back_to_back · poids saison 0.02' : null,
  });

  // ── DATA QUALITY ──────────────────────────────────────────────────────────
  record(caseLabel, 'data_quality.score', bDataQuality, fDataQuality, {
    tol:   TOL.data_quality,
    known: true,
    note:  'divergence structurelle assumée · backend (1-missing/total) vs frontend (moyenne pondérée 8 niveaux qualité)',
  });

  // ── CONFIDENCE ────────────────────────────────────────────────────────────
  // "real" · chaque côté avec son propre dq · informatif (peut diverger sur seuil)
  record(caseLabel, 'confidence.real', bConfidence, fConfidence, {
    known: true,
    note:  'inputs dq différents · voir confidence.algo_synced pour parité algo pure',
  });
  // "algo_synced" · même score + même dq · doit donner même label.
  // Utilise la VRAIE fonction frontend `EngineCore._computeConfidenceLevel`.
  // Si engine.core.js diverge de _botComputeConfidence, ce test FAIL.
  const bConfSync = backend._botComputeConfidence({ score: bScored.score, confidence_penalty: null }, bDataQuality);
  const fConfSync = EngineCore._computeConfidenceLevel(bScored.score, null, bDataQuality, 0, 'NBA');
  record(caseLabel, 'confidence.algo_synced', bConfSync, fConfSync);

  // ── EXPECTS · attentes explicites depuis fixtures.mjs ────────────────────
  // Branche `expects.confidence` (label exact attendu) et `expects.confidence_in`
  // (liste de labels acceptables) sur confidence.algo_synced.
  if (fx.expects?.confidence && fx.expects.confidence !== 'any') {
    const expected = fx.expects.confidence;
    const ok = fConfSync === expected;
    record(caseLabel, 'expects.confidence', expected, fConfSync, {
      status: ok ? 'PASS' : 'FAIL',
      note:   ok ? null : `fixture attend ${expected} · obtenu ${fConfSync}`,
    });
  }
  if (Array.isArray(fx.expects?.confidence_in)) {
    const expected = fx.expects.confidence_in;
    const ok = expected.includes(fConfSync);
    record(caseLabel, 'expects.confidence_in', expected.join('|'), fConfSync, {
      status: ok ? 'PASS' : 'FAIL',
      note:   ok ? null : `fixture attend l'un de ${expected.join(',')} · obtenu ${fConfSync}`,
    });
  }
}

function runCase(fx) {
  for (const phaseName of ['regular', 'playoff']) {
    runCaseForPhase(fx, phaseName);
  }
}

// ── EXÉCUTION ────────────────────────────────────────────────────────────────

function main() {
  console.log('NBA engine parity check · MBP-A.2 CRIT-1 · couverture MED-1 dédiée');
  console.log(`Phase NBA détectée (date courante) · ${backend._botGetNBAPhase()}`);
  console.log('');

  // Parité poids · avant tout test fixture
  try {
    checkWeightsParity();
  } catch (err) {
    console.error(`EXCEPTION weights parity · ${err.stack}`);
    results.push({
      case: 'weights_parity', field: '__runner__',
      backend: 'EXCEPTION', frontend: String(err.message),
      status: 'FAIL', note: 'erreur lecture poids · voir stack',
    });
  }

  for (const fx of FIXTURES) {
    try {
      runCase(fx);
    } catch (err) {
      results.push({
        case:   fx.id, field: '__runner__',
        backend: 'EXCEPTION', frontend: String(err.message),
        status: 'FAIL', note: 'erreur exécution cas · voir stack',
      });
      console.error(`EXCEPTION case=${fx.id} · ${err.stack}`);
    }
  }

  // ── REPORT ────────────────────────────────────────────────────────────────
  const fails  = results.filter(r => r.status === 'FAIL');
  const knowns = results.filter(r => r.status === 'KNOWN-DIVERGENCE');
  const passes = results.filter(r => r.status === 'PASS');

  console.log('Résultats par cas :');
  console.log('-'.repeat(120));
  const caseGrouped = {};
  for (const r of results) {
    if (!caseGrouped[r.case]) caseGrouped[r.case] = [];
    caseGrouped[r.case].push(r);
  }
  for (const [caseName, items] of Object.entries(caseGrouped)) {
    const failsCount  = items.filter(i => i.status === 'FAIL').length;
    const knownsCount = items.filter(i => i.status === 'KNOWN-DIVERGENCE').length;
    const passesCount = items.filter(i => i.status === 'PASS').length;
    const symbol = failsCount > 0 ? 'FAIL' : (knownsCount > 0 ? 'WARN' : 'PASS');
    console.log(`  ${symbol.padEnd(5)} · ${caseName.padEnd(38)} · pass=${passesCount} · known=${knownsCount} · fail=${failsCount}`);
  }

  if (fails.length > 0) {
    console.log('');
    console.log('Échecs détaillés :');
    console.log('-'.repeat(120));
    for (const f of fails) {
      console.log(`  FAIL · ${f.case} · ${f.field}`);
      console.log(`    backend  = ${JSON.stringify(f.backend)}`);
      console.log(`    frontend = ${JSON.stringify(f.frontend)}`);
      if (f.diff !== null && f.diff !== undefined) console.log(`    diff     = ${f.diff}`);
      if (f.note) console.log(`    note     = ${f.note}`);
    }
  }

  if (knowns.length > 0) {
    console.log('');
    console.log('Divergences connues (non bloquantes) :');
    console.log('-'.repeat(120));
    const byNote = {};
    for (const k of knowns) {
      const key = k.note ?? '(sans note)';
      byNote[key] = (byNote[key] ?? 0) + 1;
    }
    for (const [note, count] of Object.entries(byNote)) {
      console.log(`  ${count}x · ${note}`);
    }
    const b2bKnown = knowns.filter(k => k.field.includes('back_to_back'));
    if (b2bKnown.length > 0) {
      console.log('');
      console.log('  Détail back_to_back (MED-1) :');
      for (const k of b2bKnown.slice(0, 6)) {
        console.log(`    ${k.case} · ${k.field} · backend=${k.backend} · frontend=${k.frontend}`);
      }
    }
  }

  console.log('');
  console.log('Résumé :');
  console.log(`  ${passes.length} passed`);
  console.log(`  ${knowns.length} known-divergence (documentées · non bloquantes)`);
  console.log(`  ${fails.length} failed`);
  console.log('');

  if (fails.length > 0) {
    console.log('Résultat · FAIL · régression critique détectée backend ↔ frontend');
    process.exit(1);
  } else {
    console.log('Résultat · OK · backend et frontend cohérents (modulo divergences documentées)');
    process.exit(0);
  }
}

main();
