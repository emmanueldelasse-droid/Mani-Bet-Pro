/**
 * MANI BET PRO — ui.history.js
 * Affiche l'historique des analyses sauvegardées en localStorage.
 */

export async function render(container, storeInstance) {
  const history = (storeInstance.get('history') ?? []).slice().reverse();

  const CONFIDENCE_LABELS = {
    HIGH:   { label: 'Concluant', css: 'badge--robust-high' },
    MEDIUM: { label: 'Partiel',   css: 'badge--robust-mid'  },
    LOW:    { label: 'Fragile',   css: 'badge--robust-low'  },
  };

  const formatDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const formatScore = (s) => s !== null && s !== undefined ? Math.round(s * 100) + '%' : '—';

  const rows = history.length === 0
    ? `<div class="history-empty">Aucune analyse sauvegardée pour l'instant.<br>Les résultats concluants s'afficheront ici après chaque chargement du dashboard.</div>`
    : history.map(h => {
        const conf = CONFIDENCE_LABELS[h.confidence_level] ?? { label: h.confidence_level, css: '' };
        return `
          <div class="history-row">
            <div class="history-row__date">${formatDate(h.date)}</div>
            <div class="history-row__match">
              <span class="history-row__home">${h.home}</span>
              <span class="history-row__vs">vs</span>
              <span class="history-row__away">${h.away}</span>
            </div>
            <div class="history-row__sport">${h.sport}</div>
            <div class="history-row__signal">Signal ${formatScore(h.predictive_score)}</div>
            <div class="history-row__rob">Rob. ${formatScore(h.robustness_score)}</div>
            <div class="history-row__badge">
              <span class="badge ${conf.css}">${conf.label}</span>
            </div>
          </div>`;
      }).join('');

  container.innerHTML = `
    <div class="view-history">
      <div class="view-header">
        <div class="view-header__meta">MANI BET PRO</div>
        <h1 class="view-header__title">Historique</h1>
        <div class="view-header__sub">${history.length} analyse${history.length > 1 ? 's' : ''} sauvegardée${history.length > 1 ? 's' : ''}</div>
      </div>

      ${history.length > 0 ? `
      <div class="history-actions">
        <button class="btn btn--ghost btn--sm" id="clear-history">Effacer l'historique</button>
      </div>` : ''}

      <div class="history-list">
        <div class="history-header">
          <span>Date</span>
          <span>Match</span>
          <span>Sport</span>
          <span>Signal</span>
          <span>Robustesse</span>
          <span>Statut</span>
        </div>
        ${rows}
      </div>
    </div>`;

  // Bouton effacer
  container.querySelector('#clear-history')?.addEventListener('click', () => {
    if (confirm('Effacer tout l\'historique ?')) {
      storeInstance.set({ history: [] });
      render(container, storeInstance);
    }
  });
}
