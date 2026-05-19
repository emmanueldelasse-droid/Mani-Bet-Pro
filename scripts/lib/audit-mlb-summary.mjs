/**
 * MBP-AUDIT-MLB · lib pure · audit empirique logs MLB
 *
 * Fonctions pures pour calculer toutes les métriques d'audit MLB demandées
 * par ChatGPT (GO empirique d'abord · pas de décision sans dump réel) ·
 *  - IC 95% Wilson · ROI flat stake · Brier · drawdown
 *  - Buckets edge · motor_prob · DQ · favorite/underdog · home/away
 *  - Variables présence · pitcher_data_source breakdown
 *  - Conclusion automatique selon STATS_RULES borne basse 52.4%
 *
 * Conventions log MLB (cf docs/engine/BETTING_LOGIC.md MLB section) ·
 *  - home_prob · motor_prob (post settlement)
 *  - best_edge · best_side
 *  - data_quality · 'HIGH' | 'MEDIUM' | 'LOW' (label · pas numérique)
 *  - odds_at_analysis · { home_ml, away_ml } en American odds
 *  - motor_was_right · boolean (post settle)
 *  - status · post MBP-CATCHUP-SETTLE · pending | settled | missed_by_cron |
 *    postponed | cancelled | invalid_match_mapping | recovery_failed
 *  - variables · { pitcher_fip_diff, last10_form_pct, ops_adv_pct, ... }
 *  - pitcher_data_source · optionnel · 'fip' | 'era' | 'fallback_4.20' (P2 TODO)
 *
 * Aucun import worker.js · pure ESM · testable offline.
 */

// ── Constantes ──────────────────────────────────────────────────────────────

export const STATS_EXCLUDED_STATUSES = new Set([
  'missed_by_cron',
  'recovery_failed',
  'postponed',
  'cancelled',
  'invalid_match_mapping',
]);

export const JUICE_BREAKEVEN_5PCT = 52.4; // hit_rate minimum profitable cotes 1.91 typique
export const SAMPLE_INSUFFICIENT  = 100;  // STATS_RULES seuil ACCEPTABLE
export const SAMPLE_FRAGILE       = 30;   // STATS_RULES seuil VERY LOW

export const EDGE_BUCKETS = [
  { label: 'edge_0_5',    min:  0, max:  5 },
  { label: 'edge_5_7',    min:  5, max:  7 },
  { label: 'edge_7_10',   min:  7, max: 10 },
  { label: 'edge_10_plus',min: 10, max: Infinity },
];

export const MOTOR_PROB_BUCKETS = [
  { label: '50_55', min: 50, max: 55 },
  { label: '55_60', min: 55, max: 60 },
  { label: '60_65', min: 60, max: 65 },
  { label: '65_70', min: 65, max: 70 },
  { label: '70_80', min: 70, max: 80 },
];

// ── Helpers numériques ──────────────────────────────────────────────────────

/**
 * IC 95% Wilson · binomial proportion confidence interval.
 * Retourne pourcentages (0-100).
 */
export function wilsonCI(k, n, z = 1.96) {
  if (!n || n <= 0) return { center_pct: null, low_pct: null, high_pct: null, n: 0, k: 0 };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / denom;
  return {
    n,
    k,
    center_pct: Math.round(center * 1000) / 10,
    low_pct:    Math.round(Math.max(0, center - margin) * 1000) / 10,
    high_pct:   Math.round(Math.min(1, center + margin) * 1000) / 10,
  };
}

/**
 * American odds → decimal.
 * -150 → 1.667 · +200 → 3.0
 */
export function americanToDecimal(am) {
  if (am == null || !Number.isFinite(am)) return null;
  if (am < 0)  return (100 / Math.abs(am)) + 1;
  return (am / 100) + 1;
}

/**
 * American odds → implied probability (no devig).
 */
export function americanToImplied(am) {
  if (am == null || !Number.isFinite(am)) return null;
  if (am < 0)  return Math.abs(am) / (Math.abs(am) + 100);
  return 100 / (am + 100);
}

// ── Statut log (back-compat) ────────────────────────────────────────────────

/**
 * Résout le statut effectif d'un log (back-compat logs pré-PR #205).
 */
export function logStatus(log) {
  if (!log) return null;
  if (log.status) return log.status;
  if (log.motor_was_right == null) return 'pending';
  return 'settled';
}

export function isStatsExcluded(log) {
  return STATS_EXCLUDED_STATUSES.has(logStatus(log));
}

export function isSettled(log) {
  return logStatus(log) === 'settled'
      && log.motor_was_right != null
      && (log.motor_was_right === true || log.motor_was_right === false);
}

// ── Status breakdown ────────────────────────────────────────────────────────

export function computeStatusBreakdown(logs) {
  const out = {};
  for (const l of logs) {
    const s = logStatus(l);
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

// ── Filtres ─────────────────────────────────────────────────────────────────

export function filterEligible(logs) {
  return logs.filter(l => !isStatsExcluded(l));
}

export function filterSettled(logs) {
  // Eligible + actually settled (motor_was_right resolved)
  return filterEligible(logs).filter(isSettled);
}

// ── Hit rate ────────────────────────────────────────────────────────────────

export function computeHitRate(settledLogs) {
  const n = settledLogs.length;
  const k = settledLogs.filter(l => l.motor_was_right === true).length;
  return wilsonCI(k, n);
}

// ── Rolling window (N derniers settled) ─────────────────────────────────────

export function computeRollingWindow(settledLogs, windowSize) {
  const sorted = [...settledLogs].sort((a, b) => {
    const ta = a.settled_at ?? a.logged_at ?? '';
    const tb = b.settled_at ?? b.logged_at ?? '';
    return tb.localeCompare(ta); // DESC
  });
  const slice = sorted.slice(0, windowSize);
  return {
    window: windowSize,
    available: slice.length,
    ...computeHitRate(slice),
  };
}

/**
 * Tendance · split en 4 quarts égaux (Q1 = plus ancien · Q4 = plus récent).
 * Retourne hit rate par quart pour visualiser évolution.
 */
export function computeTrend(settledLogs) {
  const sorted = [...settledLogs].sort((a, b) => {
    const ta = a.settled_at ?? a.logged_at ?? '';
    const tb = b.settled_at ?? b.logged_at ?? '';
    return ta.localeCompare(tb); // ASC
  });
  const q = Math.floor(sorted.length / 4);
  if (q < 5) return { available: false, reason: 'sample_too_small_for_quartiles' };
  return {
    available: true,
    quartiles: [
      { label: 'Q1_ancien', ...computeHitRate(sorted.slice(0, q)) },
      { label: 'Q2',        ...computeHitRate(sorted.slice(q, 2 * q)) },
      { label: 'Q3',        ...computeHitRate(sorted.slice(2 * q, 3 * q)) },
      { label: 'Q4_recent', ...computeHitRate(sorted.slice(3 * q)) },
    ],
  };
}

// ── Edge buckets ────────────────────────────────────────────────────────────

export function computeEdgeBuckets(settledLogs) {
  return EDGE_BUCKETS.map(b => {
    const subset = settledLogs.filter(l => {
      const e = l.best_edge;
      return e != null && e >= b.min && e < b.max;
    });
    return {
      bucket: b.label,
      range: [b.min, b.max === Infinity ? null : b.max],
      ...computeHitRate(subset),
    };
  });
}

// ── Motor prob buckets + Brier ──────────────────────────────────────────────

function motorProbOf(log) {
  // Backend MLB · log.home_prob (worker.js:9068). Si best_side = AWAY, motor "vrai" = 100 - home_prob.
  if (log.home_prob != null) return log.home_prob;
  if (log.motor_prob != null) return log.motor_prob;
  return null;
}

export function computeMotorProbBuckets(settledLogs) {
  return MOTOR_PROB_BUCKETS.map(b => {
    const subset = settledLogs.filter(l => {
      const p = motorProbOf(l);
      return p != null && p >= b.min && p < b.max;
    });
    const hit = computeHitRate(subset);
    const brier = computeBrierForSubset(subset);
    return {
      bucket: b.label,
      range: [b.min, b.max],
      ...hit,
      brier_score: brier.calculable ? brier.value : null,
      brier_n:     brier.n,
    };
  });
}

// ── Brier score ─────────────────────────────────────────────────────────────

function computeBrierForSubset(subset) {
  const valid = subset.filter(l => motorProbOf(l) != null && l.result_winner != null);
  if (valid.length === 0) return { calculable: false, n: 0, value: null };
  const sum = valid.reduce((s, l) => {
    const p = motorProbOf(l) / 100;
    const actual = l.result_winner === 'HOME' ? 1 : 0;
    return s + Math.pow(p - actual, 2);
  }, 0);
  return {
    calculable: true,
    n: valid.length,
    value: Math.round((sum / valid.length) * 10000) / 10000,
  };
}

export function computeBrier(settledLogs) {
  return computeBrierForSubset(settledLogs);
}

// ── Favoris / outsiders ─────────────────────────────────────────────────────

export function computeFavoriteUnderdog(settledLogs) {
  const out = {
    no_odds_available: 0,
    best_was_favorite:  { wins: 0, losses: 0 },
    best_was_underdog:  { wins: 0, losses: 0 },
  };
  for (const l of settledLogs) {
    const odds = l.odds_at_analysis;
    if (!odds || odds.home_ml == null || odds.away_ml == null || !l.best_side) {
      out.no_odds_available++;
      continue;
    }
    const impliedHome = americanToImplied(odds.home_ml);
    const favoriteSide = impliedHome > 0.5 ? 'HOME' : 'AWAY';
    const wasFavorite = l.best_side === favoriteSide;
    const win = l.motor_was_right === true;
    if (wasFavorite) {
      if (win) out.best_was_favorite.wins++; else out.best_was_favorite.losses++;
    } else {
      if (win) out.best_was_underdog.wins++; else out.best_was_underdog.losses++;
    }
  }
  out.favorite_ci = wilsonCI(out.best_was_favorite.wins,
                              out.best_was_favorite.wins + out.best_was_favorite.losses);
  out.underdog_ci = wilsonCI(out.best_was_underdog.wins,
                              out.best_was_underdog.wins + out.best_was_underdog.losses);
  return out;
}

// ── Home / away ─────────────────────────────────────────────────────────────

export function computeHomeAway(settledLogs) {
  const home = settledLogs.filter(l => l.best_side === 'HOME');
  const away = settledLogs.filter(l => l.best_side === 'AWAY');
  return {
    best_side_home: { ...computeHitRate(home) },
    best_side_away: { ...computeHitRate(away) },
    no_best_side:   settledLogs.filter(l => !l.best_side).length,
  };
}

// ── Data quality ────────────────────────────────────────────────────────────

export function computeDataQualityBuckets(settledLogs) {
  const labels = ['HIGH', 'MEDIUM', 'LOW'];
  const out = {};
  for (const lbl of labels) {
    const subset = settledLogs.filter(l => l.data_quality === lbl);
    out[lbl] = { ...computeHitRate(subset) };
  }
  out.missing_data_quality = settledLogs.filter(l => l.data_quality == null).length;
  return out;
}

// ── ROI flat stake ──────────────────────────────────────────────────────────

/**
 * ROI flat stake 1 unité par pari.
 * Nécessite log.best_side + odds_at_analysis (home_ml/away_ml).
 * Si pas d'odds disponibles, retourne calculable=false.
 */
export function computeROI(settledLogs) {
  const eligible = [];
  let skipped_no_odds = 0;
  let skipped_no_side = 0;
  for (const l of settledLogs) {
    if (!l.best_side) { skipped_no_side++; continue; }
    const odds = l.odds_at_analysis;
    if (!odds) { skipped_no_odds++; continue; }
    const oddsSide = l.best_side === 'HOME' ? odds.home_ml : odds.away_ml;
    const dec = americanToDecimal(oddsSide);
    if (dec == null) { skipped_no_odds++; continue; }
    eligible.push({ log: l, decimal_odds: dec });
  }
  if (eligible.length === 0) {
    return { calculable: false, reason: 'no_odds_in_logs', n: 0, skipped_no_odds, skipped_no_side };
  }
  let totalProfit = 0;
  let wins = 0;
  for (const { log, decimal_odds } of eligible) {
    if (log.motor_was_right === true) {
      totalProfit += (decimal_odds - 1);
      wins++;
    } else {
      totalProfit -= 1;
    }
  }
  const roi = totalProfit / eligible.length;
  const avgOdds = eligible.reduce((s, e) => s + e.decimal_odds, 0) / eligible.length;
  return {
    calculable: true,
    n: eligible.length,
    wins,
    losses: eligible.length - wins,
    total_profit_units: Math.round(totalProfit * 100) / 100,
    roi_pct: Math.round(roi * 10000) / 100,
    avg_decimal_odds: Math.round(avgOdds * 1000) / 1000,
    skipped_no_odds,
    skipped_no_side,
  };
}

// ── Drawdown ────────────────────────────────────────────────────────────────

/**
 * Drawdown maximum sur equity curve flat-stake.
 * Nécessite odds disponibles.
 */
export function computeDrawdown(settledLogs) {
  const sorted = [...settledLogs].sort((a, b) => {
    const ta = a.settled_at ?? a.logged_at ?? '';
    const tb = b.settled_at ?? b.logged_at ?? '';
    return ta.localeCompare(tb); // ASC
  });
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  let used = 0;
  let losingStreak = 0;
  let maxLosingStreak = 0;
  let winningStreak = 0;
  let maxWinningStreak = 0;
  for (const l of sorted) {
    if (!l.best_side || !l.odds_at_analysis) continue;
    const oddsSide = l.best_side === 'HOME' ? l.odds_at_analysis.home_ml : l.odds_at_analysis.away_ml;
    const dec = americanToDecimal(oddsSide);
    if (dec == null) continue;
    used++;
    if (l.motor_was_right === true) {
      equity += (dec - 1);
      losingStreak = 0;
      winningStreak++;
      if (winningStreak > maxWinningStreak) maxWinningStreak = winningStreak;
    } else {
      equity -= 1;
      winningStreak = 0;
      losingStreak++;
      if (losingStreak > maxLosingStreak) maxLosingStreak = losingStreak;
    }
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }
  if (used === 0) return { calculable: false, reason: 'no_odds_in_logs' };
  return {
    calculable: true,
    n: used,
    final_equity_units: Math.round(equity * 100) / 100,
    peak_equity_units: Math.round(peak * 100) / 100,
    max_drawdown_units: Math.round(maxDD * 100) / 100,
    max_losing_streak: maxLosingStreak,
    max_winning_streak: maxWinningStreak,
  };
}

// ── Variables présence ──────────────────────────────────────────────────────

export function computeVariablesPresence(eligibleLogs) {
  const counts = {};
  for (const l of eligibleLogs) {
    const vars = l.variables ?? {};
    for (const [k, v] of Object.entries(vars)) {
      counts[k] ??= { present: 0, missing: 0 };
      if (v == null || (typeof v === 'object' && v.value == null)) {
        counts[k].missing++;
      } else {
        counts[k].present++;
      }
    }
  }
  const total = eligibleLogs.length;
  return Object.fromEntries(
    Object.entries(counts).map(([k, c]) => [
      k,
      {
        present: c.present,
        missing: c.missing,
        presence_rate_pct: total > 0 ? Math.round((c.present / total) * 1000) / 10 : null,
      },
    ])
  );
}

// ── Pitcher data source ─────────────────────────────────────────────────────

export function computePitcherDataSource(eligibleLogs) {
  let withField = 0;
  const breakdown = { fip: 0, era: 0, 'fallback_4.20': 0, other: 0 };
  for (const l of eligibleLogs) {
    if (!l.pitcher_data_source) continue;
    withField++;
    const src = l.pitcher_data_source;
    if (breakdown[src] !== undefined) breakdown[src]++;
    else breakdown.other++;
  }
  if (withField === 0) {
    return {
      available: false,
      reason: 'field_pitcher_data_source_not_logged · TODO P2 worker.js',
      logs_inspected: eligibleLogs.length,
    };
  }
  return {
    available: true,
    logs_inspected: eligibleLogs.length,
    logs_with_field: withField,
    breakdown,
  };
}

// ── Conclusion automatique ──────────────────────────────────────────────────

/**
 * Conclusion automatique selon STATS_RULES.md.
 *  - EDGE_DEMONTRE · IC borne basse > 52.4% (juice 5%)
 *  - DESACTIVATION_RECOMMANDEE · IC borne haute < 50% OU ROI < -5% sur n>=100
 *  - SAMPLE_INSUFFISANT · n_settled < 100
 *  - EDGE_NON_DEMONTRE · IC contient 52.4% mais borne basse < 52.4%
 *  - MONITORING_RECOMMANDE · ROI calculable entre -5% et 0% sur n>=100
 */
export function generateConclusion(summary) {
  const reasons = [];
  const settled = summary.settled_eligible;
  const hit = summary.hit_rate_global;
  const roi = summary.roi;

  if (settled < SAMPLE_INSUFFICIENT) {
    reasons.push(`n=${settled} < ${SAMPLE_INSUFFICIENT} · STATS_RULES catégorie ACCEPTABLE non atteinte`);
    return {
      verdict: 'SAMPLE_INSUFFISANT',
      reasons,
      action: 'Continuer logger · re-auditer à 100+ logs settled',
    };
  }

  if (hit.low_pct != null && hit.low_pct > JUICE_BREAKEVEN_5PCT) {
    reasons.push(`IC 95% borne basse ${hit.low_pct}% > ${JUICE_BREAKEVEN_5PCT}% (juice 5%)`);
    if (roi.calculable) {
      if (roi.roi_pct > 0) reasons.push(`ROI flat-stake ${roi.roi_pct}% positif`);
      else reasons.push(`ATTENTION · ROI flat-stake ${roi.roi_pct}% non positif malgré IC borne basse OK (cotes courtes ?)`);
    }
    return {
      verdict: 'EDGE_DEMONTRE',
      reasons,
      action: 'Conserver · monitoring continu · valider CLV (TODO P2 logger closing_odds)',
    };
  }

  if (hit.high_pct != null && hit.high_pct < 50) {
    reasons.push(`IC 95% borne haute ${hit.high_pct}% < 50% · sous random`);
    return {
      verdict: 'DESACTIVATION_RECOMMANDEE',
      reasons,
      action: 'Désactivation moneyline + investigation cause structurelle',
    };
  }

  if (roi.calculable && roi.n >= SAMPLE_INSUFFICIENT && roi.roi_pct < -5) {
    reasons.push(`ROI flat-stake ${roi.roi_pct}% < -5% sur n=${roi.n} settled avec odds`);
    return {
      verdict: 'DESACTIVATION_RECOMMANDEE',
      reasons,
      action: 'Désactivation moneyline · pertes structurelles documentées',
    };
  }

  if (roi.calculable && roi.n >= SAMPLE_INSUFFICIENT && roi.roi_pct < 0) {
    reasons.push(`ROI flat-stake ${roi.roi_pct}% négatif mais > -5% sur n=${roi.n}`);
    reasons.push(`IC hit rate [${hit.low_pct}%, ${hit.high_pct}%] contient 52.4%`);
    return {
      verdict: 'MONITORING_RECOMMANDE',
      reasons,
      action: 'Surveiller · pas de désactivation · pas d\'edge prouvé · attendre +200 logs',
    };
  }

  reasons.push(`IC hit rate [${hit.low_pct ?? '?'}%, ${hit.high_pct ?? '?'}%] indistinguable de l'edge minimum`);
  if (!roi.calculable) reasons.push('ROI non calculable · odds_at_analysis absent des logs');
  return {
    verdict: 'EDGE_NON_DEMONTRE',
    reasons,
    action: 'Continuer logger · pas de décision désactivation justifiée statistiquement',
  };
}

// ── Orchestrateur ───────────────────────────────────────────────────────────

/**
 * Audit MLB complet sur logs raw (depuis dump /mlb/bot/logs).
 * Input · array de logs OU objet { logs: [...] } OU { available, logs }
 * Retourne · summary object structuré.
 */
export function auditMlbLogs(input) {
  const logs = Array.isArray(input) ? input
              : Array.isArray(input?.logs) ? input.logs
              : [];

  const total_logs_kv = logs.length;
  const status_breakdown = computeStatusBreakdown(logs);
  const eligible = filterEligible(logs);
  const settled = filterSettled(logs);
  const excludedCount = total_logs_kv - eligible.length;
  const pendingCount = eligible.length - settled.length;

  const hit_rate_global = computeHitRate(settled);

  const summary = {
    total_logs_kv,
    total_eligible: eligible.length,
    settled_eligible: settled.length,
    pending: pendingCount,
    excluded_count: excludedCount,
    status_breakdown,
    hit_rate_global,
    rolling: {
      last_25:  computeRollingWindow(settled, 25),
      last_50:  computeRollingWindow(settled, 50),
      last_100: computeRollingWindow(settled, 100),
    },
    trend_quartiles: computeTrend(settled),
    edge_buckets:        computeEdgeBuckets(settled),
    motor_prob_buckets:  computeMotorProbBuckets(settled),
    favorite_underdog:   computeFavoriteUnderdog(settled),
    home_away:           computeHomeAway(settled),
    data_quality:        computeDataQualityBuckets(settled),
    roi:                 computeROI(settled),
    brier:               computeBrier(settled),
    drawdown:            computeDrawdown(settled),
    variables_presence:  computeVariablesPresence(eligible),
    pitcher_data_source: computePitcherDataSource(eligible),
  };

  summary.conclusion = generateConclusion(summary);

  return summary;
}

// ── Formatage console ───────────────────────────────────────────────────────

function fmtCI(ci) {
  if (!ci || ci.center_pct == null) return '—';
  return `${ci.center_pct}% [${ci.low_pct}% · ${ci.high_pct}%] n=${ci.n}`;
}

function fmtBucketLabel(b) {
  const range = b.range[1] == null ? `${b.range[0]}+` : `${b.range[0]}-${b.range[1]}`;
  return `${b.bucket.padEnd(13)} (${range})`.padEnd(28);
}

export function formatReport(summary) {
  const lines = [];
  const sep = '═'.repeat(72);

  lines.push(sep);
  lines.push('AUDIT MLB · logs réels');
  lines.push(sep);

  // §1 status_breakdown
  lines.push('');
  lines.push('§ 1-7 · TOTAUX & STATUS_BREAKDOWN');
  lines.push(`  total_logs_kv         · ${summary.total_logs_kv}`);
  lines.push(`  total_eligible        · ${summary.total_eligible} (stats)`);
  lines.push(`  settled_eligible      · ${summary.settled_eligible}`);
  lines.push(`  pending               · ${summary.pending}`);
  lines.push(`  excluded (5 statuts)  · ${summary.excluded_count}`);
  lines.push(`  status_breakdown      ·`);
  for (const [k, v] of Object.entries(summary.status_breakdown)) {
    lines.push(`    ${k.padEnd(25)} · ${v}`);
  }

  // §7-8 hit rate global + IC
  lines.push('');
  lines.push('§ 7-8 · HIT RATE GLOBAL + IC 95% WILSON');
  lines.push(`  ${fmtCI(summary.hit_rate_global)}`);

  // §9-10 rolling + trend
  lines.push('');
  lines.push('§ 9-10 · ROLLING WINDOW (derniers settled · tri settled_at DESC)');
  for (const [k, v] of Object.entries(summary.rolling)) {
    lines.push(`  ${k.padEnd(10)} · ${fmtCI(v)}`);
  }
  if (summary.trend_quartiles.available) {
    lines.push('  TREND QUARTILES (du plus ancien au plus récent)');
    for (const q of summary.trend_quartiles.quartiles) {
      lines.push(`    ${q.label.padEnd(12)} · ${fmtCI(q)}`);
    }
  } else {
    lines.push(`  trend · ${summary.trend_quartiles.reason}`);
  }

  // §11 edge buckets
  lines.push('');
  lines.push('§ 11 · EDGE BUCKETS + IC 95%');
  for (const b of summary.edge_buckets) {
    const flag = b.n < SAMPLE_FRAGILE ? ' · SAMPLE INSUFFISANT'
               : b.n < SAMPLE_INSUFFICIENT ? ' · fragile'
               : '';
    lines.push(`  ${fmtBucketLabel(b)} · ${fmtCI(b)}${flag}`);
  }

  // §12 motor_prob buckets + Brier per bucket
  lines.push('');
  lines.push('§ 12 · MOTOR_PROB BUCKETS + Brier per bucket (calibration plot)');
  for (const b of summary.motor_prob_buckets) {
    const flag = b.n < SAMPLE_FRAGILE ? ' · SAMPLE INSUFFISANT'
               : b.n < SAMPLE_INSUFFICIENT ? ' · fragile'
               : '';
    const brier = b.brier_score != null ? ` · Brier=${b.brier_score}` : ' · Brier non calculable';
    lines.push(`  ${fmtBucketLabel(b)} · ${fmtCI(b)}${brier}${flag}`);
  }

  // §13 favoris / outsiders
  lines.push('');
  lines.push('§ 13 · FAVORITE vs UNDERDOG');
  const fu = summary.favorite_underdog;
  lines.push(`  best_was_favorite · ${fmtCI(fu.favorite_ci)} (${fu.best_was_favorite.wins}W ${fu.best_was_favorite.losses}L)`);
  lines.push(`  best_was_underdog · ${fmtCI(fu.underdog_ci)} (${fu.best_was_underdog.wins}W ${fu.best_was_underdog.losses}L)`);
  lines.push(`  skipped no_odds   · ${fu.no_odds_available}`);

  // §14 home / away
  lines.push('');
  lines.push('§ 14 · HOME vs AWAY (best_side)');
  lines.push(`  best_side=HOME · ${fmtCI(summary.home_away.best_side_home)}`);
  lines.push(`  best_side=AWAY · ${fmtCI(summary.home_away.best_side_away)}`);
  lines.push(`  no best_side   · ${summary.home_away.no_best_side}`);

  // §15 data_quality
  lines.push('');
  lines.push('§ 15 · DATA_QUALITY (label MLB)');
  for (const lbl of ['HIGH', 'MEDIUM', 'LOW']) {
    lines.push(`  ${lbl.padEnd(7)} · ${fmtCI(summary.data_quality[lbl])}`);
  }
  lines.push(`  missing · ${summary.data_quality.missing_data_quality} logs sans data_quality`);

  // §16 ROI
  lines.push('');
  lines.push('§ 16 · ROI FLAT-STAKE (1 unité par pari)');
  if (summary.roi.calculable) {
    lines.push(`  n             · ${summary.roi.n}`);
    lines.push(`  wins / losses · ${summary.roi.wins} / ${summary.roi.losses}`);
    lines.push(`  total profit  · ${summary.roi.total_profit_units} unités`);
    lines.push(`  ROI           · ${summary.roi.roi_pct}%`);
    lines.push(`  avg odds dec  · ${summary.roi.avg_decimal_odds}`);
    lines.push(`  skipped       · no_odds=${summary.roi.skipped_no_odds} · no_side=${summary.roi.skipped_no_side}`);
  } else {
    lines.push(`  NON CALCULABLE · ${summary.roi.reason ?? 'odds absentes'}`);
    lines.push(`  skipped       · no_odds=${summary.roi.skipped_no_odds} · no_side=${summary.roi.skipped_no_side}`);
  }

  // §17 Brier global
  lines.push('');
  lines.push('§ 17 · BRIER SCORE GLOBAL');
  if (summary.brier.calculable) {
    lines.push(`  n=${summary.brier.n} · Brier=${summary.brier.value}`);
    lines.push(`  Référence · random=0.250 · calibré=0.220-0.230 · cible<0.245`);
  } else {
    lines.push('  NON CALCULABLE · motor_prob ou result_winner manquant');
  }

  // §18 drawdown
  lines.push('');
  lines.push('§ 18 · DRAWDOWN (flat-stake)');
  if (summary.drawdown.calculable) {
    const dd = summary.drawdown;
    lines.push(`  n              · ${dd.n} paris avec odds`);
    lines.push(`  final equity   · ${dd.final_equity_units} unités`);
    lines.push(`  peak equity    · ${dd.peak_equity_units} unités`);
    lines.push(`  max drawdown   · ${dd.max_drawdown_units} unités`);
    lines.push(`  max losing streak  · ${dd.max_losing_streak}`);
    lines.push(`  max winning streak · ${dd.max_winning_streak}`);
  } else {
    lines.push(`  NON CALCULABLE · ${summary.drawdown.reason ?? 'odds absentes'}`);
  }

  // §19 variables présence
  lines.push('');
  lines.push('§ 19 · VARIABLES PRÉSENCE (sur logs éligibles)');
  const vars = summary.variables_presence;
  if (Object.keys(vars).length === 0) {
    lines.push('  aucune variable détectée dans les logs (champ `variables` absent)');
  } else {
    for (const [k, c] of Object.entries(vars)) {
      lines.push(`  ${k.padEnd(25)} · ${c.presence_rate_pct ?? '—'}% (${c.present}/${c.present + c.missing})`);
    }
  }

  // §20 pitcher_data_source
  lines.push('');
  lines.push('§ 20 · PITCHER_DATA_SOURCE (P2 TODO worker.js)');
  const pds = summary.pitcher_data_source;
  if (pds.available) {
    lines.push(`  logs avec champ · ${pds.logs_with_field}/${pds.logs_inspected}`);
    for (const [k, v] of Object.entries(pds.breakdown)) {
      lines.push(`    ${k.padEnd(15)} · ${v}`);
    }
  } else {
    lines.push(`  ${pds.reason}`);
  }

  // §21 conclusion
  lines.push('');
  lines.push(sep);
  lines.push('§ 21 · CONCLUSION AUTOMATIQUE');
  lines.push(sep);
  lines.push(`  VERDICT · ${summary.conclusion.verdict}`);
  for (const r of summary.conclusion.reasons) {
    lines.push(`    · ${r}`);
  }
  lines.push(`  ACTION · ${summary.conclusion.action}`);

  // Bandeau approval obligatoire si verdict touche désactivation.
  // Rappel · le verdict est une aide à la décision · pas une décision finale.
  // Cf docs/monitoring/MLB_AUDIT_GUIDE.md §"RÈGLE ABSOLUE".
  if (summary.conclusion.verdict === 'DESACTIVATION_RECOMMANDEE') {
    lines.push('');
    lines.push(sep);
    lines.push('DECISION REQUIRES CREATOR APPROVAL · ChatGPT review obligatoire');
    lines.push(sep);
    lines.push('  Le verdict ci-dessus est une AIDE À LA DÉCISION basée sur les');
    lines.push('  chiffres et les règles STATS_RULES.md · pas une autorisation');
    lines.push('  d\'agir. Aucune désactivation MLB ne peut être déclenchée par');
    lines.push('  ce script seul. Workflow obligatoire ·');
    lines.push('    1. Partager ces résultats avec ChatGPT');
    lines.push('    2. ChatGPT review formelle DECISION-003');
    lines.push('    3. Validation créateur EXPLICITE (MERGE_PROTOCOL.md)');
    lines.push('    4. PR séparée avec changement moteur · scope étroit');
  }

  lines.push('');
  lines.push('Référence règles · docs/project/STATS_RULES.md · docs/project/CALIBRATION_RULES.md');
  lines.push(sep);
  return lines.join('\n');
}
