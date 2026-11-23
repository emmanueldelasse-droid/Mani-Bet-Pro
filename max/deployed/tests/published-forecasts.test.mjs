import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {savePublishedForecast,readPublishedForecast,readPublishedForecasts,readLatestPublishedForMatches,
  listPublishedEditions,listPublishedGames} from '../published-forecasts.mjs';

const at=n=>new Date(Date.UTC(2031,0,1,0,0,n)).toISOString();
const game={id:'400001',status:'STATUS_SCHEDULED',start:at(3600),home:{name:'Chicago Bulls'},away:{name:'Utah Jazz'}};
const visible=(p=.54)=>({...game,forecast:{probability:p,score:[112,109],players:[{id:'99',minutes:31,points:17}]}});
function database(){
  const sqlite=new DatabaseSync(':memory:');let now=at(15);
  sqlite.function('strftime',{deterministic:true},(_,t)=>t==='now'?now:isNaN(Date.parse(t))?null:new Date(t).toISOString());
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=ON;');
  const schema=readFileSync(new URL('../published-forecasts.sql',import.meta.url),'utf8');sqlite.exec(schema);sqlite.exec(schema);
  const stmt=(q,args=[])=>({bind(...a){return stmt(q,a);},first:()=>sqlite.prepare(q).get(...args)??null,all:()=>({results:sqlite.prepare(q).all(...args)})});
  const db={prepare:stmt,batch(items){sqlite.exec('BEGIN');try{const result=items.map(s=>s.all());sqlite.exec('COMMIT');return result;}
    catch(error){sqlite.exec('ROLLBACK');throw error;}},withSession(){return this;}};
  return {db,sqlite,clock:n=>{now=at(n);}};
}

test('the entire visible edition is immutable, with its D1 publication instant and matchup',async()=>{
  const {db,sqlite}=database();
  const candidate={...visible(),evidence:[{source:'feuille NBA',verified_at:at(3)}],timeline:[{report_id:231}]};
  const receipt=await savePublishedForecast(db,game,at(5),candidate);
  assert.deepEqual(receipt.visible,candidate);assert.equal(receipt.as_of,at(5));assert.equal(receipt.published_at,at(15));
  candidate.forecast.players[0].points=100;
  assert.equal((await readPublishedForecast(db,game.id,receipt.id)).visible.forecast.players[0].points,17);
  assert.equal(await readPublishedForecast(db,'400003',receipt.id),null);
  assert.throws(()=>sqlite.prepare('UPDATE published_forecasts SET as_of=? WHERE id=?').run(at(2),receipt.id),/PUBLICATION_IMMUTABLE/);
  assert.throws(()=>sqlite.prepare('DELETE FROM published_forecasts WHERE id=?').run(receipt.id),/PUBLICATION_IMMUTABLE/);
  assert.throws(()=>sqlite.prepare('INSERT OR REPLACE INTO published_forecasts SELECT * FROM published_forecasts WHERE id=?').run(receipt.id),/PUBLICATION_IMMUTABLE|DUPLICATE_OR_STALE/);
  const row=sqlite.prepare('SELECT * FROM published_forecasts').get();
  assert.throws(()=>sqlite.prepare('INSERT INTO published_forecasts(match_id,tip,as_of,published_at,content_hash,payload) VALUES(?,?,?,?,?,?)')
    .run(game.id,game.start,at(12),at(13),'f'.repeat(64),row.payload),/PUBLICATION_SERVER_TIME_REQUIRED/);
});

test('retries, racing identical publications, stale-watermark conflict and genuine A→B→A',async()=>{
  const {db,clock}=database();
  const a=visible(),same={forecast:a.forecast,away:game.away,home:game.home,start:game.start,status:game.status,id:game.id};
  const pair=await Promise.all([savePublishedForecast(db,game,at(2),a),savePublishedForecast(db,game,at(2),same)]);
  assert.equal(pair[0].id,pair[1].id);
  assert.equal((await savePublishedForecast(db,game,at(12),same)).id,pair[0].id);
  await assert.rejects(savePublishedForecast(db,game,at(10),visible(.6)),/STALE_PUBLICATION/);
  await assert.rejects(savePublishedForecast(db,game,at(12),visible(.6)),/PUBLICATION_TIME_CONFLICT/);
  clock(50);
  const b=await savePublishedForecast(db,game,at(25),visible(.6));
  await assert.rejects(savePublishedForecast(db,game,at(2),a),/STALE_PUBLICATION/);
  const last=await savePublishedForecast(db,game,at(30),a);
  assert.ok(last.id>b.id&&b.id>pair[0].id);
  const all=await readPublishedForecasts(db,game.id);
  assert.deepEqual(all.map(r=>r.id),[last.id,b.id,pair[0].id]);
  assert.equal(all[0].content_hash,all[2].content_hash);
  assert.deepEqual((await listPublishedEditions(db,game.id,{beforeId:last.id,limit:1})).map(r=>r.id),[b.id]);
  assert.deepEqual((await listPublishedEditions(db,game.id,{beforeId:pair[0].id})),[]);
});

test('a future preparation, changed fixture, missing pre-tip write and live or final card cannot enter the archive',async()=>{
  const {db,clock}=database();
  await assert.rejects(savePublishedForecast(db,game,at(30),visible()),/FUTURE_PUBLICATION_TIME/);
  await assert.rejects(savePublishedForecast(db,game,at(5),{...visible(),id:'400003'}),/PUBLICATION_CARD_MISMATCH/);
  await assert.rejects(savePublishedForecast(db,game,at(5),{...visible(),publication:{id:3}}),/PUBLICATION_CARD_MISMATCH/);
  for(const status of ['STATUS_IN_PROGRESS','STATUS_FINAL'])
    assert.equal(await savePublishedForecast(db,{...game,status},at(5),visible()),null);
  clock(3600);
  assert.equal(await savePublishedForecast(db,game,at(3599),visible()),null);
  assert.equal(await savePublishedForecast(db,game,at(3600),visible()),null);
  assert.deepEqual(await readPublishedForecasts(db,game.id),[]);
});

test('large match payloads are individually readable, period index and history contain only metadata',async()=>{
  const {db}=database();
  const cards=await Promise.all(['400001','400002'].map((id,i)=>{
    const g={...game,id,start:at(3600+i)};
    return savePublishedForecast(db,g,at(1),{...g,report:'X'.repeat(425000)});
  }));
  const index=await listPublishedGames(db,at(3600),at(3601));
  assert.deepEqual(index,[{match_id:game.id,start:at(3600),publication_id:cards[0].id,published_at:at(15),teams:{home:'Chicago Bulls',away:'Utah Jazz'}}]);
  assert.equal(Object.hasOwn((await listPublishedEditions(db,game.id))[0],'payload'),false);
  const slate=await readLatestPublishedForMatches(db,['400002','400001','400002','400090']);
  assert.deepEqual([...slate.keys()],['400002','400001']);
  assert.equal(slate.get('400001').visible.report.length,425000);
});

test('new processing time cannot republish an older source or erase a previous integration',async()=>{
  const {db,clock}=database();const first={...visible(),checked_at:at(2),study:{integrated_at:at(4)}};
  await savePublishedForecast(db,game,at(5),first);clock(60);
  for(const card of [{...first,checked_at:at(1)},{...first,study:null},{...first,checked_at:at(20),study:{integrated_at:at(3)}}])
    await assert.rejects(savePublishedForecast(db,game,at(30),card),/STALE_PUBLICATION/);
  assert.equal((await listPublishedEditions(db,game.id)).length,1);
});
