/**
 * MANI BET PRO — ai.guard.js v3
 *
 * Validation anti-hallucination des sorties IA.
 *
 * CORRECTIONS v3 :
 *   - validate() utilisait le paramètre context mais ne l'exploitait jamais.
 *     Désormais, les nombres présents dans context.engine_output sont extraits
 *     et exclus de la détection "pourcentage potentiellement inventé".
 *     Sans ça, les pourcentages du moteur (ex: "72% de probabilité") que l'IA
 *     répète correctement étaient flaggés à tort.
 *   - Pattern 'gagnera' assoupli : ne flag que la forme affirmative sans modal
 *     (ex: "il gagnera" → flag, "il pourrait gagner" ou "devrait gagner" → ok)
 */

export class AIGuard {

  static FORBIDDEN_PATTERNS = [
    // Certitude excessive sur le vainqueur — forme affirmative pure uniquement
    // Ne flag pas "devrait gagner", "pourrait gagner", "chances de gagner"
    { pattern: /(?<!devrait |pourrait |peut |risque de |chances? de )\bgagnera\b/gi,
      reason: 'Certitude sur vainqueur (forme affirmative sans conditionnel)' },

    { pattern: /\bà coup sûr\b/gi,       reason: 'Certitude excessive' },
    { pattern: /\binévitablement\b/gi,   reason: 'Certitude excessive' },
    { pattern: /\bcertainement\b/gi,     reason: 'Certitude excessive' },
    { pattern: /statistique[s]?\s+montre/gi, reason: 'Statistique potentiellement inventée' },
  ];

  /**
   * Valide la réponse IA et flag les patterns suspects.
   *
   * CORRECTION : les nombres présents dans context.engine_output
   * sont maintenant extraits et exclus de la détection de pourcentages.
   * Seuls les pourcentages absents du contexte déclenchent un flag.
   *
   * @param {string} rawText
   * @param {object} context — AIContext construit par AIContextBuilder
   * @returns {{ text: string, flags: Array, hasFlags: boolean }}
   */
  static validate(rawText, context) {
    if (!rawText) return { text: '', flags: [], hasFlags: false };

    const flags = [];

    // Extraire les nombres autorisés depuis le contexte moteur
    const allowedNumbers = this._extractAllowedNumbers(context);

    // Détecter les pourcentages dans la réponse
    // Un pourcentage est suspect seulement s'il n'est pas dans le contexte
    const percentMatches = rawText.match(/\b(\d+(?:[.,]\d+)?)\s*%/g) ?? [];
    for (const match of percentMatches) {
      const num = parseFloat(match.replace(',', '.').replace('%', '').trim());
      if (!isNaN(num) && !allowedNumbers.has(num)) {
        flags.push({
          pattern:  'PERCENTAGE_NOT_IN_CONTEXT',
          matches:  [match],
          reason:   `Pourcentage "${match}" absent du contexte moteur`,
          severity: 'WARNING',
        });
      }
    }

    // Patterns de certitude et d'invention
    for (const { pattern, reason } of this.FORBIDDEN_PATTERNS) {
      const regex   = new RegExp(pattern.source, pattern.flags);
      const matches = rawText.match(regex);
      if (matches) {
        flags.push({
          pattern:  pattern.toString(),
          matches,
          reason,
          severity: 'WARNING',
        });
      }
    }

    const annotated = flags.length > 0
      ? rawText + '\n\n⚠ [Audit automatique : certains passages ont été signalés pour vérification]'
      : rawText;

    return {
      text:     annotated,
      flags,
      hasFlags: flags.length > 0,
    };
  }

  // ── PRIVÉ ─────────────────────────────────────────────────────────────

  /**
   * Extrait tous les nombres présents dans le contexte moteur.
   * Ces nombres sont "autorisés" dans la réponse IA — l'IA les répète
   * depuis les données fournies, ce n'est pas une invention.
   *
   * @param {object} context — AIContext
   * @returns {Set<number>}
   */
  static _extractAllowedNumbers(context) {
    const allowed = new Set();
    if (!context?.engine_output) return allowed;

    const eo = context.engine_output;

    // Scores principaux
    if (eo.predictive_score != null)   allowed.add(Math.round(eo.predictive_score * 100));
    if (eo.robustness_score != null)   allowed.add(Math.round(eo.robustness_score * 100));
    if (eo.data_quality_score != null) allowed.add(Math.round(eo.data_quality_score * 100));
    if (eo.volatility != null)         allowed.add(Math.round(eo.volatility * 100));

    // Probabilité inverse
    if (eo.predictive_score != null) {
      allowed.add(100 - Math.round(eo.predictive_score * 100));
    }

    // Signaux
    for (const s of (eo.top_signals ?? [])) {
      if (s.contribution != null) {
        allowed.add(Math.round(Math.abs(s.contribution) * 100));
      }
    }

    // Recommandations paris
    const best = eo.betting_recommendations;
    if (best) {
      if (best.edge        != null) allowed.add(best.edge);
      if (best.motor_prob  != null) allowed.add(best.motor_prob);
      if (best.implied_prob != null) allowed.add(best.implied_prob);
    }

    // Sensibilité robustesse
    if (eo.max_sensitivity_delta != null) {
      allowed.add(Math.round(eo.max_sensitivity_delta * 100));
    }

    return allowed;
  }
}
