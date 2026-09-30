#!/usr/bin/env node
/**
 * Backend NBA absences_confirmed parity.
 *
 * Regression:
 * _botGetInjuriesForTeam() returns [] when the provider payload contains only
 * unrelated teams. The old backend used "homeInjuries !== null || awayInjuries
 * !== null", so an unrelated report incorrectly marked absences as confirmed.
 *
 * Canonical semantics:
 * absences_confirmed=true only when the merged relevant HOME or AWAY injury list
 * contains at least one player. This matches DataOrchestrator.buildRawData().
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', 'worker.js');
const source = readFileSync(WORKER_PATH, 'utf8');

let assertions = 0;
let failures = 0;
const assert = (cond, msg) => {
  assertions++;
  if (!cond) { failures++; console.error('  ✗', msg); }
};
const eq = (a, e, msg) => assert(Object.is(a, e), `${msg} · expected=${JSON.stringify(e)} actual=${JSON.stringify(a)}`);

const exportIdx = source.indexOf('export default {');
if (exportIdx < 0) throw new Error('worker.js export default introuvable');
const patched = source.slice(0, exportIdx) +
  'globalThis.__mbp_handlers = {' +
  source.slice(exportIdx + 'export default {'.length);

const sandbox = {
  globalThis: {},
  console: { log: () => {}, warn: () => {}, error: () => {} },
  crypto: globalThis.crypto,
  Date, Math, Object, Array, Map, Set, JSON, String, Number, Boolean,
  Error, TypeError, RangeError, Promise,
  setTimeout, clearTimeout, setInterval, clearInterval,
  URL, URLSearchParams, Intl,
  Response: class Response {}, Request: class Request {}, Headers: class Headers {},
  fetch: async () => { throw new Error('fetch not allowed'); },
  atob, btoa, TextEncoder, TextDecoder,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(patched, sandbox, { filename: 'worker.js' });

const P = (name) => ({ name, status: 'Out', source: 'espn' });

eq(sandbox._botHasRelevantAbsences([P('Home Star')], []), true,
  'home pertinent non-vide => confirmé');
eq(sandbox._botHasRelevantAbsences([], [P('Away Star')]), true,
  'away pertinent non-vide => confirmé');
eq(sandbox._botHasRelevantAbsences([P('Home Star')], [P('Away Star')]), true,
  'home+away non-vides => confirmé');
eq(sandbox._botHasRelevantAbsences([], []), false,
  'deux listes vides => non confirmé');
eq(sandbox._botHasRelevantAbsences(null, null), false,
  'sources absentes => non confirmé');
eq(sandbox._botHasRelevantAbsences(null, []), false,
  'une source absente + aucune absence pertinente => non confirmé');

// Cas critique audit : provider a répondu, mais seulement pour une autre équipe.
const unrelated = {
  by_team: {
    'Boston Celtics': { players_weighted: [P('Unrelated Player')] }
  }
};
const home = sandbox._botGetInjuriesForTeam(unrelated, 'Oklahoma City Thunder');
const away = sandbox._botGetInjuriesForTeam(unrelated, 'San Antonio Spurs');
eq(Array.isArray(home) && home.length, 0,
  'payload unrelated => home normalisé en []');
eq(Array.isArray(away) && away.length, 0,
  'payload unrelated => away normalisé en []');
eq(sandbox._botHasRelevantAbsences(home, away), false,
  'payload unrelated ne franchit plus absences_confirmed');

// La décision backend doit utiliser les listes MERGÉES, pour rester alignée avec
// le rapport fusionné côté orchestrateur frontend.
assert(
  source.includes('absences_confirmed:  _botHasRelevantAbsences(mergedHome, mergedAway)'),
  'worker canonical · absences_confirmed utilise mergedHome/mergedAway'
);
assert(
  !source.includes('absences_confirmed:  homeInjuries !== null || awayInjuries !== null'),
  'ancienne sémantique non-null supprimée'
);

console.log('\nNBA backend absences_confirmed parity');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ tous les cas OK\n');
