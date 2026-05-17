/**
 * MBP · summary best bets tennis · pure function.
 *
 * Lecture · logs tennis settlés via `/tennis/bot/logs` ou fixture locale.
 * Classification · réutilise `src/ui/ui.bot.classifier.js` · BET_CATEGORY.
 * Outcome best bet · `best_side === result_winner` (PAS `motor_was_right` ·
 * qui dépend de `motor_prob>50` · faux en contrarian · voir worker.js:10573).
 *
 * Sans dépendance navigateur · pas de réseau · testable Node.
 *
 * Règle métier (validée ChatGPT 2026-05-17) ·
 *   - Best bet = `best_side` non null OU `betting_recommendations.best` non null
 *   - Value idea = recos non vides ET pas de best · exclues du hit rate
 *   - No bet = pas de recos · exclues du hit rate
 *   - Hit rate calculé uniquement sur best bets settlés
 *   - Sample < 50 settled → INSUFFICIENT_SAMPLE
 *   - ROI flat stake 1 unité · si odds_decimal disponible · sinon non calculable
 */

import { BET_CATEGORY, classifyLogBet } from '../../src/ui/ui.bot.classifier.js';

const MIN_SAMPLE_DECISION = 50;
const HIT_FLOOR_ALERT     = 50;
const HIT_NEUTRAL_HIGH    = 54;
const HIT_POSITIVE_SIGNAL = 55;

// ── Helpers ─────────────────────────────────────────────────────────────────

function pctFromCounts(correct, total) {
  if (!total) return null;
  return Math.round((correct / total) * 1000) / 10;
}

function avgNumeric(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 1000) / 1000;
}

function bestSide(log) {
  return log?.best_side ?? log?.betting_recommendations?.best?.side ?? null;
}

function bestOddsDecimal(log) {
  const best = log?.betting_recommendations?.best ?? null;
  if (!best) return null;
  if (Number.isFinite(best.odds_decimal) && best.odds_decimal > 1) return best.odds_decimal;
  // Fallback · si seulement odds_line en format américain (peu probable tennis · garde-fou)
  return null;
}

function bestEdge(log) {
  return log?.best_edge ?? log?.betting_recommendations?.best?.edge ?? null;
}

function bestKelly(log) {
  return log?.betting_recommendations?.best?.kelly_stake ?? null;
}

function bestIsContrarian(log) {
  return !!(log?.betting_recommendations?.best?.is_contrarian);
}

function isSettled(log) {
  return log?.motor_was_right === true || log?.motor_was_right === false;
}

/**
 * Outcome d'un best bet · true=win · false=loss · null=pending OU pas best bet.
 * Formule canonique · `best_side === result_winner`.
 * Distincte de `motor_was_right` (qui dépend de motor_prob>50 · contrarian-incompatible).
 */
function bestBetOutcome(log) {
  const side = bestSide(log);
  if (!side) return null;
  const winner = log?.result_winner ?? null;
  if (winner !== 'HOME' && winner !== 'AWAY') return null;
  return side === winner;
}

// ── Décision produit ────────────────────────────────────────────────────────

function buildDecision(recommendedSettled, hitRate) {
  if (recommendedSettled < MIN_SAMPLE_DECISION) {
    return {
      status:  'INSUFFICIENT_SAMPLE',
      message: 'Échantillon insuffisant · ne pas conclure sur la performance tennis.',
    };
  }
  if (hitRate === null) {
    return {
      status:  'INSUFFICIENT_SAMPLE',
      message: 'Hit rate non calculable · données manquantes.',
    };
  }
  if (hitRate < HIT_FLOOR_ALERT) {
    return {
      status:  'ALERT_BELOW_50',
      message: 'Alerte · best bets tennis sous 50% · surveiller ou réduire exposition.',
    };
  }
  if (hitRate <= HIT_NEUTRAL_HIGH) {
    return {
      status:  'NEUTRAL_ZONE',
      message: 'Zone neutre · performance à surveiller.',
    };
  }
  if (hitRate >= HIT_POSITIVE_SIGNAL) {
    return {
      status:  'POSITIVE_SIGNAL',
      message: 'Signal positif · best bets tennis potentiellement exploitables · à confirmer sur volume supérieur.',
    };
  }
  // Entre 54% (exclu) et 55% (exclu) · zone gris · traiter comme neutre
  return {
    status:  'NEUTRAL_ZONE',
    message: 'Zone neutre · performance à surveiller.',
  };
}

// ── Segments ────────────────────────────────────────────────────────────────

function bucketStats(bestBets) {
  const settled = bestBets.filter(isSettled);
  const wins    = settled.filter(l => bestBetOutcome(l) === true);
  return {
    total:    bestBets.length,
    settled:  settled.length,
    wins:     wins.length,
    losses:   settled.length - wins.length,
    hit_rate: pctFromCounts(wins.length, settled.length),
  };
}

function segmentByConfidence(bestBets) {
  const labels = ['HIGH', 'MEDIUM', 'LOW', 'INCONCLUSIVE'];
  const out = {};
  for (const label of labels) {
    out[label] = bucketStats(bestBets.filter(l => (l?.confidence_level ?? null) === label));
  }
  return out;
}

function segmentBySide(bestBets) {
  return {
    HOME: bucketStats(bestBets.filter(l => bestSide(l) === 'HOME')),
    AWAY: bucketStats(bestBets.filter(l => bestSide(l) === 'AWAY')),
  };
}

function segmentByContrarian(bestBets) {
  return {
    contrarian:     bucketStats(bestBets.filter(l => bestIsContrarian(l) === true)),
    non_contrarian: bucketStats(bestBets.filter(l => bestIsContrarian(l) === false)),
  };
}

function segmentByTournament(bestBets) {
  const map = {};
  for (const l of bestBets) {
    const t = l?.tournament ?? l?.tourney_name ?? 'unknown';
    if (!map[t]) map[t] = [];
    map[t].push(l);
  }
  const out = {};
  for (const [t, arr] of Object.entries(map)) {
    out[t] = bucketStats(arr);
  }
  return out;
}

// ── ROI flat stake 1 unité ─────────────────────────────────────────────────

function computeROI(bestBetsSettled) {
  const usable = bestBetsSettled.filter(l => {
    const od = bestOddsDecimal(l);
    return od !== null && bestBetOutcome(l) !== null;
  });
  if (usable.length === 0) {
    return {
      available:   false,
      note:        'ROI non calculable · cote décimale manquante sur les best bets settlés.',
      sample:      0,
      profit_units: null,
      roi_pct:     null,
    };
  }
  let profit = 0;
  for (const l of usable) {
    const od  = bestOddsDecimal(l);
    const won = bestBetOutcome(l);
    profit += won ? (od - 1) : -1;
  }
  const stake = usable.length; // 1 unité par bet
  return {
    available:   true,
    note:        usable.length < bestBetsSettled.length
      ? `ROI calculé sur ${usable.length}/${bestBetsSettled.length} best bets settlés · cote manquante sur les autres`
      : `ROI calculé sur l'intégralité des ${usable.length} best bets settlés`,
    sample:      usable.length,
    profit_units: Math.round(profit * 100) / 100,
    roi_pct:     Math.round((profit / stake) * 1000) / 10,
  };
}

// ── Summary global ─────────────────────────────────────────────────────────

export function summarizeTennisBestBets(logs) {
  const all = Array.isArray(logs) ? logs : [];
  const recommended = all.filter(l => classifyLogBet(l) === BET_CATEGORY.RECOMMENDED);
  const valueIdea   = all.filter(l => classifyLogBet(l) === BET_CATEGORY.VALUE_IDEA);
  const noBet       = all.filter(l => classifyLogBet(l) === BET_CATEGORY.NO_BET);

  const recommendedSettled = recommended.filter(isSettled);
  const wins   = recommendedSettled.filter(l => bestBetOutcome(l) === true);
  const losses = recommendedSettled.filter(l => bestBetOutcome(l) === false);
  const hitRate = pctFromCounts(wins.length, recommendedSettled.length);

  const allSettled = all.filter(isSettled);

  return {
    period: {
      start: all.map(l => l?.date).filter(Boolean).sort()[0] ?? null,
      end:   all.map(l => l?.date).filter(Boolean).sort().slice(-1)[0] ?? null,
    },
    volume: {
      total_logs:                    all.length,
      settled_logs:                  allSettled.length,
      recommended_bets_total:        recommended.length,
      recommended_bets_settled:      recommendedSettled.length,
      value_ideas_not_selected_total: valueIdea.length,
      no_bet_analysis_total:         noBet.length,
    },
    performance_best_bets: {
      hit_rate:             hitRate,
      wins:                 wins.length,
      losses:               losses.length,
      pending:              recommended.length - recommendedSettled.length,
      average_edge:         avgNumeric(recommended.map(l => bestEdge(l))),
      average_kelly:        avgNumeric(recommended.map(l => bestKelly(l))),
      average_data_quality: avgNumeric(recommended.map(l => l?.data_quality)),
      by_confidence:        segmentByConfidence(recommended),
    },
    segments: {
      by_tournament:        segmentByTournament(recommended),
      by_side:              segmentBySide(recommended),
      contrarian_vs_non:    segmentByContrarian(recommended),
    },
    roi: computeROI(recommendedSettled),
    decision: buildDecision(recommendedSettled.length, hitRate),
  };
}

// ── Format console ─────────────────────────────────────────────────────────

function fmt(v, suffix = '') {
  if (v === null || v === undefined) return '—';
  return `${v}${suffix}`;
}

export function formatTennisBestBetsReport(summary) {
  const lines = [];
  lines.push('TENNIS · BEST BETS MONITORING');
  lines.push('');
  lines.push(`Période · ${summary.period.start ?? '—'} → ${summary.period.end ?? '—'}`);
  lines.push('');

  lines.push('VOLUME');
  const v = summary.volume;
  lines.push(`  total logs                       · ${v.total_logs}`);
  lines.push(`  settled (tout)                   · ${v.settled_logs}`);
  lines.push(`  best bets total                  · ${v.recommended_bets_total}`);
  lines.push(`  best bets settled                · ${v.recommended_bets_settled}`);
  lines.push(`  idées value non retenues         · ${v.value_ideas_not_selected_total} (exclues du hit rate)`);
  lines.push(`  analyses sans pari               · ${v.no_bet_analysis_total} (exclues du hit rate)`);
  lines.push('');

  lines.push('PERFORMANCE BEST BETS UNIQUEMENT');
  const p = summary.performance_best_bets;
  lines.push(`  hit rate                         · ${fmt(p.hit_rate, '%')}`);
  lines.push(`  wins / losses / pending          · ${p.wins} / ${p.losses} / ${p.pending}`);
  lines.push(`  average edge                     · ${fmt(p.average_edge, '%')}`);
  lines.push(`  average kelly stake              · ${fmt(p.average_kelly)}`);
  lines.push(`  average data_quality             · ${fmt(p.average_data_quality)}`);
  lines.push('');

  lines.push('PAR CONFIDENCE');
  for (const lvl of ['HIGH', 'MEDIUM', 'LOW', 'INCONCLUSIVE']) {
    const b = p.by_confidence[lvl];
    if (b.total === 0) continue;
    lines.push(`  ${lvl.padEnd(13)} · n=${b.settled}/${b.total} · wins=${b.wins} · hit=${fmt(b.hit_rate, '%')}`);
  }
  lines.push('');

  lines.push('PAR CÔTÉ');
  for (const side of ['HOME', 'AWAY']) {
    const b = summary.segments.by_side[side];
    if (b.total === 0) continue;
    lines.push(`  ${side.padEnd(5)} · n=${b.settled}/${b.total} · wins=${b.wins} · hit=${fmt(b.hit_rate, '%')}`);
  }
  lines.push('');

  lines.push('CONTRARIAN VS NON-CONTRARIAN');
  for (const k of ['contrarian', 'non_contrarian']) {
    const b = summary.segments.contrarian_vs_non[k];
    if (b.total === 0) { lines.push(`  ${k.padEnd(15)} · n=0`); continue; }
    lines.push(`  ${k.padEnd(15)} · n=${b.settled}/${b.total} · wins=${b.wins} · hit=${fmt(b.hit_rate, '%')}`);
  }
  lines.push('');

  const byTourn = Object.entries(summary.segments.by_tournament);
  if (byTourn.length > 0) {
    lines.push('PAR TOURNOI');
    for (const [t, b] of byTourn.sort((a, b) => b[1].total - a[1].total).slice(0, 15)) {
      lines.push(`  ${String(t).padEnd(35)} · n=${b.settled}/${b.total} · hit=${fmt(b.hit_rate, '%')}`);
    }
    lines.push('');
  }

  lines.push('ROI FLAT STAKE 1 UNITÉ');
  const r = summary.roi;
  if (!r.available) {
    lines.push(`  ${r.note}`);
  } else {
    lines.push(`  profit (units)                   · ${r.profit_units}`);
    lines.push(`  ROI                              · ${fmt(r.roi_pct, '%')}`);
    lines.push(`  sample                           · ${r.sample}`);
    lines.push(`  ${r.note}`);
  }
  lines.push('');

  lines.push('DÉCISION');
  lines.push(`  statut  · ${summary.decision.status}`);
  lines.push(`  message · ${summary.decision.message}`);
  lines.push('');
  lines.push('Note · ne pas confondre best bet (pari retenu par le moteur) avec idée value (signal mathématique non retenu). Les idées value ne sont JAMAIS comptées dans le hit rate.');
  return lines.join('\n');
}

export const _CONST = Object.freeze({
  MIN_SAMPLE_DECISION,
  HIT_FLOOR_ALERT,
  HIT_NEUTRAL_HIGH,
  HIT_POSITIVE_SIGNAL,
});
