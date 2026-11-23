import test from 'node:test';
import assert from 'node:assert/strict';
import {d1,g,tip,h,iso} from './study-journey-fixture.mjs';
import {savePublishedForecast} from '../published-forecasts.mjs';
import {recordQuotedDecisions} from '../odds-study.mjs';
import {schedulePlayerOddsCoverage,processPlayerOddsCoverage,readPlayerOddsCoverage} from '../player-odds-coverage.mjs';

const fixture=g=>({...g,checked_at:iso(Date.now()),independent_analysis:{advanced:{forecast:{probability_home:.53,projected_score:{home:112,away:105}},
  player_points:{home:{players:Array.from({length:21},(_,i)=>({id:String(i+101),name:'Athlète '+i,team_id:g.home.id,predicted_points_if_active:32-i}))},away:{players:[]}}}}});
function quotes(g,p,at){
  return ['OVER','UNDER'].map(side=>({side,line:16.5,decimal_odds:1.91,observed_at:at,provider_updated_at:at,source:'LineSmart',
    source_url:'https://linesmart.app/nba/props/p-'+p.id+'/',bookmaker:'DraftKings',provider_id:'draftkings',match_id:g.id,event_start:g.start,
    home_team_id:g.home.id,away_team_id:g.away.id,team_id:p.team_id,player_id:p.id,period:'FULL_GAME_OT',market:'PLAYER_POINTS_OT',group_key:'line-1'}));
}
async function setup(t,now=tip-2*h){
  t.mock.timers.enable({apis:['Date'],now});
  const db=d1(),messages=[];
  const env={MAX_JOURNAL:db,MAX_RESEARCH_QUEUE:{send:async(body,opts)=>{messages.push({body,at:Date.now()+opts.delaySeconds*1000});}}};
  const game=fixture(g),edition=await savePublishedForecast(db,g,iso(Date.now()),game);
  return {db,env,game,edition,messages,async dispatch(options){
    messages.sort((a,b)=>a.at-b.at);const msg=messages.shift();assert.ok(msg);
    t.mock.timers.setTime(Math.max(msg.at,Date.now()));await processPlayerOddsCoverage(env,msg.body,options);return msg.body;
  }};
}
function options({size=18,failIndex=false,rateLimitAt=null,failProfile=false}={}){
  const calls=[],indexes=[];
  return {calls,indexes,fetchIndex:async game=>{
    indexes.push([game.id,Date.now()]);const players=game.independent_analysis.advanced.player_points.home.players.slice(0,size);
    return {status:failIndex?'UNAVAILABLE':'INDEXED',source_url:'https://linesmart.app/test-index',observed_at:iso(Date.now()),
      players:failIndex?[]:players,listed_players:failIndex?0:players.length,reported_players:players.length,all_reported_players_scanned:!failIndex,http_status:failIndex?403:200};
  },fetchProfile:async(game,p)=>{
    const observed_at=iso(Date.now());calls.push([p.id,Date.now()]);
    const status=calls.length===rateLimitAt?'HTTP_429':failProfile?'HTTP_403':'OBSERVED';
    return {quotes:status==='OBSERVED'?quotes(game,p,observed_at):[],lookup:{status,observed_at,source_url:'https://linesmart.app/nba/props/p-'+p.id+'/',retry_after:'1500'}};
  }};
}

test('one real index and all 18 listed projected players, spaced, read back, one attempt despite replay and prior star coverage',async t=>{
  const {env,db,game,edition,messages,dispatch}=await setup(t),opt=options();
  const star=game.independent_analysis.advanced.player_points.home.players[0];
  await recordQuotedDecisions(db,edition,quotes(game,star,iso(Date.now())),iso(Date.now()));
  await schedulePlayerOddsCoverage(env,[g]);await schedulePlayerOddsCoverage(env,[g]);
  assert.equal(messages.length,1);
  const old=await dispatch(opt);
  assert.equal(opt.indexes.length,1);assert.equal(opt.calls.length,3);
  await processPlayerOddsCoverage(env,old,opt);assert.equal(opt.calls.length,3);
  while(messages.length)await dispatch(opt);
  const result=await readPlayerOddsCoverage(db,g.id),w=result.windows[0];
  assert.equal(w.status,'DONE');assert.equal(w.mode,'LISTED_POINTS');assert.equal(w.projected_players,21);
  assert.equal(result.planned_players,18);assert.equal(result.observed_players,18);assert.equal(w.not_listed_players,3);
  assert.equal(opt.calls.length,17);assert.equal(new Set(opt.calls.map(r=>r[0])).size,17);assert.ok(!opt.calls.some(r=>r[0]===star.id));
  assert.deepEqual([...new Set(opt.calls.map(r=>r[1]))].map((v,i)=>v-opt.indexes[0][1]),[0,35000,70000,105000,140000]);
  assert.equal(result.attempted_players,18);assert.equal(result.window_from,null);
  t.mock.timers.setTime(tip+96*h);assert.equal((await readPlayerOddsCoverage(db)).windows.length,0);
  assert.equal((await readPlayerOddsCoverage(db,g.id)).observed_players,18);
});

test('source denial makes only four priority candidates eligible; a 429 stops immediately and respects a 25-minute backoff',async t=>{
  const {db,env,messages,dispatch}=await setup(t),opt=options({failIndex:true,rateLimitAt:1,failProfile:true});
  await schedulePlayerOddsCoverage(env,[g]);const start=Date.now();
  await dispatch(opt);assert.equal(opt.calls.length,1);assert.equal(messages[0].at,start+25*60000);
  const paused=await readPlayerOddsCoverage(db,g.id);
  assert.equal(paused.backoff_until,iso(start+25*60000));assert.equal(paused.windows[0].index_http_status,403);
  assert.equal(paused.windows[0].outside_verified_index,17);assert.equal(paused.planned_players,4);
  await dispatch(opt);assert.equal(messages.length,0);
  const report=await readPlayerOddsCoverage(db,g.id);assert.equal(report.refused_players,4);assert.equal(report.observed_players,0);
});

test('index 429 suspends all profile lookups, including another match, and pending jobs do not query a finished game',async t=>{
  const {db,env,messages,dispatch}=await setup(t,tip-90*1000),other={...g,id:'900000222'};
  await savePublishedForecast(db,other,iso(Date.now()),fixture(other));
  const opt=options();let count=0;
  opt.fetchIndex=async()=>{count++;return {status:'UNAVAILABLE',http_status:429,retry_after:'120',players:[],observed_at:iso(Date.now())};};
  await schedulePlayerOddsCoverage(env,[g,other]);
  while(messages.length)await dispatch(opt);
  assert.equal(count,1);assert.equal(opt.calls.length,0);const report=await readPlayerOddsCoverage(db);
  assert.equal(report.attempted_players,0);assert.ok(report.windows.every(w=>w.status==='EXPIRED'));
  assert.equal(report.windows.find(w=>w.match_id===g.id).index_status,'HTTP_429');
});
