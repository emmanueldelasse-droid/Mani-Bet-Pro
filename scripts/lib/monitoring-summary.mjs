/**
 * MBP monitoring · fonction pure `summarize` + helpers.
 *
 * Calcule un résumé read-only des logs bot (NBA · MLB · Tennis) sans
 * toucher au moteur. Conçu pour être appelé depuis un script Node ou un
 * test unitaire avec fixtures déterministes.
 *
 * Conventions de champs (lus depuis le code worker.js · vérifié 2026-05) ·
 *   - logged_at · ISO string
 *   - settled_at · ISO ou null
 *   - motor_was_right · boolean ou null (null = pas settlé)
 *   - confidence_level · string · NBA/Tennis 'HIGH'|'MEDIUM'|'LOW'|'INCONCLUSIVE' ·
 *     MLB 'HIGH'|'MEDIUM'|'LOW' (= data_quality label · pas de INCONCLUSIVE)
 *   - data_quality · NBA/Tennis number [0,1] · MLB string 'HIGH'|'MEDIUM'|'LOW'
 *   - betting_recommendations.recommendations[] · objets avec `type`, `was_right`, `edge`
 *   - betting_recommendations.best · objet ou null (post-MBP-P1 si dq fail)
 *   - best_edge · alias top niveau
 *
 * Limites · documentées dans BOT_MONITORING.md ·
 *   - pas de stamp `engine_version` dans les logs · "post-v6.94" approximé via
 *     "last 50 settled" comme proxy de la dernière calibration
 *   - hit_rate exclut les logs non settlés (motor_was_right === null)
 *   - PLAYER_POINTS / PITCHER_STRIKEOUTS · hit rate basé sur `was_right` par reco
 *     (champ enrichi par settler · null si pas encore évalué)
 */

const NUMERIC_DQ_THRESHOLD = 0.55; // MBP-P1 · seuil INCONCLUSIVE NBA/Tennis
const MLB_LOW_LABEL        = 'LOW';
const HIT_RATE_TARGET_MLB  = 52;   // mission · si <52% sur 50 → LIMITER_OU_DESACTIVER
const HIT_RATE_FLOOR_TENNIS = 50;  // proxy "baisse forte" · documenté approximatif
const MIN_SAMPLE_DECISION  = 50;   // 50 logs settlés minimum pour décision
const NBA_RECHECK_MIN      = 80;   // SESSION.md TODO P2 · recheck NBA à 80+ logs

// ── Helpers numériques ──────────────────────────────────────────────────────

function pctRound(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return Math.round(n * 1000) / 10; // 0.523 → 52.3
}

function pctFromCounts(correct, total) {
  if (!total) return null;
  return Math.round((correct / total) * 1000) / 10;
}

function avgNumeric(values) {
  const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 1000) / 1000;
}

// ── Catégorisation par sport ────────────────────────────────────────────────

function isMLBLowBlocked(log) {
  // Post-MBP-P1 · MLB LOW force recommendations=[] et best=null.
  // Détection · data_quality === 'LOW' (peu importe ce que recos contiennent ·
  // les anciens logs pré-gate peuvent avoir des recos même en LOW).
  return log?.data_quality === MLB_LOW_LABEL;
}

function isNumericDqBelowThreshold(log) {
  // NBA · Tennis · dq numérique. Si dq < 0.55 → bloqué par MBP-P1.
  const dq = log?.data_quality;
  return typeof dq === 'number' && dq < NUMERIC_DQ_THRESHOLD;
}

function isInconclusive(log) {
  return log?.confidence_level === 'INCONCLUSIVE';
}

function hasExploitableReco(log) {
  // Une reco "exploitable" · best non null OU au moins 1 reco listée.
  const recs = log?.betting_recommendations;
  if (!recs) return false;
  if (recs.best && recs.best !== null) return true;
  const rec = recs.recommendations ?? recs.all ?? [];
  return Array.isArray(rec) && rec.length > 0;
}

// ── Compte par type de pari ─────────────────────────────────────────────────

const BET_TYPES = ['MONEYLINE', 'SPREAD', 'OVER_UNDER', 'PLAYER_POINTS', 'PITCHER_STRIKEOUTS'];

function summarizeByBetType(logs) {
  const out = {};
  for (const type of BET_TYPES) {
    const recs = logs.flatMap(l => (l?.betting_recommendations?.recommendations ?? []).filter(r => r?.type === type));
    if (recs.length === 0) { out[type] = null; continue; }
    const settled = recs.filter(r => r?.was_right === true || r?.was_right === false);
    const correct = settled.filter(r => r?.was_right === true);
    out[type] = {
      total_recs: recs.length,
      settled:    settled.length,
      hit_rate:   pctFromCounts(correct.length, settled.length),
    };
  }
  return out;
}

// ── Compte par confidence ───────────────────────────────────────────────────

function summarizeByConfidence(logs) {
  const labels = ['HIGH', 'MEDIUM', 'LOW', 'INCONCLUSIVE'];
  const out = {};
  for (const label of labels) {
    const bucket = logs.filter(l => l?.confidence_level === label);
    const settled = bucket.filter(l => l?.motor_was_right === true || l?.motor_was_right === false);
    const correct = settled.filter(l => l?.motor_was_right === true);
    out[label] = {
      total:   bucket.length,
      settled: settled.length,
      hit_rate: pctFromCounts(correct.length, settled.length),
    };
  }
  return out;
}

// ── Distribution data_quality ───────────────────────────────────────────────

function summarizeDataQuality(logs, sport) {
  if (sport === 'MLB') {
    return {
      kind: 'label',
      counts: {
        LOW:    logs.filter(l => l?.data_quality === 'LOW').length,
        MEDIUM: logs.filter(l => l?.data_quality === 'MEDIUM').length,
        HIGH:   logs.filter(l => l?.data_quality === 'HIGH').length,
      },
      average: null,
    };
  }
  // NBA · Tennis · dq numérique
  const numeric = logs.map(l => l?.data_quality).filter(v => typeof v === 'number');
  return {
    kind: 'numeric',
    counts: {
      below_0_55:   numeric.filter(v => v < 0.55).length,
      between_0_55_0_70: numeric.filter(v => v >= 0.55 && v < 0.70).length,
      above_0_70:   numeric.filter(v => v >= 0.70).length,
    },
    average: avgNumeric(numeric),
  };
}

// ── Décision par sport ──────────────────────────────────────────────────────

function decideMLBStatus(perSport) {
  if (perSport.total_settled < MIN_SAMPLE_DECISION) return 'SURVEILLER';
  const hr = perSport.hit_rate_last_50;
  if (hr !== null && hr < HIT_RATE_TARGET_MLB) return 'LIMITER_OU_DESACTIVER';
  return 'SURVEILLER';
}

function decideTennisStatus(perSport) {
  if (perSport.total_settled < MIN_SAMPLE_DECISION) return 'SURVEILLER';
  const hr = perSport.hit_rate_last_50;
  if (hr !== null && hr < HIT_RATE_FLOOR_TENNIS) return 'SURVEILLER_REVERT';
  return 'SURVEILLER';
}

function decideNBAStatus(perSport) {
  if (perSport.total_settled < NBA_RECHECK_MIN) return 'SURVEILLER';
  return 'OK';
}

// ── Résumé par sport ────────────────────────────────────────────────────────

export function summarizeSport(logs, sport) {
  const total = Array.isArray(logs) ? logs.length : 0;
  if (total === 0) {
    return {
      sport,
      total_analyzed:        0,
      total_recos_exploitable: 0,
      total_blocked:         0,
      total_inconclusive:    0,
      mlb_low_blocked:       0,
      dq_below_055_blocked:  0,
      total_settled:         0,
      total_unsettled:       0,
      hit_rate:              null,
      hit_rate_last_50:      null,
      by_confidence:         {},
      by_bet_type:           {},
      data_quality:          { kind: sport === 'MLB' ? 'label' : 'numeric', counts: {}, average: null },
      status:                'NO_DATA',
    };
  }

  const sorted   = [...logs].sort((a, b) => new Date(b.logged_at ?? 0) - new Date(a.logged_at ?? 0));
  const settled  = sorted.filter(l => l?.motor_was_right === true || l?.motor_was_right === false);
  const unsettled = sorted.length - settled.length;
  const correct  = settled.filter(l => l?.motor_was_right === true);
  const hitRate  = pctFromCounts(correct.length, settled.length);
  const last50   = settled.slice(0, 50);
  const last50Correct = last50.filter(l => l?.motor_was_right === true);
  const hitRateLast50 = pctFromCounts(last50Correct.length, last50.length);

  const recosExploitable = sorted.filter(hasExploitableReco).length;
  const inconclusive = sorted.filter(isInconclusive).length;
  const mlbLowBlocked = sport === 'MLB' ? sorted.filter(isMLBLowBlocked).length : 0;
  const numericLowBlocked = sport !== 'MLB' ? sorted.filter(isNumericDqBelowThreshold).length : 0;
  const totalBlocked = inconclusive + mlbLowBlocked + numericLowBlocked;

  const result = {
    sport,
    total_analyzed:           sorted.length,
    total_recos_exploitable:  recosExploitable,
    total_blocked:            totalBlocked,
    total_inconclusive:       inconclusive,
    mlb_low_blocked:          mlbLowBlocked,
    dq_below_055_blocked:     numericLowBlocked,
    total_settled:            settled.length,
    total_unsettled:          unsettled,
    hit_rate:                 hitRate,
    hit_rate_last_50:         hitRateLast50,
    by_confidence:            summarizeByConfidence(sorted),
    by_bet_type:              summarizeByBetType(sorted),
    data_quality:             summarizeDataQuality(sorted, sport),
    status:                   'SURVEILLER',  // overridden below
  };

  if (sport === 'NBA')    result.status = decideNBAStatus(result);
  if (sport === 'MLB')    result.status = decideMLBStatus(result);
  if (sport === 'TENNIS') result.status = decideTennisStatus(result);

  return result;
}

// ── Résumé global ───────────────────────────────────────────────────────────

export function summarize(logsBySport) {
  const NBA    = summarizeSport(logsBySport?.NBA    ?? [], 'NBA');
  const MLB    = summarizeSport(logsBySport?.MLB    ?? [], 'MLB');
  const TENNIS = summarizeSport(logsBySport?.TENNIS ?? [], 'TENNIS');

  const allLogs = [
    ...(logsBySport?.NBA    ?? []),
    ...(logsBySport?.MLB    ?? []),
    ...(logsBySport?.TENNIS ?? []),
  ];
  const dates = allLogs
    .map(l => (l?.date ?? (l?.logged_at ? String(l.logged_at).slice(0, 10) : null)))
    .filter(d => typeof d === 'string' && d.length > 0)
    .sort();
  const periodStart = dates[0] ?? null;
  const periodEnd   = dates[dates.length - 1] ?? null;

  const global = {
    total_analyzed:           NBA.total_analyzed + MLB.total_analyzed + TENNIS.total_analyzed,
    total_recos_exploitable:  NBA.total_recos_exploitable + MLB.total_recos_exploitable + TENNIS.total_recos_exploitable,
    total_blocked:            NBA.total_blocked + MLB.total_blocked + TENNIS.total_blocked,
    total_settled:            NBA.total_settled + MLB.total_settled + TENNIS.total_settled,
    total_unsettled:          NBA.total_unsettled + MLB.total_unsettled + TENNIS.total_unsettled,
  };
  // Hit rate global · pondéré par #settled
  const correctGlobal = (NBA.hit_rate ?? 0) * NBA.total_settled
                      + (MLB.hit_rate ?? 0) * MLB.total_settled
                      + (TENNIS.hit_rate ?? 0) * TENNIS.total_settled;
  global.hit_rate = global.total_settled > 0
    ? Math.round((correctGlobal / global.total_settled) * 10) / 10
    : null;

  const conclusion = buildConclusion({ NBA, MLB, TENNIS });

  return {
    period: { start: periodStart, end: periodEnd },
    global,
    NBA, MLB, TENNIS,
    conclusion,
  };
}

function buildConclusion(perSport) {
  const messages = [];
  // NBA
  if (perSport.NBA.total_settled === 0) {
    messages.push('NBA · pas de logs settlés · attendre cron');
  } else if (perSport.NBA.total_settled < NBA_RECHECK_MIN) {
    messages.push(`NBA · ${perSport.NBA.total_settled} logs settlés · recheck calibration à ${NBA_RECHECK_MIN}+ (TODO P2 SESSION.md)`);
  } else {
    messages.push(`NBA · ${perSport.NBA.total_settled} logs settlés · recheck calibration disponible · garder`);
  }
  // MLB
  if (perSport.MLB.total_settled < MIN_SAMPLE_DECISION) {
    messages.push(`MLB · ${perSport.MLB.total_settled} logs settlés · attendre ${MIN_SAMPLE_DECISION}+ avant décision (surveiller)`);
  } else if (perSport.MLB.status === 'LIMITER_OU_DESACTIVER') {
    messages.push(`MLB · hit rate sur 50 derniers = ${perSport.MLB.hit_rate_last_50}% < ${HIT_RATE_TARGET_MLB}% · LIMITER ou DÉSACTIVER (Option C SESSION.md)`);
  } else {
    messages.push(`MLB · hit rate sur 50 derniers = ${perSport.MLB.hit_rate_last_50}% ≥ ${HIT_RATE_TARGET_MLB}% · garder · surveiller`);
  }
  // Tennis
  if (perSport.TENNIS.total_settled < MIN_SAMPLE_DECISION) {
    messages.push(`Tennis · ${perSport.TENNIS.total_settled} logs settlés · attendre ${MIN_SAMPLE_DECISION}+ avant décision (surveiller)`);
  } else if (perSport.TENNIS.status === 'SURVEILLER_REVERT') {
    messages.push(`Tennis · hit rate sur 50 derniers = ${perSport.TENNIS.hit_rate_last_50}% < ${HIT_RATE_FLOOR_TENNIS}% · SURVEILLER_REVERT v6.93 (Option SESSION.md)`);
  } else {
    messages.push(`Tennis · hit rate sur 50 derniers = ${perSport.TENNIS.hit_rate_last_50}% ≥ ${HIT_RATE_FLOOR_TENNIS}% · garder · surveiller`);
  }
  messages.push('Recommandation · ne pas recalibrer tant que les logs post-MBP-P1 ne parlent pas · piloter avec les chiffres, pas l\'intuition');
  return messages;
}

// ── Formatage console ───────────────────────────────────────────────────────

function fmt(v, suffix = '') {
  if (v === null || v === undefined) return '—';
  return `${v}${suffix}`;
}

export function formatReport(summary) {
  const lines = [];
  lines.push('BOT MONITORING SUMMARY');
  lines.push('');
  lines.push('Période :');
  lines.push(`  depuis · ${summary.period.start ?? '—'}`);
  lines.push(`  jusqu'à · ${summary.period.end   ?? '—'}`);
  lines.push('  source · KV via routes publiques /bot/logs · /mlb/bot/logs · /tennis/bot/logs (ou fixture locale)');
  lines.push('');

  lines.push('GLOBAL');
  lines.push(`  matchs analysés · ${summary.global.total_analyzed}`);
  lines.push(`  recommandations exploitables · ${summary.global.total_recos_exploitable}`);
  lines.push(`  recommandations bloquées (INCONCLUSIVE + dq faible) · ${summary.global.total_blocked}`);
  lines.push(`  settlés · ${summary.global.total_settled}`);
  lines.push(`  non settlés · ${summary.global.total_unsettled}`);
  lines.push(`  hit rate global · ${fmt(summary.global.hit_rate, '%')}`);
  lines.push('');

  for (const sport of ['NBA', 'MLB', 'TENNIS']) {
    const s = summary[sport];
    lines.push(sport);
    lines.push(`  matchs analysés · ${s.total_analyzed}`);
    lines.push(`  recommandations exploitables · ${s.total_recos_exploitable}`);
    if (sport === 'MLB') {
      lines.push(`  MLB LOW bloqués (MBP-P1) · ${s.mlb_low_blocked}`);
    } else {
      lines.push(`  INCONCLUSIVE · ${s.total_inconclusive}`);
      lines.push(`  data_quality < 0.55 bloqués (MBP-P1) · ${s.dq_below_055_blocked}`);
    }
    lines.push(`  settlés · ${s.total_settled}`);
    lines.push(`  non settlés · ${s.total_unsettled}`);
    lines.push(`  hit rate · ${fmt(s.hit_rate, '%')}`);
    if (sport !== 'NBA') lines.push(`  hit rate sur 50 derniers settlés · ${fmt(s.hit_rate_last_50, '%')}`);

    // confidence (NBA + Tennis · MLB n'a pas INCONCLUSIVE)
    if (sport !== 'MLB') {
      lines.push('  hit rate par confidence ·');
      for (const lvl of ['HIGH', 'MEDIUM', 'LOW', 'INCONCLUSIVE']) {
        const b = s.by_confidence?.[lvl];
        if (b && b.total > 0) {
          lines.push(`    ${lvl.padEnd(13)} · n=${b.settled}/${b.total} · hit=${fmt(b.hit_rate, '%')}`);
        }
      }
    }

    // bet type
    const types = sport === 'MLB' ? ['MONEYLINE', 'OVER_UNDER', 'PITCHER_STRIKEOUTS']
                : sport === 'NBA' ? ['MONEYLINE', 'SPREAD', 'OVER_UNDER', 'PLAYER_POINTS']
                : ['MONEYLINE'];
    lines.push('  types de paris ·');
    for (const t of types) {
      const b = s.by_bet_type?.[t];
      if (b) {
        lines.push(`    ${t.padEnd(20)} · recs=${b.total_recs} · settled=${b.settled} · hit=${fmt(b.hit_rate, '%')}`);
      } else {
        lines.push(`    ${t.padEnd(20)} · 0 recos`);
      }
    }

    // data quality distribution
    const dq = s.data_quality;
    if (dq.kind === 'numeric') {
      lines.push(`  data_quality · moyenne=${fmt(dq.average)} · <0.55=${dq.counts.below_0_55} · 0.55-0.70=${dq.counts.between_0_55_0_70} · ≥0.70=${dq.counts.above_0_70}`);
    } else {
      lines.push(`  data_quality · LOW=${dq.counts.LOW ?? 0} · MEDIUM=${dq.counts.MEDIUM ?? 0} · HIGH=${dq.counts.HIGH ?? 0}`);
    }
    lines.push(`  statut · ${s.status}`);
    lines.push('');
  }

  lines.push('CONCLUSION');
  for (const m of summary.conclusion) lines.push(`  · ${m}`);
  return lines.join('\n');
}

// ── Constantes exportées (utiles tests) ─────────────────────────────────────

export const _CONST = {
  NUMERIC_DQ_THRESHOLD,
  MLB_LOW_LABEL,
  HIT_RATE_TARGET_MLB,
  HIT_RATE_FLOOR_TENNIS,
  MIN_SAMPLE_DECISION,
  NBA_RECHECK_MIN,
};
