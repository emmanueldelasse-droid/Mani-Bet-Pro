import assert from 'node:assert/strict';
import worker from '../worker.mjs';

let n=0;
const ok=(v,m)=>{assert.ok(v,m);n++};
const eq=(x,y,m)=>{assert.deepEqual(x,y,m);n++};
const game={id:'401999999',start:'2026-11-03T00:00:00Z',
 status:'STATUS_FINAL',home:{name:'Denver Nuggets',score:115},
 away:{name:'Utah Jazz',score:105}};
const state=new Map([['max:slate:latest',JSON.stringify({games:[game]})]]);
const kv={async get(k,o){const raw=state.get(k);return o?.type==='json'?
 (raw?JSON.parse(raw):null):(raw??null);}};
const env={MAX_STATE:kv};
const snapshot=(checkpoint,at,p)=>JSON.stringify({
 game_id:game.id,checkpoint,at,
 forecast:{status:'SIMULATED_UNCALIBRATED',probability_home:p,simulated_runs:50000},
 injuries:{home:[],away:[]}
});
state.set('max:pre:401999999:EARLIEST',snapshot('EARLIEST','2026-11-02T02:00:00Z',0.51));
state.set('max:pre:401999999:H3',snapshot('H3','2026-11-02T21:20:00Z',0.58));
state.set('max:pre:401999999:H1',snapshot('H1','2026-11-03T00:12:00Z',0.81)); // rejeté car rétroactif
state.set('max:eval:401999999',JSON.stringify({
 pregame_at:'2026-11-02T21:20:00Z',brier:0.1764,log_loss:0.5447,
 final_score:{home:115,away:105}
}));
async function get(path){
 const response=await worker.fetch(new Request('https://max.example'+path),env);
 return {status:response.status,data:await response.json()};
}
const okGame=await get('/api/game?id=401999999');
eq(okGame.status,200,'route historique');
eq(okGame.data.timeline.length,2,'deux seuls snapshots avant le début');
eq(okGame.data.timeline[0].checkpoint,'EARLIEST','ordre chronologique');
eq(okGame.data.timeline[1].checkpoint,'H3','dernier snapshot');
eq(okGame.data.evaluation.brier,0.1764,'évaluation réelle jointe');
eq(okGame.data.timeline[0].forecast.simulated_runs,50000,'tirages conservés');
eq(okGame.data.match_id,game.id,'ID vérifié');
const invalid=await get('/api/game?id=javascript:alert(1)');
eq(invalid.status,400,'ID non numérique refusé');
const unknown=await get('/api/game?id=401123456');
eq(unknown.status,404,'pas de match inventé');
state.set('max:eval:401999999',JSON.stringify({
 pregame_at:'2026-11-03T01:00:00Z',brier:0.01
}));
eq((await get('/api/game?id=401999999')).data.evaluation,null,
 'évaluation datée après le coup d’envoi rejetée');
ok(okGame.data.source.includes('pre-tip'),'source des captures explicite');
console.log('ManiBetProMax immutable game history API: '+n+' assertions OK');
