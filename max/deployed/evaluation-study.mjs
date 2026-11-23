// Prospective analysis only. No prediction, settlement or promotion is performed here.
export const STUDY_VERSION = 'max-paired-study-1';
const finite = Number.isFinite;
const time = value => Date.parse(value);
const sides = ['home', 'away'];
const mean = values => values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : null;
const round = (x, places = 5) => finite(x) ? Number(x.toFixed(places)) : null;
const gamesCount = rows => new Set(rows.map(r => r.game_id)).size;
const validScore = x => finite(x) && x >= 0;
const validProb = x => finite(x) && x >= 0 && x <= 1;
const utcDate = tip => new Date(time(tip)).toISOString().slice(0, 10);

// Capture both model outputs from this single run. Identity covers inputs available
// at this instant. Simultaneous feeds may be used differently by each model.
export function studyPair(game, at, inputId, forecast, playerPoints, trial) {
  const shared = { game_id: String(game.id), at, input_id: inputId };
  const primary = { ...shared, forecast, player_points: playerPoints };
  if (trial?.state !== 'SHADOW_FORECAST' || String(trial.match_id) !== String(game.id))
    return { primary, variant: null };
  return { primary, variant: { ...shared, forecast: trial.forecast, player_points: trial.teams } };
}

function compareCaptures(game, a, b, controlled = true) {
  if (!a || !b) return 'MISSING_CAPTURE';
  if (![a,b].every(s => String(s.game_id) === String(game.id))) return 'WRONG_MATCH';
  const t1 = time(a.at), t2 = time(b.at), tip = time(game.start);
  if (![t1,t2,tip].every(finite) || t1 >= tip || t2 >= tip) return 'INVALID_OR_LATE_CAPTURE';
  if (controlled) {
    if (Math.abs(t1 - t2) > 15 * 60000) return 'OVER_15_MINUTES';
    if (t1 !== t2) return 'DIFFERENT_INSTANT';
    if (!a.input_id || !b.input_id) return 'UNVERIFIED_INPUTS';
    if (a.input_id !== b.input_id) return 'DIFFERENT_INPUTS';
  }
  if (![a,b].every(s => validProb(s.forecast?.probability_home) &&
    sides.every(side => validScore(s.forecast.projected_score?.[side])))) return 'FORECAST_UNAVAILABLE';
  return null;
}

function gameScore(game, snapshot) {
  const f = snapshot.forecast, projected = f.projected_score;
  const observedMargin = game.home.score - game.away.score;
  const homeWin = Number(observedMargin > 0), p = f.probability_home;
  const picked = p === .5 ? null : Number(p > .5);
  // Cap log score for finite serialized values even when a model rounds to 0 or 1.
  const probabilityOfResult = homeWin ? p : 1 - p;
  return {
    p_home: p, home_win: homeWin, correct: picked === null ? null : picked === homeWin,
    brier: (p - homeWin) ** 2, log_loss: -Math.log(Math.max(1e-15, probabilityOfResult)),
    total_error: projected.home + projected.away - game.home.score - game.away.score,
    margin_error: projected.home - projected.away - observedMargin
  };
}

function playerForecast(proj) {
  if (!proj) return null;
  const out = proj.availability === 'OFFICIAL_OUT' || proj.status === 'OUT';
  const minutes = proj.projected_minutes_if_active ?? proj.minutes_if_active;
  const points = proj.predicted_points_if_active ?? proj.points_if_active;
  return { out, minutes: out ? 0 : minutes, points: out ? 0 : points };
}

function playerScore(proj, actual) {
  if (!proj || !validScore(proj.points) || !validScore(actual?.points) || !(actual.minutes > 0) ||
      !finite(actual.minutes)) return null;
  const error = proj.points - actual.points;
  const minutesError = validScore(proj.minutes) ? proj.minutes - actual.minutes : null;
  const rate = proj.minutes > 0 && finite(proj.minutes) ? proj.points / proj.minutes : null;
  const minutesPoints = rate === null ? null : rate * minutesError;
  // Signed identity: predicted - observed points = minutes term + production term.
  return { error, minutes_error: minutesError, minutes_points: minutesPoints,
    production_error: minutesPoints === null ? null : error - minutesPoints, predicted_absent: proj.out };
}

function playerComparison(game, box, a, b, filterIds) {
  const result = { box_available: false, rows: [], absent_or_missing: 0, unmatched_projections: 0 };
  if (String(box?.game_id) !== String(game.id) ||
      !sides.every(side => Array.isArray(box.teams?.[String(game[side].id)]?.players))) return result;
  result.box_available = true;
  for (const side of sides) {
    const lookup = snap => new Map((snap.player_points?.[side]?.players ?? []).map(p => [String(p.id), p]));
    const left = lookup(a), right = lookup(b);
    const actual = new Map(box.teams[String(game[side].id)].players.map(p => [String(p.id), p]));
    for (const id of new Set([...left.keys(), ...right.keys()])) {
      if (filterIds?.size && !filterIds.has(id)) continue;
      const real = actual.get(id);
      if (!real || !(real.minutes > 0)) { result.absent_or_missing++; continue; }
      const first = playerScore(playerForecast(left.get(id)), real);
      const second = playerScore(playerForecast(right.get(id)), real);
      if (!first || !second) { result.unmatched_projections++; continue; }
      result.rows.push({ id, team_id: String(game[side].id), name: real.name ?? null,
        observed_points: real.points, observed_minutes: real.minutes, primary: first, variant: second });
    }
  }
  return result;
}

function measure(game, box, left, right, ids) {
  return { primary: gameScore(game, left), variant: gameScore(game, right),
    players: playerComparison(game, box, left, right, ids) };
}

function revisionResult(game, box, revision) {
  if (!revision?.group_id || !finite(time(revision.at)) || time(revision.at) >= time(game.start))
    return null;
  const base = { group_id: String(revision.group_id), at: revision.at,
    kinds: [...new Set((revision.kinds ?? []).map(String))].sort(),
    already_known: revision.already_known === true, controlled: revision.controlled === true };
  if (base.already_known) return base;
  const exclusion = compareCaptures(game, revision.before, revision.after, base.controlled);
  if (exclusion) return { ...base, exclusion };
  if (time(revision.after.at) !== time(revision.at) || time(revision.before.at) > time(revision.at))
    return { ...base, exclusion: 'INVALID_REVISION_TIME' };
  // Include beneficiaries of redistributed minutes as well as explicitly named players.
  const affected = new Set((revision.player_ids ?? []).map(String));
  for (const side of sides) {
    const previous = new Map((revision.before.player_points?.[side]?.players ?? []).map(p => [String(p.id), playerForecast(p)]));
    for (const p of revision.after.player_points?.[side]?.players ?? []) {
      const forecast = playerForecast(p), old = previous.get(String(p.id));
      if (old && (old.minutes !== forecast.minutes || old.points !== forecast.points || old.out !== forecast.out))
        affected.add(String(p.id));
    }
  }
  const result = measure(game, box, revision.before, revision.after, affected);
  if (!affected.size) result.players.rows = [];
  return { ...base, ...result };
}

export function evaluateStudyGame({ game, box = null, pair, revisions = [] }) {
  if (!game?.id || !finite(time(game.start)) || !String(game.status).includes('FINAL') ||
      !sides.every(side => validScore(game[side]?.score)) || game.home.score === game.away.score) return null;
  const left = pair?.primary, right = pair?.variant;
  const exclusion = compareCaptures(game, left, right);
  const lagMs = Math.abs(time(left?.at) - time(right?.at));
  const seen = new Set(), groups = [];
  for (const r of revisions) {
    const row = revisionResult(game, box, r);
    if (row && !seen.has(row.group_id)) { groups.push(row); seen.add(row.group_id); }
  }
  return {
    version: STUDY_VERSION, game_id: String(game.id), tip: game.start, at: left?.at ?? null,
    primary_at: left?.at ?? null, variant_at: right?.at ?? null, gap_minutes: round(lagMs / 60000, 2),
    game_source: box?.source_url ?? ('https://www.espn.com/nba/game/_/gameId/' + game.id),
    final_score: { home: game.home.score, away: game.away.score },
    exclusion, ...(exclusion ? {} : measure(game, box, left, right)), revisions: groups
  };
}

function calibration(scores) {
  return Array.from({length: 5}, (_, i) => {
    const bin = scores.filter(s => Math.min(4, Math.floor(s.p_home * 5)) === i);
    return { min: i / 5, max: (i + 1) / 5, n: bin.length,
      announced: round(mean(bin.map(s => s.p_home))), observed: round(mean(bin.map(s => s.home_win))) };
  });
}

const losses = { brier: 'brier', log_loss: 'log_loss', total_mae: 'total_error',
  player_mae: 'error', minutes_mae: 'minutes_error', production_mae: 'production_error' };
const playerMetrics = new Set(['player_mae', 'minutes_mae', 'production_mae']);
function pairedLosses(record, metric) {
  const key = losses[metric];
  const rows = playerMetrics.has(metric) ? record.players.rows : [record];
  return rows.filter(row => finite(row.primary[key]) && finite(row.variant[key]))
    .map(row => [Math.abs(row.primary[key]), Math.abs(row.variant[key])]);
}

function aggregate(records) {
  const scored = { primary: {}, variant: {} }, gains = {}, intervals = {}, counts = {};
  for (const metric of Object.keys(losses)) {
    const daily = new Map(); let left = 0, right = 0, count = 0;
    for (const row of records) {
      const day = utcDate(row.tip), block = daily.get(day) ?? { gain: 0, n: 0 };
      for (const [a,b] of pairedLosses(row, metric)) {
        left += a; right += b; count++; block.gain += a - b; block.n++;
      }
      if (block.n) daily.set(day, block);
    }
    counts[metric] = count;
    scored.primary[metric] = count ? round(left / count) : null;
    scored.variant[metric] = count ? round(right / count) : null;
    const gain = count ? (left - right) / count : null;
    gains[metric] = round(gain);
    // Day-clustered sandwich interval. Do not treat players or revisions from one game/day
    // as independent samples. Only descriptive until enough distinct game dates.
    const days = daily.size;
    let ci = null;
    if (days >= 20) {
      const residuals = [...daily.values()].reduce((v,d) => v + (d.gain - d.n * gain) ** 2, 0);
      const margin = 2.1 * Math.sqrt(days / (days - 1) * residuals) / count;
      ci = [round(gain - margin), round(gain + margin)];
    }
    intervals[metric] = { dates: days, approximate_95pct: ci };
  }
  const decisive = records.filter(r => typeof r.primary.correct === 'boolean' && typeof r.variant.correct === 'boolean');
  for (const side of ['primary','variant']) {
    scored[side].accuracy_n = decisive.length;
    scored[side].accuracy_pct = decisive.length ? round(100 * mean(decisive.map(r => Number(r[side].correct))), 1) : null;
    scored[side].calibration = calibration(records.map(r => r[side]));
    scored[side].incorrect_absence_among_paired = records.reduce((n,r) =>
      n + r.players.rows.filter(p => p[side].predicted_absent).length, 0);
  }
  return { ...scored, gain: gains, intervals, counts };
}

function summarizeRevisions(records) {
  const groups = new Map(), output = { controlled: [], descriptive: [], already_known_groups: 0, excluded_groups: 0 };
  for (const game of records) for (const r of game.revisions ?? []) {
    if (r.already_known) { output.already_known_groups++; continue; }
    if (r.exclusion) { output.excluded_groups++; continue; }
    const key = JSON.stringify([r.controlled, r.kinds]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...r, game_id: game.game_id, tip: game.tip });
  }
  for (const rows of groups.values()) {
    const type = rows[0].controlled ? 'controlled' : 'descriptive';
    const {gain, intervals, counts} = aggregate(rows);
    output[type].push({ kinds: rows[0].kinds, groups: rows.length, games: gamesCount(rows), gain, intervals, counts });
  }
  return output;
}

function largestMinutesMiss(record, side) {
  let largest = null;
  for (const p of record.players.rows) {
    const score = p[side];
    if (!finite(score.minutes_error) || (largest && Math.abs(score.minutes_error) <= Math.abs(largest.minutes_error))) continue;
    largest = { id: p.id, name: p.name, team_id: p.team_id, minutes_error: score.minutes_error,
      forecast_minutes: round(p.observed_minutes + score.minutes_error, 2), actual_minutes: p.observed_minutes,
      forecast_points: round(p.observed_points + score.error, 2), actual_points: p.observed_points,
      points_error_from_minutes: round(score.minutes_points, 2), points_error_from_production: round(score.production_error, 2) };
  }
  return largest;
}

export function summarizeStudy(records) {
  const unique = new Map();
  for (const r of records ?? []) if (r?.version === STUDY_VERSION && r.game_id) unique.set(r.game_id, r);
  const rows = [...unique.values()], paired = rows.filter(r => !r.exclusion);
  const summary = aggregate(paired), excluded = {};
  for (const {exclusion} of rows) if (exclusion) excluded[exclusion] = (excluded[exclusion] ?? 0) + 1;
  return {
    version: STUDY_VERSION, analyzed_games: rows.length, paired_games: paired.length, excluded,
    player_pairs: summary.counts.player_mae,
    games_with_box: paired.filter(r => r.players.box_available).length,
    absent_or_missing: paired.reduce((n,r) => n + r.players.absent_or_missing, 0),
    ...summary, macfly: summarizeRevisions(rows),
    audits: paired.map(r => ({ game_id: r.game_id, tip: r.tip, primary_correct: r.primary.correct,
      variant_correct: r.variant.correct, primary_probability_home: r.primary.p_home,
      actual_home_win: r.primary.home_win, primary_margin_error: round(r.primary.margin_error, 2),
      variant_margin_error: round(r.variant.margin_error, 2), primary_total_error: round(r.primary.total_error, 2),
      variant_total_error: round(r.variant.total_error, 2),
      largest_minutes_miss: { primary: largestMinutesMiss(r,'primary'), variant: largestMinutesMiss(r,'variant') },
      source: r.game_source })),
    review: { minimum_paired_games: 100, minimum_dates_for_intervals: 20,
      status: paired.length >= 100 && summary.intervals.brier.approximate_95pct?.[0] > 0
        ? 'MANUAL_REVIEW_REQUIRED' : 'EXPERIMENTAL', auto_promotion: false,
      primary_endpoint: 'paired_brier_gain', interval_method: 'approximate_by_UTC_game_date' }
  };
}
