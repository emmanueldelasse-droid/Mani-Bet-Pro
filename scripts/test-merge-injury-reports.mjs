#!/usr/bin/env node
/**
 * MBP-PLAYOFF-GATE-FIX (Fix #1 · audit Playoff Gate) · tests _mergeInjuryReports.
 *
 * Vérifie le correctif du court-circuit ESPN-null dans _mergeInjuryReports
 * (src/orchestration/data.orchestrator.js). Avant le fix, ESPN null faisait
 * retourner null même quand l'IA avait des absences → absences_confirmed false
 * → Playoff Gate déclenché → match exclu du History (Finales Est/Ouest
 * disparues).
 *
 * Les 4 cas obligatoires de la mission :
 *   Cas 1 · ESPN null  + IA by_team valide → injuryReport construit depuis IA, != null
 *   Cas 2 · ESPN valide + IA vide          → comportement actuel inchangé
 *   Cas 3 · ESPN valide + IA valide        → merge actuel conservé
 *   Cas 4 · ESPN null  + IA null           → injuryReport null (inchangé)
 *
 * Cas de garde supplémentaires (non-régression du fix) :
 *   5 · ESPN null + IA présente mais sans joueurs → null (inchangé, conservateur)
 *   6 · ESPN sans by_team + IA valide → construit depuis IA, != null
 *
 * Strictement read-only sur la stack métier · pas de réseau · pas de secret.
 *
 * Lancement · `node scripts/test-merge-injury-reports.mjs`
 * Exit · 0 OK · 1 régression.
 */

import './lib/dom-stub.mjs';
import { _mergeInjuryReports } from '../src/orchestration/data.orchestrator.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, cond) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); }
}

// ── Fixtures ──────────────────────────────────────────────────────────────
const ESPN_VALID = {
  by_team: {
    'Boston Celtics': [
      { name: 'Jayson Tatum', status: 'Day-To-Day', ppg: 27, impact_weight: 0.1, source: 'espn' },
    ],
  },
  source: 'espn_injuries_weighted',
};

const AI_VALID = {
  by_team: {
    'Boston Celtics':   [{ name: 'Jrue Holiday', status: 'OUT', ppg: 12 }],
    'Indiana Pacers':   [{ name: 'Tyrese Haliburton', status: 'OUT', ppg: 20 }],
  },
  team_context:  { 'Indiana Pacers': { note: 'road trip' } },
  market_signal: 'sharp_money_home',
};

const AI_EMPTY = { by_team: {}, team_context: {}, market_signal: null };

// ── Cas 1 · ESPN null + IA by_team valide → != null, construit depuis IA ───
{
  const r = _mergeInjuryReports(null, AI_VALID);
  check('Cas1 · résultat non-null', r !== null && r !== undefined);
  check('Cas1 · by_team présent', !!(r && r.by_team));
  check('Cas1 · joueurs IA home intégrés',
    !!(r && r.by_team['Boston Celtics'] &&
       r.by_team['Boston Celtics'].some(p => p.name === 'Jrue Holiday')));
  check('Cas1 · joueurs IA away intégrés',
    !!(r && r.by_team['Indiana Pacers'] &&
       r.by_team['Indiana Pacers'].some(p => p.name === 'Tyrese Haliburton')));
  // absences_confirmed = (injuryReport !== null) ⇒ true ⇒ Playoff Gate NON déclenché
  check('Cas1 · absences_confirmed deviendrait true', (r !== null) === true);
}

// ── Cas 2 · ESPN valide + IA vide → comportement inchangé ───────────────────
{
  const r = _mergeInjuryReports(ESPN_VALID, AI_EMPTY);
  check('Cas2 · résultat non-null', r !== null);
  check('Cas2 · by_team ESPN conservé',
    !!(r && r.by_team['Boston Celtics'] &&
       r.by_team['Boston Celtics'].some(p => p.name === 'Jayson Tatum')));
  check('Cas2 · pas de joueur IA ajouté (IA vide)',
    !!(r && r.by_team['Boston Celtics'] && r.by_team['Boston Celtics'].length === 1));
}

// ── Cas 3 · ESPN valide + IA valide → merge conservé ────────────────────────
{
  const r = _mergeInjuryReports(ESPN_VALID, AI_VALID);
  check('Cas3 · résultat non-null', r !== null);
  check('Cas3 · base ESPN conservée (Tatum)',
    !!(r && r.by_team['Boston Celtics'] &&
       r.by_team['Boston Celtics'].some(p => p.name === 'Jayson Tatum')));
  check('Cas3 · joueur IA home mergé (Holiday)',
    !!(r && r.by_team['Boston Celtics'] &&
       r.by_team['Boston Celtics'].some(p => p.name === 'Jrue Holiday')));
  check('Cas3 · équipe IA-only créée (Pacers)',
    !!(r && r.by_team['Indiana Pacers'] &&
       r.by_team['Indiana Pacers'].some(p => p.name === 'Tyrese Haliburton')));
  check('Cas3 · source mergée', r && r.source === 'espn_injuries_weighted+ai');
}

// ── Cas 4 · ESPN null + IA null → null (inchangé) ───────────────────────────
{
  const r = _mergeInjuryReports(null, null);
  check('Cas4 · résultat null (inchangé)', r === null);
}

// ── Cas 5 (garde) · ESPN null + IA présente mais sans joueurs → null ────────
{
  const r = _mergeInjuryReports(null, AI_EMPTY);
  check('Cas5 · ESPN null + IA sans joueurs → null (conservateur)', r === null);
}

// ── Cas 6 (garde) · ESPN sans by_team + IA valide → construit depuis IA ─────
{
  const r = _mergeInjuryReports({ source: 'espn_empty' }, AI_VALID);
  check('Cas6 · ESPN sans by_team + IA valide → non-null', r !== null && r !== undefined);
  check('Cas6 · joueurs IA intégrés',
    !!(r && r.by_team && r.by_team['Indiana Pacers'] &&
       r.by_team['Indiana Pacers'].some(p => p.name === 'Tyrese Haliburton')));
}

// ── Bilan ───────────────────────────────────────────────────────────────────
console.log(`\n_mergeInjuryReports · Fix #1 ESPN-null`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\n  Échecs :');
  failures.forEach(f => console.log(`   ✗ ${f}`));
  process.exit(1);
}
console.log('  ✓ tous les cas OK (4 obligatoires + 2 gardes)\n');
process.exit(0);
