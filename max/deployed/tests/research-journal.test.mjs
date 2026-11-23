import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {validateResearch} from '../worker.mjs';
import {classifyFacts, forecastView, insertResearch, readJournalVersions, readResearchInbox, saveJournalVersion} from '../research-journal.mjs';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../research-journal.sql',import.meta.url),'utf8'));
  const db = {
    prepare(sql) { return {bind(...args) {return {
      all() {return {results:sqlite.prepare(sql).all(...args)};}
    };}}; },
    batch(stmts) {
      sqlite.exec('BEGIN');
      try { const result = stmts.map(s => s.all()); sqlite.exec('COMMIT'); return result; }
      catch(e) {sqlite.exec('ROLLBACK'); throw e;}
    },
    withSession() {return this;}
  };
  return {sqlite,db};
}
const iso = t => new Date(t).toISOString();
const source='https://official.nba.com/nba-injury-report-test/';
const game = (now) => ({id:'401909991',start:iso(now+3600000),status:'STATUS_SCHEDULED',home:{id:'1'},away:{id:'2'}});
const rosters=new Map([['1',{team_id:'1',players:[{id:'11',name:'A. Player'},{id:'12',name:'B. Player'}]}]]);
function report(g,t,items) {
  const at=iso(t), common={match_id:g.id,event_start:g.start,team_id:'1',source_url:source,checked_at:at};
  return {schema_version:'max-research-v1',match_id:g.id,generated_at:at,summary:'Contrôle du bulletin.',
    sources:[{url:source,title:'NBA',kind:'OFFICIAL',published_at:iso(t-60000),checked_at:at}],
    verified_injuries:items.map(item => ({...common,...item}))};
}
function view(pts) {
  return forecastView({probability_home:0.55,projected_score:{home:112,away:110}},
    {home:{team_id:'1',players:[{id:'11',name:'A. Player',reported_status:pts===0?'OUT':'UNKNOWN',
      availability:pts===0?'OFFICIAL_OUT':null,projected_minutes_if_active:31,predicted_points_if_active:pts}]}},null);
}

test('receipt is immutable, deduplicated, primary-read verified, cannot be backdated',async () => {
  const {db,sqlite}=database(), t=Date.now(), g=game(t), original=report(g,t-10000,[{player:'A. Player',status:'OUT'}]);
  const [a,b]=await Promise.all([insertResearch(db,original),insertResearch(db,structuredClone(original))]);
  assert.deepEqual(a,b); assert.ok(a.received_at>a.generated_at);
  sqlite.prepare('INSERT OR REPLACE INTO macfly_inbox(report_json) VALUES (?)').run(JSON.stringify(original));
  assert.equal(sqlite.prepare('SELECT id FROM macfly_inbox').get().id,a.id);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM macfly_inbox').get().n,1);
  await assert.rejects(insertResearch(db,{...original,summary:'amended'}),/CONTENT_CONFLICT/);
  assert.throws(()=>sqlite.prepare('UPDATE macfly_inbox SET received_at=?').run(iso(0)),/IMMUTABLE/);
  assert.throws(()=>sqlite.prepare('INSERT INTO macfly_inbox(report_json,received_at) VALUES (?,?)').run(JSON.stringify(report(g,t-5000,[])),iso(t-9000)),/SERVER_TIME/);
  const before=await readResearchInbox(db,g,iso(Date.parse(a.received_at)-1),validateResearch,rosters);
  assert.equal(before.raw,null);
  const late={...g,start:iso(t-5)};
  assert.equal((await readResearchInbox(db,late,iso(t+60000),validateResearch,rosters)).raw,null);
});

test('versions freeze the visible before and after and group already-known and new information',async () => {
  const {db}=database(), t=Date.now(), g=game(t), before=view(18), after=view(0);
  const first=await saveJournalVersion(db,{game:g,asOf:iso(t-100),baseline:before,after:before,inputSignature:'A'});
  assert.equal(first.revision.before,null);
  const r=report(g,t-60000,[{player:'A. Player',status:'OUT'},{player:'B. Player',status:'OUT'}]);
  const receipt=await insertResearch(db,r);
  const data=await readResearchInbox(db,g,receipt.received_at,validateResearch,rosters);
  const official=data.verified.verified_injuries;
  const facts=classifyFacts(data.facts,{official,direct:[official[1]]});
  assert.deepEqual(facts.map(f=>f.effect),['APPLIED','ALREADY_KNOWN']);
  const entry={game:g,asOf:receipt.received_at,baseline:before,after,receipts:data.receipts,facts,pair:{p:.55},inputSignature:'A'};
  const saved=await saveJournalVersion(db,entry);
  assert.equal(saved.revision.attribution,'GROUP');
  assert.deepEqual(saved.revision.before,before);
  assert.equal(saved.revision.after.primary.players[0].points,0);
  assert.equal(saved.revision.after.primary.players[0].minutes,0);
  assert.equal(saved.revision.changes[0].player_id,'11');
  assert.ok(saved.revision.changed);
  assert.equal(saved.revision.changes[0].published_at,r.sources[0].published_at);
  assert.equal(saved.revision.changes[0].checked_at,r.sources[0].checked_at);
  assert.equal(saved.revision.changes[0].integrated_at,saved.integrated_at);
  assert.equal((await saveJournalVersion(db,entry)).id,saved.id);
  await assert.rejects(saveJournalVersion(db,{...entry,after:before}),/VERSION_CONTENT_CONFLICT/);
  assert.equal((await readJournalVersions(db,g.id)).length,2);
});

test('mismatched ids, conflicting facts, source checked after receipt and after tip never enter the model',async () => {
  const {db}=database(), t=Date.now(), g=game(t);
  const r=report(g,t-60000,[{player:'A. Player',player_id:'12',status:'OUT'},
    {player:'B. Player',status:'OUT'},{player:'B. Player',status:'AVAILABLE'}]);
  const receipt=await insertResearch(db,r);
  const info=await readResearchInbox(db,g,receipt.received_at,validateResearch,rosters);
  assert.deepEqual(info.verified.verified_injuries,[]);
  assert.deepEqual(info.facts.map(f=>f.effect),['UNMATCHED_PLAYER','CONFLICT','CONFLICT']);
  const future=report(g,t-10000,[{player:'A. Player',status:'OUT'}]);
  future.sources[0].checked_at=iso(t+30000);
  await insertResearch(db,future);
  assert.equal((await readResearchInbox(db,g,iso(t+35000),validateResearch,rosters)).receipts.length,1);
  assert.equal(await saveJournalVersion(db,{game:{...g,start:iso(t-1)},asOf:iso(t-100),baseline:view(18),after:view(0)}),null);
});
test('replaying the old set keeps it in the marginal control; rediscovered old bulletin cannot override a newer one',async () => {
  const {db}=database(), t=Date.now(), g=game(t);
  const make=(generated,published,status) => {
    const r=report(g,generated,[{player:'A. Player',status}]);
    r.sources[0].published_at=iso(published);
    return r;
  };
  const a=await insertResearch(db,make(t-240000,t-300000,'OUT'));
  const b=await insertResearch(db,make(t-120000,t-180000,'AVAILABLE'));
  await insertResearch(db,make(t-60000,t-300000,'OUT'));
  const full=await readResearchInbox(db,g,iso(Date.now()),validateResearch,rosters);
  assert.equal(full.verified.verified_injuries[0].status,'AVAILABLE');
  assert.equal(full.facts.find(f=>f.receipt_id===a.id).effect,'SUPERSEDED');
  assert.equal(full.facts.find(f=>f.receipt_id===b.id).effect,'CANDIDATE');
  const marginal=await readResearchInbox(db,g,iso(Date.now()),validateResearch,rosters,new Set([a.id]));
  assert.equal(marginal.verified.verified_injuries[0].status,'OUT');
});

test('a future D1 integration never appears in a previous forecast even if received before the match',async () => {
  const {db}=database(), t=Date.now(), g=game(t);
  const receipt=await insertResearch(db,report(g,t-180000,[{player:'A. Player',status:'OUT'}]));
  await assert.rejects(saveJournalVersion(db,{game:g,asOf:iso(t-150000),receipts:[receipt],baseline:view(18),after:view(0)}),/INVALID_INPUT_CUTOFF/);
});

test('two concurrent deliveries, including an out-of-order cutoff, reread the same committed publication', async () => {
  const {db}=database(),t=Date.now(),g=game(t);
  const options={game:g,baseline:view(18),after:view(0),deliveryKey:'same-context-and-receipts'};
  const [first,retry]=await Promise.all([
    saveJournalVersion(db,{...options,asOf:iso(t-10)}),saveJournalVersion(db,{...options,asOf:iso(t-50)})
  ]);
  assert.equal(first.id,retry.id);
  assert.equal(first.integrated_at,retry.integrated_at);
  assert.equal((await readJournalVersions(db,g.id)).length,1);
  const next=await saveJournalVersion(db,{...options,deliveryKey:'new-data',asOf:iso(t-1)});
  assert.notEqual(next.id,first.id);
});
