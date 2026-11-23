import test from 'node:test';
import assert from 'node:assert/strict';
import {d1,g} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';
import {resumeUnsentPlayerMarkets} from '../player-odds-coverage.mjs';

const start='2026-11-24T00:00:00.000Z',at='2026-11-23T23:06:00.000Z';
const registrations=[['401910036','2026-11-23T22:58:43.061Z'],['401910037','2026-11-23T22:58:43.376Z'],
  ['401910038','2026-11-23T22:58:43.556Z'],['401910039','2026-11-23T22:58:43.743Z']];
async function setup(t){
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-23T22:57:00Z')});const db=d1(),sent=[];
  for(const [id] of registrations){const game={...g,id,start};await savePublishedForecast(db,game,new Date().toISOString(),game);}
  t.mock.timers.setTime(Date.parse(at));
  const add=(n,{code=null,reason='INDEX_FETCH_FAILED',busy=false,revision=null,received=null}={})=>{
    const [id,created]=registrations[n],stream=db.prepare('SELECT id FROM published_forecasts WHERE match_id=?').bind(id).first().id;
    const window={scope:'LISTED_POINTS_ONLY',bytes:0,reason,http_status:code,...(revision?{transport_revision:revision}:{})};
    db.prepare(`INSERT INTO player_odds_windows(match_id,tip,edition_id,created_at,status,mode,generation,sent_generation,
      lease,lease_until,index_status,index_url,index_at,index_json) VALUES(?,?,?,?,'OPEN','FALLBACK_TOP_4',2,1,?,?,'UNAVAILABLE','https://linesmart.app/index',?,?)`)
      .bind(id,start,stream,received??created,busy?'owner':null,busy?'2026-11-23T23:06:30.000Z':null,created,JSON.stringify(window)).run();
    for(const [i,status] of ['SOURCE_UNAVAILABLE','HTTP_403','HTTP_429','OBSERVED','NOT_VERIFIED_IN_INDEX'].entries()){
      const observed=status==='NOT_VERIFIED_IN_INDEX'?null:created;
      db.prepare('INSERT INTO player_odds_tasks(match_id,tip,player_id,player_name,team_id,ranking,status,observed_at,started_at,source_url) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .bind(id,start,String(i),'Joueur '+i,'10',i,status,observed,observed,observed?'https://linesmart.app/player/'+i:null).run();
    }
  };
  return {db,env:{MAX_JOURNAL:db,MAX_RESEARCH_QUEUE:{send:async(msg,opts)=>sent.push({msg,opts})}},sent,add};
}
test('one-time v25 repair preserves every original field before resetting only documented pre-HTTP attempts',async t=>{
  const {db,env,sent,add}=await setup(t);add(0);add(1,{code:429});add(2,{revision:'workerd-manual-v26'});add(3,{received:'2026-11-23T22:58:43.742Z'});
  const id=registrations[0][0],rows=()=>db.prepare('SELECT * FROM player_odds_tasks WHERE match_id=? ORDER BY ranking').bind(id).all().results;
  const before=rows(),window=db.prepare('SELECT * FROM player_odds_windows WHERE match_id=?').bind(id).first();
  assert.deepEqual((await resumeUnsentPlayerMarkets(env)).windows,[id]);
  const snapshot=db.prepare('SELECT * FROM player_odds_transport_repairs').first();
  assert.equal(JSON.stringify(JSON.parse(snapshot.window_json)),JSON.stringify(window));
  assert.deepEqual(JSON.parse(snapshot.tasks_json),before.map(t=>({...t})));
  assert.equal(snapshot.captured_at,at);assert.deepEqual(rows().map(x=>x.status),['PROJECTED','HTTP_403','HTTP_429','OBSERVED','PROJECTED']);
  assert.equal(rows()[1].observed_at,before[1].observed_at);assert.equal(sent.length,1);
  assert.deepEqual((await resumeUnsentPlayerMarkets(env)).windows,[]);assert.equal(sent.length,1);
  assert.throws(()=>db.prepare('DELETE FROM player_odds_transport_repairs').run(),/IMMUTABLE/);
});
test('busy lease retries, dispatch failure recovers, and post-tip candidates remain closed',async t=>{
  const {db,env,sent,add}=await setup(t);add(0,{busy:true});
  assert.equal((await resumeUnsentPlayerMarkets(env)).busy,true);assert.equal(sent.length,0);
  t.mock.timers.setTime(Date.parse(at)+45000);
  const failing={...env,MAX_RESEARCH_QUEUE:{send:async()=>{throw Error('SIMULATED_OUTAGE');}}};
  await assert.rejects(resumeUnsentPlayerMarkets(failing),/SIMULATED_OUTAGE/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM player_odds_transport_repairs').first().n,1);
  assert.equal((await resumeUnsentPlayerMarkets(env)).busy,false);assert.equal(sent.length,1);
  add(1);t.mock.timers.setTime(Date.parse(start));
  assert.deepEqual((await resumeUnsentPlayerMarkets(env)).windows,[]);assert.equal(sent.length,1);
});
