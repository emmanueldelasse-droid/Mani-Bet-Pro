/**
 * MANI BET PRO — ui.loading.js
 *
 * Responsabilité unique : afficher l'état de chargement.
 * Barre de progression visible avec étapes textuelles.
 * Aucune logique métier.
 */

export class LoadingUI {

  /**
   * Met à jour le message et la progression.
   * @param {string} message
   * @param {number} percent — 0 à 100
   */
  static update(message, percent = 0) {
    const el  = document.getElementById('loading-message');
    const bar = document.getElementById('loading-bar-fill');

    if (el)  el.textContent = message;
    if (bar) bar.style.width = `${Math.min(Math.max(percent, 0), 100)}%`;

    this.show();
  }

  /** Affiche le loader */
  static show() {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.classList.remove('hidden');
  }

  /** Masque le loader */
  static hide() {
    const loader = document.getElementById('loading-overlay');
    if (loader) loader.classList.add('hidden');

    // Reset
    const bar = document.getElementById('loading-bar-fill');
    if (bar) bar.style.width = '0%';
  }

  /**
   * Génère le HTML du loader à injecter dans index.html.
   * @returns {string}
   */
  static renderHTML() {
    return `
      <div id="loading-overlay" class="loading-overlay hidden">
        <div class="loading-overlay__content">
          <div class="loading-overlay__logo">Mani Bet Pro</div>
          <div class="loading-overlay__bar">
            <div id="loading-bar-fill" class="loading-overlay__bar-fill"></div>
          </div>
          <div id="loading-message" class="loading-overlay__message text-muted">
            Chargement…
          </div>
        </div>
      </div>
    `;
  }
}
