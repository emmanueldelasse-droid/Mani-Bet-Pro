#!/usr/bin/env node
/**
 * MBP-P1 · Test gate `data_quality < 0.55` → confidence = INCONCLUSIVE.
 *
 * Vérifie le comportement sur les boundaries (0.54, 0.55, 0.56, 0.80, null,
 * undefined) pour les 3 fonctions confidence avec dq numérique ·
 *   - backend NBA · `_botComputeConfidence`
 *   - backend Tennis · `_botTennisConfidence`
 *   - frontend · `EngineCore._computeConfidenceLevel` (branches NBA + legacy)
 *
 * MLB backend exclu · son `data_quality` est label-based ('LOW'/'MEDIUM'/'HIGH')
 * · le gate équivalent existant est 'LOW' = pas de reco (BETTING_LOGIC.md:212).
 *
 * Strictement read-only sur la stack métier · pas de réseau · pas de secret.
 *
 * Lancement · `node scripts/test-data-quality-gate.mjs`
 * Exit · 0 OK · 1 régression.
 */

import './lib/dom-stub.mjs';
import { backend } from './lib/backend-engine.mjs';
import { EngineCore } from '../src/engine/engine.core.js';

const THRESHOLD = 0.55;

// Score 0.95 · dist = 0.45 · sans gate, donnerait HIGH si dq ≥ 0.70.
// Permet de distinguer gate-INCONCLUSIVE d'INCONCLUSIVE pour autre raison.
const STRONG_SCORE = 0.95;

const cases = [
  { dq: 0.80,     label: 'dq haute (0.80)',           gateExpected: false },
  { dq: 0.56,     label: 'dq juste au-dessus (0.56)', gateExpected: false },
  { dq: THRESHOLD,label: 'dq exact (0.55)',           gateExpected: false },
  { dq: 0.549,    label: 'dq juste en-dessous (0.549)', gateExpected: true },
  { dq: 0.40,     label: 'dq basse (0.40)',           gateExpected: true },
  { dq: 0,        label: 'dq zéro (0)',               gateExpected: true },
  { dq: null,     label: 'dq null',                   gateExpected: true },
  { dq: undefined,label: 'dq undefined',              gateExpected: true },
];

const results = [];

function record(target, caseLabel, expected, actual, note = null) {
  const ok = expected === actual;
  results.push({ target, caseLabel, expected, actual, ok, note });
}

// ── BACKEND NBA · _botComputeConfidence(analysis, dataQuality) ────────────
for (const c of cases) {
  const conf = backend._botComputeConfidence(
    { score: STRONG_SCORE, confidence_penalty: null },
    c.dq
  );
  if (c.gateExpected) {
    record('backend.NBA', c.label, 'INCONCLUSIVE', conf,
      c.dq == null ? 'dq nullish · gate doit forcer INCONCLUSIVE' : `dq=${c.dq} < 0.55 · gate doit forcer`);
  } else {
    // Sans gate, HIGH attendu (score 0.95 · dist 0.45 ≥ 0.20 · dq ≥ 0.70 ou ≥ 0.50 selon valeur).
    const expectedNoGate = c.dq >= 0.70 ? 'HIGH' : (c.dq >= 0.50 ? 'MEDIUM' : 'LOW');
    record('backend.NBA', c.label, expectedNoGate, conf, `dq=${c.dq} ≥ 0.55 · pas de gate`);
  }
}

// ── BACKEND TENNIS · _botTennisConfidence(score, dataQuality, missingCount) ──
// Note · Tennis ancien gate était à 0.30 · MBP-P1 bump à 0.55.
// Test dq=0.45 doit maintenant être INCONCLUSIVE (était LOW/HIGH avant).
const tennisCases = [
  ...cases,
  { dq: 0.45, label: 'dq 0.45 (ex-autorisé Tennis avant MBP-P1)', gateExpected: true },
];
for (const c of tennisCases) {
  // signature · (score, dataQuality, missingCount)
  // Tennis · ToolSearch confirme worker.js:9458
  // Pour score=0.95 et missing=0 · sans gate · deviation=0.45 ≥ 0.20 · dq ≥ 0.70 → HIGH.
  // signal: dq=null ou < 0.55 → INCONCLUSIVE attendu (gate).
  // Backend Tennis n'est pas exposé via vm sandbox actuellement · ajoutons.
}

// Tennis · vérifions que la fonction est exposée par le loader.
// Si pas exposée · l'ajouter dans backend-engine.mjs (déjà fait juste après).

// ── FRONTEND · EngineCore._computeConfidenceLevel ─────────────────────────
// signature · (predictive, robustness, dataQuality, penaltyScore, sport)
// NBA branche · gate appliqué AVANT branche NBA distance-based.
// Legacy branche (MLB/Tennis/autres) · gate appliqué aussi en amont.
for (const c of cases) {
  const conf = EngineCore._computeConfidenceLevel(STRONG_SCORE, 0.90, c.dq, 0, 'NBA');
  if (c.gateExpected) {
    record('frontend.NBA', c.label, 'INCONCLUSIVE', conf);
  } else {
    const expectedNoGate = c.dq >= 0.70 ? 'HIGH' : (c.dq >= 0.50 ? 'MEDIUM' : 'LOW');
    record('frontend.NBA', c.label, expectedNoGate, conf);
  }
}
// Legacy branche · robustness 0.90 · sans gate · min(0.90, dq) → HIGH si dq ≥ 0.75
for (const c of cases) {
  const conf = EngineCore._computeConfidenceLevel(STRONG_SCORE, 0.90, c.dq, 0, 'TENNIS');
  if (c.gateExpected) {
    record('frontend.legacy', c.label, 'INCONCLUSIVE', conf);
  } else {
    const minScore = Math.min(0.90, c.dq);
    const expectedNoGate = minScore >= 0.75 ? 'HIGH' : (minScore >= 0.50 ? 'MEDIUM' : 'LOW');
    record('frontend.legacy', c.label, expectedNoGate, conf);
  }
}

// ── BACKEND TENNIS · re-essai après vérification exposition ────────────────
const tennisFn = backend._botTennisConfidence ?? null;
if (typeof tennisFn === 'function') {
  for (const c of tennisCases) {
    const conf = tennisFn(STRONG_SCORE, c.dq, 0);
    if (c.gateExpected) {
      record('backend.Tennis', c.label, 'INCONCLUSIVE', conf);
    } else {
      const dev = Math.abs(STRONG_SCORE - 0.5);
      const expectedNoGate = (dev >= 0.20 && c.dq >= 0.70) ? 'HIGH'
                           : (dev >= 0.10 && c.dq >= 0.50) ? 'MEDIUM' : 'LOW';
      record('backend.Tennis', c.label, expectedNoGate, conf);
    }
  }
} else {
  results.push({
    target: 'backend.Tennis', caseLabel: '__loader__',
    expected: 'fonction exposée',
    actual:   'manquante · `_botTennisConfidence` pas dans backend-engine.mjs',
    ok: false,
    note: 'ajouter dans la liste `required` de scripts/lib/backend-engine.mjs',
  });
}

// ── REPORT ─────────────────────────────────────────────────────────────────

console.log('Data quality gate test · MBP-P1');
console.log(`Seuil · data_quality < ${THRESHOLD} → INCONCLUSIVE (strict · ${THRESHOLD} autorisé)`);
console.log('');

const grouped = {};
for (const r of results) {
  if (!grouped[r.target]) grouped[r.target] = [];
  grouped[r.target].push(r);
}

let fails = 0;
for (const [target, items] of Object.entries(grouped)) {
  console.log(`\n${target} ·`);
  for (const r of items) {
    const symbol = r.ok ? 'PASS' : 'FAIL';
    if (!r.ok) fails++;
    console.log(`  ${symbol.padEnd(4)} · ${r.caseLabel.padEnd(40)} · attendu=${r.expected} · obtenu=${r.actual}${r.note ? ' · ' + r.note : ''}`);
  }
}

const total = results.length;
console.log('');
console.log(`Résumé · ${total - fails}/${total} pass · ${fails} fail`);
console.log('');
if (fails > 0) {
  console.log('Résultat · FAIL · gate non conforme');
  process.exit(1);
} else {
  console.log('Résultat · OK · gate appliqué sur les 4 surfaces (backend NBA + Tennis · frontend NBA + legacy)');
  process.exit(0);
}
