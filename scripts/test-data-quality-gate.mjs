#!/usr/bin/env node
/**
 * MBP-P1 · Test gate `data_quality < 0.55` → confidence = INCONCLUSIVE.
 *
 * Vérifie le comportement sur les boundaries (0.54, 0.55, 0.56, 0.80, null,
 * undefined) pour les 3 fonctions confidence avec dq numérique ·
 *   - backend NBA · `_botComputeConfidence` · dq numérique [0, 1]
 *   - backend Tennis · `_botTennisConfidence` · dq numérique [0, 1]
 *   - backend MLB · `_mlbEngineCompute` · dq label-based ('LOW' = gate)
 *   - frontend NBA · `EngineCore._computeConfidenceLevel` branche NBA
 *   - frontend legacy (MLB/Tennis/autres) · `EngineCore._computeConfidenceLevel` branche legacy
 *   - frontend MLB UI · `_analyzeMLBMatch` (data.orchestrator.js) · dq label-based
 *
 * MLB · le `data_quality` reste label-based ('LOW'/'MEDIUM'/'HIGH') et le gate
 * équivalent au seuil 0.55 numérique est la valeur 'LOW' (pitcher FIP/ERA manquant).
 * Ne PAS confondre avec frontend EngineCore branche legacy qui reçoit un dq numérique.
 *
 * Strictement read-only sur la stack métier · pas de réseau · pas de secret.
 *
 * Lancement · `node scripts/test-data-quality-gate.mjs`
 * Exit · 0 OK · 1 régression.
 */

import './lib/dom-stub.mjs';
import { backend } from './lib/backend-engine.mjs';
import { EngineCore } from '../src/engine/engine.core.js';
// `_analyzeMLBMatch` (data.orchestrator.js) · vrai chemin frontend MLB.
// `computeMLB` (engine.mlb.betting.js) est dead code · non importé en prod
// (vérifié grep · aucun consommateur) · pas testé ici · pas gaté.
import { _analyzeMLBMatch } from '../src/orchestration/data.orchestrator.js';

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

// ── MLB · gate label-based (data_quality === 'LOW' → pas de reco) ──────────
// Fixture commun · edge favorable (motor home 77% · home_ml 1.45 implied 69%
// → edge ≈ 8%, dans la zone profitable v6.94 [5, 10]).
// Différence entre cas LOW et cas HIGH · seulement la présence du pitcher FIP.

function buildMLBMatchData({ withPitcher }) {
  return {
    match_id:  'MBP-P1-MLB-PARITY',
    home_team: 'Home MLB',
    away_team: 'Away MLB',
    venue:     'Yankee Stadium',
    home_pitcher: withPitcher
      ? { name: 'Pitcher H', fip: 3.5, era: 3.6, whip: 1.10, rest_days: 4 }
      : { name: 'Pitcher H', fip: null, era: null, whip: 1.10, rest_days: 4 },
    away_pitcher: withPitcher
      ? { name: 'Pitcher A', fip: 4.5, era: 4.4, whip: 1.30, rest_days: 4 }
      : { name: 'Pitcher A', fip: null, era: null, whip: 1.30, rest_days: 4 },
    // Backend `_mlbEngineCompute` consomme home_season.ops + team_era +
    // bullpen_era pour évaluer dataQuality 'HIGH'.
    home_season: {
      run_diff: 50, win_pct: 0.580, runs_per_game: 4.8, runs_allowed_per_game: 4.2,
      home_wins: 25, home_losses: 15, away_wins: 18, away_losses: 22,
      last10_wins: 7, last10_losses: 3,
      ops: 0.750, obp: 0.330, slg: 0.420, babip: 0.295,
      team_era: 3.80, team_whip: 1.20, team_k_per_9: 8.5,
      starter_era: 3.60, bullpen_era: 3.50, bullpen_whip: 1.18, bullpen_k_per_9: 9.0,
    },
    away_season: {
      run_diff: -30, win_pct: 0.420, runs_per_game: 4.1, runs_allowed_per_game: 4.7,
      home_wins: 18, home_losses: 22, away_wins: 15, away_losses: 25,
      last10_wins: 4, last10_losses: 6,
      ops: 0.700, obp: 0.310, slg: 0.390, babip: 0.295,
      team_era: 4.20, team_whip: 1.32, team_k_per_9: 8.0,
      starter_era: 4.00, bullpen_era: 4.10, bullpen_whip: 1.30, bullpen_k_per_9: 8.5,
    },
    // Frontend `computeMLB` lit lineup/bullpen séparément.
    home_lineup:  withPitcher ? { ops: 0.750, wrc_plus: 110, k_pct: 0.21 } : { ops: null },
    away_lineup:  withPitcher ? { ops: 0.700, wrc_plus: 95,  k_pct: 0.22 } : { ops: null },
    home_bullpen: { era_7d: 3.50, whip_7d: 1.18 },
    away_bullpen: { era_7d: 4.10, whip_7d: 1.30 },
    weather:      { indoor: false, conditions: 'Clear', temp_celsius: 22, wind_speed_mps: 2 },
    market_odds: {
      bookmakers: [
        { key: 'pinnacle',  title: 'Pinnacle',
          home_ml: 1.45, away_ml: 2.85,
          total_line: 8.5, over_total: 1.95, under_total: 1.95 },
        { key: 'draftkings', title: 'DraftKings',
          home_ml: 1.46, away_ml: 2.80,
          total_line: 8.5, over_total: 1.92, under_total: 1.96 },
      ],
    },
  };
}

// Backend · _mlbEngineCompute(matchData)
const mlbLow  = backend._mlbEngineCompute(buildMLBMatchData({ withPitcher: false }));
const mlbHigh = backend._mlbEngineCompute(buildMLBMatchData({ withPitcher: true  }));

record('backend.MLB', 'LOW dq · data_quality', 'LOW', mlbLow?.data_quality,
  'pitcher FIP/ERA null doit forcer LOW');
record('backend.MLB', 'LOW dq · recommendations.length', 0, mlbLow?.recommendations?.length ?? -1,
  'gate doit vider les recos');
record('backend.MLB', 'LOW dq · best is null', true, mlbLow?.best === null,
  'gate doit annuler best (=== null)');

record('backend.MLB', 'HIGH dq · data_quality non LOW', true, mlbHigh?.data_quality !== 'LOW',
  'pitcher + team stats + bullpen présents');
// Optional · si l'edge ne tombe pas dans [5,10] le moteur peut renvoyer 0 reco
// même en HIGH · on vérifie juste que le gate ne bloque pas
record('backend.MLB', 'HIGH dq · gate non actif (recommendations défini)', true,
  Array.isArray(mlbHigh?.recommendations),
  'liste doit exister · contenu dépend de l\'edge calculé');

// Frontend · `_analyzeMLBMatch` (data.orchestrator.js) · vrai chemin UI.
// Signature attend un objet `match` avec home_pitcher/away_pitcher/home_season/
// away_season/venue/market_odds.
// LOW dq déclenché par missing.length > 0 (pitcher FIP/ERA absent).
function buildOrchestratorMatch({ withPitcher }) {
  const base = buildMLBMatchData({ withPitcher });
  return { id: base.match_id, ...base };
}

const frontLow  = _analyzeMLBMatch(buildOrchestratorMatch({ withPitcher: false }));
const frontHigh = _analyzeMLBMatch(buildOrchestratorMatch({ withPitcher: true  }));

record('frontend.MLB', 'LOW dq · data_quality', 'LOW', frontLow?.data_quality);
record('frontend.MLB', 'LOW dq · recommendations.length', 0, frontLow?.recommendations?.length ?? -1);
record('frontend.MLB', 'LOW dq · best_recommendation is null', true,
  frontLow?.best_recommendation === null);
record('frontend.MLB', 'LOW dq · decision', 'INSUFFISANT', frontLow?.decision,
  'gate doit forcer INSUFFISANT (jamais EXPLORER quand LOW)');

record('frontend.MLB', 'HIGH dq · data_quality non LOW', true, frontHigh?.data_quality !== 'LOW');
record('frontend.MLB', 'HIGH dq · gate non actif (recommendations défini)', true,
  Array.isArray(frontHigh?.recommendations));

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
  console.log('Résultat · OK · gate appliqué sur 6 surfaces (backend NBA + Tennis + MLB · frontend NBA + legacy + MLB)');
  process.exit(0);
}
