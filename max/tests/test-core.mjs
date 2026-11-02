import assert from 'node:assert/strict';
import {slateDates,normalizeGames,teamInjuries,detectChange,fingerprint,collect} from '../worker.mjs';

const ts=new Date('2026-11-02T23:40:00.000Z');
let checks=0;
function check(x,message){assert.ok(x,message);checks++;}
function eq(a,b,message){assert.deepEqual(a,b,message);checks++;}
function game(status='STATUS_SCHEDULED'){
 return {id:'GAME-1',datetime:'2026-11-03T02:00:00.000Z',status,home_team:{name:'Denver Nuggets',abbreviation:'DEN',record:'4-2'},away_team:{name:'Los Angeles Lakers',abbreviation:'LAL',record:'3-3'},home_season_stats:{ppg:112},away_season_stats:{ppg:110}};
}
function payload(status='STATUS_SCHEDULED'){return {matches:[game(status)]};}
function report(status='Out'){
 return {available:true,by_team:{'Denver Nuggets':[{player:'Joueur Alpha',status,detail:'Cheville'}],'Los Angeles Lakers':[]}};
}
function kv(){
 const state=new Map(),writes=[];
 return {state,writes,async get(k,options){let v=state.get(k);return options?.type==='json'&&v!==undefined?JSON.parse(v):v??null;},
 async put(k,v){writes.push(k);state.set(k,v);}};
}
const dates=slateDates(ts);
eq(dates,['20261101','20261102','20261103'],'dates UTC voisines');
eq(normalizeGames([payload(),payload()]).length,1,'déduplication ESPN');
eq(normalizeGames([{matches:[{id:'X',datetime:'NOT_DATE',home_team:{name:'A'},away_team:{name:'B'}}]}]).length,0,'heure invalide filtrée');
eq(teamInjuries(report(),{name:'Dénver Nuggets',abbreviation:'DEN'}).length,1,'noms normalisés');
eq(teamInjuries(null,{name:'Denver Nuggets'}),null,'blessures inconnues != 0');
eq(teamInjuries({available:false,by_team:{}},{name:'Denver Nuggets'}),null,'source absente');
const normalized=normalizeGames([payload()])[0];
const current={...normalized,injuries:{home:teamInjuries(report(),normalized.home),away:[]}};
const prior={...current,injuries:{home:teamInjuries(report('Questionable'),normalized.home),away:[]}};
eq(detectChange(null,current),null,'premier snapshot sans événement artificiel');
eq(detectChange(prior,current),['RAPPORT_BLESSURES'],'blessure mise à jour');
eq(detectChange({...prior,status:'STATUS_FINAL'},current),['STATUT_MATCH','RAPPORT_BLESSURES'],'deux changements');
eq(fingerprint({...current,analyzed_at:'2026-11-02'}),fingerprint({...current,analyzed_at:'2026-11-03'}),'horodatage ignoré dans fingerprint');
const mock=kv();const calls=[];let currentStatus='STATUS_SCHEDULED',inj='Questionable',scheduleFailure=false,injuryFailure=false;
const fetcher=async (url)=>{
 calls.push(url);
 if(url.includes('/nba/matches')) {
   if(scheduleFailure)throw new Error('source indisponible');
   return {ok:true,json:async()=>payload(currentStatus)};
 }
 if(url.includes('/nba/injuries/espn')) {
   if(injuryFailure)throw new Error('blessures indisponibles');
   return {ok:true,json:async()=>report(inj)};
 }
 throw new Error('appel non autorisé: '+url);
};
let result=await collect({MAX_STATE:mock},fetcher,ts);
check(result.updated===true,'première collecte réussie');
eq(result.game_count,1,'match dédupliqué');
eq(result.events_new,0,'pas de fausse alerte au premier run');
check(calls.length===4,'3 dates + blessures');
check(calls.every(x=>x.startsWith('https://manibetpro.emmanueldelasse.workers.dev/nba/')),'pas de source facturée');
let stored=JSON.parse(mock.state.get('max:slate:latest'));
eq(stored.games[0].coverage.status,'OBSERVATION','coverage disponible');
eq(stored.games[0].analysis,null,'aucun résultat GPT inventé');
eq(stored.games[0].historical_model_reference,null,'aucun résultat moteur inventé');
inj='Out';
result=await collect({MAX_STATE:mock},fetcher,new Date(ts.getTime()+15*60000));
check(result.updated===true,'deuxième collecte');
let events=JSON.parse(mock.state.get('max:events:latest'));
eq(events.length,1,'changement blessure historisé');
eq(events[0].changes,['RAPPORT_BLESSURES'],'type événement');
check([...mock.state.keys()].some(x=>x.startsWith('max:history:GAME-1:')),'snapshot historique');
result=await collect({MAX_STATE:mock},fetcher,new Date(ts.getTime()+30*60000));
eq(JSON.parse(mock.state.get('max:events:latest')).length,1,'anti-doublon à information inchangée');
eq(mock.writes.filter(k=>k==='max:game:GAME-1').length,2,'pas de KV write game sans changement');
eq(mock.writes.filter(k=>k==='max:events:latest').length,1,'pas de KV write events sans changement');
injuryFailure=true;
result=await collect({MAX_STATE:mock},fetcher,new Date(ts.getTime()+45*60000));
eq(result.sources.injuries.state,'ERROR','dégradation source affichée');
stored=JSON.parse(mock.state.get('max:slate:latest'));
check(stored.games[0].injuries.cached_age_minutes>0,'cache source tracé');
scheduleFailure=true;
const preserved=mock.state.get('max:slate:latest');
result=await collect({MAX_STATE:mock},fetcher,new Date(ts.getTime()+60*60000));
check(result.updated===false,'indisponibilité matches fail closed');
eq(mock.state.get('max:slate:latest'),preserved,'dernier snapshot non écrasé si provider down');
check(![...mock.state.keys()].some(k=>k.includes('betting_recommendations')||k.includes('motor_prob')),'aucune écriture sur moteur historique');
// Le raccordement interne vers le Worker historique doit primer sur fetch public.
scheduleFailure=false;injuryFailure=false;
const serviceKV=kv();let boundCalls=0;
const legacyService={fetch:async request=>{boundCalls++;return fetcher(request.url);}};
const bound=await collect({MAX_STATE:serviceKV,LEGACY_SERVICE:legacyService},
  async()=>{throw new Error('fetch public interdit')},ts);
check(bound.updated===true,'service binding fonctionne');
eq(boundCalls,4,'les 4 lectures passent par service binding');
eq(JSON.parse(serviceKV.state.get('max:slate:latest')).games.length,1,'slate via liaison interne');
console.log('ManiBetProMax tests:',checks,'assertions · 0 échec');
