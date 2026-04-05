/**
 * MANI BET PRO — app.js v3
 *
 * AJOUTS v3 :
 *   - initThemeToggle() : bouton ☀️/🌙 pour basculer entre thème sombre et clair.
 *     Préférence sauvegardée dans localStorage (clé 'mbp_theme').
 *
 * CORRECTIONS v2 :
 *   - persistState() merge l'état existant au lieu de l'écraser.
 *   - window.MBP commenté comme debug uniquement.
 */

import { store }         from './state/store.js';
import { router }        from './ui/ui.router.js';
import { ProviderCache } from './providers/provider.cache.js';
import { PaperSettler }  from './paper/paper.settler.js';
import { Logger }        from './utils/utils.logger.js';
import { APP_CONFIG }    from './config/sports.config.js';

// ── THEME ─────────────────────────────────────────────────────────────────

function initThemeToggle() {
  // Lire la préférence sauvegardée
  const saved = localStorage.getItem('mbp_theme') ?? 'dark';
  _applyTheme(saved);

  // Créer le bouton toggle
  const btn = document.createElement('button');
  btn.id          = 'theme-toggle';
  btn.title       = 'Changer le thème';
  btn.textContent = saved === 'light' ? '🌙' : '☀️';
  document.body.appendChild(btn);

  btn.addEventListener('click', () => {
    const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
    const next    = current === 'light' ? 'dark' : 'light';
    _applyTheme(next);
    localStorage.setItem('mbp_theme', next);
    btn.textContent = next === 'light' ? '🌙' : '☀️';
  });
}

function _applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('theme-light');
    document.body.setAttribute('data-theme', 'light');
  } else {
    document.body.classList.remove('theme-light');
    document.body.removeAttribute('data-theme');
  }
}

// ── PERSISTENCE ───────────────────────────────────────────────────────────

function _loadPersistedState() {
  try {
    const raw = localStorage.getItem('mbp_state');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    Logger.warn('STORAGE_LOAD_FAIL', { message: err.message });
    return null;
  }
}

function _persistState() {
  try {
    const state   = store.getState();
    const current = JSON.parse(localStorage.getItem('mbp_state') ?? '{}');

    localStorage.setItem('mbp_state', JSON.stringify({
      ...current,
      dashboardFilters: state.dashboardFilters,
      ui: {
        ...(current.ui ?? {}),
        displayMode: state.ui?.displayMode,
      },
    }));
  } catch (err) {
    Logger.warn('STORAGE_PERSIST_FAIL', { message: err.message });
  }
}

// ── TOAST ─────────────────────────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className   = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity    = '0';
    toast.style.transition = 'opacity 300ms ease';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}

// ── LOADER GLOBAL ─────────────────────────────────────────────────────────

export function setGlobalLoader(visible, text = '') {
  const loader    = document.getElementById('global-loader');
  const loaderTxt = document.getElementById('loader-text');

  if (!loader) return;

  if (visible) {
    loader.classList.remove('hidden');
    if (loaderTxt) loaderTxt.textContent = text || 'Chargement…';
  } else {
    loader.classList.add('hidden');
  }

  store.setLoading(visible, text);
}

// ── INITIALISATION ────────────────────────────────────────────────────────

async function init() {
  Logger.info('APP_INIT_START', {
    version:   APP_CONFIG.VERSION,
    name:      APP_CONFIG.NAME,
    timestamp: new Date().toISOString(),
  });

  // 1. Cache — purge si nouvelle version, nettoyage des expirés
  ProviderCache.init();

  // 2. Charger l'état persisté
  const persisted = _loadPersistedState();
  if (persisted) {
    store.load(persisted);
    Logger.debug('APP_STATE_LOADED', {});
  }

  // 3. Persister à chaque changement de route
  store.subscribe('currentRoute', () => _persistState());

  // 4. Persister avant fermeture de page
  window.addEventListener('beforeunload', () => _persistState());

  // 5. Erreurs globales non capturées
  window.addEventListener('error', (e) => {
    Logger.error('UNCAUGHT_ERROR', {
      message:  e.message,
      filename: e.filename,
      lineno:   e.lineno,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    Logger.error('UNHANDLED_REJECTION', {
      reason: e.reason?.message ?? String(e.reason),
    });
  });

  // 6. Router
  router.init(store);

  // 7. Thème — bouton toggle ☀️/🌙
  initThemeToggle();

  // 8. Clôture automatique des paris en attente
  PaperSettler.settle(store).catch(() => {});

  Logger.info('APP_INIT_DONE', { version: APP_CONFIG.VERSION });
}

// ── LANCEMENT ────────────────────────────────────────────────────────────

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── DEBUG ─────────────────────────────────────────────────────────────────
window.MBP = {
  store,
  router,
  showToast,
  setGlobalLoader,
  version: APP_CONFIG.VERSION,
};
