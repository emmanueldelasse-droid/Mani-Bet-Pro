// Synthetic, fully local replay. No real player, result, quote or live selection.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{validateResearch} from '../worker.mjs';
import {parseBoxscore} from '../advanced.mjs';
import {refreshStudy,settleStudy} from '../study-runtime.mjs';
import {insertResearch} from '../research-journal.mjs';

import {d1,h,tip,iso,g,teams,players,source,fixture,fixtureState,report} from './study-journey-fixture.mjs';

test('D1 → queue réelle → carte et sources → final → bilan sportif et financier, sans fuite temporelle',async t=>{
  t.mock.timers.enable({apis:['Date'],now:tip-8*h});
  const db=d1(), slate={games:[g]}, kv=fixtureState([g],slate);
  const env={MAX_JOURNAL:db,MAX_STATE:kv};
  const api=async path=>{
    const response=await worker.fetch(new Request('https://example.test'+path),env);
    assert.equal(response.status,200);return response.json();
  };
  async function deliver(receipt){
    let count=0;
    await worker.queue({messages:[{body:{match_id:receipt.match_id,generated_at:receipt.generated_at},ack(){count++;}}]},env);
    assert.equal(count,1);
  }
  const card=async()=>(await api('/api/game?id='+g.id)).study;
  t.mock.timers.setTime(tip-7*h);
  await refreshStudy(db,fixture(),validateResearch,{persistContext:true});
  await worker.queue({messages:[{body:{type:'publish_forecast',match_id:g.id},ack(){}}]},env);
  assert.ok((await api('/api/game?id='+g.id)).publication?.id);
  const first=await card();
  assert.equal(first.revisions.length,1);assert.equal(first.decision,null);
  assert.equal(first.pair.primary.at,first.pair.variant.at);
  const prior=first.pair.primary.player_points.home.players.find(p=>p.id==='1001');
  assert.ok(prior.predicted_points_if_active>0);
  t.mock.timers.setTime(tip-h);
  const incoming=report(tip-h-20000,[{n:0,status:'OUT'},{n:1,status:'OUT'}],true);
  const rec=await insertResearch(db,incoming);
  t.mock.timers.setTime(tip-h+10000);
  await deliver(rec);
  const second=await card();
  assert.equal(second.revisions.length,2);
  assert.equal(second.revision.changes.length,2);
  assert.deepEqual(second.revision.changes.map(x=>[x.player_id,x.effect]),[['1001','APPLIED'],['1002','ALREADY_KNOWN']]);
  assert.equal(second.revision.attribution,'GROUP');
  const delta=second.revision;
  assert.equal(delta.before.primary.players.find(x=>x.player_id==='1001').points,prior.predicted_points_if_active);
  assert.equal(delta.after.primary.players.find(x=>x.player_id==='1001').points,0);
  assert.equal(delta.changes[0].published_at,incoming.sources[0].published_at);
  assert.equal(delta.changes[0].received_at,rec.received_at);
  assert.ok(delta.changes[0].integrated_at>rec.received_at);
  assert.equal(second.pair.primary.at,second.pair.variant.at);
  assert.equal(second.pair.primary.input_id,second.pair.variant.input_id);
  assert.equal(second.decision.selected,true);
  assert.equal(second.decision.quote.homeOdds,2);
  assert.equal(second.decision.simulationOnly,true);
  const slateCard=(await api('/api/slate')).games[0].study;
  assert.equal(slateCard.revision.group_id,second.revision.group_id);
  t.mock.timers.setTime(tip-h+60000);
  assert.equal((await insertResearch(db,incoming)).id,rec.id);await deliver(rec);
  assert.equal((await card()).revisions.length,2);
  const studyBeforeLate=await api('/api/study');
  const future=report(tip-30000,[{n:0,status:'AVAILABLE'}]);
  t.mock.timers.setTime(tip+60000);
  const late=await insertResearch(db,future);await deliver(late);
  assert.ok(late.received_at>g.start);
  const archived=await card();
  for(const key of ['pair','revision','revisions','evaluation','decision','integrated_at'])
    assert.deepEqual(archived[key],second[key]);
  assert.deepEqual(await api('/api/study'),studyBeforeLate);
  assert.deepEqual([...new Set(archived.revisions.flatMap(v=>v.revision.changes.map(f=>f.receipt_id)))],[rec.id]);
  assert.equal(archived.deliveries.length,2);
  const lateDelivery=archived.deliveries.find(d=>d.received_at===late.received_at);
  assert.equal(lateDelivery.state,'AFTER_TIP');
  assert.equal(lateDelivery.generated_at,late.generated_at);
  assert.equal(lateDelivery.integrated_at,null);
  const onTime=archived.deliveries.find(d=>d.generated_at===rec.generated_at);
  assert.equal(onTime.state,'INTEGRATED');
  assert.equal(onTime.integrated_at,delta.integrated_at);
  t.mock.timers.setTime(tip+3*h);
  const final={...g,status:'STATUS_FINAL',fetched_at:iso(tip+3*h),home:{...g.home,score:108},away:{...g.away,score:104}};
  // A coherent synthetic ESPN box, decoded by the same parser used after real finals.
  const rawBox={_fetched_at:final.fetched_at,boxscore:{players:teams.map(team=>({team:{id:team.id},statistics:[{
    names:['MIN','PTS'],athletes:players[team.id].map((p,i)=>{
      const out=team.id==='10' && i<2;
      const minutes=out?0:team.id==='10'?24:20;
      const points=out?0:team.id==='10'?(i<6?12:10):(i<4?10:8);
      return {athlete:{id:p.id,displayName:p.name},didNotPlay:out,stats:[String(minutes),String(points)]};
    })
  }]}))}};
  const box=parseBoxscore(rawBox,final);
  assert.equal(box.teams['10'].minutes,240);
  assert.equal(box.teams['10'].totals.points,final.home.score);
  assert.equal(box.teams['20'].totals.points,final.away.score);
  assert.ok(fixture().boxes.every(b=>b.game_id!==g.id&&b.fetched_at<fixture().sourceAt));
  await settleStudy(db,final,box);
  await settleStudy(db,final,box);
  const result=await api('/api/study'), settled=await card();
  assert.equal(result.market.analyzedGames,1);
  assert.equal(result.market.pricedGames,1);
  assert.equal(result.market.selections,1);
  assert.equal(result.market.netUnits,1);
  assert.equal(result.market.roi,1);
  assert.deepEqual([result.market.comparedWithFavorite.maxCorrect,result.market.comparedWithFavorite.favoriteCorrect],[1,0]);
  assert.equal(result.sport.paired_games,1);
  assert.equal(settled.evaluation.game_id,g.id);
  assert.equal(settled.revisions.length,2);
});
