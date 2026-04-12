export async function render(container) {
  container.innerHTML = `
    <div class="page-shell">
      <div class="page-header">
        <div class="page-header__eyebrow">Mani Bet Pro</div>
        <div class="page-header__title">Laboratoire</div>
        <div class="page-header__sub">Vue de réserve. Aucun test lourd n'est lancé ici.</div>
      </div>
      <div class="card">
        <div class="card__title">Statut</div>
        <div class="text-muted">Cette vue est présente pour éviter une erreur de navigation. Rien d'important n'est exécuté ici.</div>
      </div>
    </div>`;
  return { destroy() {} };
}
