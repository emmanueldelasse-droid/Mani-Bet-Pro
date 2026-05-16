/**
 * Stub minimal des globals navigateur pour permettre l'import en Node de
 * `src/utils/utils.logger.js` (qui lit `window.location.hostname` au load).
 *
 * Doit être importé AVANT tout module frontend qui transite par Logger
 * (`engine.core.js`, `engine.robustness.js`, `engine.nba.js`).
 *
 * Effet de bord uniquement · pas d'export.
 */

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    location: { hostname: 'node-parity-test' },
    addEventListener: () => {},
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  const _store = new Map();
  globalThis.localStorage = {
    getItem:    (k) => _store.has(k) ? _store.get(k) : null,
    setItem:    (k, v) => { _store.set(k, String(v)); },
    removeItem: (k) => { _store.delete(k); },
    clear:      () => { _store.clear(); },
  };
}
