#!/usr/bin/env node
/**
 * MBP-PLAYOFF-GATE-FIX (Fix #2 · alignement front↔backend) · tests
 * `absences_confirmed` côté frontend dans DataOrchestrator.buildRawData.
 *
 * Avant le fix : `absences_confirmed = injuryReport !== null` (booléen GLOBAL).
 * Après le fix : défini PAR ÉQUIPE, aligné sur le backend
 *   (worker.js _botAnalyzeMatch:3654 · `homeInjuries !== null || awayInjuries !== null`).
 *
 * Les 5 cas obligatoires de la mission :
 *   Cas 1 · rapport avec absences home ou away        → true
 *   Cas 2 · rapport non-null mais aucune donnée équipe → false  (← changement clé)
 *   Cas 3 · home présent, away absent                  → true
 *   Cas 4 · home absent, away présent                  → true
 *   Cas 5 · home + away absents (ou rapport null)       → false
 *
 * Cas témoin : San Antonio Spurs @ Oklahoma City Thunder (20260518).
 *
 * Strictement read-only sur la stack métier · pas de réseau · pas de secret.
 *
 * Lancement · `node scripts/test-absences-confirmed-front.mjs`
 * Exit · 0 OK · 1 régression.
 */

import './lib/dom-stub.mjs';
import { DataOrchestrator } from '../src/orchestration/data.orchestrator.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); }
}

// ── Match témoin · OKC (home) vs SAS (away) ────────────────────────────────
const HOME = 'Oklahoma City Thunder';
const AWAY = 'San Antonio Spurs';
const MATCH = {
  id: '401873197',
  date: '2026-05-18',
  home_team: { name: HOME },
  away_team: { name: AWAY },
};
const NO_FORMS = {};
const NO_ADV   = null;

function absConfirmed(injuryReport) {
  const raw = DataOrchestrator.buildRawData(MATCH, NO_FORMS, injuryReport, NO_ADV);
  return raw.absences_confirmed;
}

// Fixtures rapports
const PLAYER = (name) => ({ name, status: 'Out', ppg: 20, impact_weight: 0.18 });

// ── Cas 1 · absences home ET away → true ───────────────────────────────────
{
  const report = { by_team: { [HOME]: [PLAYER('SGA')], [AWAY]: [PLAYER('Wembanyama')] }, source: 'x' };
  const v = absConfirmed(report);
  check('Cas1 · home+away présents → true', v === true);
}

// ── Cas 2 · rapport non-null mais aucune équipe exploitable → false ─────────
{
  // Rapport global existe (autres équipes) mais ni OKC ni SAS dedans.
  const report = { by_team: { 'Boston Celtics': [PLAYER('Tatum')] }, source: 'x' };
  const v = absConfirmed(report);
  check('Cas2 · rapport non-null sans OKC/SAS → false (NOUVEAU)', v === false);
  check('Cas2 · type strictement booléen', typeof v === 'boolean');
}

// ── Cas 2bis · rapport présent mais by_team vide → false ───────────────────
{
  const report = { by_team: {}, source: 'x' };
  check('Cas2bis · by_team vide → false', absConfirmed(report) === false);
}

// ── Cas 3 · home présent, away absent → true ───────────────────────────────
{
  const report = { by_team: { [HOME]: [PLAYER('SGA')] }, source: 'x' };
  check('Cas3 · home seul → true', absConfirmed(report) === true);
}

// ── Cas 4 · home absent, away présent → true ───────────────────────────────
{
  const report = { by_team: { [AWAY]: [PLAYER('Wembanyama')] }, source: 'x' };
  check('Cas4 · away seul → true', absConfirmed(report) === true);
}

// ── Cas 5a · home + away listés mais tableaux vides → false ────────────────
{
  const report = { by_team: { [HOME]: [], [AWAY]: [] }, source: 'x' };
  check('Cas5a · équipes présentes mais 0 joueur → false', absConfirmed(report) === false);
}

// ── Cas 5b · rapport null → false ──────────────────────────────────────────
{
  check('Cas5b · injuryReport null → false', absConfirmed(null) === false);
}

// ── Vérif alignement backend · définition par équipe identique ─────────────
// Backend : homeInjuries !== null || awayInjuries !== null (non-vide par équipe).
// On vérifie que le front produit le MÊME verdict que la règle backend.
{
  const backendVerdict = (report) => {
    const h = report?.by_team?.[HOME] ?? [];
    const a = report?.by_team?.[AWAY] ?? [];
    return (h.length > 0) || (a.length > 0);
  };
  const samples = [
    { by_team: { [HOME]: [PLAYER('x')] } },
    { by_team: { [AWAY]: [PLAYER('y')] } },
    { by_team: { 'Boston Celtics': [PLAYER('z')] } },
    { by_team: {} },
    { by_team: { [HOME]: [], [AWAY]: [] } },
  ];
  let aligned = true;
  for (const s of samples) {
    if (absConfirmed(s) !== backendVerdict(s)) aligned = false;
  }
  check('Alignement · front == backend (par équipe) sur 5 échantillons', aligned);
}

// ── Bilan ───────────────────────────────────────────────────────────────────
console.log(`\nabsences_confirmed front · Fix #2 alignement front↔backend`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\n  Échecs :');
  failures.forEach(f => console.log(`   ✗ ${f}`));
  process.exit(1);
}
console.log('  ✓ tous les cas OK (5 obligatoires + gardes + alignement)\n');
process.exit(0);
