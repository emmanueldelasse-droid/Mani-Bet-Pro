import assert from 'node:assert/strict';
import {collect} from '../worker.mjs';
const firstNow=new Date('2026-11-03T10:00:00.000Z'),tip='2026-11-04T01:00:00.000Z',id='401999998';
let n=0;const eq=(x,y,msg)=>{assert.deepEqual(x,y,msg);n++},ok=(v,msg)=>{assert.ok(v,msg);n++};
function fixture(eventId,start,status,homeScore,awayScore){
 return {id:String(eventId),start,status,event_type:'REGULAR',season_type:2,
  home:{id:'1',name:'Denver Nuggets',abbreviation:'DEN',score:homeScore},
  away:{id:'2',name:'Los Angeles Lakers',abbreviation:'LAL',score:awayScore}};
}
function payload(g){
 return {id:g.id,date:g.start,status:{type:{name:g.status}},season:{type:2},
  competitions:[{seasonType:2,competitors:[
   {homeAway:'home',team:{id:'1',displayName:'Denver Nuggets',abbreviation:'DEN'},score:g.home.score},
   {homeAway:'away',team:{id:'2',displayName:'Los Angeles Lakers',abbreviation:'LAL'},score:g.away.score}
  ]}]};
}
const prior=Array.from({length:32},(_,i)=>fixture(401800000+i,
 new Date(Date.parse('2026-10-01T22:00:00Z')+i*86400000).toISOString(),
 'STATUS_FINAL',110+i%7,99+i%7)).filter(g=>Date.parse(g.start)<firstNow);
const upcoming=fixture(id,tip,'STATUS_SCHEDULED',null,null);
const state=new Map(),writes=[];
const kv={async get(key,options){const v=state.get(key);return options?.type==='json'?v?JSON.parse(v):null:v??null;},
 async put(key,value){state.set(key,value);writes.push(key);}};
for(let offset=2;offset<=46;offset++){
 const day=new Date(firstNow.getTime()-offset*86400000).toISOString().slice(0,10).replace(/-/g,'');
 state.set('max:scoreboard:'+day,JSON.stringify({date:day,
  games:prior.filter(x=>x.start.slice(0,10).replace(/-/g,'')===day)}));
}
for(const g of prior)state.set('max:box:failed:'+g.id,JSON.stringify({reason:'TEST_NOT_AVAILABLE'}));
const fetcher=async url=>{
 const d=url.match(/dates=(\d{8})/)?.[1];
 return {ok:true,json:async()=>url.endsWith('/injuries')?
  {injuries:[{displayName:'Denver Nuggets',injuries:[]},{displayName:'Los Angeles Lakers',injuries:[]}]}:
  {events:d==='20261104'?[payload(upcoming)]:[]}};
};
const one=await collect({MAX_STATE:kv},fetcher,firstNow);
eq(one.monte_carlo_executed,1,'initial simulation actually executed');
eq(one.monte_carlo_reused,0,'no cache on initial pass');
const slate1=JSON.parse(state.get('max:slate:latest'));
eq(slate1.research_agenda.due_count,1,'H24 research due before report');
eq(slate1.research_agenda.due[0].phase,'H24','due window recognized');
const check1=JSON.parse(state.get('max:game:'+id));
ok(check1.independent_analysis.advanced.forecast_signature,'input cache signature written');
ok(state.has('max:pre:'+id+':PLAYER_V1'),'player baseline snapshot frozen');
const reportTime='2026-11-03T10:05:00.000Z';
state.set('max:research:'+id,JSON.stringify({
 schema_version:'max-research-v1',match_id:id,generated_at:reportTime,
 summary:'Rapport analytique lié à la phase H24.',
 sources:[{url:'https://official.nba.com/nba-injury-report-2026-27-season/',
  title:'NBA official injury report',kind:'OFFICIAL',checked_at:reportTime}],
 sections:Array.from({length:16},(_,i)=>({section_id:i+1,title:'Rubrique '+(i+1),
  status:'PARTIAL',findings:[],missing:[]}))
}));
const two=await collect({MAX_STATE:kv},fetcher,new Date('2026-11-03T10:15:00.000Z'));
eq(two.monte_carlo_executed,0,'unchanged inputs: zero new Monte Carlo');
eq(two.monte_carlo_reused,1,'50k Monte Carlo reused');
eq(two.research_due,0,'MacFly H24 done => no repeated heavy research');
const slate2=JSON.parse(state.get('max:slate:latest'));
eq(slate2.forecast_efficiency.reused,1,'cache status surfaced to monitoring');
eq(slate2.research_agenda.due_count,0,'agenda empty after report');
eq(slate2.games[0].research_priority.action,'SKIP','skip researched phase');
eq(slate2.games[0].independent_analysis.advanced.forecast.probability_home,
 slate1.games[0].independent_analysis.advanced.forecast.probability_home,'stable forecast');
const changed=JSON.parse(state.get('max:game:'+id));
ok(changed.source_changes.includes('RECHERCHE_MACFLY'),'MacFly publication detected');
const three=await collect({MAX_STATE:kv},fetcher,new Date('2026-11-03T19:30:00.000Z'));
eq(three.monte_carlo_reused,1,'reused through next phase on unchanged NBA inputs');
eq(three.research_due,1,'H6 research now due');
eq(JSON.parse(state.get('max:slate:latest')).research_agenda.due[0].phase,'H6','H6 delta scheduled');
ok(writes.every(key=>key.startsWith('max:')),'all storage writes strictly independent');
console.log('ManiBetProMax adaptive end-to-end : '+n+' checks OK');
