/**
 * MANI BET PRO — engine.nba.js v5.11
 *
 * AJOUTS v5.11 :
 *   - MONEYLINE edge minimum : 7% → 5% (aligné SPREAD/O/U).
 *     En NBA les books sont efficients — 7% bloquait quasi tous les Moneylines.
 *   - pace_diff : approximation depuis avg_pts si Tank01 ne fournit pas pace.
 *     proxy = (homeAvgPts + awayAvgPts) / 2 centré sur 225 (moyenne NBA).
 *     Améliore la projection O/U même sans Tank01 pace réel.
 *   - _computeAbsencesImpact : source 'tank01_roster' reconnue comme pondérée.
 *     Pipeline v6.27 — impact_weight calculé depuis roster Tank01 côté worker.
 *
 * AJOUTS v5.10 :
 *   - _computeStarAbsenceModifier : statut Limited ajouté (status_weight 0.4).
 *     Capture les joueurs qui jouent avec une restriction physique (retour blessure, minutes limitées).
 *
 * AJOUTS v5.9 :
 *   - _computeStarAbsenceModifier() : modificateur multiplicatif sur le score
 *     si une star (ppg > 20) est Out ou Doubtful pour l'une des deux équipes.
 *     Appliqué après _computeScore() avant le return — indépendant des poids.
 *     Formule : coefficient = 1 - (ppg/team_ppg) × status_weight × STAR_FACTOR
 *     Plafond : -20% max sur le score (modifier >= 0.80).
 *     STAR_PPG_THRESHOLD = 20, STAR_FACTOR = 1.2, MAX_REDUCTION = 0.20.
 *     Exposé dans star_absence_modifier pour traçabilité UI.
 *
 * AJOUTS v5.4 :
 *   - _computeAbsencesImpact() exploite le champ impact_weight pondéré par ppg
 *     issu de la route /nba/injuries/impact (ESPN + Tank01).
 *     Si source='tank01' → impact_weight = (ppg/team_ppg) × status_weight.
 *     Si source='fallback' → comportement ESPN brut (status_weight plat).
 *     Normalisation adaptée : seuil 1.0 (pondéré) vs 5.0 (brut ESPN).
 *     quality passe à 'WEIGHTED' quand Tank01 disponible.
 *
 * AJOUTS v5 :
 *   1. net_rating_diff — signal dominant depuis NBA Stats API
 *      Remplace win_pct_diff comme indicateur de qualité globale.
 *      Source : /nba/stats/advanced (stats.nba.com via Worker).
 *
 *   2. min_games_sample guard dans _safeDiff et _safeEMADiff.
 *      En v4, efg_pct sur 2 matchs (début de saison) était traité
 *      comme une stat fiable. Désormais : quality='LOW_SAMPLE' si
 *      games_played < MIN_GAMES (10 par défaut dans sports.config.js).
 *
 *   3. pace_diff — différentiel de pace entre les deux équipes.
 *      Utilisé pour améliorer le calcul O/U (avg_pts biaisé pace supprimé
 *      du calcul O/U, remplacé par projection pace × possessions).
 *
 * CORRECTIONS v5.1 :
 *   - O/U : motor_prob et implied_prob étaient des points (229, 219)
 *     au lieu de probabilités (55, 52). Corrigé.
 *   - O/U : ajout predicted_total et market_total dans la reco
 *     pour affichage correct dans l'UI et en console.
 */

import { SPORTS_CONFIG }                 from '../config/sports.config.js';
import { americanToProb, decimalToProb } from '../utils/utils.odds.js';
import { Logger }                         from '../utils/utils.logger.js';

const CONFIG   = SPORTS_CONFIG.NBA;
const MIN_GAMES = CONFIG.rejection_thresholds.min_games_sample ?? 10;

// Seuils edge minimum — v5.11 : MONEYLINE 7% → 5%
const EDGE_THRESHOLDS = {
  MONEYLINE:  0.05,  // v5.11 : était 0.07, trop restrictif en NBA
  SPREAD:     0.03,
  OVER_UNDER: 0.03,
};

// Kelly Criterion — Fractional Kelly/4, plafond 5% bankroll
const KELLY_FRACTION = 0.25;
const KELLY_MAX_PCT  = 0.05;

// Modificateur star absente — v5.9
const STAR_PPG_THRESHOLD = 20;   // seuil star (ppg saison)
const STAR_FACTOR        = 1.2;  // amplificateur impact star (à calibrer post-50 paris)
const STAR_MAX_REDUCTION = 0.20; // plafond réduction score (-20% max)
const STAR_TEAM_PPG_FALLBACK = 115; // ppg équipe si non disponible

export class EngineNBA {

  static compute(matchData, customWeights = null) {
    const baseWeights = customWeights ?? CONFIG.default_weights;

    const variables = this._extractVariables(matchData);
    const { missing, missingCritical } = this._assessMissing(variables);

    const uncalibrated = Object.entries(baseWeights)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    let score = null, signals = [], volatility = null, scoreMethod = null;
    let effectiveWeights = { ...baseWeights };
    let structureMultiplier = 1;
    let starLineupAdjustment = null;
    let marketDivergence = {
      home_implied: null,
      away_implied: null,
      home_diff_pts: null,
      away_diff_pts: null,
      max_diff_pts: null,
      flag: 'none',
    };
    let confidencePenalty = 0;

    if (uncalibrated.length === Object.keys(baseWeights).length) {
      scoreMethod = 'UNCALIBRATED';
    } else if (missingCritical.length > 0) {
      scoreMethod = 'MISSING_CRITICAL';
    } else {
      const weightedContext = this._buildEffectiveWeights(
        baseWeights,
        variables,
        matchData?.home_injuries ?? null,
        matchData?.away_injuries ?? null
      );
      effectiveWeights = weightedContext.weights;
      structureMultiplier = weightedContext.structureMultiplier;

      const computed = this._computeScore(variables, effectiveWeights);
      score       = computed.score;
      signals     = computed.signals;
      volatility  = computed.volatility;
      scoreMethod = structureMultiplier < 1 ? 'WEIGHTED_SUM+LINEUP_DAMPING' : 'WEIGHTED_SUM';

      if (score !== null) {
        starLineupAdjustment = this._computeStarLineupAdjustment(
          matchData?.home_injuries ?? null,
          matchData?.away_injuries ?? null
        );
        if (starLineupAdjustment?.delta) {
          score = Math.max(0, Math.min(1, Math.round((score + starLineupAdjustment.delta) * 1000) / 1000));
          scoreMethod += '+STAR_LINEUP';
        }

        marketDivergence = this._computeMarketDivergence(score, matchData);
        confidencePenalty = this._computeConfidencePenalty(
          matchData?.home_injuries ?? null,
          matchData?.away_injuries ?? null,
          marketDivergence
        );
      }
    }

    const hasOdds = matchData?.odds != null || matchData?.market_odds != null;
    const bettingRecs = (score !== null && hasOdds)
      ? this._computeBettingRecommendations(score, matchData?.odds ?? {}, matchData, variables, signals, marketDivergence)
      : null;

    Logger.debug('ENGINE_NBA_RESULT', {
      score,
      method: scoreMethod,
      missing_count: missing.length,
      critical_missing: missingCritical.length,
      structure_multiplier: structureMultiplier,
      star_adjustment: starLineupAdjustment?.delta ?? null,
      market_divergence_flag: marketDivergence?.flag ?? 'none',
      confidence_penalty: confidencePenalty,
    });

    return {
      sport:                 'NBA',
      score,
      score_method:          scoreMethod,
      signals,
      volatility,
      missing_variables:     missing,
      missing_critical:      missingCritical,
      uncalibrated_weights:  uncalibrated,
      variables_used:        variables,
      effective_weights:     effectiveWeights,
      structure_multiplier:  structureMultiplier,
      star_absence_modifier: starLineupAdjustment?.delta ?? null,
      star_lineup_adjustment: starLineupAdjustment,
      market_divergence:     marketDivergence,
      confidence_penalty:    confidencePenalty,
      betting_recommendations: bettingRecs,
      debug: {
        predictive_score_final: score,
        absences_impact_value: variables?.absences_impact?.value ?? null,
        star_absence_modifier: starLineupAdjustment?.delta ?? null,
        home_star_counts: starLineupAdjustment?.home?.counts ?? null,
        away_star_counts: starLineupAdjustment?.away?.counts ?? null,
        market_implied_home: marketDivergence?.home_implied ?? null,
        market_implied_away: marketDivergence?.away_implied ?? null,
        market_divergence_pts: marketDivergence?.max_diff_pts ?? null,
        market_divergence_flag: marketDivergence?.flag ?? 'none',
        weights_used: effectiveWeights,
        confidence_penalty: confidencePenalty,
      },
      computed_at:           new Date().toISOString(),
    };
  }

  /**
   * Compat legacy UI/debug.
   * Retourne le delta net appliqué au score domicile :
   *   négatif = domicile pénalisé, positif = visiteur pénalisé.
   */
  static _computeStarAbsenceModifier(homeInjuries, awayInjuries) {
    return this._computeStarLineupAdjustment(homeInjuries, awayInjuries)?.delta ?? null;
  }

  static _computeBackToBack(data) {
    const h = data?.home_back_to_back ?? null, a = data?.away_back_to_back ?? null;
    if (h === null && a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    let value = 0;
    if (h && !a) value = -1;
    else if (!h && a) value = 1;
    return { value, source: 'espn_schedule', quality: 'VERIFIED', raw: { home_b2b: h, away_b2b: a } };
  }

  static _computeRestDiff(data) {
    const h = data?.home_rest_days ?? null, a = data?.away_rest_days ?? null;
    if (h === null || a === null) return { value: null, source: 'espn_schedule', quality: 'MISSING' };
    return { value: Math.max(-3, Math.min(3, h - a)), source: 'espn_schedule', quality: 'VERIFIED', raw: { home_rest: h, away_rest: a } };
  }

  // ── VOLATILITÉ ────────────────────────────────────────────────────────────

  static _estimateVolatility(variables) {
    let vol = 0.20;
    const abs = variables.absences_impact?.value;
    if (abs !== null && Math.abs(abs) > 0.5) vol += 0.15;
    const hasLow = Object.values(variables).some(v => v?.quality === 'LOW_SAMPLE' || v?.quality === 'ESTIMATED');
    if (hasLow) vol += 0.10;
    return Math.min(1, Math.round(vol * 100) / 100);
  }

  // ── DONNÉES MANQUANTES ────────────────────────────────────────────────────

  static _assessMissing(variables) {
    const missing = [], missingCritical = [];
    for (const varConfig of CONFIG.variables) {
      const v = variables[varConfig.id];
      if (!v || v.value === null || v.quality === 'MISSING') {
        missing.push(varConfig.id);
        if (varConfig.critical) missingCritical.push(varConfig.id);
      }
    }
    return { missing, missingCritical };
  }

  // ── RECOMMANDATIONS PARIS ─────────────────────────────────────────────────

  static _computeBettingRecommendations(score, odds, matchData, variables, signals = [], marketDivergence = null) {
    const recs = [];
    const marketOdds = matchData?.market_odds ?? null;

    // Construire les cotes de référence.
    // Priorité : Winamax (bookmaker principal) > Pinnacle > premier disponible.
    // Winamax = cotes réelles disponibles pour parier.
    // Pinnacle = fallback si Winamax absent (marché le plus efficient).
    const pinnacle = marketOdds?.bookmakers?.find(b => b.key === 'winamax')
                  ?? marketOdds?.bookmakers?.find(b => b.key === 'pinnacle')
                  ?? marketOdds?.bookmakers?.[0]
                  ?? null;

    // Cotes décimales Pinnacle → américaines pour le calcul interne
    const _decToAm = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

    const espnOdds = odds ?? {};
    const normalizedOdds = {
      home_ml:    espnOdds.home_ml    != null ? Number(espnOdds.home_ml)
                : pinnacle?.home_ml   != null ? _decToAm(pinnacle.home_ml)
                : null,
      away_ml:    espnOdds.away_ml    != null ? Number(espnOdds.away_ml)
                : pinnacle?.away_ml   != null ? _decToAm(pinnacle.away_ml)
                : null,
      spread:     espnOdds.spread     != null ? Number(espnOdds.spread)
                : pinnacle?.spread_line != null ? Number(pinnacle.spread_line)
                : null,
      over_under: espnOdds.over_under != null ? Number(espnOdds.over_under)
                : pinnacle?.total_line != null ? Number(pinnacle.total_line)
                : null,
    };

    const pHome = score;
    const pAway = 1 - score;

    // ── MONEYLINE ────────────────────────────────────────────────────────
    if (normalizedOdds.home_ml !== null && normalizedOdds.away_ml !== null) {
      const impliedHome = americanToProb(normalizedOdds.home_ml);
      const impliedAway = americanToProb(normalizedOdds.away_ml);
      const edgeHome    = pHome - impliedHome;
      const absEdge     = Math.abs(edgeHome);

      const isExtreme = (edgeHome > 0 && normalizedOdds.home_ml > 400) ||
                        (edgeHome < 0 && normalizedOdds.away_ml > 400);

      if (absEdge >= EDGE_THRESHOLDS.MONEYLINE && !isExtreme) {
        const side        = edgeHome > 0 ? 'HOME' : 'AWAY';
        const dkOdds      = side === 'HOME' ? normalizedOdds.home_ml : normalizedOdds.away_ml;
        const motorProb   = side === 'HOME' ? pHome : pAway;
        const bestBook    = this._getBestBookOdds(marketOdds, side, 'h2h');
        const bestOdds    = bestBook?.odds ?? dkOdds;
        const bestImplied = americanToProb(bestOdds);
        const realEdge    = motorProb - bestImplied;
        const kelly       = this._computeKelly(motorProb, bestOdds);

        // is_contrarian : vrai quand on parie sur l'équipe défavorisée par le moteur
        // Ex: score=0.56 (Boston favori) mais edge sur Charlotte → is_contrarian=true
        const isContrarian = (side === 'HOME' && score <= 0.5) || (side === 'AWAY' && score > 0.5);
        recs.push({
          type: 'MONEYLINE', label: 'Vainqueur du match', side,
          odds_line: bestOdds, odds_source: bestBook?.bookmaker ?? 'DraftKings', odds_dk: dkOdds,
          motor_prob: Math.round(motorProb * 100), implied_prob: Math.round(bestImplied * 100),
          edge: Math.round(Math.abs(realEdge) * 100),
          confidence: this._edgeToConfidence(Math.abs(realEdge)),
          has_value: true, kelly_stake: kelly,
          is_contrarian: isContrarian,
        });
      }
    }

    // ── SPREAD ───────────────────────────────────────────────────────────
    // La probabilité de couvrir un spread n'est pas la même que la probabilité
    // de gagner le match. Conversion via distribution normale NBA (σ ~12 pts).
    // P(couvrir spread S) = P(marge victoire > S) = 1 - Φ((S - μ) / σ)
    if (normalizedOdds.spread !== null) {
      const spreadLine = normalizedOdds.spread; // négatif = favori domicile
      const NBA_SIGMA  = 12; // écart-type historique des marges NBA

      // Ancre principale : spread Pinnacle = meilleur prédicteur de marge
      // Adjustment moteur : delta marginal depuis signaux clés (±8 pts max)
      // v5.5 : net_rating_diff ajouté — meilleur prédicteur de marge disponible
      const marketMargin   = -spreadLine;
      const _sig = (id) => (signals.find(s => s.variable === id)?.normalized ?? 0);
      const adjustment     = _sig("net_rating_diff") * 3.0
                           + _sig("efg_diff")         * 1.5
                           + _sig("recent_form_ema")  * 1.0
                           + _sig("absences_impact")  * 2.5;
      const expectedMargin = marketMargin + Math.max(-8, Math.min(8, adjustment));

      // P(domicile couvre spread) = P(marge > spreadLine)
      // spread négatif = domicile favori, doit gagner de plus que |spread|
      const zHome = ((-spreadLine) - expectedMargin) / NBA_SIGMA;
      const pSpreadHome = 1 - this._normalCDF(zHome);

      // Comparer à la probabilité implicite Pinnacle
      const bestHome = this._getBestBookOdds(marketOdds, 'HOME', 'spreads');
      const bestAway = this._getBestBookOdds(marketOdds, 'AWAY', 'spreads');

      const checkSpreadSide = (motorProb, bestBook, side, sLine) => {
        if (!bestBook) return;
        const impliedProb = decimalToProb(bestBook.decimalOdds);
        if (impliedProb === null) return;
        const edge = motorProb - impliedProb;
        if (edge >= EDGE_THRESHOLDS.SPREAD) {
          recs.push({
            type: 'SPREAD', label: 'Handicap (spread)', side,
            odds_line: bestBook.odds, odds_decimal: bestBook.decimalOdds, odds_source: bestBook.bookmaker,
            spread_line: sLine,
            motor_prob: Math.round(motorProb * 100), implied_prob: Math.round(impliedProb * 100),
            edge: Math.round(edge * 100), confidence: this._edgeToConfidence(edge),
            has_value: true, kelly_stake: this._computeKelly(motorProb, bestBook.odds),
            is_contrarian: false,
          });
        }
      };

      checkSpreadSide(pSpreadHome,       bestHome, 'HOME',  spreadLine);
      checkSpreadSide(1 - pSpreadHome,   bestAway, 'AWAY', -spreadLine);
    }

    // ── OVER/UNDER ───────────────────────────────────────────────────────
    // CORRECTION v5.1 : motor_prob et implied_prob sont des probabilités (0-100)
    // et non des points. Les champs predicted_total et market_total portent
    // les valeurs en points pour l'affichage UI.
    if (normalizedOdds.over_under !== null) {
      const homeAvgPtsRaw = matchData?.home_season_stats?.avg_pts;
      const awayAvgPtsRaw = matchData?.away_season_stats?.avg_pts;
      // Guard live ESPN : avg_pts < 60 ou > 140 = score partiel de match en cours
      const isLiveData = (homeAvgPtsRaw != null && (homeAvgPtsRaw < 60 || homeAvgPtsRaw > 140))
                      || (awayAvgPtsRaw != null && (awayAvgPtsRaw < 60 || awayAvgPtsRaw > 140));
      const homeAvgPts = isLiveData ? null : homeAvgPtsRaw;
      const awayAvgPts = isLiveData ? null : awayAvgPtsRaw;

      if (homeAvgPts != null && awayAvgPts != null) {
        const ouLine = normalizedOdds.over_under;

        // v5.5 : déduction blessures sur avg_pts avant projection.
        // impact_score par équipe = fraction du scoring perdu (0=intact, 1=décimée).
        // On déduit jusqu'à ~15% du scoring en cas d'équipe très affectée.
        // absences_impact > 0 = domicile affaibli / < 0 = visiteur affaibli.
        const absImpact  = variables?.absences_impact?.value ?? 0;
        // Conversion : absences_impact [-1,1] → pts perdus par équipe
        // Domicile affaibli (absImpact > 0) → réduit homeAvgPts
        // Visiteur affaibli (absImpact < 0) → réduit awayAvgPts
        const homeInjAdj = absImpact > 0 ? -homeAvgPts * absImpact * 0.12 : 0;
        const awayInjAdj = absImpact < 0 ? -awayAvgPts * Math.abs(absImpact) * 0.12 : 0;

        // Ajustement pace si disponible
        const paceDiff = variables?.pace_diff?.value ?? null;
        const paceAdj  = paceDiff !== null ? paceDiff * 0.5 : 0;

        const projectedTotal = homeAvgPts + homeInjAdj + awayAvgPts + awayInjAdj + paceAdj;
        const diff           = projectedTotal - ouLine;
        const side           = diff > 0 ? 'OVER' : 'UNDER';
        const bestOUBook     = this._getBestBookOdds(marketOdds, side, 'totals');

        if (bestOUBook) {
          // motorProb = probabilité estimée que l'OVER/UNDER se réalise (0-1)
          // Sigmoid calibrée sur sigma NBA (~12 pts) — asymptote 65% max
          // diff=5pts → ~56%, diff=10pts → ~60%, diff=15pts → ~63%
          const motorProb   = 0.50 + 0.15 * (1 - Math.exp(-Math.abs(diff) / 12));
          const impliedProb = decimalToProb(bestOUBook.decimalOdds);
          if (impliedProb !== null) {
            const edge = motorProb - impliedProb;
            if (edge >= EDGE_THRESHOLDS.OVER_UNDER) {
              // Construire la note avec les ajustements actifs
              const adjParts = [];
              if (paceDiff !== null) adjParts.push(`pace ${paceAdj > 0 ? '+' : ''}${paceAdj.toFixed(1)}`);
              if (homeInjAdj !== 0) adjParts.push(`inj.dom ${homeInjAdj.toFixed(1)}`);
              if (awayInjAdj !== 0) adjParts.push(`inj.ext ${awayInjAdj.toFixed(1)}`);
              const adjNote = adjParts.length > 0 ? ` (${adjParts.join(', ')})` : '';

              recs.push({
                type: 'OVER_UNDER', label: 'Total de points', side,
                odds_line: bestOUBook.odds, odds_decimal: bestOUBook.decimalOdds, odds_source: bestOUBook.bookmaker,
                ou_line: ouLine,
                motor_prob:      Math.round(motorProb * 100),
                implied_prob:    Math.round(impliedProb * 100),
                predicted_total: Math.round(projectedTotal),
                market_total:    ouLine,
                edge: Math.round(edge * 100), confidence: this._edgeToConfidence(edge),
                has_value: true,
                note: `Projection ${Math.round(projectedTotal)} pts${adjNote} · ligne ${ouLine}`,
                kelly_stake: this._computeKelly(motorProb, bestOUBook.odds),
              });
            }
          }
        }
      }
    }

    recs.sort((a, b) => b.edge - a.edge);
    const validRecs = recs.filter(r => r.has_value);
    const flag = marketDivergence?.flag ?? 'none';
    const bestRec = (flag === 'critical' || flag === 'high') ? null : (validRecs[0] ?? null);
    return { recommendations: validRecs, best: bestRec, computed_at: new Date().toISOString() };
  }

  static _computeKelly(p, americanOdds) {
    if (p === null || americanOdds === null) return null;
    const b = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
    const kelly = (b * p - (1 - p)) / b;
    if (kelly <= 0) return 0;
    return Math.min(kelly * KELLY_FRACTION, KELLY_MAX_PCT);
  }

  static _getBestBookOdds(marketOdds, side, market) {
    if (!marketOdds?.bookmakers?.length) return null;

    // Priorité bookmaker : Winamax > Pinnacle > meilleure cote disponible
    // Winamax = bookmaker principal pour le pari réel
    // Pinnacle = fallback marché efficient si Winamax absent
    const PRIORITY = ['winamax', 'pinnacle', 'betclic', 'unibet_eu', 'betsson', 'bet365'];

    const _getOdds = (bk) => {
      if (market === 'h2h')      return side === 'HOME' ? bk.home_ml : bk.away_ml;
      if (market === 'spreads')  return side === 'HOME' ? bk.home_spread : bk.away_spread;
      if (market === 'totals')   return side === 'OVER' ? bk.over_total : bk.under_total;
      return null;
    };

    // Chercher d'abord dans l'ordre de priorité
    for (const key of PRIORITY) {
      const bk = marketOdds.bookmakers.find(b => b.key === key);
      if (!bk) continue;
      const oddsDecimal = _getOdds(bk);
      if (!oddsDecimal || oddsDecimal <= 1) continue;
      const american = oddsDecimal >= 2
        ? Math.round((oddsDecimal - 1) * 100)
        : Math.round(-100 / (oddsDecimal - 1));
      return { odds: american, decimalOdds: oddsDecimal, bookmaker: bk.title ?? bk.key };
    }

    // Fallback : meilleure cote disponible tous bookmakers
    let best = null;
    for (const bk of marketOdds.bookmakers) {
      const oddsDecimal = _getOdds(bk);
      if (!oddsDecimal || oddsDecimal <= 1) continue;
      const american = oddsDecimal >= 2 ? Math.round((oddsDecimal - 1) * 100) : Math.round(-100 / (oddsDecimal - 1));
      if (!best || oddsDecimal > best.decimalOdds) {
        best = { odds: american, decimalOdds: oddsDecimal, bookmaker: bk.title ?? bk.key };
      }
    }
    return best;
  }

  static _explainSignal(varId, normalized, contribution) {
    const dir = contribution >  0.001 ? "en faveur de l'équipe domicile"
              : contribution < -0.001 ? "en faveur de l'équipe visiteuse"
              : 'neutre';
    const int = Math.abs(normalized) > 0.6 ? 'fort' : Math.abs(normalized) > 0.3 ? 'modéré' : 'faible';
    const labels = {
      net_rating_diff:  `Net Rating différentiel ${int} ${dir} — NBA Stats API`,
      efg_diff:         `Efficacité tir (eFG%) ${int} ${dir} — ESPN`,
      ts_diff:          `Efficacité globale (TS%) ${int} ${dir} — ESPN`,
      win_pct_diff:     `Bilan saison ${int} ${dir} — ESPN`,
      home_away_split:  `Contexte dom/ext ${int} ${dir} — ESPN`,
      recent_form_ema:  `Forme récente (EMA) ${int} ${dir} — BallDontLie`,
      absences_impact:  `Impact absences ${int} ${dir} — NBA PDF officiel`,
      avg_pts_diff:     `Différentiel scoring ${int} ${dir} — ESPN`,
      defensive_diff:   `Défense adverse ${int} ${dir} — Tank01`,
      back_to_back:     `Back-to-back ${int} ${dir} — ESPN`,
      rest_days_diff:   `Jours de repos ${int} ${dir} — ESPN`,
    };
    return labels[varId] ?? `Variable ${varId} — signal ${int} ${dir}`;
  }

  static _edgeToConfidence(edge) {
    if (edge >= 0.10) return 'FORTE';
    if (edge >= 0.06) return 'MOYENNE';
    return 'FAIBLE';
  }

  static _normalCDF(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
    return z >= 0 ? 1 - p : p;
  }
}
