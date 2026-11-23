// Local path through the scheduled collector, the editorial Queue, the public API and the final scoreboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../quality-worker.mjs';
import {collect} from '../worker.mjs';
import {parseBoxscore} from '../advanced.mjs';
import {insertResearch} from '../research-journal.mjs';
import {d1,g,h,iso,players,report,teams,tip} from './study-journey-fixture.mjs';

const day=24*h;
const dateKey=time=>iso(time).slice(0,10).replaceAll('-','');

function gameBox(game,rows,observedAt){
  const raw={_fetched_at:iso(observedAt),boxscore:{players:teams.map(team=>({
    team:{id:team.id},statistics:[{names:['MIN','PTS'],athletes:players[team.id].map((player,i)=>{
      const [minutes,points]=rows(team.id,i);
      return {athlete:{id:player.id,displayName:player.name},didNotPlay:minutes===0,stats:[String(minutes),String(points)]};
    })}]
  }))}};
  const box=parseBoxscore(raw,game);
  assert.ok(box,'feuille synthétique cohérente des deux équipes');
  return box;
}

function networkFixture(game){
  const data=new Map(),kv={
    writes:0,get:async key=>Array.isArray(key)?new Map(key.map(k=>[k,structuredClone(data.get(k)??null)])):structuredClone(data.get(key)??null),
    async put(key,body){this.writes++;data.set(key,JSON.parse(body));},
    async list({prefix}){return {keys:[...data.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true};}
  };
  const scheduled={id:game.id,date:game.start,status:{type:{name:'STATUS_SCHEDULED'}},season:{type:2},
    competitions:[{competitors:['home','away'].map(side=>({homeAway:side,team:{id:game[side].id,displayName:game[side].name}}))}]};
  const fetcher=async url=>{
    const endpoint=new URL(url);
    if(endpoint.pathname.endsWith('/scoreboard')){
      const date=endpoint.searchParams.get('dates');
      return Response.json({events:date===dateKey(tip)&&Date.now()<tip?[scheduled]:[]});
    }
    if(endpoint.pathname.endsWith('/injuries'))return Response.json({injuries:[]});
    return new Response('',{status:404});
  };
  // Thirty-two actual cached finals feed the existing simulation; this test adds no samples to production.
  for(let i=2;i<34;i++){
    const start=tip-i*day,historical={...game,id:String(910004000+i),start:iso(start),event_type:'REGULAR',
      status:'STATUS_FINAL',home:{...game.home,score:120},away:{...game.away,score:108},fetched_at:iso(start+3*h)};
    data.set('max:scoreboard:'+dateKey(start),{date:dateKey(start),games:[historical]});
    const stats=(teamId,index)=>[20,teamId==='10'?10:index===0?20:index===1?8:8];
    data.set('max:box:'+historical.id,gameBox(historical,stats,start+3*h));
  }
  for(const team of teams)data.set('max:roster:'+team.id,{team_id:team.id,checked_at:iso(tip-8*h),players:players[team.id]});
  return {kv,data,fetcher};
}

const points=game=>game.independent_analysis.advanced.player_points;
const findPlayer=(game,id)=>['away','home'].flatMap(side=>points(game)[side].players).find(p=>p.id===id);
const approximately=(a,b)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.03,`${a} ≈ ${b}`);

test('édition publiée complète, révisions MacFly puis bilan relié à chaque édition après la sortie du calendrier',async t=>{
  const game={...g,id:'910000760'};
  t.mock.timers.enable({apis:['Date'],now:tip-6*h-7*60000});
  t.mock.method(performance,'now',()=>Date.now()-(tip-day));
  const {kv,data,fetcher}=networkFixture(game),db=d1(),env={MAX_JOURNAL:db,MAX_STATE:kv};
  const time=offset=>t.mock.timers.setTime(tip+offset);
  async function get(path){
    const before=db.prepare('SELECT total_changes() AS n').first('n'),writes=kv.writes;
    const response=await worker.fetch(new Request('https://test.invalid'+path),env,{});
    assert.equal(response.status,200,path);
    const body=await response.json();
    assert.equal(db.prepare('SELECT total_changes() AS n').first('n'),before,'GET en lecture seule dans D1');
    assert.equal(kv.writes,writes,'GET en lecture seule dans KV');
    return body;
  }
  const card=id=>get('/api/game?id='+game.id+(id?'&publication='+id:''));
  const archive=()=>get('/api/forecast-archive?date='+game.start.slice(0,10));
  const notify=async body=>{
    let ack=0;await worker.queue({messages:[{body,ack(){ack++;}}]},env,{});
    assert.equal(ack,1);
  };
  const deliver=receipt=>notify({match_id:receipt.match_id,generated_at:receipt.generated_at});
  const firstCycle=await collect(env,fetcher,new Date());
  assert.equal(firstCycle.updated,true);
  const first=await card();
  assert.ok(first.publication?.id,'la collecte normale fige une édition publiée avant le premier GET');
  assert.equal(first.publications.length,1);
  assert.ok(first.publication.published_at<game.start);
  assert.ok(first.game.independent_analysis.advanced.forecast.interval_80.total.length===2);
  assert.equal(first.game.independent_analysis.advanced.forecast.simulated_runs,50000);
  const firstGame=structuredClone(first.game);
  for(const team of ['home','away']){
    assert.deepEqual(points(first.game)[team].players.map(p=>p.id).sort(),players[game[team].id].map(p=>p.id).sort());
    for(const p of points(first.game)[team].players){
      assert.ok(Number.isFinite(p.predicted_points_if_active) && Number.isFinite(p.projected_minutes_if_active));
      assert.ok(p.predicted_interval_80_if_active && p.probability_points_at_least_if_active);
    }
  }
  assert.ok((await archive()).games.some(row=>String(row.match_id??row.id)===game.id));
  time(-5*h);
  const news=report(tip-5*h-60000,[{n:0,status:'QUESTIONABLE'}],false,game);
  const receipt=await insertResearch(db,news);
  time(-5*h+15000);
  await deliver(receipt);
  const question=await card();
  assert.notEqual(question.publication.id,first.publication.id);
  assert.ok(question.publication.published_at>receipt.received_at);
  const star=findPlayer(question.game,'1001');
  assert.equal(star.reported_status,'QUESTIONABLE');
  assert.equal(star.scenarios.available.points,star.predicted_points_if_active);
  assert.ok(star.scenarios.limited.points>0 && star.scenarios.limited.points<star.scenarios.available.points);
  assert.deepEqual(star.scenarios.out,{minutes:0,points:0});
  assert.deepEqual((await card(first.publication.id)).game,firstGame);
  time(-4.5*h);
  assert.equal((await insertResearch(db,news)).id,receipt.id);
  await deliver(receipt);
  await notify({type:'publish_forecast',match_id:game.id});
  assert.equal((await card()).publications.length,question.publications.length,'rejouer la livraison garde la même édition');
  time(-3*h);
  const repeat=await insertResearch(db,report(tip-3*h-60000,[{n:0,status:'QUESTIONABLE'}],false,game));
  await deliver(repeat);
  const corroborated=await card();
  assert.deepEqual(findPlayer(corroborated.game,'1001').scenarios,star.scenarios);
  const repeatEffect=corroborated.study.revision.changes.find(f=>f.receipt_id===repeat.id);
  assert.equal(repeatEffect?.effect,'ALREADY_KNOWN');
  time(-2*h);
  const out=await insertResearch(db,report(tip-2*h-60000,[{n:0,status:'OUT'}],false,game));
  time(-2*h+15000);
  await deliver(out);
  const latest=await card();
  assert.notEqual(latest.publication.id,question.publication.id);
  assert.equal(findPlayer(latest.game,'1001').availability,'OFFICIAL_OUT');
  assert.equal(findPlayer(latest.game,'1001').predicted_points,0);
  assert.deepEqual((await card(question.publication.id)).game,question.game);
  const editions=latest.publications.map(e=>e.id);
  assert.deepEqual(editions,[...new Set(editions)]);
  time(60000);
  const late=await insertResearch(db,report(tip-30000,[{n:0,status:'AVAILABLE'}],false,game));
  await deliver(late);
  await notify({type:'publish_forecast',match_id:game.id});
  const afterTip=await card();
  assert.deepEqual(afterTip.publications.map(e=>e.id),editions);
  assert.ok(afterTip.study.deliveries.some(r=>r.id===late.id&&r.state==='AFTER_TIP'&&r.integrated_at===null));
  assert.deepEqual(afterTip.game,latest.game);

  // The final and complete box are already cached. The next regular pass can no longer see the game on its live slate.
  const observed=tip+3*h;
  const final={...game,event_type:'REGULAR',status:'STATUS_FINAL',fetched_at:iso(observed),
    home:{...game.home,score:110},away:{...game.away,score:108}};
  const actual=(teamId,i)=>teamId==='10'?(i===0?[0,0]:[i<10?22:21,10]):[i===0?12:i===1?28:20,i===0?8:i===1?20:8];
  const box=gameBox(final,actual,observed);
  data.set('max:scoreboard:'+dateKey(tip),{date:dateKey(tip),games:[final]});
  data.set('max:box:'+game.id,box);
  time(3*day+7*60000);
  const settled=await collect(env,fetcher,new Date());
  assert.equal(settled.updated,true);
  assert.equal(settled.boxes_new,0);
  assert.deepEqual((await get('/api/slate')).games,[]);
  const archived=await card();
  assert.ok((await archive()).games.some(row=>String(row.match_id??row.id)===game.id));
  assert.deepEqual(archived.game,latest.game);
  assert.deepEqual(archived.publications.map(e=>e.id),editions);
  for(const edition of [first,question,latest]){
    const resolved=await card(edition.publication.id);
    assert.deepEqual(resolved.game,edition.game);
    const review=resolved.review;
    assert.equal(review.edition_id,edition.publication.id);
    assert.equal(review.published_at,edition.publication.published_at);
    assert.ok(review.observed_at>=final.fetched_at);
    assert.ok(review.result_source && review.box_source);
    assert.equal(review.game.total.actual,218);
    assert.equal(review.game.total.forecast,edition.game.independent_analysis.advanced.forecast.projected_score.home+
      edition.game.independent_analysis.advanced.forecast.projected_score.away);
    assert.equal(review.game.winner.actual,'home');
    assert.equal(review.players.length,24);
    const absent=review.players.find(r=>r.player_id==='1001');
    assert.equal(absent.participation,'CONFIRMED_DNP');
    if(edition===question)assert.deepEqual(Object.fromEntries(absent.scenarios.map(r=>[r.label,r.applicability])),
      {available:'NOT_APPLICABLE',limited:'NOT_APPLICABLE',out:'OBSERVED'});
    const comparison=review.players.find(r=>r.player_id==='2001');
    assert.equal(comparison.participation,'PLAYED');
    assert.equal(comparison.minutes.actual,12);
    assert.equal(comparison.points.actual,8);
    approximately(comparison.minutes.forecast,findPlayer(edition.game,'2001').projected_minutes_if_active);
    approximately(comparison.points.forecast,findPlayer(edition.game,'2001').predicted_points_if_active);
    approximately(comparison.minutes.error,comparison.minutes.forecast-12);
    approximately(comparison.points.error,comparison.points.forecast-8);
    approximately(comparison.minutes_points,comparison.points.forecast/comparison.minutes.forecast*comparison.minutes.error);
    approximately(comparison.minutes_points+comparison.production_error,comparison.points.error);
  }
});

test('une fiche ancienne retrouvée dans KV après le coup d’envoi reste sans édition publique rétroactive',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip+h});
  const db=d1(),game={...g,id:'910000761',checked_at:iso(tip-h),independent_analysis:{advanced:{
    forecast:{status:'SIMULATED_UNCALIBRATED',projected_score:{away:100,home:109},probability_home:.62},player_points:{home:{players:[]},away:{players:[]}}
  }}};
  const {kv,data}=networkFixture(game),env={MAX_STATE:kv,MAX_JOURNAL:db};
  data.set('max:game:'+game.id,game);data.set('max:slate:latest',{games:[game]});
  const count=()=>db.prepare('SELECT count(*) n FROM published_forecasts WHERE match_id=?').bind(game.id).first('n');
  await worker.fetch(new Request('https://test.invalid/api/game?id='+game.id),env,{});
  assert.equal(count(),0);
  let acknowledged=false;
  await worker.queue({messages:[{body:{type:'publish_forecast',match_id:game.id},ack(){acknowledged=true;}}]},env,{});
  assert.equal(acknowledged,true);
  assert.equal(count(),0);
  const archive=await worker.fetch(new Request('https://test.invalid/api/forecast-archive?date='+game.start.slice(0,10)),env,{});
  assert.equal(archive.status,200);
  assert.deepEqual((await archive.json()).games,[]);
});
