/**
 * Backend NBA engine loader (test-only).
 *
 * Charge worker.js comme texte · neutralise `export default {...}` · évalue
 * dans un sandbox vm pour exposer les fonctions pures `_bot*` utilisées par
 * le moteur NBA backend (cron `_runBotCron`).
 *
 * Aucune modification de worker.js requise. Aucun appel réseau. Aucun secret.
 * Strictement read-only : si worker.js change de structure, l'évaluation peut
 * casser · le test signalera "FAIL backend loader" plutôt que de masquer.
 *
 * Fonctions exposées :
 *   _botGetNBAPhase
 *   _botGetWeights
 *   _botExtractVariables
 *   _botNormalizeVariables
 *   _botComputeAbsencesImpact
 *   _botComputeEMADiff
 *   _botCountB2BInLast5
 *   _botCountAwayGamesInLast5
 *   _botComputeScore
 *   _botComputeMarketDivergence
 *   _botComputeConfidence
 *   _botEngineCompute          (orchestrateur · pour test global)
 *
 * Note · `_botEngineCompute` appelle aussi `_botComputeBettingRecs`,
 * `_botPredictNBATotal`, `_botPredictPlayerPoints` · ces fonctions sont
 * également chargées par le sandbox (toutes les fonctions top-level de
 * worker.js sont disponibles dans le contexte).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = resolve(__dirname, '..', '..', 'worker.js');

function loadBackendSandbox() {
  const source = readFileSync(WORKER_PATH, 'utf8');

  // Neutraliser `export default {` (seul export top-level) · transformer en
  // assignation locale au sandbox · les handlers HTTP ne sont jamais appelés.
  const idx = source.indexOf('export default {');
  if (idx < 0) {
    throw new Error('backend loader · worker.js · `export default {` introuvable · structure inattendue');
  }
  const patched = source.slice(0, idx) + 'globalThis.__mbp_worker_handlers = {' + source.slice(idx + 'export default {'.length);

  // Stubs minimaux · CF Worker APIs jamais invoquées par les fonctions pures
  // mais référencées au niveau module · vide suffit.
  const sandbox = {
    globalThis: {},
    console:    { log: () => {}, warn: () => {}, error: () => {} },
    crypto:     globalThis.crypto,
    Date,
    Math,
    Object, Array, Map, Set, JSON, String, Number, Boolean,
    Error, TypeError, RangeError,
    Promise,
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams,
    Response: class Response {},
    Request:  class Request {},
    Headers:  class Headers {},
    fetch:    async () => { throw new Error('fetch not allowed in parity tests'); },
    atob, btoa,
    TextEncoder, TextDecoder,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Évaluation · les declarations `function` top-level deviennent properties
  // du context · accessibles via sandbox[name].
  vm.runInContext(patched, sandbox, { filename: 'worker.js' });

  const required = [
    '_botGetNBAPhase',
    '_botGetWeights',
    '_botExtractVariables',
    '_botNormalizeVariables',
    '_botComputeAbsencesImpact',
    '_botComputeEMADiff',
    '_botCountB2BInLast5',
    '_botCountAwayGamesInLast5',
    '_botComputeScore',
    '_botComputeMarketDivergence',
    '_botComputeConfidence',
    '_botTennisConfidence',
    '_botEngineCompute',
  ];
  const exported = {};
  for (const name of required) {
    if (typeof sandbox[name] !== 'function') {
      throw new Error(`backend loader · fonction \`${name}\` introuvable dans worker.js · refactor détecté · adapter le test`);
    }
    // Bind via lookup dynamique sur sandbox · permet monkey-patch ultérieur
    // (ex: `getWeightsForPhase` ci-dessous patche `_botGetNBAPhase` puis
    // appelle `_botGetWeights` qui doit voir la nouvelle implémentation).
    exported[name] = (...args) => sandbox[name](...args);
  }

  /**
   * Récupère les poids backend pour une phase forcée (regular | playoff).
   * Monkey-patche temporairement `_botGetNBAPhase` dans le sandbox.
   * Garantit qu'on lit la VRAIE table de poids backend (pas une copie
   * hardcodée côté test).
   */
  exported.getWeightsForPhase = (phase) => {
    if (!['regular', 'playin', 'playoff', 'offseason'].includes(phase)) {
      throw new Error(`getWeightsForPhase · phase invalide · ${phase}`);
    }
    const original = sandbox._botGetNBAPhase;
    sandbox._botGetNBAPhase = () => phase;
    try {
      return sandbox._botGetWeights();
    } finally {
      sandbox._botGetNBAPhase = original;
    }
  };

  return exported;
}

export const backend = loadBackendSandbox();
