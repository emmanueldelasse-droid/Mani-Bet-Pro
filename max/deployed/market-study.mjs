// Prospective, virtual moneyline experiment. All prices are decimal and include overtime.
// The caller freezes the first eligible primary forecast in a unique persistent game row.
export const MARKET_RULE = Object.freeze({
  id: "winamax-moneyline-ot-primary-v1",
  market: "MONEYLINE_OT",
  bookmaker: "Winamax",
  forecastWindowMinutes: 360,
  maxQuoteAgeMinutes: 60,
  minExpectedReturn: 0.05,
  stakeUnits: 1,
  simulationOnly: true,
  description: "Première prévision principale dans les 6 h avant le match. Une unité virtuelle sur le vainqueur projeté si probabilité × cote ≥ 1,05. Deux cotes Winamax vainqueur, prolongations incluses, relevées dans l’heure. Une décision par match."
});

const minute = 60_000;
const noYield = "Rendement non évaluable";
const finite = Number.isFinite;
const nonemptyId = v => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "";
const sameId = (a, b) => nonemptyId(a) && nonemptyId(b) && String(a) === String(b);
const iso = n => new Date(n).toISOString();
function instant(value) {
  // Never interpret an offset-free calendar time in the Worker or viewer timezone.
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}

function isMatchPage(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      /^(www\.)?winamax\.fr$/i.test(url.hostname) &&
      /^\/paris-sportifs\/match\/\d+(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

// The research adapter must supply the server receipt time; never take it from the report.
export function validateMarketQuote(quote, game, integratedAt) {
  if (!quote || !game || quote.verified !== true || quote.bookmaker !== MARKET_RULE.bookmaker ||
      quote.market !== MARKET_RULE.market || !isMatchPage(quote.sourceUrl) ||
      !sameId(quote.gameId, game.gameId) || !sameId(quote.homeTeamId, game.homeTeamId) ||
      !sameId(quote.awayTeamId, game.awayTeamId) || sameId(game.homeTeamId, game.awayTeamId) ||
      !finite(quote.homeOdds) || !finite(quote.awayOdds) || quote.homeOdds <= 1 || quote.awayOdds <= 1) return null;
  const observed = instant(quote.observedAt), received = instant(integratedAt), tip = instant(game.tipAt);
  if (![observed, received, tip].every(finite) || observed > received || received >= tip) return null;
  return {
    verified: true, bookmaker: MARKET_RULE.bookmaker, market: MARKET_RULE.market,
    gameId: String(game.gameId), homeTeamId: String(game.homeTeamId), awayTeamId: String(game.awayTeamId),
    homeOdds: quote.homeOdds, awayOdds: quote.awayOdds, sourceUrl: quote.sourceUrl,
    observedAt: iso(observed), integratedAt: iso(received)
  };
}

function lastQuote(game, quotes, decisionTime) {
  const valid = (Array.isArray(quotes) ? quotes : []).map(q => validateMarketQuote(q, game, q?.integratedAt))
    .filter(q => q && instant(q.integratedAt) <= decisionTime &&
      decisionTime - instant(q.observedAt) <= MARKET_RULE.maxQuoteAgeMinutes * minute)
    .sort((a,b) => instant(b.observedAt) - instant(a.observedAt) || instant(a.integratedAt) - instant(b.integratedAt));
  if (!valid.length) return { quote: null, reason: "NO_FRESH_VERIFIED_PRICE" };
  const first = valid[0];
  if (valid.some(q => q.observedAt === first.observedAt && (q.homeOdds !== first.homeOdds || q.awayOdds !== first.awayOdds))) {
    return { quote: null, reason: "CONFLICTING_PRICES" };
  }
  return { quote: first, reason: null };
}

export function makeMarketDecision(game) {
  if (!game || (game.status != null && game.status !== "STATUS_SCHEDULED") || !nonemptyId(game.gameId) || !nonemptyId(game.homeTeamId) || !nonemptyId(game.awayTeamId) ||
      sameId(game.homeTeamId, game.awayTeamId)) return null;
  const { homeWinProbability: p } = game;
  const t = instant(game.decidedAt), tip = instant(game.tipAt), forecast = instant(game.forecastAt);
  const earliest = tip - MARKET_RULE.forecastWindowMinutes * minute;
  if (![p, t, tip, forecast].every(finite) || p < 0 || p > 1 || t >= tip || forecast > t || forecast < earliest) return null;
  const { quote, reason: marketReason } = lastQuote(game, game.quotes, t);
  const prediction = p === 0.5 ? null : p > 0.5 ? "home" : "away";
  const favorite = !quote || quote.homeOdds === quote.awayOdds ? null : quote.homeOdds < quote.awayOdds ? "home" : "away";
  const selectionOdds = prediction && quote ? (prediction === "home" ? quote.homeOdds : quote.awayOdds) : null;
  const expectedReturn = selectionOdds === null ? null : (prediction === "home" ? p : 1 - p) * selectionOdds - 1;
  // Tiny tolerance only for binary floating point at the pre-registered 5% boundary.
  const selected = expectedReturn !== null && expectedReturn + 1e-12 >= MARKET_RULE.minExpectedReturn;
  return {
    gameId: String(game.gameId), homeTeamId: String(game.homeTeamId), awayTeamId: String(game.awayTeamId),
    homeTeamName: typeof game.homeTeamName === "string" ? game.homeTeamName : null,
    awayTeamName: typeof game.awayTeamName === "string" ? game.awayTeamName : null,
    ruleId: MARKET_RULE.id, market: MARKET_RULE.market, simulationOnly: true,
    decidedAt: iso(t), tipAt: iso(tip), forecastAt: iso(forecast), homeWinProbability: p,
    prediction, favorite, quote, selected, selectionOdds: selected ? selectionOdds : null, expectedReturn,
    stakeUnits: selected ? MARKET_RULE.stakeUnits : 0,
    reason: marketReason || (!prediction ? "NO_UNIQUE_WINNER" : selected ? "SELECTED" : "BELOW_THRESHOLD"),
    label: !quote ? noYield : selected ? "Sélection simulée" : "Abstention"
  };
}

function finalResult(final, decision) {
  if (!final || !Number.isInteger(final.homeScore) || !Number.isInteger(final.awayScore) ||
      Math.min(final.homeScore, final.awayScore) < 0 || final.homeScore === final.awayScore ||
      (final.homeTeamId != null && !sameId(final.homeTeamId, decision.homeTeamId)) ||
      (final.awayTeamId != null && !sameId(final.awayTeamId, decision.awayTeamId))) return null;
  const at = instant(final.finalAt);
  if (!finite(at) || at <= instant(decision.tipAt) || at <= instant(decision.decidedAt)) return null;
  return { winner: final.homeScore > final.awayScore ? "home" : "away", at: iso(at) };
}

// Only outcomes that the caller has verified as FINAL may be supplied.
// Inconsistent duplicates are exposed and excluded, independently of their insertion order.
function uniqueRows(rows, identity, equivalent) {
  const byId = new Map(), conflicts = new Set();
  for (const item of rows || []) {
    if (!item || !nonemptyId(item.gameId)) continue;
    const id = String(item.gameId);
    if (conflicts.has(id)) continue;
    if (byId.has(id) && !equivalent(identity(byId.get(id)), identity(item))) {
      conflicts.add(id);
      byId.delete(id);
    } else if (!byId.has(id)) byId.set(id, item);
  }
  return { byId, conflicts: [...conflicts].sort() };
}
const tupleEqual = (a, b) => a.every((v, i) => v === b[i]);
const decisionIdentity = d => [d.ruleId, d.gameId, d.tipAt, d.decidedAt, d.forecastAt, d.homeTeamId,
  d.awayTeamId, d.homeWinProbability, d.prediction, d.favorite, d.stakeUnits, d.selectionOdds, d.selected, d.reason,
  d.quote?.homeOdds, d.quote?.awayOdds, d.quote?.sourceUrl, d.quote?.observedAt, d.quote?.integratedAt];

export function summarizeMarket(decisions = [], finals = []) {
  const freezes = uniqueRows(decisions.filter(d => d?.ruleId === MARKET_RULE.id && d?.simulationOnly === true), decisionIdentity, tupleEqual);
  // Re-reads of the same official final use the earliest valid resolution timestamp.
  const eligibleFinals = finals.filter(f => {
    const d = freezes.byId.get(String(f?.gameId));
    return d && finalResult(f, d);
  }).sort((a,b) => instant(a.finalAt) - instant(b.finalAt));
  const outcomes = uniqueRows(eligibleFinals, f => [f.homeScore, f.awayScore], tupleEqual);
  let pricedGames = 0, selections = 0, settledSelections = 0, comparableGames = 0, sportGames = 0, sportCorrect = 0;
  let maxCorrect = 0, favoriteCorrect = 0;
  const bySettlement = new Map(), rows = [];
  for (const d of freezes.byId.values()) {
    const result = finalResult(outcomes.byId.get(d.gameId), d);
    if (d.quote) pricedGames++;
    if (d.selected) selections++;
    const sportHit = result && d.prediction ? d.prediction === result.winner : null;
    if (sportHit !== null) { sportGames++; if (sportHit) sportCorrect++; }
    if (result && d.quote && d.prediction && d.favorite) {
      comparableGames++;
      if (sportHit) maxCorrect++;
      if (d.favorite === result.winner) favoriteCorrect++;
    }
    const netUnits = result && d.selected ? (sportHit ? d.selectionOdds - 1 : -1) : null;
    if (netUnits !== null) {
      settledSelections++;
      bySettlement.set(result.at, (bySettlement.get(result.at) || 0) + netUnits);
    }
    rows.push({
      gameId: d.gameId, homeTeamName: d.homeTeamName, awayTeamName: d.awayTeamName,
      quote: d.quote, selected: d.selected, label: d.label, resultAt: result?.at ?? null,
      decisionAt: d.decidedAt, tipAt: d.tipAt, selectionOdds: d.selectionOdds, prediction: d.prediction,
      favorite: d.favorite, sportHit, stakeUnits: d.stakeUnits, netUnits
    });
  }
  let total = 0, peak = 0, deepest = 0;
  // All finals first observed at one instant settle together. Array/database order cannot change drawdown.
  for (const at of [...bySettlement.keys()].sort()) {
    total += bySettlement.get(at);
    peak = Math.max(peak, total);
    deepest = Math.max(deepest, peak - total);
  }
  rows.sort((a,b) => a.decisionAt.localeCompare(b.decisionAt) || a.gameId.localeCompare(b.gameId));
  const settledUnits = settledSelections * MARKET_RULE.stakeUnits;
  const rounded = n => Number(n.toFixed(10));
  return {
    rule: MARKET_RULE, analyzedGames: freezes.byId.size, pricedGames, selections, settledSelections,
    pendingSelections: selections - settledSelections, stakedUnits: selections * MARKET_RULE.stakeUnits, settledUnits,
    netUnits: settledUnits ? rounded(total) : null, roi: settledUnits ? rounded(total / settledUnits) : null,
    maxDrawdownUnits: settledUnits ? rounded(deepest) : null, yieldLabel: settledUnits ? "Rendement simulé" : noYield,
    sport: { games: sportGames, correct: sportCorrect, accuracy: sportGames ? sportCorrect / sportGames : null },
    comparedWithFavorite: {
      games: comparableGames, maxCorrect, favoriteCorrect,
      maxAccuracy: comparableGames ? maxCorrect / comparableGames : null,
      favoriteAccuracy: comparableGames ? favoriteCorrect / comparableGames : null
    },
    conflictingDecisionIds: freezes.conflicts, conflictingFinalIds: outcomes.conflicts, rows
  };
}

const primaryDb = db => db.withSession ? db.withSession("first-primary") : db;
const dbClock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const byGame = "SELECT payload FROM market_study_decisions WHERE rule_id=? AND match_id=?";
const payloadOf = row => row ? JSON.parse(row.payload) : null;

async function quotesForVersion(session, versionId, game, cutoff) {
  // Only use receipts actually validated and linked to the frozen engine inputs.
  const rows = await session.prepare(`SELECT r.id,r.generated_at,r.received_at,q.value AS quote,
    (SELECT json_extract(s.value,'$.checked_at') FROM json_each(r.report_json,'$.sources') s
     WHERE json_extract(s.value,'$.url')=json_extract(q.value,'$.sourceUrl') LIMIT 1) AS source_checked
    FROM max_forecast_versions v, json_each(v.payload,'$.receipts') linked
    JOIN macfly_inbox r ON r.id=json_extract(linked.value,'$.id') AND r.match_id=v.match_id
    JOIN json_each(r.report_json,'$.verified_winamax_quotes') q
    WHERE v.id=? AND r.received_at<=? AND r.generated_at<=r.received_at AND q.type='object'`).bind(versionId,cutoff).all();
  const accepted=[];
  for(const row of rows.results) {
    const q=JSON.parse(row.quote), checked=instant(row.source_checked);
    if (!finite(checked) || checked < instant(q.observedAt) || checked > instant(row.generated_at)) continue;
    const valid=validateMarketQuote(q,game,row.received_at);
    if (valid) accepted.push({...valid,receiptId:row.id,checkedAt:iso(checked)});
  }
  return accepted;
}

export async function recordMarket(db, game, version, asOf) {
  if (!db || !version || game?.status!=="STATUS_SCHEDULED" || !sameId(version.match_id, game.id) ||
      !Number.isInteger(version.id) || !finite(instant(asOf)) || !finite(instant(game.start)) ||
      instant(asOf)>=instant(game.start) || instant(asOf)<instant(game.start)-MARKET_RULE.forecastWindowMinutes*minute) return null;
  const session=primaryDb(db), id=String(game.id), rule=MARKET_RULE.id, tip=iso(instant(game.start));
  const existing=await session.prepare(byGame).bind(rule,id).first();
  if(existing) return payloadOf(existing);
  // A retry after process interruption still uses the first journaled forecast in the test.
  const first=await session.prepare(`SELECT v.id,v.as_of,v.integrated_at,${dbClock} AS server_now,
      json_extract(v.payload,'$.pair.primary.forecast.probability_home') AS p
    FROM max_forecast_versions v JOIN market_study_rules r ON r.rule_id=?
    WHERE v.match_id=? AND v.tip=? AND v.as_of>=r.activated_at AND v.as_of>=? AND v.as_of<?
      AND v.integrated_at<=${dbClock} AND ${dbClock}<? AND v.id<=?
      AND json_extract(v.payload,'$.pair.primary.game_id')=v.match_id
      AND json_type(v.payload,'$.pair.primary.forecast.probability_home') IN ('real','integer')
      AND json_extract(v.payload,'$.pair.primary.forecast.probability_home') BETWEEN 0 AND 1
    ORDER BY v.as_of,v.id LIMIT 1`).bind(rule,id,tip,iso(instant(tip)-MARKET_RULE.forecastWindowMinutes*minute),tip,tip,version.id).first();
  if(!first) return null;
  const candidate={gameId:id,homeTeamId:game.home.id,awayTeamId:game.away.id,tipAt:tip,status:game.status,
    homeTeamName:game.home.name,awayTeamName:game.away.name,forecastAt:first.as_of,decidedAt:first.server_now,homeWinProbability:first.p};
  const quotes=await quotesForVersion(session,first.id,candidate,first.as_of);
  const choice=makeMarketDecision({...candidate,quotes}), fallback=makeMarketDecision({...candidate,quotes:[]});
  if(!choice) return null;
  if(choice.quote) {
    const receipt=quotes.find(q=>q.sourceUrl===choice.quote.sourceUrl && q.observedAt===choice.quote.observedAt &&
      q.integratedAt===choice.quote.integratedAt);
    choice.quote.receiptId=receipt.receiptId;
    choice.quote.checkedAt=receipt.checkedAt;
  }
  const expires=choice.quote ? iso(instant(choice.quote.observedAt)+MARKET_RULE.maxQuoteAgeMinutes*minute) : null;
  const [,read]=await session.batch([
    session.prepare(`INSERT INTO market_study_decisions(match_id,rule_id,version_id,tip,cutoff,payload)
      SELECT ?,?,?,?,?,json_set(CASE WHEN ? IS NULL OR ${dbClock}<=? THEN ? ELSE ? END,
        '$.decidedAt',${dbClock},'$.forecastVersionId',?)
      WHERE ?<=${dbClock} AND ${dbClock}<? ON CONFLICT(match_id,rule_id) DO NOTHING`)
      .bind(id,rule,first.id,tip,first.as_of,expires,expires,JSON.stringify(choice),JSON.stringify(fallback),first.id,first.integrated_at,tip),
    session.prepare(byGame).bind(rule,id)
  ]);
  return payloadOf(read.results[0]);
}

export async function recordFinalMarket(db, game, asOf) {
  if (!db || !/^STATUS_FINAL(?:_|$)/.test(game?.status??"") || !nonemptyId(game.id) ||
      !finite(instant(asOf)) || (game.source && game.source!=="ESPN scoreboard")) return null;
  const session=primaryDb(db), id=String(game.id), rule=MARKET_RULE.id;
  const issued=await session.prepare(byGame).bind(rule,id).first();
  if(!issued) return null;
  const d=payloadOf(issued), observed=game.fetched_at??asOf;
  if(instant(observed)>instant(asOf)) return null;
  const final={gameId:id,homeTeamId:game.home?.id,awayTeamId:game.away?.id,homeScore:game.home?.score,
    awayScore:game.away?.score,finalAt:observed};
  if(!finalResult(final,d)) return null;
  const getLatest=`SELECT observed_at,settled_at,home_score,away_score,source_url FROM market_study_finals
    WHERE match_id=? AND rule_id=? ORDER BY id DESC LIMIT 1`;
  const at=iso(instant(observed));
  // Official score corrections append a revision. Repeated/stale scoreboard reads are inert.
  const [,read]=await session.batch([
    session.prepare(`INSERT INTO market_study_finals(match_id,rule_id,observed_at,home_score,away_score,source_url)
      SELECT ?,?,?,?,?,? WHERE ?<=${dbClock} AND NOT EXISTS (
        SELECT 1 FROM (${getLatest}) WHERE observed_at>=? OR (home_score=? AND away_score=?))`)
      .bind(id,rule,at,final.homeScore,final.awayScore,"https://www.espn.com/nba/game/_/gameId/"+id,at,
        id,rule,at,final.homeScore,final.awayScore),
    session.prepare(getLatest).bind(id,rule)
  ]);
  return read.results[0]??null;
}

export async function readDecisions(db, ids) {
  const map=new Map(), session=primaryDb(db), wanted=[...new Set(ids.map(String))];
  // D1 limits bound variables per statement. One read per game slate normally suffices.
  for(let start=0;start<wanted.length;start+=80) {
    const batch=wanted.slice(start,start+80);
    const data=await session.prepare(`SELECT match_id,payload FROM market_study_decisions WHERE rule_id=?
      AND match_id IN (${batch.map(()=>"?").join(",")})`).bind(MARKET_RULE.id,...batch).all();
    for(const row of data.results) map.set(row.match_id,payloadOf(row));
  }
  return map;
}

export async function readMarket(db) {
  const session=primaryDb(db), rule=MARKET_RULE.id;
  const [ds,fs,rs]=await session.batch([
    session.prepare("SELECT payload FROM market_study_decisions WHERE rule_id=?").bind(rule),
    session.prepare(`SELECT match_id AS gameId,home_score AS homeScore,away_score AS awayScore,
      first_settled AS finalAt FROM (SELECT f.*,MIN(settled_at) OVER(PARTITION BY match_id) AS first_settled,
        ROW_NUMBER() OVER(PARTITION BY match_id ORDER BY id DESC) AS revision
        FROM market_study_finals f WHERE rule_id=?) WHERE revision=1`).bind(rule),
    session.prepare("SELECT activated_at FROM market_study_rules WHERE rule_id=?").bind(rule)
  ]);
  return {...summarizeMarket(ds.results.map(payloadOf),fs.results),activatedAt:rs.results[0]?.activated_at??null};
}
