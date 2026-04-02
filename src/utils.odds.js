/**
 * MANI BET PRO — utils.odds.js
 *
 * Responsabilité unique : conversion et calcul sur les cotes.
 * Remplace les 4 copies dupliquées dans ui.match-detail.js,
 * ui.history.js, ui.dashboard.js et engine.nba.js.
 *
 * Aucune donnée fictive. Retourne null si entrée invalide.
 */

// ── CONVERSIONS ────────────────────────────────────────────────────────────

/**
 * Cote américaine → cote décimale (format européen / Winamax).
 * +150 → 2.50 | -110 → 1.91
 * @param {number|string|null} american
 * @returns {number|null}
 */
export function americanToDecimal(american) {
  if (american === null || american === undefined || american === '') return null;
  const n = Number(american);
  if (!isFinite(n) || n === 0) return null;
  if (n > 0) return Math.round((n / 100 + 1) * 100) / 100;
  return Math.round((100 / Math.abs(n) + 1) * 100) / 100;
}

/**
 * Cote décimale → cote américaine.
 * 2.50 → +150 | 1.91 → -111
 * @param {number|null} decimal
 * @returns {number|null}
 */
export function decimalToAmerican(decimal) {
  if (decimal === null || decimal === undefined) return null;
  const n = Number(decimal);
  if (!isFinite(n) || n <= 1) return null;
  if (n >= 2) return Math.round((n - 1) * 100);
  return Math.round(-100 / (n - 1));
}

/**
 * Cote américaine → probabilité implicite brute (avec marge bookmaker).
 * +150 → 0.400 | -110 → 0.524
 * @param {number|null} american
 * @returns {number|null}
 */
export function americanToProb(american) {
  if (american === null || american === undefined) return null;
  const n = Number(american);
  if (!isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

/**
 * Cote décimale → probabilité implicite brute.
 * 2.50 → 0.400 | 1.91 → 0.524
 * @param {number|null} decimal
 * @returns {number|null}
 */
export function decimalToProb(decimal) {
  if (decimal === null || decimal === undefined) return null;
  const n = Number(decimal);
  if (!isFinite(n) || n <= 1) return null;
  return 1 / n;
}

// ── VIG-FREE ───────────────────────────────────────────────────────────────

/**
 * Calcule les probabilités vig-free (sans marge bookmaker) depuis deux cotes décimales.
 * Méthode multiplicative — la plus conservative.
 *
 * @param {number|null} oddsHomeDecimal
 * @param {number|null} oddsAwayDecimal
 * @returns {{ probHome: number, probAway: number, vig: number }|null}
 */
export function vigFreeProb(oddsHomeDecimal, oddsAwayDecimal) {
  if (!oddsHomeDecimal || !oddsAwayDecimal) return null;
  const rawHome = decimalToProb(oddsHomeDecimal);
  const rawAway = decimalToProb(oddsAwayDecimal);
  if (rawHome === null || rawAway === null) return null;
  const vig = rawHome + rawAway;
  if (vig <= 0) return null;
  return {
    probHome: Math.round((rawHome / vig) * 10000) / 10000,
    probAway: Math.round((rawAway / vig) * 10000) / 10000,
    vig:      Math.round((vig - 1) * 10000) / 10000,
  };
}

/**
 * Calcule les probabilités vig-free depuis deux cotes américaines.
 * @param {number|null} americanHome
 * @param {number|null} americanAway
 * @returns {{ probHome: number, probAway: number, vig: number }|null}
 */
export function vigFreeProbFromAmerican(americanHome, americanAway) {
  return vigFreeProb(
    americanToDecimal(americanHome),
    americanToDecimal(americanAway)
  );
}

// ── FORMATAGE ──────────────────────────────────────────────────────────────

/**
 * Formate une cote américaine pour affichage.
 * +150 → "+150" | -110 → "-110" | null → "—"
 * @param {number|null} american
 * @returns {string}
 */
export function formatAmerican(american) {
  if (american === null || american === undefined) return '—';
  const n = Number(american);
  if (!isFinite(n)) return '—';
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Formate une cote décimale pour affichage.
 * 2.50 → "2.50" | null → "—"
 * @param {number|null} decimal
 * @returns {string}
 */
export function formatDecimal(decimal) {
  if (decimal === null || decimal === undefined) return '—';
  const n = Number(decimal);
  if (!isFinite(n)) return '—';
  return n.toFixed(2);
}

/**
 * Formate un edge en % pour affichage.
 * 0.07 → "+7%" | -0.03 → "-3%" | null → "—"
 * @param {number|null} edge — fraction [0,1]
 * @returns {string}
 */
export function formatEdge(edge) {
  if (edge === null || edge === undefined) return '—';
  const pct = Math.round(edge * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}
