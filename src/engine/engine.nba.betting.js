/**
 * MANI BET PRO — engine.nba.betting.js v1.1
 *
 * Extrait depuis engine.nba.js v5.12 (refactor v5.13).
 * Responsabilité : calcul des recommandations de paris (Moneyline, Spread, O/U),
 * Kelly Criterion, divergence marché, pénalité de confiance.
 *
 * Exporté vers engine.nba.js (orchestrateur) uniquement.
 */

import { americanToProb, decimalToProb } from '../utils/utils.odds.js';
import { normalCDF }                      from './engine.nba.score.js';

// Seuils edge minimum
const EDGE_THRESHOLDS = {
  MONEYLINE:  0.05,
  SPREAD:     0.03,
  OVER_UNDER: 0.03,
};

// Kelly Criterion — Fractional Kelly/4, plafond 5% bankroll
const KELLY_FRACTION = 0.25;
const KELLY_MAX_PCT  = 0.05;

// ── RECOMMANDATIONS ───────────────────────────────────────────────────────────

export function computeBettingRecommendations(score, odds, matchData, variables, signals = [], marketDivergence = null) {
  const recs = [];
  const marketOdds = matchData?.market_odds ?? null;
  const isCriticalDivergence = marketDivergence?.flag === 'critical';

  const pinnacle = marketOdds?.bookmakers?.find(b => b.key === 'winamax')
                ?? marketOdds?.bookmakers?.find(b => b.key === 'pinnacle')
                ?? marketOdds?.bookmakers?.[0]
                ?? null;

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

  // ── MONEYLINE ─────────────────────────────────────────────────────────────
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
      const bestBook    = getBestBookOdds(marketOdds, side, 'h2h');
      const bestOdds    = bestBook?.odds ?? dkOdds;
      const bestImplied = americanToProb(bestOdds);
      const realEdge    = motorProb - bestImplied;
      const kelly       = computeKelly(motorProb, bestOdds);
      const isContrarian = (side === 'HOME' && score <= 0.5) || (side === 'AWAY' && score > 0.5);

      recs.push({
        type: 'MONEYLINE', label: 'Vainqueur du match', side,
        odds_line: bestOdds, odds_source: bestBook?.bookmaker ?? 'DraftKings', odds_dk: dkOdds,
        motor_prob: Math.round(motorProb * 100), implied_prob: Math.round(bestImplied * 100),
        edge: Math.round(Math.abs(realEdge) * 100),
        confidence: edgeToConfidence(Math.abs(realEdge)),
        has_value: true, kelly_stake: kelly, is_contrarian: isContrarian,
      });
    }
  }

  // ── SPREAD ────────────────────────────────────────────────────────────────
  if (normalizedOdds.spread !== null) {
    const spreadLine = normalizedOdds.spread;
    const NBA_SIGMA  = 12;
    const marketMargin = -spreadLine;
    const _sig = (id) => (signals.find(s => s.variable === id)?.normalized ?? 0);
    const adjustment   = _sig('net_rating_diff') * 3.0
                       + _sig('efg_diff')         * 1.5
                       + _sig('recent_form_ema')  * 1.0
                       + _sig('absences_impact')  * 2.5;
    const expectedMargin = marketMargin + Math.max(-8, Math.min(8, adjustment));
    const zHome = ((-spreadLine) - expectedMargin) / NBA_SIGMA;
    const pSpreadHome = 1 - normalCDF(zHome);

    const bestHome = getBestBookOdds(marketOdds, 'HOME', 'spreads');
    const bestAway = getBestBookOdds(marketOdds, 'AWAY', 'spreads');

    const checkSpreadSide = (motorProb, bestBook, side, sLine) => {
      if (!bestBook) return;
      const impliedProb = decimalToProb(bestBook.decimalOdds);
      if (impliedProb === null) return;
      const edge     = motorProb - impliedProb;
      const hasValue = edge >= EDGE_THRESHOLDS.SPREAD;
      recs.push({
        type: 'SPREAD', label: 'Handicap (spread)', side,
        odds_line: bestBook.odds, odds_decimal: bestBook.decimalOdds, odds_source: bestBook.bookmaker,
        spread_line: sLine,
        motor_prob:   Math.round(motorProb * 100),
        implied_prob: Math.round(impliedProb * 100),
        edge:         Math.round(edge * 100),
        confidence:   hasValue ? edgeToConfidence(edge) : null,
        has_value:    hasValue,
        kelly_stake:  hasValue ? computeKelly(motorProb, bestBook.odds) : null,
        is_contrarian: false,
      });
    };

    checkSpreadSide(pSpreadHome,     bestHome, 'HOME',  spreadLine);
    checkSpreadSide(1 - pSpreadHome, bestAway, 'AWAY', -spreadLine);
  }

  // ── OVER/UNDER ────────────────────────────────────────────────────────────
  if (normalizedOdds.over_under !== null) {
    const homeAvgPtsRaw  = matchData?.home_season_stats?.avg_pts;
    const awayAvgPtsRaw  = matchData?.away_season_stats?.avg_pts;
    const homeLast5Raw   = matchData?.home_last5_avg_pts ?? null;
    const awayLast5Raw   = matchData?.away_last5_avg_pts ?? null;

    const isLiveData = (homeAvgPtsRaw != null && (homeAvgPtsRaw < 60 || homeAvgPtsRaw > 140))
                    || (awayAvgPtsRaw != null && (awayAvgPtsRaw < 60 || awayAvgPtsRaw > 140));
    // Priorité : BDL last5 (5 derniers matchs, réactif) > ESPN avg_pts saison
    // BDL last5 est calculé dans l'orchestrateur depuis recentForms
    const homeAvgPts = isLiveData ? null : (homeLast5Raw ?? homeAvgPtsRaw);
    const awayAvgPts = isLiveData ? null : (awayLast5Raw ?? awayAvgPtsRaw);

    if (homeAvgPts != null && awayAvgPts != null) {
      const ouLine     = normalizedOdds.over_under;
      const absImpact  = variables?.absences_impact?.value ?? 0;
      const paceDiff   = variables?.pace_diff?.value ?? null;
      const paceAdj    = paceDiff !== null ? paceDiff * 0.5 : 0;

      const homeBase = homeLast5Raw !== null
        ? homeAvgPts * 0.60 + homeLast5Raw * 0.40
        : homeAvgPts;
      const awayBase = awayLast5Raw !== null
        ? awayAvgPts * 0.60 + awayLast5Raw * 0.40
        : awayAvgPts;

      const homeInjAdj = absImpact > 0 ? -homeBase * absImpact * 0.12 : 0;
      const awayInjAdj = absImpact < 0 ? -awayBase * Math.abs(absImpact) * 0.12 : 0;

      const projectedTotal = homeBase + homeInjAdj + awayBase + awayInjAdj + paceAdj;
      const diff = projectedTotal - ouLine;

      // Prob Over : > 50% si projection dépasse la ligne, < 50% sinon
      const motorProbOver  = diff > 0
        ? 0.50 + 0.15 * (1 - Math.exp(-diff / 12))
        : 0.50 - 0.15 * (1 - Math.exp(diff / 12));
      const motorProbUnder = 1 - motorProbOver;

      const adjParts = [];
      if (homeLast5Raw !== null) adjParts.push(`dom last5 ${homeBase.toFixed(1)}`);
      if (awayLast5Raw !== null) adjParts.push(`ext last5 ${awayBase.toFixed(1)}`);
      if (paceDiff !== null) adjParts.push(`pace ${paceAdj > 0 ? '+' : ''}${paceAdj.toFixed(1)}`);
      if (homeInjAdj !== 0) adjParts.push(`inj.dom ${homeInjAdj.toFixed(1)}`);
      if (awayInjAdj !== 0) adjParts.push(`inj.ext ${awayInjAdj.toFixed(1)}`);
      const adjNote = adjParts.length > 0 ? ` (${adjParts.join(', ')})` : '';
      const noteBase = `Projection ${Math.round(projectedTotal)} pts${adjNote} · ligne ${ouLine}`;

      // Toujours ajouter Over ET Under avec motor_prob calculé.
      // has_value = true seulement si edge suffisant — mais motor_prob toujours affiché.
      for (const [side, motorProb] of [['OVER', motorProbOver], ['UNDER', motorProbUnder]]) {
        const bestBook = getBestBookOdds(marketOdds, side, 'totals');
        if (!bestBook) continue;
        const impliedProb = decimalToProb(bestBook.decimalOdds);
        if (impliedProb === null) continue;
        const edge     = motorProb - impliedProb;
        const hasValue = edge >= EDGE_THRESHOLDS.OVER_UNDER;

        recs.push({
          type: 'OVER_UNDER', label: 'Total de points', side,
          odds_line: bestBook.odds, odds_decimal: bestBook.decimalOdds, odds_source: bestBook.bookmaker,
          ou_line:          ouLine,
          motor_prob:       Math.round(motorProb * 100),
          implied_prob:     Math.round(impliedProb * 100),
          predicted_total:  Math.round(projectedTotal),
          market_total:     ouLine,
          home_last5_avg:   homeLast5Raw,
          away_last5_avg:   awayLast5Raw,
          edge:       Math.round(edge * 100),
          confidence: hasValue ? edgeToConfidence(edge) : null,
          has_value:  hasValue,
          note:       noteBase,
          kelly_stake: hasValue ? computeKelly(motorProb, bestBook.odds) : null,
        });
      }
    }
  }

  recs.sort((a, b) => b.edge - a.edge);
  const validRecs = recs.filter(r => r.has_value);
  // Pour l'O/U : inclure aussi les recs sans valeur pour que l'UI affiche
  // la prob moteur sur les deux côtés (Over ET Under). Sans ça, le côté sans
  // edge affiche '—' au lieu de sa prob réelle.
  const ouNoValue = recs.filter(r => r.type === 'OVER_UNDER' && !r.has_value);
  const allRecs   = [...validRecs, ...ouNoValue];
  return {
    recommendations:        allRecs,
    best:                   isCriticalDivergence ? null : (validRecs[0] ?? null),
    computed_at:            new Date().toISOString(),
    market_divergence_flag: marketDivergence?.flag ?? 'low',
    market_divergence_pts:  marketDivergence?.divergence_pts ?? null,
  };
}

// ── MARCHÉ / DIVERGENCE ───────────────────────────────────────────────────────

export function computeMarketDivergence(score, matchData) {
  if (score === null || score === undefined) return null;
  const marketOdds = matchData?.market_odds ?? null;
  const odds       = matchData?.odds ?? null;

  const decToProb = d => d && d > 1 ? 1 / d : null;
  const amToProb  = n => n != null ? americanToProb(Number(n)) : null;

  const homeProb = marketOdds?.home_ml_decimal ? decToProb(marketOdds.home_ml_decimal) : amToProb(odds?.home_ml);
  const awayProb = marketOdds?.away_ml_decimal ? decToProb(marketOdds.away_ml_decimal) : amToProb(odds?.away_ml);
  if (homeProb == null || awayProb == null) return null;

  const divergencePts = Math.round(Math.max(Math.abs(score - homeProb), Math.abs((1 - score) - awayProb)) * 100);
  let flag = 'low';
  if (divergencePts >= 28)      flag = 'critical';
  else if (divergencePts >= 20) flag = 'high';
  else if (divergencePts >= 12) flag = 'medium';

  return {
    market_implied_home: Math.round(homeProb * 1000) / 1000,
    market_implied_away: Math.round(awayProb * 1000) / 1000,
    divergence_pts: divergencePts, flag,
  };
}

export function computeConfidencePenalty(homeInjuries, awayInjuries, marketDivergence = null) {
  const STATUS_WEIGHT = { 'Out': 1.0, 'Doubtful': 0.70, 'Questionable': 0.35, 'Day-To-Day': 0.30, 'GTD': 0.30, 'Limited': 0.45 };
  const scoreSide = injuries => {
    if (!Array.isArray(injuries)) return 0;
    return injuries.reduce((sum, p) => {
      const ppg = Number(p?.ppg ?? 0) || 0;
      const statusWeight = STATUS_WEIGHT[p?.status] ?? 0;
      const roleWeight   = ppg >= 20 ? 1.0 : ppg >= 12 ? 0.6 : 0.25;
      return sum + statusWeight * roleWeight;
    }, 0);
  };

  let penalty = 0;
  const uncertaintyScore = scoreSide(homeInjuries) + scoreSide(awayInjuries);

  if (uncertaintyScore >= 1.5) penalty += 0.05;
  if (uncertaintyScore >= 2.5) penalty += 0.05;
  if (marketDivergence?.flag === 'high')     penalty += 0.08;
  if (marketDivergence?.flag === 'critical') penalty += 0.15;

  return {
    score:             Math.min(0.25, Math.round(penalty * 1000) / 1000),
    uncertainty_score: Math.round(uncertaintyScore * 1000) / 1000,
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

export function computeKelly(p, americanOdds) {
  if (p === null || americanOdds === null) return null;
  const b = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  const kelly = (b * p - (1 - p)) / b;
  if (kelly <= 0) return 0;
  return Math.min(kelly * KELLY_FRACTION, KELLY_MAX_PCT);
}

export function getBestBookOdds(marketOdds, side, market) {
  if (!marketOdds?.bookmakers?.length) return null;

  const PRIORITY = ['winamax', 'pinnacle', 'betclic', 'unibet_eu', 'betsson', 'bet365'];

  const _getOdds = (bk) => {
    if (market === 'h2h')    return side === 'HOME' ? bk.home_ml : bk.away_ml;
    if (market === 'spreads') return side === 'HOME' ? bk.home_spread : bk.away_spread;
    if (market === 'totals')  return side === 'OVER' ? bk.over_total : bk.under_total;
    return null;
  };

  for (const key of PRIORITY) {
    const bk = marketOdds.bookmakers.find(b => b.key === key);
    if (!bk) continue;
    const oddsDecimal = _getOdds(bk);
    if (!oddsDecimal || oddsDecimal <= 1) continue;
    const american = oddsDecimal >= 2 ? Math.round((oddsDecimal - 1) * 100) : Math.round(-100 / (oddsDecimal - 1));
    return { odds: american, decimalOdds: oddsDecimal, bookmaker: bk.title ?? bk.key };
  }

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

function edgeToConfidence(edge) {
  if (edge >= 0.10) return 'FORTE';
  if (edge >= 0.06) return 'MOYENNE';
  return 'FAIBLE';
}
