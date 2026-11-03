import assert from 'node:assert/strict';
import {archiveStep} from '../worker.mjs';

let n=0;
const ok=(v,m)=>{assert.ok(v,m);n++};
const eq=(v,w,m)=>{assert.deepEqual(v,w,m);n++};
const state=new Map(),writes=[],calls=[];
const kv={
 async get(k,opts){const raw=state.get(k);return opts?.type==='json'?(raw?JSON.parse(raw):null):(raw??null);},
 async put(k,value){state.set(k,value);writes.push(k);}
};
let broken=false;
const fetcher=async(url)=>{
 calls.push(url);
 if(broken)throw new Error('TEST_PROVIDER_UNAVAILABLE');
 return {ok:true,json:async()=>({events:[]})};
};
let r=await archiveStep(kv,fetcher,'2026-11-03T07:00:00Z');
eq(r.days,2,'deux jours téléchargés seulement');
eq(r.target,505,'période 2024-25 + 2025-26');
eq(r.next_date,'20241024','curseur suivant correct');
eq(calls.length,2,'quota de récupération borné');
eq(JSON.parse(state.get('max:archive:scoreboard:20241022')).season,'2024-25','saison étiquetée');
r=await archiveStep(kv,fetcher,'2026-11-03T07:15:00Z');
eq(r.days,4,'progression cumulative');
eq(r.next_date,'20241026','reprise après arrêt');
eq(writes.filter(k=>k==='max:archive:progress').length,2,'curseur sauvé une fois par exécution');
broken=true;
r=await archiveStep(kv,fetcher,'2026-11-03T07:30:00Z');
eq(r.state,'ERROR','erreur fournisseur signalée');
eq(r.days,4,'aucun faux jour ajouté sur échec');
eq(r.next_date,'20241026','curseur conservé sur échec');
const before=calls.length;
r=await archiveStep(kv,fetcher,'2026-11-03T08:00:00Z');
eq(r.state,'RETRY_PAUSED','pause anti-spam réseau');
eq(calls.length,before,'aucun nouvel appel dans la pause');
broken=false;
r=await archiveStep(kv,fetcher,'2026-11-03T08:40:00Z');
eq(r.days,6,'reprise après une heure');
eq(r.next_date,'20241028','aucune journée sautée');
ok(writes.every(k=>k.startsWith('max:')),'aucune clé de ManiBetPro touchée');
ok(!calls.some(u=>!u.startsWith('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=')),
 'aucun autre fournisseur utilisé');
console.log('ManiBetProMax archives progressives: '+n+' assertions OK');
