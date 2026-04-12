export async function render(container) {
  container.innerHTML = `
    <div class="page-shell">
      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Configuration</div>
        <div class="page-header__sub">Vue simple pour garder une navigation propre.</div>
      </div>
      <div class="card">
        <div class="card__title">Statut</div>
        <div class="text-muted">Les réglages avancés seront branchés plus tard. Cette page évite une route vide.</div>
      </div>
    </div>`;
  return { destroy() {} };
}
