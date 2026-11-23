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
    if(String(url)==='https://www.unibet.fr/paris-basketball/usa/nba')return new Response('Pas de marché affiché',{status:503});
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
  assert.equal(fetchSpy.mock.callCount(),2);
  assert.equal(ack,2);
});

test('la file relance une analyse dont le reçu n’est pas encore visible',async()=>{
  const calls=[];
  await worker.queue({messages:[{body:{type:'learning_review',id:'analyse-en-transit'},ack(){calls.push('ack');},retry(opts){calls.push(opts.delaySeconds);}}]},{MAX_JOURNAL:d1()});
  assert.deepEqual(calls,[60]);
});

test('le rattrapage conserve l’échec avant HTTP, respecte un refus de la source et ne relit rien au second envoi',async t=>{
  const started=Date.parse(fixture.captured_at);
  t.mock.timers.enable({apis:['Date'],now:started-20000});
  const db=d1(),state=new Map();
  const env={MAX_JOURNAL:db,MAX_STATE:{get:key=>state.get(key),put:(key,v)=>state.set(key,JSON.parse(v))}};
  const start='2026-11-24T01:00:00.000Z';
  const g={id:'401910041',start,status:'STATUS_SCHEDULED',home:{id:'4',name:'Chicago Bulls',abbreviation:'CHI'},away:{id:'5',name:'Cleveland Cavaliers',abbreviation:'CLE'}};
  await savePublishedForecast(db,g,new Date().toISOString(),g);
  const check={source:'Unibet.fr',checked_at:fixture.captured_at,games_with_observed_prices:0,games_checked:1,
    lookups:[{reason:'BOARD_FETCH_FAILED',http_status:null,bytes:0}]};
  state.set('max:odds:unibet:last',check);
  const {recoverFrenchBoard}=await import('../odds-feed.mjs');
  t.mock.timers.setTime(started+60000);
  const fetcher=t.mock.fn(async()=>new Response(null,{status:403}));
  await recoverFrenchBoard(env,check.checked_at,fetcher);
  await recoverFrenchBoard(env,check.checked_at,fetcher);
  assert.equal(fetcher.mock.callCount(),1);
  const journal=db.prepare('SELECT checked_at,retry_of,payload FROM odds_first_party_checks ORDER BY checked_at').all().results;
  assert.equal(journal.length,2);
  assert.deepEqual(JSON.parse(journal[0].payload),check);
  assert.equal(journal[1].retry_of,check.checked_at);
  assert.equal(JSON.parse(journal[1].payload).lookups[0].http_status,403);
  assert.equal(db.prepare('SELECT count(*) n FROM odds_study_decisions').first('n'),0);
});

test('le nouveau relevé répare les marchés manquants au prix et à l’heure de la nouvelle lecture',async t=>{
  const previous=Date.parse(fixture.captured_at),checkAt=new Date(previous+500).toISOString();
  t.mock.timers.enable({apis:['Date'],now:previous-60000});
  const db=d1(),state=new Map();
  const env={MAX_JOURNAL:db,MAX_STATE:{get:key=>state.get(key),put:(key,v)=>state.set(key,v)}};
  const g={id:'401910041',start:'2026-11-24T01:00:00.000Z',status:'STATUS_SCHEDULED',home:{id:'4',name:'Chicago Bulls',abbreviation:'CHI'},away:{id:'5',name:'Cleveland Cavaliers',abbreviation:'CLE'}};
  await savePublishedForecast(db,g,new Date().toISOString(),{...g,checked_at:new Date().toISOString(),
    independent_analysis:{advanced:{forecast:{status:'SIMULATED_UNCALIBRATED',probability_home:.35,projected_score:{home:104,away:113}}}}});
  db.prepare('INSERT INTO odds_first_party_checks(checked_at,payload) VALUES(?,?)').bind(checkAt,JSON.stringify({
    checked_at:checkAt,source:'Unibet.fr',games_with_observed_prices:1,lookups:[{status:'OBSERVED',observed_at:fixture.captured_at}]
  })).run();
  t.mock.timers.setTime(previous+60000);
  const fetcher=t.mock.fn(async url=>url===fixture.source_url?Response.json(fixture.scoreboard):new Response(null,{status:503}));
  const {recoverIncompleteBoards}=await import('../odds-feed.mjs');
  await recoverIncompleteBoards(env,'20261123',checkAt,fetcher);
  const quotes=db.prepare('SELECT DISTINCT observed_at FROM odds_study_quotes').all().results;
  assert.deepEqual(quotes.map(q=>q.observed_at),[new Date(previous+60000).toISOString()]);
  assert.equal(db.prepare('SELECT count(*) n FROM odds_study_quotes').first('n'),6);
  await recoverIncompleteBoards(env,'20261123',checkAt,fetcher);
  assert.equal(fetcher.mock.callCount(),2);
});
