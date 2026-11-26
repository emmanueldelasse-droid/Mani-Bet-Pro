/**
 * Private MacFly delivery plans. This file contains no credential and opens no
 * network connection. Persist the manifest after each command. Tool-level
 * refusals can be recorded with `recordOutcome` even when no API call ran.
 */
export const DESTINATION = Object.freeze({
  account_id: 'a44ec708d7642c774dc1f8c63f653c6b',
  database_id: '6b320ed0-c2a9-4b15-8b19-872103e05cd3',
  queue_id: '4c7b35e470a94e688918658b363cc53d'
});
const D1 = `/accounts/${DESTINATION.account_id}/d1/database/${DESTINATION.database_id}/query`;
const QUEUE = `/accounts/${DESTINATION.account_id}/queues/${DESTINATION.queue_id}/messages`;
const SELECT = "SELECT id,match_id,generated_at,received_at,report_json=? AS identical FROM macfly_inbox WHERE match_id=? AND generated_at=strftime('%Y-%m-%dT%H:%M:%fZ', ?)";
const INSERT = 'INSERT INTO macfly_inbox(report_json) VALUES (?) ON CONFLICT(match_id,generated_at) DO NOTHING';
const INTEGRATION = `SELECT 'INTEGRATED' AS status,v.id,v.match_id,v.as_of,v.tip,v.integrated_at,NULL AS received_at
FROM max_forecast_versions v,json_each(v.payload,'$.receipts') r
WHERE v.match_id=?1 AND json_extract(r.value,'$.id')=?2
UNION ALL
SELECT 'AFTER_TIP' AS status,NULL AS id,c.match_id,NULL AS as_of,c.tip,NULL AS integrated_at,i.received_at
FROM study_context c JOIN macfly_inbox i ON i.match_id=c.match_id
WHERE c.match_id=?1 AND i.id=?2 AND i.received_at>=c.tip
ORDER BY id DESC LIMIT 1`;
const STATES = new Set(['PENDING', 'INSERT', 'VERIFY', 'NOTIFY', 'CHECK_INTEGRATION',
  'RETRY_LATER', 'QUEUE_AMBIGUOUS', 'NOTIFIED_WAITING_INTEGRATION', 'INTEGRATED', 'AFTER_TIP_DOCUMENTARY', 'BLOCKED']);
const FINAL = new Set(['RETRY_LATER', 'QUEUE_AMBIGUOUS', 'NOTIFIED_WAITING_INTEGRATION', 'INTEGRATED', 'AFTER_TIP_DOCUMENTARY']);
const SECRET = /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|access_token|refresh_token|(?:x[-_])?api[-_]?key|.*[_-](?:token|password|secret|api[-_]?key))$/i;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const sourceTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && timestamp(value.replace(/(?:\.(\d{1,3}))?Z$/, (_, digits = '') => '.' + digits.padEnd(3, '0') + 'Z'));
const id = value => typeof value === 'string' && /^\d{5,15}$/.test(value);
const runId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const now = clock => new Date(clock ? clock() : Date.now()).toISOString();
function ensure(value, reason) { if (!value) throw Error(reason); }
export async function sha256(text) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    n => n.toString(16).padStart(2, '0')).join('');
}
function checkSecrets(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    ensure(!SECRET.test(key), 'REPORT_CONTAINS_CREDENTIAL_FIELD');
    checkSecrets(item);
  }
}
function sourceUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && ![...u.searchParams.keys()].some(k => SECRET.test(k)); }
  catch { return false; }
}
function reportInfo(body, expectedRun) {
  ensure(typeof body === 'string' && body.length > 0 && Array.from(body).length <= 250000, 'ORIGINAL_JSON_STRING_REQUIRED');
  let report;
  try { report = JSON.parse(body); } catch { throw Error('INVALID_REPORT_JSON'); }
  ensure(report && !Array.isArray(report) && report.schema_version === 'max-research-v1', 'INVALID_REPORT_SCHEMA');
  ensure(id(report.match_id), 'INVALID_MATCH_ID');
  ensure(runId(report.collection_run_id) && report.collection_run_id === expectedRun, 'COLLECTION_RUN_ID_MISMATCH');
  ensure(timestamp(report.generated_at), 'INVALID_GENERATED_AT');
  ensure(typeof report.summary === 'string' && Array.isArray(report.sources), 'INVALID_REPORT_FIELDS');
  ensure(Array.isArray(report.sections) && report.sections.length === 16 &&
    new Set(report.sections.map(s => s?.section_id)).size === 16 && report.sections.every(s =>
      Number.isSafeInteger(s?.section_id) && s.section_id >= 1 && s.section_id <= 16 && typeof s.title === 'string' &&
      ['VERIFIED', 'PARTIAL', 'UNAVAILABLE', 'CONFLICT'].includes(s.status) && Array.isArray(s.findings) &&
      s.findings.every(x => typeof x === 'string') && Array.isArray(s.missing) && s.missing.every(x => typeof x === 'string')), 'SIXTEEN_REPORT_SECTIONS_REQUIRED');
  checkSecrets(report);
  for (const source of report.sources) {
    ensure(source && sourceUrl(source.url) && sourceTime(source.checked_at), 'INVALID_SOURCE');
    ensure(Date.parse(source.checked_at) <= Date.parse(report.generated_at), 'SOURCE_AFTER_REPORT');
    ensure(source.published_at == null || sourceTime(source.published_at) && Date.parse(source.published_at) <= Date.parse(source.checked_at), 'INVALID_SOURCE_PUBLICATION');
  }
  for (const key of ['verified_injuries', 'verified_role_facts']) {
    ensure(report[key] == null || Array.isArray(report[key]), 'INVALID_FACTS');
    for (const fact of report[key] ?? []) {
      ensure(fact.match_id === report.match_id && sourceTime(fact.event_start), 'FACT_MATCH_MISMATCH');
      ensure(typeof fact.team_id === 'string' && /^\d{1,15}$/.test(fact.team_id), 'INVALID_TEAM_ID');
      ensure(fact.player_id == null || typeof fact.player_id === 'string' && /^\d{1,15}$/.test(fact.player_id), 'INVALID_PLAYER_ID');
      ensure(typeof fact.player === 'string' && fact.player.length > 0, 'INVALID_PLAYER_NAME');
      ensure(sourceTime(fact.checked_at) && Date.parse(fact.checked_at) <= Date.parse(report.generated_at) && Date.parse(fact.checked_at) < Date.parse(fact.event_start), 'INVALID_FACT_TIME');
      ensure(report.sources.some(s => s.url === fact.source_url), 'FACT_SOURCE_MISSING');
      ensure(fact.published_at == null || sourceTime(fact.published_at) && Date.parse(fact.published_at) <= Date.parse(fact.checked_at), 'INVALID_FACT_PUBLICATION');
    }
  }
  return {match_id: report.match_id, generated_at: report.generated_at};
}
export function archiveText(manifest) {
  return JSON.stringify({schema_version: 'macfly-originals-v1', collection_run_id: manifest.run_id,
    reports: manifest.reports.map(r => r.original)}) + '\n';
}
export async function prepareBatch(originals, {run_id, clock} = {}) {
  ensure(runId(run_id), 'STABLE_RUN_ID_REQUIRED');
  ensure(Array.isArray(originals) && originals.length > 0 && originals.length <= 6, 'EXPECTED_ONE_TO_SIX_ORIGINALS');
  const seen = new Set(), reports = [];
  for (const original of originals) {
    const info = reportInfo(original, run_id), key = `${info.match_id}:${info.generated_at}`;
    ensure(!seen.has(key), 'DUPLICATE_REPORT_ID_IN_BATCH'); seen.add(key);
    reports.push({...info, original, sha256: await sha256(original), state: 'PENDING', receipt: null, integration: null});
  }
  const manifest = {schema_version: 'macfly-delivery-v1', run_id, prepared_at: now(clock),
    reports, archive_sha256: null, archive: null, pending: null, block: null, events: []};
  ensure(reports.every(r => r.generated_at <= manifest.prepared_at), 'REPORT_GENERATED_IN_FUTURE');
  manifest.archive_sha256 = await sha256(archiveText(manifest));
  return manifest;
}
export async function validateManifest(manifest, {requireArchive = true} = {}) {
  ensure(manifest?.schema_version === 'macfly-delivery-v1' && runId(manifest.run_id), 'INVALID_DELIVERY_MANIFEST');
  ensure(timestamp(manifest.prepared_at), 'INVALID_PREPARATION_TIME');
  ensure(Array.isArray(manifest.reports) && manifest.reports.length > 0 && manifest.reports.length <= 6 && Array.isArray(manifest.events), 'INVALID_DELIVERY_MANIFEST');
  const seen = new Set();
  for (const report of manifest.reports) {
    const info = reportInfo(report.original, manifest.run_id), key = `${info.match_id}:${info.generated_at}`;
    ensure(!seen.has(key), 'DUPLICATE_REPORT_ID_IN_BATCH'); seen.add(key);
    ensure(info.match_id === report.match_id && info.generated_at === report.generated_at && await sha256(report.original) === report.sha256, 'ORIGINAL_TAMPERED');
    ensure(report.generated_at <= manifest.prepared_at, 'REPORT_GENERATED_IN_FUTURE');
    ensure(STATES.has(report.state), 'INVALID_DELIVERY_STATE');
  }
  ensure(await sha256(archiveText(manifest)) === manifest.archive_sha256, 'ARCHIVE_CONTENT_TAMPERED');
  if (requireArchive) {
    const a = manifest.archive;
    ensure(a?.provider === 'chatgpt-library' && durableId(a.file_id) && a.readback_file_id === a.file_id &&
      a.sha256 === manifest.archive_sha256 && a.readback_sha256 === a.sha256 && timestamp(a.verified_at), 'VERIFIED_DURABLE_ARCHIVE_REQUIRED');
  }
  return true;
}
function durableId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,255}$/.test(value) && !/^(?:sandbox|file:|https?:)/i.test(value);
}
/** readArchive is a separate read of the already-created Library file. */
export async function verifyArchive(manifest, reference, readArchive, {clock} = {}) {
  await validateManifest(manifest, {requireArchive: false});
  ensure(reference?.provider === 'chatgpt-library' && durableId(reference.file_id), 'DURABLE_ARCHIVE_REFERENCE_REQUIRED');
  ensure(typeof readArchive === 'function', 'INDEPENDENT_ARCHIVE_READ_REQUIRED');
  const read = await readArchive({...reference});
  ensure(read?.file_id === reference.file_id && typeof read.text === 'string', 'ARCHIVE_READBACK_ID_MISMATCH');
  const digest = await sha256(read.text);
  ensure(digest === manifest.archive_sha256 && read.text === archiveText(manifest), 'ARCHIVE_READBACK_MISMATCH');
  manifest.archive = {...reference, sha256: digest, readback_file_id: read.file_id, readback_sha256: digest, verified_at: now(clock)};
  return manifest.archive;
}
function requestFor(report, stage) {
  if (['PENDING', 'VERIFY'].includes(stage)) return {method: 'POST', path: D1,
    body: {sql: SELECT, params: [report.original, report.match_id, report.generated_at]}};
  if (stage === 'INSERT') return {method: 'POST', path: D1, body: {sql: INSERT, params: [report.original]}};
  if (stage === 'NOTIFY') {
    ensure(report.receipt?.identical === 1, 'INDEPENDENT_RECEIPT_REQUIRED');
    return {method: 'POST', path: QUEUE, body: {content_type: 'json',
      body: {match_id: report.receipt.match_id, generated_at: report.receipt.generated_at}}};
  }
  if (stage === 'CHECK_INTEGRATION') {
    ensure(report.receipt?.identical === 1, 'INDEPENDENT_RECEIPT_REQUIRED');
    return {method: 'POST', path: D1, body: {sql: INTEGRATION, params: [report.match_id, report.receipt.id]}};
  }
  throw Error('NO_OPERATION_FOR_STATE');
}
/** One operation only. Persist `pending` before calling the connector. */
export async function nextOperation(manifest, {clock} = {}) {
  await validateManifest(manifest);
  ensure(!manifest.block, 'BATCH_BLOCKED'); ensure(!manifest.pending, 'PENDING_OUTCOME_REQUIRED');
  const index = manifest.reports.findIndex(r => !FINAL.has(r.state));
  if (index < 0) return null;
  const report = manifest.reports[index], stage = report.state;
  const op = {id: `${manifest.run_id}:${manifest.events.length + 1}`, report_index: index, stage,
    account_id: DESTINATION.account_id, request: requestFor(report, stage)};
  manifest.pending = {...op, planned_at: now(clock)};
  return structuredClone(op);
}
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET.test(k) ? '[REDACTED]' : redact(v)]));
  if (typeof value !== 'string') return value;
  return value.replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(authorization|cookie|password|secret|token|(?:access|refresh)[_-]?token|(?:x[-_])?api[-_]?key)(["']?\s*[:=]\s*["']?)[^\s,;"'&}<>]+/gi, '$1$2[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[REDACTED]@');
}
function refused(outcome) {
  if (outcome.kind === 'REFUSED') return true;
  const deniedStatus = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) =>
    /^(?:http_?status|status_?code|status)$/i.test(key) && [401, 403].includes(Number(item)) || deniedStatus(item));
  const raw = JSON.stringify(outcome.response ?? outcome.error ?? '');
  return deniedStatus(outcome) || /\b(?:401\s+Unauthorized|403\s+Forbidden)\b/i.test(raw) ||
    /(?:HTTP\s*(?:401|403)\b|auto[_ -]?review.{0,100}(?:reject|denied|refus)|approval.{0,100}(?:reject|denied)|permission denied|\baccess[\s_-]*(?:deny|denied)\b|not authorized|not authorised)/i.test(raw) ||
    /(?:refus|rejet|bloqu).{0,100}(?:contr[oô]le|s[eé]curit[eé]|autorisation|approbation)|(?:contr[oô]le|s[eé]curit[eé]|autorisation|approbation).{0,100}(?:refus|rejet|bloqu)/i.test(raw);
}
function envelope(response) {
  return response?.success === true && Array.isArray(response.errors) && response.errors.length === 0 &&
    Object.hasOwn(response, 'result');
}
const canonicalResponse = value => JSON.stringify(value, function (key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
});
const TRANSPORT_FIELDS = new Set(['success', 'result', 'errors', 'error', 'isError', 'structuredContent', 'content']);
const transportWrapper = value => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).some(key => TRANSPORT_FIELDS.has(key));
function containsTransportWrapper(value, depth = 0) {
  if (depth > 16) return true;
  if (typeof value === 'string') {
    let parsed; try { parsed = JSON.parse(value); } catch { return false; }
    return containsTransportWrapper(parsed, depth + 1);
  }
  if (!value || typeof value !== 'object') return false;
  return transportWrapper(value) || Object.values(value).some(item => containsTransportWrapper(item, depth + 1));
}
/** Accept the actual API envelope or its MCP transport wrapper, retaining raw
 * output in the event. Never unwrap through a tool error or choose between
 * disagreeing structured/text responses. */
function responseEnvelope(value, depth = 0) {
  ensure(depth <= 8, 'RESPONSE_WRAPPER_TOO_DEEP');
  if (typeof value === 'string') {
    let parsed; try { parsed = JSON.parse(value); } catch { throw Error('UNRECOGNIZED_RESPONSE_ENVELOPE'); }
    return responseEnvelope(parsed, depth + 1);
  }
  ensure(value && typeof value === 'object' && !Array.isArray(value), 'UNRECOGNIZED_RESPONSE_ENVELOPE');
  ensure(!Object.hasOwn(value, 'success') || typeof value.success === 'boolean', 'INVALID_SUCCESS_FLAG');
  ensure((value.isError == null || value.isError === false) && (value.error == null || value.error === '') &&
    (value.errors == null || Array.isArray(value.errors) && value.errors.length === 0) &&
    !['error', 'failed', 'denied', 'refused'].includes(String(value.status ?? '').toLowerCase()), 'TOOL_RESPONSE_ERROR');
  // An explicit API/tool failure is authoritative even if its result happens
  // to contain a successful envelope from a previous operation.
  if (value.success === false) return value;
  const candidates = [];
  const apiShaped = Object.hasOwn(value, 'success') && Object.hasOwn(value, 'result');
  const nestedTransport = transportWrapper(value.result);
  if (apiShaped && !nestedTransport) candidates.push(value);
  if (value.result != null && (!apiShaped || nestedTransport)) candidates.push(responseEnvelope(value.result, depth + 1));
  if (value.structuredContent != null) {
    candidates.push(responseEnvelope(value.structuredContent, depth + 1));
  }
  if (typeof value.content === 'string') candidates.push(responseEnvelope(value.content, depth + 1));
  else if (Array.isArray(value.content)) {
    for (const item of value.content) {
      if (item?.type !== 'text' || typeof item.text !== 'string') continue;
      // Non-JSON status text is not a server reply. Refusal detection examines
      // the entire raw outcome before reaching this function.
      let parsed; try { parsed = JSON.parse(item.text); } catch { continue; }
      candidates.push(responseEnvelope(parsed, depth + 1));
    }
  }
  ensure(candidates.length > 0, 'UNRECOGNIZED_RESPONSE_ENVELOPE');
  // Compare the actual API contract, not transport-only fields present on one
  // representation. Missing errors remain missing and cannot create success.
  const signature = c => canonicalResponse({success: c.success, errors: c.errors, result: c.result});
  ensure(candidates.every(c => signature(c) === signature(candidates[0])), 'CONFLICTING_RESPONSE_WRAPPERS');
  return candidates[0];
}
function queueAccepted(response) {
  const payload = response?.result;
  ensure(envelope(response) && payload && typeof payload === 'object' && !Array.isArray(payload) &&
    !containsTransportWrapper(payload) &&
    (payload.isError == null || payload.isError === false) && (payload.error == null || payload.error === '') &&
    (payload.errors == null || Array.isArray(payload.errors) && payload.errors.length === 0) &&
    (!Object.hasOwn(payload, 'success') || payload.success === true) &&
    !['error', 'failed', 'denied', 'refused'].includes(String(payload.status ?? '').toLowerCase()), 'UNCONFIRMED_QUEUE_RESPONSE');
}
function rows(response) {
  ensure(envelope(response) && Array.isArray(response.result) && response.result.length === 1 &&
    response.result[0]?.success === true && Array.isArray(response.result[0].results), 'UNCONFIRMED_D1_RESPONSE');
  return response.result[0].results;
}
function block(manifest, report, kind, event) {
  report.state = 'BLOCKED';
  manifest.block = {kind, operation_id: event.operation_id, event_sequence: event.sequence, at: event.at};
}
/** Keep the actual response, including a tool refusal, with credentials redacted. */
export async function recordOutcome(manifest, operationId, outcome, {clock} = {}) {
  await validateManifest(manifest);
  const op = manifest.pending;
  ensure(op?.id === operationId, 'UNKNOWN_PENDING_OPERATION');
  const report = manifest.reports[op.report_index];
  ensure(JSON.stringify(op.request) === JSON.stringify(requestFor(report, op.stage)), 'OPERATION_TAMPERED');
  ensure(['RESPONSE', 'AMBIGUOUS', 'REFUSED', 'ERROR'].includes(outcome?.kind), 'EXPLICIT_OUTCOME_REQUIRED');
  const event = {sequence: manifest.events.length + 1, at: now(clock), operation_id: op.id,
    report_index: op.report_index, stage: op.stage, outcome: outcome.kind, raw: redact(outcome)};
  manifest.events.push(event); manifest.pending = null;
  if (refused(outcome)) { block(manifest, report, 'AUTHORIZATION_REFUSAL', event); return event; }
  if (outcome.kind === 'AMBIGUOUS') {
    report.state = op.stage === 'INSERT' ? 'VERIFY' : op.stage === 'NOTIFY' ? 'QUEUE_AMBIGUOUS'
      : op.stage === 'CHECK_INTEGRATION' && report.notification ? 'NOTIFIED_WAITING_INTEGRATION' : 'RETRY_LATER';
    return event;
  }
  if (outcome.kind !== 'RESPONSE') {
    block(manifest, report, 'UNCONFIRMED_FAILURE', event); return event;
  }
  try {
    const response = responseEnvelope(outcome.response);
    if (!envelope(response)) { block(manifest, report, 'UNCONFIRMED_FAILURE', event); return event; }
    if (['PENDING', 'VERIFY'].includes(op.stage)) {
      const found = rows(response);
      ensure(found.length <= 1, 'AMBIGUOUS_RECEIPT');
      if (!found.length) { report.state = op.stage === 'PENDING' ? 'INSERT' : 'RETRY_LATER'; return event; }
      const receipt = found[0];
      ensure(Number.isSafeInteger(receipt.id) && receipt.id > 0 && receipt.match_id === report.match_id &&
        receipt.generated_at === report.generated_at && timestamp(receipt.received_at) &&
        receipt.received_at >= report.generated_at && receipt.identical === 1, 'RECEIPT_CONTENT_CONFLICT');
      report.receipt = {...receipt, verified_by: op.id, verified_at: event.at}; report.state = 'NOTIFY';
    } else if (op.stage === 'INSERT') {
      // A successful INSERT never proves reception. Always issue a separate SELECT.
      rows(response); report.state = 'VERIFY';
    } else if (op.stage === 'NOTIFY') {
      queueAccepted(response);
      report.notification = {operation_id: op.id, accepted_at: event.at}; report.state = 'CHECK_INTEGRATION';
    } else if (op.stage === 'CHECK_INTEGRATION') {
      const found = rows(response); ensure(found.length <= 1, 'AMBIGUOUS_INTEGRATION');
      if (!found.length) { report.state = 'NOTIFIED_WAITING_INTEGRATION'; return event; }
      const version = found[0];
      if (version.status === 'AFTER_TIP') {
        ensure(version.match_id === report.match_id && timestamp(version.tip) &&
          version.received_at === report.receipt.received_at && version.received_at >= version.tip, 'INVALID_DOCUMENTARY_PROOF');
        report.documentary = {tip: version.tip, received_at: version.received_at, verified_by: op.id};
        report.state = 'AFTER_TIP_DOCUMENTARY'; return event;
      }
      ensure(version.status === 'INTEGRATED', 'INVALID_INTEGRATION_STATUS');
      ensure(Number.isSafeInteger(version.id) && version.id > 0 && version.match_id === report.match_id &&
        timestamp(version.as_of) && timestamp(version.tip) && timestamp(version.integrated_at) &&
        version.as_of >= report.receipt.received_at && version.integrated_at >= version.as_of &&
        version.integrated_at < version.tip, 'INVALID_INTEGRATION_PROOF');
      report.integration = {...version, verified_by: op.id}; report.state = 'INTEGRATED';
    }
  } catch (error) {
    event.validation_error = error.message; block(manifest, report, error.message, event);
  }
  return event;
}
/** No network retry here. Call only at an authorized later pass/resolution. */
export async function resumeBatch(manifest, {authorization_reference, resolution_reference, clock} = {}) {
  await validateManifest(manifest); ensure(!manifest.pending, 'PENDING_OUTCOME_REQUIRED');
  if (manifest.block) {
    const reference = manifest.block.kind === 'AUTHORIZATION_REFUSAL' ? authorization_reference : resolution_reference;
    ensure(typeof reference === 'string' && reference.trim().length >= 12, 'EXPLICIT_RESOLUTION_REFERENCE_REQUIRED');
    manifest.events.push({sequence: manifest.events.length + 1, at: now(clock), outcome: 'RESUME_AUTHORIZED',
      previous_block: manifest.block, reference: redact(reference)});
    manifest.block = null;
  }
  for (const report of manifest.reports) {
    if (['BLOCKED', 'RETRY_LATER', 'QUEUE_AMBIGUOUS'].includes(report.state))
      report.state = report.notification ? 'CHECK_INTEGRATION' : 'PENDING';
    else if (report.state === 'NOTIFIED_WAITING_INTEGRATION') report.state = 'CHECK_INTEGRATION';
  }
}
/** Optional adapter: request = cloudflare.request; persist must durably save the manifest. */
export async function executeNext(manifest, {request, persist, clock}) {
  ensure(typeof request === 'function' && typeof persist === 'function', 'REQUEST_AND_DURABLE_PERSIST_REQUIRED');
  const operation = await nextOperation(manifest, {clock}); if (!operation) return null;
  await persist(structuredClone(manifest));
  let outcome;
  try { outcome = {kind: 'RESPONSE', response: await request(operation.request)}; }
  catch (error) {
    const detail = {message: error?.message ?? String(error), code: error?.code, status: error?.status, statusCode: error?.statusCode};
    outcome = {kind: 'ERROR', error: detail, http_status: error?.status ?? error?.statusCode};
    // Only explicitly identified transport ambiguity permits a later readback.
    if (['ETIMEDOUT', 'ECONNRESET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.code)) outcome.kind = 'AMBIGUOUS';
  }
  await recordOutcome(manifest, operation.id, outcome, {clock});
  await persist(structuredClone(manifest));
  return {operation, state: manifest.reports[operation.report_index].state, block: manifest.block};
}

// CLI prepares files/plans only. It never calls Cloudflare or reads credentials.
// prepare ORIGINAL_STRINGS.json RUN_ID MANIFEST.json ARCHIVE.json
// archive MANIFEST.json LIBRARY_FILE_ID INDEPENDENT_READBACK.json
// next MANIFEST.json | outcome MANIFEST.json OUTCOME.json
// resume MANIFEST.json AUTHORIZATION_REFERENCE | validate MANIFEST.json
async function cli(args) {
  const {readFile, writeFile, rename} = await import('node:fs/promises');
  const [command, filename, ...rest] = args;
  const read = async path => JSON.parse(await readFile(path, 'utf8'));
  const save = async (path, value) => {
    const temporary = `${path}.tmp-${process.pid}`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: 0o600});
    await rename(temporary, path);
  };
  if (command === 'prepare') {
    const [run_id, manifestFile, archiveFile] = rest;
    ensure(filename && run_id && manifestFile && archiveFile, 'prepare ORIGINALS RUN_ID MANIFEST ARCHIVE');
    const manifest = await prepareBatch(await read(filename), {run_id});
    await save(manifestFile, manifest); await writeFile(archiveFile, archiveText(manifest), {mode: 0o600});
    console.log(JSON.stringify({manifest: manifestFile, archive: archiveFile, sha256: manifest.archive_sha256, archived: false})); return;
  }
  ensure(filename, 'MANIFEST_PATH_REQUIRED');
  const manifest = await read(filename);
  let result;
  if (command === 'archive') {
    const [file_id, readback] = rest;
    result = await verifyArchive(manifest, {provider: 'chatgpt-library', file_id}, async () => ({file_id, text: await readFile(readback, 'utf8')}));
  } else if (command === 'next') result = await nextOperation(manifest);
  else if (command === 'outcome') {
    const outcome = await read(rest[0]);
    ensure(typeof outcome.operation_id === 'string', 'OUTCOME_OPERATION_ID_REQUIRED');
    result = await recordOutcome(manifest, outcome.operation_id, outcome);
  }
  else if (command === 'resume') result = await resumeBatch(manifest, {authorization_reference: rest[0], resolution_reference: rest[0]});
  else if (command === 'validate') result = await validateManifest(manifest);
  else throw Error('UNKNOWN_COMMAND');
  await save(filename, manifest); console.log(JSON.stringify(command === 'next' ? result : result ?? {ok: true}));
}
if (typeof process !== 'undefined' && process.argv?.[1]) {
  const {pathToFileURL} = await import('node:url');
  if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await cli(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
