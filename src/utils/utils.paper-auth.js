/**
 * MANI BET PRO — utils.paper-auth.js v1 (MBP-S.2.1)
 *
 * Gestion de la clé Paper API côté front.
 * Stockage uniquement dans localStorage navigateur · jamais committée ni envoyée
 * ailleurs que vers le worker `manibetpro.emmanueldelasse.workers.dev`.
 */

const LS_KEY = 'mbp_paper_api_key';
const EVENT_KEY_CHANGED = 'mbp:paper-api-key-changed';

export const PaperAuth = {
  getKey() {
    try { return localStorage.getItem(LS_KEY); } catch { return null; }
  },

  setKey(rawKey) {
    const trimmed = (rawKey ?? '').trim();
    try {
      if (trimmed) localStorage.setItem(LS_KEY, trimmed);
      else localStorage.removeItem(LS_KEY);
    } catch {}
    window.dispatchEvent(new CustomEvent(EVENT_KEY_CHANGED));
  },

  clearKey() {
    try { localStorage.removeItem(LS_KEY); } catch {}
    window.dispatchEvent(new CustomEvent(EVENT_KEY_CHANGED));
  },

  hasKey() {
    const k = this.getKey();
    return !!k && k.length > 0;
  },

  onKeyChanged(cb) {
    window.addEventListener(EVENT_KEY_CHANGED, cb);
    return () => window.removeEventListener(EVENT_KEY_CHANGED, cb);
  },
};

/**
 * Wrapper fetch ajoutant automatiquement le header `X-API-Key`.
 *
 * Retours uniformes :
 *  - { ok: true,  status,    data }          succès
 *  - { ok: false, status: 0, reason: 'no_key' }       clé absente côté front
 *  - { ok: false, status: 401, reason: 'invalid_key' } worker refuse la clé
 *  - { ok: false, status, reason: 'http_error' }      autre erreur HTTP
 *  - { ok: false, status: 0, reason: 'network' }      fetch a échoué
 */
export async function paperFetch(url, options = {}) {
  const key = PaperAuth.getKey();
  if (!key) return { ok: false, status: 0, reason: 'no_key' };

  const headers = { ...(options.headers ?? {}), 'X-API-Key': key };
  try {
    const response = await fetch(url, { ...options, headers });
    if (response.ok) {
      const data = await response.json().catch(() => null);
      return { ok: true, status: response.status, data };
    }
    if (response.status === 401) {
      return { ok: false, status: 401, reason: 'invalid_key' };
    }
    return { ok: false, status: response.status, reason: 'http_error' };
  } catch {
    return { ok: false, status: 0, reason: 'network' };
  }
}
