export async function render(container) {
  container.innerHTML = `
    <div class="page-shell">
      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Réglages</div>
        <div class="page-header__sub">Base visuelle unifiée pour éviter une route vide et préparer la suite du chantier UI.</div>
      </div>

      <div class="alert alert--info">
        <div class="alert__title">État actuel</div>
        <div class="alert__text">Les réglages avancés ne sont pas encore branchés. Cette vue sert de point d’ancrage propre pendant la refonte visuelle.</div>
      </div>

      <div class="settings-grid">
        <div class="card card--elevated">
          <div class="card__section">
            <div class="card__title">Socle UI</div>
            <div class="card__sub">Les primitives communes sont maintenant prévues pour harmoniser Dashboard, Fiche match, Bot et les prochaines vues MLB.</div>
          </div>
          <div class="card__footer">
            <span class="source-pill">UI system</span>
            <span class="text-muted" style="font-size:11px">En cours</span>
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

  return { destroy() {} };
}
