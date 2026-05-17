/**
 * MANI BET PRO — ui.bot.classifier.js
 *
 * Classification pure d'un log bot selon sa lecture produit ·
 *   - recommended_bet         · log retenu comme pari principal par le moteur
 *   - value_idea_not_selected · value mathématique détectée mais non retenue
 *   - no_bet_analysis         · analyse sans pari (pas de recommendations)
 *
 * Sans dépendance navigateur · sans import · pure ESM · testable Node.
 * Source d'autorité pour les helpers UI (`ui.bot.js`, `ui.match-detail.tennis.js`).
 *
 * Règle métier (validée ChatGPT 2026-05-17) ·
 *   A. RECOMMENDED · `best_side` existe OU `betting_recommendations.best` non null
 *   B. VALUE_IDEA  · `recommendations[]` non vide ET pas de `best` ni `best_side`
 *   C. NO_BET      · pas de `betting_recommendations` OU pas de `recommendations`
 *
 * Cette classification est universelle (NBA · MLB · Tennis) · même structure log.
 * Pour Tennis · HOME=p1 · AWAY=p2 (alias historique).
 */

export const BET_CATEGORY = Object.freeze({
  RECOMMENDED: 'recommended_bet',
  VALUE_IDEA:  'value_idea_not_selected',
  NO_BET:      'no_bet_analysis',
});

/**
 * Retourne la catégorie produit d'un log.
 * @param {object|null|undefined} log
 * @returns {'recommended_bet'|'value_idea_not_selected'|'no_bet_analysis'}
 */
export function classifyLogBet(log) {
  if (!log || typeof log !== 'object') return BET_CATEGORY.NO_BET;

  const recs = log.betting_recommendations?.recommendations
            ?? log.betting_recommendations?.all
            ?? [];
  const best     = log.betting_recommendations?.best ?? null;
  const bestSide = log.best_side ?? null;

  if (best !== null || (bestSide !== null && bestSide !== undefined)) {
    return BET_CATEGORY.RECOMMENDED;
  }
  if (Array.isArray(recs) && recs.length > 0) {
    return BET_CATEGORY.VALUE_IDEA;
  }
  return BET_CATEGORY.NO_BET;
}

/**
 * Résout le côté HOME/AWAY vers le vrai nom du joueur/équipe.
 * Tennis · HOME=p1 · AWAY=p2.
 * NBA/MLB · HOME=home · AWAY=away.
 * OVER/UNDER ou autre · pass-through (utilisé pour totals/props).
 *
 * @param {object} log
 * @param {string} side · 'HOME' · 'AWAY' · 'OVER' · 'UNDER' · etc.
 * @returns {string} nom ou label original
 */
export function resolveSidePlayerName(log, side) {
  if (!log || !side) return side ?? '';
  const s = String(side).toUpperCase();
  if (s === 'HOME') return log.p1 ?? log.home ?? 'HOME';
  if (s === 'AWAY') return log.p2 ?? log.away ?? 'AWAY';
  return side;
}

/**
 * Pour un log de catégorie RECOMMENDED · retourne le pari principal
 * sous forme normalisée pour affichage UI.
 * Retourne null si non applicable.
 */
export function buildRecommendedView(log) {
  if (classifyLogBet(log) !== BET_CATEGORY.RECOMMENDED) return null;
  const br        = log.betting_recommendations ?? {};
  const best      = br.best ?? null;
  const bestSide  = log.best_side ?? best?.side ?? null;
  const bestEdge  = log.best_edge ?? best?.edge ?? null;
  const bestType  = log.best_market ?? best?.type ?? null;

  return {
    category:       BET_CATEGORY.RECOMMENDED,
    side:           bestSide,
    side_label:     resolveSidePlayerName(log, bestSide),
    edge:           bestEdge,
    market_type:    bestType,
    odds:           best?.odds_decimal ?? best?.odds_line ?? null,
    motor_prob:     best?.motor_prob   ?? log.motor_prob ?? null,
    kelly:          best?.kelly_stake  ?? null,
    is_contrarian:  !!best?.is_contrarian,
    confidence:     log.confidence_level ?? null,
    data_quality:   log.data_quality    ?? null,
  };
}

/**
 * Pour un log de catégorie VALUE_IDEA · retourne la liste des idées value
 * non retenues avec leur status (contrarian ou pas).
 * Retourne tableau vide si non applicable.
 */
export function buildValueIdeasView(log) {
  if (classifyLogBet(log) !== BET_CATEGORY.VALUE_IDEA) return [];
  const recs = log.betting_recommendations?.recommendations
            ?? log.betting_recommendations?.all
            ?? [];
  return recs.map(r => ({
    category:       BET_CATEGORY.VALUE_IDEA,
    side:           r.side ?? null,
    side_label:     resolveSidePlayerName(log, r.side),
    edge:           r.edge ?? null,
    market_type:    r.type ?? null,
    odds:           r.odds_decimal ?? r.odds_line ?? null,
    motor_prob:     r.motor_prob ?? null,
    is_contrarian:  !!r.is_contrarian,
    confidence:     log.confidence_level ?? null,
    data_quality:   log.data_quality    ?? null,
  }));
}
