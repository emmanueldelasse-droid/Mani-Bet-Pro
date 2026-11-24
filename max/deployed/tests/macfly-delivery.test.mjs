import test from 'node:test';
import assert from 'node:assert/strict';
import {d1} from './study-journey-fixture.mjs';
import {DESTINATION, archiveText, executeNext, nextOperation, prepareBatch, recordOutcome,
  resumeBatch, sha256, validateManifest, verifyArchive} from '../release/macfly-delivery.mjs';

const RUN = 'macfly-test-20300102';
const TIME = Date.parse('2030-01-02T08:00:00.000Z');
const clock = () => TIME;
const iso = n => new Date(n).toISOString();
function original(n = 1, patch = {}) {
  return JSON.stringify({schema_version: 'max-research-v1', collection_run_id: RUN,
    match_id: `90000000${n}`, generated_at: iso(TIME - 60000),
    summary: 'Donnée fictive — test local, jamais envoyée.',
    sections: Array.from({length: 16}, (_, i) => ({section_id: i + 1, title: `Section ${i + 1}`,
      status: 'UNAVAILABLE', findings: [], missing: ['Jeu de données synthétique.']})),
    sources: [{url: 'https://official.nba.com/test-fixture/', checked_at: '2030-01-02T07:58:00Z',
      published_at: '2030-01-02T07:57:00.000Z', title: 'Source fictive', kind: 'OFFICIAL'}], ...patch}, null, 2);
}
async function batch(originals = [original()]) {
  return prepareBatch(originals, {run_id: RUN, clock});
}
async function archive(manifest) {
  return verifyArchive(manifest, {provider: 'chatgpt-library', file_id: 'libfile_delivery_test'},
    async reference => ({file_id: reference.file_id, text: archiveText(manifest)}), {clock});
}
function server() {
  const db = d1({serverClock: clock}), calls = [], notifications = [];
  const request = async op => {
    calls.push(structuredClone(op));
    assert.equal(op.method, 'POST');
    if (op.path.endsWith('/query')) {
      assert.equal(op.path, `/accounts/${DESTINATION.account_id}/d1/database/${DESTINATION.database_id}/query`);
      return {success: true, errors: [], result: [await db.prepare(op.body.sql).bind(...op.body.params).all()]};
    }
    assert.equal(op.path, `/accounts/${DESTINATION.account_id}/queues/${DESTINATION.queue_id}/messages`);
    notifications.push(op.body); return {success: true, errors: [], result: {}};
  };
  return {db, request, calls, notifications};
}
async function finish(manifest, request, persist = async () => {}) {
  for (let i = 0; i < 40; i++) {
    if (manifest.block) return;
    if (!await executeNext(manifest, {request, persist, clock})) return;
  }
  throw Error('Unexpected delivery loop');
}
const insertCount = server => server.calls.filter(c => c.body.sql?.startsWith('INSERT')).length;

test('original strings keep every byte, source timestamp and identity; mutation and invalid schema fail', async () => {
  const text = original(), manifest = await batch([text]);
  assert.equal(manifest.reports[0].original, text);
  assert.equal(JSON.parse(archiveText(manifest)).reports[0], text);
  assert.equal(manifest.reports[0].sha256, await sha256(text));
  assert.equal(await sha256(archiveText(manifest)), manifest.archive_sha256);
  await assert.rejects(batch([JSON.parse(text)]), /ORIGINAL_JSON_STRING/);
  await assert.rejects(batch([text, text]), /DUPLICATE_REPORT/);
  await assert.rejects(batch([original(1, {schema_version: 'bad'})]), /SCHEMA/);
  await assert.rejects(batch([original(1, {match_id: 'unknown'})]), /MATCH_ID/);
  await assert.rejects(batch([original(1, {collection_run_id: 'other'})]), /RUN_ID/);
  await assert.rejects(batch([original(1, {generated_at: '2030-02-30T08:00:00.000Z'})]), /GENERATED_AT/);
  await assert.rejects(batch([original(1, {generated_at: iso(TIME + 1)})]), /GENERATED_IN_FUTURE/);
  await assert.rejects(batch([original(1, {sections: []})]), /SIXTEEN_REPORT_SECTIONS/);
  await assert.rejects(batch([original(1, {authorization: 'private'})]), /CREDENTIAL_FIELD/);
  manifest.reports[0].original += ' ';
  await assert.rejects(validateManifest(manifest, {requireArchive: false}), /TAMPERED/);
});

test('no operation without a durable archive independently reread with matching ID and exact hash', async () => {
  const m = await batch();
  await assert.rejects(nextOperation(m), /VERIFIED_DURABLE_ARCHIVE/);
  await assert.rejects(verifyArchive(m, {provider: 'chatgpt-library', file_id: 'sandbox:/mnt/data/a.json'}, async () => ({})), /DURABLE_ARCHIVE_REFERENCE/);
  await assert.rejects(verifyArchive(m, {provider: 'chatgpt-library', file_id: 'libfile_a'}, null), /INDEPENDENT_ARCHIVE_READ/);
  await assert.rejects(verifyArchive(m, {provider: 'chatgpt-library', file_id: 'libfile_a'}, async () => ({file_id: 'libfile_b', text: archiveText(m)})), /READBACK_ID/);
  await assert.rejects(verifyArchive(m, {provider: 'chatgpt-library', file_id: 'libfile_a'}, async () => ({file_id: 'libfile_a', text: archiveText(m) + ' '})), /READBACK_MISMATCH/);
  assert.equal(m.archive, null);
  let reads = 0;
  await verifyArchive(m, {provider: 'chatgpt-library', file_id: 'libfile_a'}, async ref => {
    reads++; return {file_id: ref.file_id, text: archiveText(m)};
  }, {clock});
  assert.equal(reads, 1);
  assert.equal(m.archive.readback_sha256, m.archive_sha256);
  assert.equal((await nextOperation(m)).stage, 'PENDING');
});

test('successful INSERT is followed by an independent SELECT before any Queue notification', async () => {
  const m = await batch(), s = server(), saved = [];
  await archive(m);
  const persist = async snapshot => saved.push(snapshot);
  await executeNext(m, {request: s.request, persist, clock});
  assert.equal(m.reports[0].state, 'INSERT');
  await executeNext(m, {request: s.request, persist, clock});
  assert.equal(m.reports[0].state, 'VERIFY');
  assert.equal(m.reports[0].receipt, null);
  assert.equal(s.notifications.length, 0);
  await executeNext(m, {request: s.request, persist, clock});
  assert.equal(m.reports[0].state, 'NOTIFY');
  assert.equal(m.reports[0].receipt.identical, 1);
  assert.equal(m.reports[0].receipt.received_at, iso(TIME));
  await finish(m, s.request, persist);
  assert.equal(insertCount(s), 1);
  assert.equal(s.notifications.length, 1);
  assert.equal(m.reports[0].state, 'NOTIFIED_WAITING_INTEGRATION');
  assert.equal(m.reports[0].integration, null);
  assert.equal(s.db.prepare('SELECT report_json FROM macfly_inbox').first().report_json, original());
  assert.deepEqual(s.notifications[0], {content_type: 'json', body: {
    match_id: '900000001', generated_at: iso(TIME - 60000)}});
  assert.equal(saved.length, 10);
  assert.ok(saved.filter(x => x.pending).every(x => x.events.length < saved.at(-1).events.length));
});

test('replaying an already received original skips INSERT and keeps the original receipt and bytes', async () => {
  const s = server(), first = await batch(); await archive(first); await finish(first, s.request);
  const initialReceipt = first.reports[0].receipt.id, before = insertCount(s);
  const retry = await batch(); await archive(retry); await finish(retry, s.request);
  assert.equal(insertCount(s), before);
  assert.equal(retry.reports[0].receipt.id, initialReceipt);
  assert.equal(s.db.prepare('SELECT count(*) n FROM macfly_inbox').first().n, 1);
  assert.equal(s.notifications.length, 2);
  assert.equal(retry.reports[0].original, first.reports[0].original);
});

test('same identity with another body blocks the whole batch and never overwrites or sends Queue', async () => {
  const s = server();
  s.db.prepare('INSERT INTO macfly_inbox(report_json) VALUES (?)').bind(original()).run();
  const changed = original(1, {summary: 'Different body, same identity.'});
  const m = await batch([changed, original(2)]); await archive(m); await finish(m, s.request);
  assert.equal(m.block.kind, 'RECEIPT_CONTENT_CONFLICT');
  assert.equal(s.calls.length, 1);
  assert.equal(insertCount(s), 0); assert.equal(s.notifications.length, 0);
  assert.equal(s.db.prepare('SELECT report_json FROM macfly_inbox').first().report_json, original());
  await assert.rejects(nextOperation(m), /BATCH_BLOCKED/);
});

test('ambiguous INSERT after commit is reread independently and never inserted twice', async () => {
  const s = server(), m = await batch(); await archive(m);
  let interrupted = false;
  const request = async op => {
    const response = await s.request(op);
    if (op.body.sql?.startsWith('INSERT') && !interrupted) {
      interrupted = true; throw Object.assign(Error('connection reset after write'), {code: 'ECONNRESET'});
    }
    return response;
  };
  await finish(m, request);
  assert.equal(m.events[1].outcome, 'AMBIGUOUS');
  assert.equal(insertCount(s), 1);
  assert.equal(s.notifications.length, 1);
  assert.equal(m.reports[0].receipt.identical, 1);
});

test('ambiguous INSERT without a receipt waits for a later pass; no immediate retry or Queue', async () => {
  const s = server(), m = await batch(); await archive(m);
  let writes = 0;
  const request = async op => {
    if (op.body.sql?.startsWith('INSERT')) { writes++; throw Object.assign(Error('timeout before reply'), {code: 'ETIMEDOUT'}); }
    return s.request(op);
  };
  await finish(m, request);
  assert.equal(writes, 1); assert.equal(s.notifications.length, 0);
  assert.equal(m.reports[0].state, 'RETRY_LATER');
  await resumeBatch(m); await finish(m, s.request);
  assert.equal(s.notifications.length, 1);
});

test('security refusal records the raw reason, redacts credentials and stops the remaining reports', async () => {
  const m = await batch([original(), original(2)]), s = server(); await archive(m);
  await executeNext(m, {request: s.request, persist: async () => {}, clock});
  const op = await nextOperation(m, {clock});
  await recordOutcome(m, op.id, {kind: 'REFUSED', response: {
    reason: 'Automatic approval review rejected the write: missing explicit scope.',
    authorization: 'Bearer private-token', detail: 'Bearer private-token',
    headers: {'X-API-Key': 'hidden-key'}, serialized: '{"access_token":"hidden-token"}'
  }}, {clock});
  assert.equal(m.block.kind, 'AUTHORIZATION_REFUSAL');
  assert.equal(m.events.at(-1).raw.response.reason, 'Automatic approval review rejected the write: missing explicit scope.');
  assert.equal(m.events.at(-1).raw.response.authorization, '[REDACTED]');
  assert.ok(!JSON.stringify(m).includes('private-token'));
  assert.ok(!JSON.stringify(m).includes('hidden-key'));
  assert.ok(!JSON.stringify(m).includes('hidden-token'));
  await assert.rejects(nextOperation(m), /BATCH_BLOCKED/);
  await assert.rejects(resumeBatch(m), /EXPLICIT_RESOLUTION_REFERENCE/);
  await assert.rejects(resumeBatch(m, {resolution_reference: 'This is a generic retry, not an authorization.'}), /EXPLICIT_RESOLUTION_REFERENCE/);
  assert.equal(m.reports[1].state, 'PENDING'); assert.equal(s.calls.length, 1);
  await resumeBatch(m, {authorization_reference: 'User message of 2030-01-02 explicitly authorizing this original batch.', clock});
  assert.equal(m.reports[0].original, original());
  const resumed = await nextOperation(m, {clock});
  assert.equal(resumed.stage, 'PENDING'); assert.ok(resumed.request.body.sql.startsWith('SELECT'));
});

test('HTTP 403 blocks without a retry even when the adapter reports a generic error', async () => {
  const m = await batch(); await archive(m);
  await executeNext(m, {request: async () => { throw Object.assign(Error('HTTP 403 permission denied'), {status: 403}); },
    persist: async () => {}, clock});
  assert.equal(m.block.kind, 'AUTHORIZATION_REFUSAL');
  assert.equal(m.events[0].raw.error.message, 'HTTP 403 permission denied');
  await assert.rejects(nextOperation(m), /BATCH_BLOCKED/);
});

test('raw 401/403 refusals and structured status fields require explicit reauthorization', async () => {
  for (const response of [
    {isError: true, content: [{type: 'text', text: '403 Forbidden'}]},
    {isError: true, content: [{type: 'text', text: '401 Unauthorized'}]},
    {status: 403}, {statusCode: 401}, {error: {status: '403'}},
    {structuredContent: {statusCode: '401'}}
  ]) {
    const m = await batch(); await archive(m);
    const op = await nextOperation(m);
    await recordOutcome(m, op.id, {kind: 'ERROR', response});
    assert.equal(m.block.kind, 'AUTHORIZATION_REFUSAL', JSON.stringify(response));
    await assert.rejects(resumeBatch(m, {resolution_reference: 'Generic transport resolution without authorization.'}),
      /EXPLICIT_RESOLUTION_REFERENCE/);
  }
  const m = await batch(); await archive(m);
  await executeNext(m, {request: async () => { throw Object.assign(Error('Request refused'), {statusCode: 403}); },
    persist: async () => {}, clock});
  assert.equal(m.block.kind, 'AUTHORIZATION_REFUSAL');
  assert.equal(m.events[0].raw.error.statusCode, 403);
});

test('French tool-level security refusals stop delivery even before the API is called', async () => {
  for (const message of ['Le contrôle de sécurité a refusé cette opération.',
    'Transmission bloquée par le contrôle de sécurité.', 'Approbation refusée.',
    'Action rejetée par le contrôle automatique des autorisations.']) {
    const m = await batch(); await archive(m);
    const op = await nextOperation(m);
    await recordOutcome(m, op.id, {kind: 'ERROR', response: {isError: true, content: [{type: 'text', text: message}]}});
    assert.equal(m.block.kind, 'AUTHORIZATION_REFUSAL', message);
  }
});

test('missing or unsuccessful API responses cannot be represented as a valid receipt', async () => {
  for (const response of [null, {success: false, errors: [{message: 'SQL constraint'}]},
    {success: true, result: [{success: false, results: []}]},
    {success: true, result: [{success: true, results: [{id: 1, identical: 1}]}]}]) {
    const m = await batch(); await archive(m);
    await executeNext(m, {request: async () => response, persist: async () => {}, clock});
    assert.ok(m.block); assert.equal(m.reports[0].receipt, null);
  }
});

test('pending outcomes, operation tampering and unavailable durable persistence fail closed', async () => {
  const m = await batch(); await archive(m);
  const op = await nextOperation(m);
  await assert.rejects(nextOperation(m), /PENDING_OUTCOME/);
  await assert.rejects(recordOutcome(m, 'wrong-id', {kind: 'AMBIGUOUS'}), /UNKNOWN_PENDING/);
  m.pending.request.path = '/accounts/other/d1/database/other/query';
  await assert.rejects(recordOutcome(m, op.id, {kind: 'AMBIGUOUS'}), /OPERATION_TAMPERED/);
  const fresh = await batch(); await archive(fresh); let calls = 0;
  await assert.rejects(executeNext(fresh, {request: async () => { calls++; },
    persist: async () => { throw Error('Archive store unavailable'); }}), /Archive store unavailable/);
  assert.equal(calls, 0);
});

test('only a matching pregame version establishes integration; Queue acceptance alone does not', async () => {
  const m = await batch(), s = server(); await archive(m);
  await finish(m, s.request);
  assert.equal(m.reports[0].state, 'NOTIFIED_WAITING_INTEGRATION');
  const receipt = m.reports[0].receipt;
  s.db.prepare('INSERT INTO max_forecast_versions(match_id,as_of,tip,payload) VALUES (?,?,?,?)')
    .bind(receipt.match_id, iso(TIME), iso(TIME + 3600000), JSON.stringify({receipts: [{id: receipt.id}]})).run();
  await resumeBatch(m); await finish(m, s.request);
  assert.equal(m.reports[0].state, 'INTEGRATED');
  assert.equal(m.reports[0].integration.match_id, receipt.match_id);
  assert.equal(s.notifications.length, 1);
});

test('a server-confirmed late receipt stays documentary and never becomes an integrated forecast', async () => {
  const m = await batch(), s = server(); await archive(m);
  s.db.prepare('INSERT INTO study_context(match_id,tip,source_at,context) VALUES (?,?,?,?)')
    .bind('900000001', iso(TIME - 10000), iso(TIME - 70000), '{}').run();
  await finish(m, s.request);
  assert.equal(m.reports[0].state, 'AFTER_TIP_DOCUMENTARY');
  assert.equal(m.reports[0].integration, null);
  assert.equal(m.reports[0].documentary.received_at, iso(TIME));
  assert.equal(m.reports[0].documentary.tip, iso(TIME - 10000));
  await resumeBatch(m);
  assert.equal(await nextOperation(m), null);
  assert.equal(s.db.prepare('SELECT count(*) n FROM max_forecast_versions').first().n, 0);
});

test('CLI persists each plan and outcome and returns literal null when the pass is finished', async () => {
  const {mkdtempSync, readFileSync, writeFileSync, rmSync} = await import('node:fs');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const {fileURLToPath} = await import('node:url');
  const {execFileSync} = await import('node:child_process');
  const directory = mkdtempSync(join(tmpdir(), 'macfly-delivery-'));
  const module = fileURLToPath(new URL('../release/macfly-delivery.mjs', import.meta.url));
  const input = join(directory, 'originals.json'), manifest = join(directory, 'manifest.json');
  const archived = join(directory, 'archive.json'), readback = join(directory, 'readback.json'), outcome = join(directory, 'outcome.json');
  const call = (...args) => JSON.parse(execFileSync(process.execPath, [module, ...args], {encoding: 'utf8'}));
  try {
    const text = original(1, {generated_at: '2020-01-02T08:00:00.000Z', sources: []});
    writeFileSync(input, JSON.stringify([text]));
    assert.equal(call('prepare', input, RUN, manifest, archived).archived, false);
    writeFileSync(readback, readFileSync(archived));
    call('archive', manifest, 'libfile_cli_test', readback);
    const initial = call('next', manifest);
    assert.equal(initial.stage, 'PENDING');
    writeFileSync(outcome, JSON.stringify({operation_id: initial.id, kind: 'AMBIGUOUS', error: 'Read timed out.'}));
    call('outcome', manifest, outcome);
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).reports[0].state, 'RETRY_LATER');
    assert.equal(call('next', manifest), null);
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).pending, null);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
