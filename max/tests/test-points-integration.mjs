import assert from 'node:assert/strict';
import {collect,validateResearch} from '../worker.mjs';

const now=new Date('2026-11-03T13:00:00Z');
const start='2026-11-04T01:00:00.000Z',gameId='401999998';
const kv=new Map(),writes=[];
const state={async get(k,o){const v=kv.get(k);return o?.type==='json'?(v?JSON.parse(v):null):v??null;},
 async put(k,v){kv.set(k,v);writes.push(k);}};
const baseEvent=(id,date,status,h,a,hs,as)=>({id:String(id),date,status:{type:{name:status}},season:{type:2},
 competitions:[{seasonType:2,competitors:[
 {homeAway:'home',team:{id:String(h),displayName:'Denver Nuggets',abbreviation:'DEN'},score:hs},
 {homeAway:'away',team:{id:String(a),displayName:'Los Angeles Lakers',abbreviation:'LAL'},score:as}]}]});
const old=[];
for(let i=0;i<40;i++){
 const day=new Date(Date.parse('2026-10-01T19:00:00Z')+i*86400000).toISOString();
 if(Date.parse(day)>=now.getTime())break;
 old.push(baseEvent(401780000+i,day,'STATUS_FINAL','1','2',110+i%7,105+i%7));
}
const oldParsed=id=>old.find(x=>String(x.id)===String(id));
function cachedBox(event){
 const id=String(event.id),home=event.competitions[0].competitors[0].score;
 const away=event.competitions[0].competitors[1].score;
 const players=(team,points)=>Array.from({length:8},(_,i)=>({
  id:team+'-'+i,name:'Player '+team+' '+i,team_id:team,
  minutes:30,points:i===7?points-7*14:14,starter:i<5,
  source:'ESPN final boxscore'
 }));
 return {schema_version:'max-box-v1',game_id:id,start:event.date,home_id:'1',away_id:'2',
  teams:{'1':{players:players('1',home),totals:{points:home}},
   '2':{players:players('2',away),totals:{points:away}}},
  source_url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+id};
}
for(let d=2;d<=46;d++){
 const day=new Date(now.getTime()-d*86400000).toISOString().slice(0,10).replace(/-/g,'');
 const rows=old.filter(x=>x.date.slice(0,10).replace(/-/g,'')===day);
 kv.set('max:scoreboard:'+day,JSON.stringify({date:day,games:rows.flatMap(x=>[{
  id:String(x.id),start:x.date,status:'STATUS_FINAL',event_type:'REGULAR',home:{id:'1',name:'Denver Nuggets',score:x.competitions[0].competitors[0].score},away:{id:'2',name:'Los Angeles Lakers',score:x.competitions[0].competitors[1].score}}])}));
}
for(const event of old.slice(-8))kv.set('max:box:'+event.id,JSON.stringify(cachedBox(event)));
for(const event of old.slice(0,-8))kv.set('max:box:failed:'+event.id,JSON.stringify({reason:'test'}));
const pdf='https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-11-03_08_00AM.pdf';
const report={schema_version:'max-research-v1',match_id:gameId,generated_at:'2026-11-03T12:59:00Z',
 summary:'Rapport NBA officiel contrôlé pour ce match.',
 sources:[{url:pdf,title:'NBA injury report',kind:'OFFICIAL',checked_at:'2026-11-03T12:55:00Z'}],
 verified_injuries:[{match_id:gameId,team_id:'1',player:'Player 1 0',status:'OUT',
  source_url:pdf,checked_at:'2026-11-03T12:55:00Z',event_start:start}],
 sections:Array.from({length:16},(_,i)=>({section_id:i+1,title:'Section '+i,status:'PARTIAL'}))};
kv.set('max:research:'+gameId,JSON.stringify(report));
assert.equal(validateResearch(report,{id:gameId,start,home:{id:'1'},away:{id:'2'}},now.toISOString()).verified_injuries.length,1);
const scheduled=baseEvent(gameId,start,'STATUS_SCHEDULED','1','2',null,null);
const final=baseEvent(gameId,start,'STATUS_FINAL','1','2',120,116);
let finished=false;
const fetcher=async url=>{
 if(url.endsWith('/injuries'))return {ok:true,json:async()=>({injuries:[
  {displayName:'Denver Nuggets',injuries:[{athlete:{displayName:'Player 1 0'},status:'Out',shortComment:'out for an earlier game'}]},
  {displayName:'Los Angeles Lakers',injuries:[]}]})};
 if(url.includes('/summary?'))throw new Error('test pending boxscore not provided');
 const day=url.match(/dates=(\d{8})/)?.[1];
 return {ok:true,json:async()=>({events:day==='20261104'?[finished?final:scheduled]:[]})};
};
const first=await collect({MAX_STATE:state},fetcher,now);
assert.equal(first.updated,true);
const slate=JSON.parse(kv.get('max:slate:latest')),g=slate.games.find(x=>x.id===gameId);
assert.ok(g);
const points=g.independent_analysis.advanced.player_points;
assert.equal(points.status,'PLAYER_PROJECTIONS_UNCALIBRATED');
assert.equal(points.home.players.find(x=>x.id==='1-0').availability,'OFFICIAL_OUT');
assert.equal(points.home.players.find(x=>x.id==='1-0').predicted_points,0);
assert.equal(points.away.players.find(x=>x.id==='2-0').availability,'NOT_CONFIRMED_FOR_THIS_GAME');
assert.ok(points.away.players.find(x=>x.id==='2-0').predicted_points_if_active>0);
assert.equal(g.independent_analysis.advanced.forecast.simulated_runs,50000);
assert.ok(kv.has('max:pre:'+gameId+':PLAYER_V1'));
const last=JSON.parse(kv.get('max:pre:'+gameId+':PLAYER_V1'));
assert.ok(new Date(last.at)<new Date(start));
finished=true;
kv.set('max:box:'+gameId,JSON.stringify(cachedBox(final)));
const second=await collect({MAX_STATE:state},fetcher,new Date('2026-11-04T09:00:00Z'));
assert.equal(second.updated,true);
const pe=JSON.parse(kv.get('max:eval:players:'+gameId));
assert.ok(pe.matched>0,'historical player points evaluated ONLY after tip');
assert.ok(Number.isFinite(pe.mae));
const stats=JSON.parse(kv.get('max:metrics:player-points'));
assert.equal(stats.games_evaluated,1);
assert.ok(writes.every(k=>k.startsWith('max:')));
console.log('ManiBetProMax end-to-end player scoring: 15 checks OK');
