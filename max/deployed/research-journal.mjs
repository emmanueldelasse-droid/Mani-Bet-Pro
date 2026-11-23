import {playerIdentity} from './identity.mjs';
import {reportTimestamp} from './collectors.mjs';

const clock = value => {
  const n = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
const primary = db => db.withSession ? db.withSession('first-primary') : db;
const sorted = value => Array.isArray(value) ? value.map(sorted)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;
const canonical = value => JSON.stringify(sorted(value));
const metric = n => Number.isFinite(n) ? n : null;
const receiptMeta = row => ({id: row.id, match_id: row.match_id, generated_at: row.generated_at, received_at: row.received_at});

export async function insertResearch(db, record) {
  const match = String(record?.match_id ?? ''), generated = clock(record?.generated_at);
  if (record?.schema_version !== 'max-research-v1' || !/^\d{5,15}$/.test(match) || !generated)
    throw new TypeError('MACFLY_INVALID_REPORT_ID');
  const session = primary(db), body = JSON.stringify(record);
  const [, read] = await session.batch([
    session.prepare('INSERT INTO macfly_inbox (report_json) VALUES (?) ON CONFLICT(match_id,generated_at) DO NOTHING').bind(body),
    session.prepare('SELECT * FROM macfly_inbox WHERE match_id=? AND generated_at=?').bind(match,generated)
  ]);
  const row = read.results?.[0];
  if (!row || canonical(JSON.parse(row.report_json)) !== canonical(record)) throw Error('MACFLY_READBACK_MISMATCH');
  return receiptMeta(row);
}

function rosterPlayer(rosters, item) {
  const roster = rosters?.get(String(item.team_id));
  if (!roster || String(roster.team_id) !== String(item.team_id)) return null;
  const matches = roster.players.filter(p => playerIdentity(p.name) === playerIdentity(item.player));
  if (matches.length !== 1 || (item.player_id != null && String(item.player_id) !== String(matches[0].id))) return null;
  return String(matches[0].id);
}

function sourceFacts(verified, raw, receipt, rosters) {
  const result = [];
  for (const [kind, list] of [['INJURY','verified_injuries'],['ROTATION','verified_role_facts']]) {
    for (const item of verified[list] ?? []) {
      const submitted = (raw[list] ?? []).find(x => String(x.team_id) === String(item.team_id)
        && playerIdentity(x.player) === playerIdentity(item.player) && x.source_url === item.source_url && x.checked_at === item.checked_at);
      const source = raw.sources.find(s => s.url === item.source_url);
      const publication = submitted?.published_at ?? source?.published_at ?? reportTimestamp(item.source_url);
      const checked = clock(item.checked_at), sourceCheck = clock(source?.checked_at), published = clock(publication);
      if (!checked || !sourceCheck || checked > receipt.received_at || sourceCheck > receipt.received_at ||
          (publication != null && (!published || published > checked || published > sourceCheck))) continue;
      const player_id = rosterPlayer(rosters, {...item, player_id: submitted?.player_id ?? item.player_id});
      const info = {receipt_id: receipt.id, match_id: receipt.match_id, kind, team_id: String(item.team_id),
        player_id, player: item.player, source_url: item.source_url, published_at: published,
        checked_at: checked, received_at: receipt.received_at,
        ...(kind === 'INJURY' ? {status: item.status} : {
          ...(item.minutes_limit == null ? {} : {minutes_limit: item.minutes_limit}),
          ...(item.starter == null ? {} : {starter: item.starter})})};
      result.push({info, item, effect: player_id ? 'CANDIDATE' : 'UNMATCHED_PLAYER'});
    }
  }
  return result;
}

const identity = f => [f.kind, f.team_id, f.player_id ?? playerIdentity(f.player)].join(':');
const valueKey = f => JSON.stringify([f.status ?? null, f.minutes_limit ?? null, f.starter ?? null]);
const occurrence = f => canonical([f.receipt_id, identity(f), valueKey(f), f.source_url, f.checked_at]);
function resolveFacts(candidates) {
  const groups = new Map();
  for (const c of candidates.filter(c => c.effect === 'CANDIDATE')) {
    const key = identity(c.info);
    const group = groups.get(key) ?? [];
    group.push(c);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    // An old bulletin found again today cannot displace a newer official bulletin.
    const effective = c => c.info.published_at ?? c.info.checked_at;
    const newest = group.reduce((max,c) => effective(c) > max ? effective(c) : max, '');
    const newestRows = group.filter(c => effective(c) === newest);
    const mostRecent = newestRows.filter(c => !c.expired).at(-1) ?? newestRows.at(-1);
    const conflicting = new Set(newestRows.map(c => valueKey(c.info))).size > 1;
    for (const c of group) c.effect = effective(c) !== newest ? 'SUPERSEDED'
      : conflicting ? 'CONFLICT' : c === mostRecent ? 'CANDIDATE' : 'ALREADY_KNOWN';
  }
}

export async function readInboxRows(db, game, asOf) {
  const cutoff = clock(asOf), tip = clock(game?.start);
  if (!cutoff || !tip || cutoff >= tip || game?.status !== 'STATUS_SCHEDULED') return [];
  const read = await primary(db).prepare(
    'SELECT * FROM macfly_inbox WHERE match_id=? AND received_at<=? AND received_at<? ORDER BY generated_at,id'
  ).bind(String(game.id),cutoff,tip).all();
  return read.results;
}

export async function readResearchInbox(db, game, asOf, validateResearch, rosters, allowedReceiptIds=null, rows=null) {
  const empty = {raw: null, verified: null, receipts: [], facts: []};
  const cutoff = clock(asOf), tip = clock(game?.start);
  if (!cutoff || !tip || cutoff >= tip || game?.status !== 'STATUS_SCHEDULED') return empty;
  const sourceRows = rows ?? await readInboxRows(db,game,cutoff);
  const candidates = [];
  for (const row of sourceRows) {
    if (row.match_id !== String(game.id) || row.received_at > cutoff || row.received_at >= tip ||
        (allowedReceiptIds && !allowedReceiptIds.has(row.id))) continue;
    const receipt = receiptMeta(row), raw = JSON.parse(row.report_json);
    // Future-dated content relative to receipt is invalid even when read on a later day.
    if (row.generated_at > row.received_at || !Array.isArray(raw.sources)) continue;
    const timely = raw.sources.filter(s => {
      const checked = clock(s?.checked_at), published = clock(s?.published_at);
      return checked && checked <= row.received_at && (s.published_at == null || published && published <= checked);
    });
    const record = {...raw, sources:timely};
    const accepted = validateResearch(record, game, cutoff);
    if (!accepted) {
      // Even an expired update supersedes older, subsequently rediscovered
      // bulletins. It is an ordering watermark, never a current input.
      const atReceipt = validateResearch(record, game, row.received_at);
      if (atReceipt) candidates.push(...sourceFacts(atReceipt,record,receipt,rosters).map(c => ({...c,expired:true})));
      continue;
    }
    empty.raw = raw;
    empty.verified = {...accepted};
    empty.receipts.push(receipt);
    candidates.push(...sourceFacts(accepted,{...raw,sources:timely},receipt,rosters));
  }
  resolveFacts(candidates);
  if (empty.verified) {
    const usable = candidates.filter(c => !c.expired && c.effect === 'CANDIDATE');
    empty.verified.verified_injuries = usable.filter(c => c.info.kind === 'INJURY').map(c => ({...c.item, player_id: c.info.player_id}));
    empty.verified.verified_role_facts = usable.filter(c => c.info.kind === 'ROTATION').map(c => c.item);
    const urls = new Set(empty.verified.sources.map(s => s.url));
    for (const c of usable) if (!urls.has(c.info.source_url)) {
      empty.verified.sources.push({url:c.info.source_url, title:'Source officielle', checked_at:c.info.checked_at, kind:'OFFICIAL'});
      urls.add(c.info.source_url);
    }
  }
  empty.facts = candidates.filter(c => !c.expired).map(c => ({...c.info, effect:c.effect}));
  return empty;
}

export function classifyFacts(facts, {official = [], direct = [], roles = []} = {}) {
  const matches = (row, f) => String(row.team_id) === f.team_id && playerIdentity(row.player) === playerIdentity(f.player);
  return facts.map(f => {
    if (f.effect !== 'CANDIDATE') return f;
    let effect;
    if (f.kind === 'ROTATION') {
      const admitted = roles.some(r => matches(r,f) && String(r.player_id) === f.player_id && r.source_url === f.source_url);
      effect = !admitted ? 'SUPERSEDED' : f.minutes_limit == null ? 'CONTEXT_ONLY' : 'APPLIED';
    } else if (direct.some(x => matches(x,f) && x.status === f.status)) effect = 'ALREADY_KNOWN';
    else effect = official.some(x => matches(x,f) && x.status === f.status && x.source_url === f.source_url) ? 'APPLIED' : 'SUPERSEDED';
    return {...f, effect};
  });
}

function slimForecast(forecast, players) {
  const s = forecast?.projected_score;
  const home = metric(s?.home), away = metric(s?.away);
  return {probability_home: metric(forecast?.probability_home), projected_score:{home,away},
    total: home === null || away === null ? null : Math.round(100*(home+away))/100,
    players: players.sort((a,b) => a.team_id.localeCompare(b.team_id) || a.player_id.localeCompare(b.player_id))};
}
export function forecastView(forecast, playerPoints, trial) {
  const p = [], t = [];
  for (const side of ['home','away']) {
    const team = playerPoints?.[side], teamId = String(team?.team_id ?? '');
    for (const x of team?.players ?? []) {
      const out = x.availability === 'OFFICIAL_OUT';
      p.push({team_id: String(x.team_id ?? teamId), player_id:String(x.id), name:x.name, status:x.reported_status ?? null,
        minutes:out ? 0 : metric(x.projected_minutes_if_active), points:out ? 0 : metric(x.predicted_points_if_active),
        conditional:!out,official_for_game:out || x.official_for_game===true});
    }
    for (const x of trial?.teams?.[side]?.players ?? []) {
      const out = x.status === 'OUT';
      t.push({team_id: teamId || String(trial?.teams?.[side]?.team_id ?? ''),player_id:String(x.id),name:x.name,status:x.status ?? null,
        minutes:out ? 0 : metric(x.minutes_if_active),points:out ? 0 : metric(x.points_if_active),conditional:!out});
    }
  }
  return {primary:slimForecast(forecast,p),challenger:trial?.state === 'SHADOW_FORECAST' ? slimForecast(trial.forecast,t) : null};
}

const measuredValues = view => Object.fromEntries(Object.entries(view ?? {}).map(([engine,f]) => [engine, f && {
  p: f.probability_home, score: f.projected_score, players: f.players?.map(x => [x.team_id,x.player_id,x.minutes,x.points])
}]));
function decodeVersions(rows) {
  const seen = new Map(), previousAccepted = new Map();
  let last = null;
  return rows.map(row => {
    const payload = JSON.parse(row.payload), after = payload.after;
    const facts = payload.facts.map(f => ({...f, integrated_at: seen.get(occurrence(f)) ?? row.integrated_at}));
    const changes = facts.filter(f => !seen.has(occurrence(f))).map(f => {
      const previouslyDisplayed = f.kind === 'INJURY' && last?.after?.primary?.players?.some(p =>
        p.official_for_game && p.team_id === f.team_id && p.player_id === f.player_id && p.status === f.status);
      if (f.effect === 'APPLIED' && (previouslyDisplayed || previousAccepted.get(identity(f)) === valueKey(f)))
        return {...f,effect:'ALREADY_KNOWN'};
      return f;
    });
    for (const f of facts) seen.set(occurrence(f),f.integrated_at);
    previousAccepted.clear();
    // Only the status applied this cycle (including corroboration by the
    // direct source) can carry forward. Older statuses are superseded.
    for (const f of facts.filter(x => x.effect === 'ALREADY_KNOWN')) previousAccepted.set(identity(f),valueKey(f));
    for (const f of facts.filter(x => x.effect === 'APPLIED')) previousAccepted.set(identity(f),valueKey(f));
    const previous = last;
    const different = canonical(measuredValues(payload.baseline)) !== canonical(measuredValues(after));
    const attribution = changes.length === 0 ? 'NO_NEW_INFORMATION'
      : previous && previous.inputSignature !== payload.inputSignature ? 'MIXED_INPUTS'
      : changes.length > 1 ? 'GROUP' : 'SINGLE';
    last = {id:row.id,match_id:row.match_id,as_of:row.as_of,tip:row.tip,integrated_at:row.integrated_at,
      ...payload,facts,revision:{attribution, changes, before:previous?.after ?? null, after,
        previous_visible: previous ? {id:previous.id,at:previous.integrated_at} : null,
        without_macfly:payload.baseline, integrated_at:row.integrated_at, changed:different}};
    return last;
  });
}

export async function readJournalVersions(db, matchId) {
  const rows = await primary(db).prepare(
    'SELECT * FROM max_forecast_versions WHERE match_id=? ORDER BY as_of,id'
  ).bind(String(matchId)).all();
  return decodeVersions(rows.results);
}

export async function saveJournalVersion(db, {game, asOf, receipts=[], facts=[], baseline, after, pair=null, inputSignature=null, deliveryKey=null}) {
  const tip=clock(game?.start), cutoff=clock(asOf);
  if (!tip || !cutoff || cutoff >= tip || game.status !== 'STATUS_SCHEDULED') return null;
  if (!baseline || !after || receipts.some(r => r.match_id !== String(game.id) || !clock(r.received_at) || clock(r.received_at)>cutoff) ||
    facts.some(f => f.match_id !== String(game.id) || !receipts.some(r => r.id === f.receipt_id))) throw Error('JOURNAL_INVALID_INPUT_CUTOFF');
  const session=primary(db), id=String(game.id);
  if (deliveryKey!==null && (typeof deliveryKey!=='string' || !deliveryKey || deliveryKey.length>256))
    throw Error('JOURNAL_INVALID_DELIVERY_KEY');
  const body=JSON.stringify({receipts,facts,baseline,after,pair,inputSignature,...(deliveryKey ? {deliveryKey} : {})});
  // Both the deadline and the order are checked on the primary in the same transaction as the write.
  const [,read]=await session.batch([
    session.prepare(`INSERT INTO max_forecast_versions (match_id,as_of,tip,payload)
      SELECT ?,?,?,? WHERE strftime('%Y-%m-%dT%H:%M:%fZ','now') < ? AND NOT EXISTS
        (SELECT 1 FROM max_forecast_versions WHERE match_id=? AND as_of>?)
      ON CONFLICT DO NOTHING`).bind(id,cutoff,tip,body,tip,id,cutoff),
    session.prepare('SELECT * FROM max_forecast_versions WHERE match_id=? AND as_of<=? ORDER BY as_of,id').bind(id,cutoff)
  ]);
  const exact = read.results.at(-1);
  if (!exact || exact.as_of !== cutoff) {
    if (!deliveryKey) return null;
    let versions=decodeVersions(read.results);
    let found=versions.find(v=>v.deliveryKey===deliveryKey);
    if (!found) {
      // A racing consumer could have used a later cut-off and committed first.
      versions=await readJournalVersions(session,id);
      found=versions.find(v=>v.deliveryKey===deliveryKey);
    }
    return found ?? null;
  }
  const stored=JSON.parse(exact.payload);
  if ((!deliveryKey || stored.deliveryKey!==deliveryKey) && canonical(stored)!==canonical(JSON.parse(body)))
    throw Error('JOURNAL_VERSION_CONTENT_CONFLICT');
  return decodeVersions(read.results).at(-1);
}
