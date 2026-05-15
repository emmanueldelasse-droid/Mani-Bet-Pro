import { PaperAuth, paperFetch } from '../utils/utils.paper-auth.js';
import { API_CONFIG }            from '../config/api.config.js';
import { showToast }             from '../app.js';

const WORKER = API_CONFIG.WORKER_BASE_URL;

export async function render(container) {
  const buildMeta = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? 'dev';

  container.innerHTML = `
    <div class="page-shell">
      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Réglages</div>
        <div class="page-header__sub">Base visuelle unifiée pour éviter une route vide et préparer la suite du chantier UI.</div>
      </div>

      <div class="alert alert--info">
        <div class="alert__title">État actuel</div>
        <div class="alert__text">Les réglages avancés ne sont pas encore branchés. Cette vue sert de point d'ancrage propre pendant la refonte visuelle.</div>
      </div>

      <div class="settings-grid">
        <div class="card card--elevated">
          <div class="card__section">
            <div class="card__title">Mise à jour de l'app</div>
            <div class="card__sub">Si l'app n'affiche pas les derniers changements, force un rechargement complet (vide le cache navigateur).</div>
            <div style="margin-top:var(--space-3);font-size:11px;color:var(--color-text-secondary);font-family:var(--font-mono)">Build actuel : ${buildMeta}</div>
            <button id="force-update-btn" type="button" style="margin-top:var(--space-3);padding:8px 16px;background:var(--color-info);color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px">Forcer la mise à jour</button>
          </div>
        </div>

        <div class="card card--elevated">
          <div class="card__section">
            <div class="card__title">Clé Paper API</div>
            <div class="card__sub">
              Nécessaire pour accéder au journal de paris stocké côté worker.
              Stockée uniquement dans votre navigateur (localStorage) ·
              jamais envoyée ailleurs que vers le worker Mani Bet Pro.
            </div>

            <div id="paper-api-status" style="margin-top:var(--space-3);font-size:12px;font-weight:600"></div>

            <div style="margin-top:var(--space-3);display:flex;flex-direction:column;gap:var(--space-2)">
              <input
                id="paper-api-input"
                type="password"
                autocomplete="off"
                spellcheck="false"
                placeholder="Coller votre clé ici"
                style="padding:8px 12px;border:1px solid var(--color-border);border-radius:6px;background:var(--color-bg-elevated);color:var(--color-text);font-family:var(--font-mono);font-size:12px"
              />
              <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
                <button id="paper-api-save" type="button" style="padding:8px 16px;background:var(--color-success);color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px">Enregistrer</button>
                <button id="paper-api-clear" type="button" style="padding:8px 16px;background:var(--color-danger);color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px">Effacer</button>
                <button id="paper-api-test" type="button" style="padding:8px 16px;background:var(--color-info);color:#fff;border:0;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px">Tester</button>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card__section">
            <div class="card__title">Chantier prioritaire</div>
            <div class="settings-stat-list">
              <div class="settings-stat-row">
                <span class="settings-stat-row__label">NBA</span>
                <span class="settings-stat-row__value">Priorité 1</span>
              </div>
              <div class="settings-stat-row">
                <span class="settings-stat-row__label">MLB</span>
                <span class="settings-stat-row__value">Priorité 2</span>
              </div>
              <div class="settings-stat-row">
                <span class="settings-stat-row__label">Objectif</span>
                <span class="settings-stat-row__value">Même langage visuel</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // Bouton force-update : hard reload avec cache busting (Safari iOS-safe)
  container.querySelector('#force-update-btn')?.addEventListener('click', () => {
    const url = new URL(window.location.href);
    url.searchParams.set('_v', Date.now().toString());
    window.location.href = url.toString();
  });

  // ── MBP-S.2.1 · gestion clé Paper API ───────────────────────────────────
  const statusEl = container.querySelector('#paper-api-status');
  const inputEl  = container.querySelector('#paper-api-input');

  function _refreshStatus(text, color) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.style.color = color;
  }

  function _renderInitialStatus() {
    if (PaperAuth.hasKey()) {
      _refreshStatus('Clé configurée · stockée localement', 'var(--color-success)');
      // Ne jamais préremplir la vraie valeur · affiche placeholder masqué.
      inputEl.value = '';
      inputEl.placeholder = '••••••••  (clé déjà enregistrée · saisir pour remplacer)';
    } else {
      _refreshStatus('Aucune clé configurée · le journal de paris reste local', 'var(--color-warning)');
      inputEl.placeholder = 'Coller votre clé ici';
    }
  }

  _renderInitialStatus();

  container.querySelector('#paper-api-save')?.addEventListener('click', () => {
    const value = inputEl.value;
    if (!value || !value.trim()) {
      showToast('Saisir une clé avant d\'enregistrer', 'warning', 3000);
      return;
    }
    PaperAuth.setKey(value);
    inputEl.value = '';
    _renderInitialStatus();
    showToast('Clé Paper API enregistrée', 'success', 2500);
  });

  container.querySelector('#paper-api-clear')?.addEventListener('click', () => {
    PaperAuth.clearKey();
    inputEl.value = '';
    _renderInitialStatus();
    showToast('Clé Paper API effacée', 'info', 2500);
  });

  container.querySelector('#paper-api-test')?.addEventListener('click', async () => {
    if (!PaperAuth.hasKey()) {
      _refreshStatus('Aucune clé à tester', 'var(--color-warning)');
      showToast('Aucune clé enregistrée', 'warning', 2500);
      return;
    }
    _refreshStatus('Test en cours…', 'var(--color-text-secondary)');
    const result = await paperFetch(`${WORKER}/paper/state`);
    if (result.ok) {
      _refreshStatus('Clé valide · journal accessible', 'var(--color-success)');
      showToast('Clé Paper API valide', 'success', 2500);
    } else if (result.reason === 'invalid_key') {
      _refreshStatus('Clé Paper API invalide ou expirée', 'var(--color-danger)');
      showToast('Clé invalide ou expirée', 'error', 3500);
    } else {
      _refreshStatus(`Test impossible (${result.reason})`, 'var(--color-warning)');
      showToast('Test impossible · réseau ou worker indisponible', 'warning', 3000);
    }
  });

  return { destroy() {} };
}
