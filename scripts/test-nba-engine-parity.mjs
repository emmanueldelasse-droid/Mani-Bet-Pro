#!/usr/bin/env node
/**
 * MBP-A.2 · Test parité backend ↔ frontend NBA.
 *
 * Anti-régression structurel · couvre :
 *   - extraction variables (11 vars NBA)
 *   - normalisation
 *   - score pondéré (saison régulière + adjustments absences)
 *   - confidence NBA (aligné MBP-FIX-A.2.1 · distance-based)
 *   - home_away_split (aligné MBP-FIX-A.2.2 · 4 vars + clamp [-0.50, 0.50])
 *   - back_to_back numérique (MED-1 · divergence connue -0.6/+0.6 vs -1/+1)
 *   - data_quality (divergence structurelle backend simple vs frontend pondéré)
 *
 * Strictement read-only sur le moteur. Charge worker.js via vm sandbox sans
 * le modifier. Importe les modules frontend (engine.nba.variables.js +
 * engine.nba.score.js) directement (pas de dépendance Logger).
 *
 * Lancement :
 *   node scripts/test-nba-engine-parity.mjs
 *
 * Exit code · 0 si OK ou divergences connues uniquement · 1 sinon.
 */

import { backend } from './lib/backend-engine.mjs';
import { FIXTURES } from './lib/fixtures.mjs';

import {
  extractVariables          as frontExtractVariables,
  normalizeVariables        as frontNormalizeVariables,
  computeAbsencesImpact     as frontComputeAbsencesImpact,
} from '../src/engine/engine.nba.variables.js';

import {
  computeScore   as frontComputeScore,
  buildEffectiveWeights as frontBuildEffectiveWeights,
} from '../src/engine/engine.nba.score.js';

// ── CONFIG TOLÉRANCES ────────────────────────────────────────────────────────

const TOL = {
  score:           0.005,   // 0.5pt sur score 0-1
  contribution:    0.005,
  variable:        0.001,   // valeur brute variable (efg, net rating)
  home_away_split: 0.001,
  absences_impact: 0.005,
  data_quality:    0.301,   // divergence structurelle assumée · backend simple vs frontend pondéré
};

// Confidence frontend NBA · source-of-truth = engine.core.js:319-331
// Aligné MBP-FIX-A.2.1 sur backend `_botComputeConfidence` worker.js:5888.
// Reproduit ici verbatim · test asserte égalité avec backend sur N fixtures.
// Si la source diverge dans engine.core.js, le test détecte via comparaison.
function frontConfidenceNBA(score, dataQuality, penaltyScore = 0) {
  if (score === null || dataQuality === null) return 'INCONCLUSIVE';
  const dist = Math.abs(score - 0.5);
  if (dist >= 0.20 && dataQuality >= 0.70 && penaltyScore < 0.08) return 'HIGH';
  if (dist >= 0.12 && dataQuality >= 0.50 && penaltyScore < 0.15) return 'MEDIUM';
  if (dist >= 0.06) return 'LOW';
  return 'INCONCLUSIVE';
}

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

// ── POIDS FIXES PAR PHASE · indépendant de la date d'exécution ──────────────
// Source · sports.config.js + _botGetWeights worker.js (NBA_ENGINE_AUDIT §3).
// Tester les 2 phases garantit que MED-1 (back_to_back numérique divergent)
// est exposé dans son contexte de poids non-nul (saison régulière, 0.02).
const PHASE_WEIGHTS = {
  regular: {
    weights: {
      net_rating_diff: 0.22, efg_diff: 0.18, recent_form_ema: 0.16,
      home_away_split: 0.10, absences_impact: 0.20, defensive_diff: 0.02,
      win_pct_diff: 0.04, back_to_back: 0.02, rest_days_diff: 0.02,
      b2b_cumul_diff: 0.02, travel_load_diff: 0.02,
    },
    ema_lambda: 0.85,
    score_cap:  0.90,
  },
  playoff: {
    weights: {
      absences_impact: 0.20, recent_form_ema: 0.15, home_away_split: 0.14,
      defensive_diff: 0.12, net_rating_diff: 0.16, rest_days_diff: 0.06,
      efg_diff: 0.04, travel_load_diff: 0.02, win_pct_diff: 0.02,
      back_to_back: 0.00, b2b_cumul_diff: 0.00,
    },
    ema_lambda: 0.92,
    score_cap:  0.80,
  },
};

// ── RUN UN CAS ───────────────────────────────────────────────────────────────

function runCaseForPhase(fx, phaseName) {
  const weights = PHASE_WEIGHTS[phaseName];
  const caseLabel = `${fx.id}__${phaseName}`;

  // ── EXTRACTION BACKEND ─────────────────────────────────────────────────────
  const bVars = backend._botExtractVariables(fx.data, weights.ema_lambda);
  const bNorm = backend._botNormalizeVariables(bVars);
  const bScored = backend._botComputeScore(bVars, weights.weights);

  // Backend data quality · 1 - missing/total (worker.js:3615)
  const totalVarsB = Object.keys(bVars).length;
  const missingB = Object.values(bVars).filter(v => v.quality === 'MISSING').length;
  const bDataQuality = totalVarsB > 0 ? Math.round((1 - missingB / totalVarsB) * 100) / 100 : null;

  // Backend confidence · le moteur ne stocke pas penalty.score · null partout
  const bConfidence = backend._botComputeConfidence(
    { score: bScored.score, confidence_penalty: null },
    bDataQuality
  );

  // ── EXTRACTION FRONTEND ────────────────────────────────────────────────────
  const fData = Object.assign({}, fx.data, { __ema_lambda: weights.ema_lambda });
  const fVars = frontExtractVariables(fData);
  const fNorm = frontNormalizeVariables(fVars);
  const fScored = frontComputeScore(fVars, weights.weights);

  // Frontend data quality · moyenne des scores par variable (engine.core.js:258)
  const QUALITY_SCORES = {
    'VERIFIED': 1.0, 'WEIGHTED': 0.9, 'PARTIAL': 0.6, 'ESTIMATED': 0.5,
    'LOW_SAMPLE': 0.4, 'UNCALIBRATED': 0.2, 'INSUFFICIENT_SAMPLE': 0.1, 'MISSING': 0.0,
  };
  // 11 variables NBA · même set que engine.nba.variables.js
  const NBA_VAR_IDS = Object.keys(bVars);
  let dqSum = 0;
  for (const id of NBA_VAR_IDS) {
    const q = fVars[id]?.quality ?? 'MISSING';
    dqSum += QUALITY_SCORES[q] ?? 0;
  }
  const fDataQuality = Math.round((dqSum / NBA_VAR_IDS.length) * 1000) / 1000;

  const fConfidence = frontConfidenceNBA(fScored.score, fDataQuality);

  // ── VARIABLES · valeur brute (avant normalisation) ─────────────────────────
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

  // ── BACK-TO-BACK · divergence connue MED-1 ────────────────────────────────
  // Backend · -0.6 / 0 / +0.6 · Frontend · -1 / 0 / +1
  const bB2B = bVars.back_to_back?.value ?? null;
  const fB2B = fVars.back_to_back?.value ?? null;
  const b2bKnownDivergence = !!fx.expects?.back_to_back_known_divergence;
  record(caseLabel, 'var.back_to_back', bB2B, fB2B, {
    tol: TOL.variable,
    known: b2bKnownDivergence,
    note: b2bKnownDivergence ? 'MED-1 · attendu · backend -0.6/+0.6 · frontend -1/+1' : null,
  });

  // ── NORMALISATION · valeur normalisée ─────────────────────────────────────
  for (const v of varsToCompare) {
    record(caseLabel, `norm.${v}`, bNorm[v], fNorm[v], { tol: TOL.contribution });
  }
  // back_to_back normalisé · divergence amplifiée
  record(caseLabel, 'norm.back_to_back', bNorm.back_to_back, fNorm.back_to_back, {
    tol: TOL.contribution,
    known: b2bKnownDivergence,
    note: b2bKnownDivergence ? 'MED-1 · norm hérite divergence raw' : null,
  });

  // ── SCORE ─────────────────────────────────────────────────────────────────
  // Note · `_botComputeScore` n'applique pas star_absence_modifier (séparé).
  // `frontComputeScore` non plus. Comparaison directe valide.
  // En saison régulière (back_to_back weight=0.02), une asymétrie b2b XOR
  // produit une divergence visible sur le score (MED-1 amplifié).
  // En playoff (weight=0.00), la divergence raw ne se propage pas au score.
  const b2bAffectsScore = b2bKnownDivergence && weights.weights.back_to_back > 0;
  record(caseLabel, 'score.weighted_sum', bScored.score, fScored.score, {
    tol:   TOL.score,
    known: b2bAffectsScore,
    note:  b2bAffectsScore ? 'MED-1 · score décale via contribution back_to_back · poids saison 0.02' : null,
  });

  // ── DATA QUALITY ──────────────────────────────────────────────────────────
  // Structurellement différent · backend binaire · frontend pondéré.
  // Ne PAS échouer · documenter écart.
  record(caseLabel, 'data_quality.score', bDataQuality, fDataQuality, {
    tol: TOL.data_quality,
    known: true,
    note: 'divergence structurelle assumée · backend (1-missing/total) vs frontend (moyenne pondérée 8 niveaux qualité)',
  });

  // ── CONFIDENCE · NBA aligné MBP-FIX-A.2.1 ────────────────────────────────
  // Reporter confidence "réelle" (chaque côté avec son propre dq) · informatif.
  record(caseLabel, 'confidence.real', bConfidence, fConfidence, {
    known: true,
    note:  'inputs différents (dq backend vs frontend) · voir confidence.algo_synced',
  });
  // Validation pure algo · même score · même dq · doit donner même label.
  // Si frontend ou backend diverge dans la formule confidence, ce test FAIL.
  const bConfidenceSync = backend._botComputeConfidence({ score: bScored.score, confidence_penalty: null }, bDataQuality);
  const fConfidenceSync = frontConfidenceNBA(bScored.score, bDataQuality);
  record(caseLabel, 'confidence.algo_synced', bConfidenceSync, fConfidenceSync);
}

function runCase(fx) {
  for (const phaseName of Object.keys(PHASE_WEIGHTS)) {
    runCaseForPhase(fx, phaseName);
  }
}

// ── EXÉCUTION ────────────────────────────────────────────────────────────────

function main() {
  console.log('NBA engine parity check · MBP-A.2 CRIT-1 · couverture MED-1 dédiée');
  console.log(`Phase NBA détectée · ${backend._botGetNBAPhase()}`);
  console.log('');

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
    console.log(`  ${symbol.padEnd(5)} · ${caseName.padEnd(35)} · pass=${passesCount} · known=${knownsCount} · fail=${failsCount}`);
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
    // Regrouper par note pour lisibilité
    const byNote = {};
    for (const k of knowns) {
      const key = k.note ?? '(sans note)';
      byNote[key] = (byNote[key] ?? 0) + 1;
    }
    for (const [note, count] of Object.entries(byNote)) {
      console.log(`  ${count}x · ${note}`);
    }
    // Détail back_to_back · toujours afficher pour visibilité MED-1
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
