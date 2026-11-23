import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker.mjs';
import {d1} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';

const fixture=JSON.parse(readFileSync(new URL('fixtures/draftkings-espn-pregame.json',import.meta.url),'utf8'));
const origin='https://manibetpromax-shadow.example';

test('le premier relevé privé rejoint l’édition, les prix et les décisions visibles; le rejeu préserve leur heure',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(fixture.captured_at)-2000});
  const state=new Map();
  const env={MAX_JOURNAL:d1(),MAX_STATE:{get:key=>state.get(key),put:(key,value)=>state.set(key,value)}};
  const event=fixture.scoreboard.events[0];
  const teams=Object.fromEntries(event.competitions[0].competitors.map(t=>[t.homeAway,{id:t.id,name:t.team.abbreviation}]));
  const game={id:event.id,start:new Date(event.date).toISOString(),status:'STATUS_SCHEDULED',...teams};
  const card={...game,checked_at:new Date().toISOString(),independent_analysis:{advanced:{
    forecast:{status:'SIMULATED_UNCALIBRATED',projected_score:{home:104,away:113},probability_home:.35}}}};
  const edition=await savePublishedForecast(env.MAX_JOURNAL,game,card.checked_at,card);
  t.mock.timers.setTime(Date.parse(fixture.captured_at));
  const fetchSpy=t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,fixture.source_url);
    return Response.json(fixture.scoreboard);
  });
  let ack=0;
  const batch={messages:[{body:{type:'bootstrap_observed_odds',date:'20261123'},ack(){ack++;}}]};
  await worker.queue(batch,env);
  const read=async()=>{
    const response=await worker.fetch(new Request(origin+'/api/odds-study?match_id='+game.id),env);
    assert.equal(response.status,200);
    return response.json();
  };
  const result=await read();
  assert.equal(result.quote_rows.length,6);
  assert.equal(result.priced_games,1);
  assert.equal(result.decision_rows.length,3);
  assert.equal(result.quote_rows[0].observed_at,fixture.captured_at);
  assert.ok(result.decision_rows.every(row=>row.edition_id===edition.id));
  assert.ok(result.decision_rows.some(row=>row.selected && row.status==='PENDING'));
  t.mock.timers.setTime(Date.parse(fixture.captured_at)+60000);
  await worker.queue(batch,env);
  assert.deepEqual(await read(),result);
  assert.equal(fetchSpy.mock.callCount(),1);
  assert.equal(ack,2);
});

test('la file relance une analyse dont le reçu n’est pas encore visible',async()=>{
  const calls=[];
  await worker.queue({messages:[{body:{type:'learning_review',id:'analyse-en-transit'},ack(){calls.push('ack');},retry(opts){calls.push(opts.delaySeconds);}}]},{MAX_JOURNAL:d1()});
  assert.deepEqual(calls,[60]);
});
