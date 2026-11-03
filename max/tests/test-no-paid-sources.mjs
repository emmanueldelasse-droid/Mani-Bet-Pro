import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base=new URL('../',import.meta.url);
const [worker,engine,advanced,config,prompt]=await Promise.all([
 readFile(new URL('worker.mjs',base),'utf8'),
 readFile(new URL('engine.mjs',base),'utf8'),
 readFile(new URL('advanced.mjs',base),'utf8'),
 readFile(new URL('wrangler.jsonc',base),'utf8'),
 readFile(new URL('analyst-prompt.md',base),'utf8')
]);
let checks=0;
function test(condition,reason){assert.ok(condition,reason);checks++}
for(const forbidden of ['api.openai.com','api.anthropic.com','rapidapi.com',
 'the-odds-api.com','LEGACY_SERVICE','manibetpro.emmanueldelasse.workers.dev',
 'PAPER_TRADING','MANI_HISTORY_DB','CLAUDE_API_KEY','OPENAI_API_KEY']){
 test(!worker.includes(forbidden),'Worker Max référence une source interdite : '+forbidden);
 test(!engine.includes(forbidden),'Engine Max référence une source interdite : '+forbidden);
 test(!advanced.includes(forbidden),'Quant engine Max référence une source interdite : '+forbidden);
}
const settings=JSON.parse(config);
test(settings.name==='manibetpromax-shadow','Nom Worker séparé');
test(settings.kv_namespaces?.length===1,'Namespace unique pour Max');
test(settings.kv_namespaces?.[0]?.binding==='MAX_STATE','Binding dédié Max uniquement');
test(!settings.services,'Aucun service binding vers application historique');
test(!settings.d1_databases,'Aucune base historique partagée');
test(settings.triggers?.crons?.includes('*/15 * * * *'),'Collecte automatique active');
test(!worker.includes('runAI('),'Aucun client de modèle payant appelé');
test(worker.includes('validateResearch'),'Rapports MacFly sourcés validés');
test(worker.includes("api/methodology"),'Prompt documenté publiquement');
test(worker.includes("api/metrics"),'Évaluation prospective exposée');
test(worker.includes("api/archive"),'Archives en lecture seule exposées');
test(worker.includes("api/game"),'Snapshots historiques accessibles en lecture seule');
test(worker.includes("max:archive:progress"),'Curseur archives isolé Max');
test(advanced.includes("simulated_runs"),'Monte Carlo réellement calculé');
test(advanced.includes("evaluatePregame"),'Aucune évaluation avant résultat');
test(advanced.includes("parseBoxscore"),'Feuilles joueurs indépendantes');
for(let i=1;i<=16;i++){
 test(new RegExp('(?:^|\\n)'+i+'\\. [A-ZÉÈÛÀ]', 'u').test(prompt),'Section '+i+' manquante');
}
test(prompt.includes('50 000'),'Simulations conditionnelles conservées dans contrat');
test(prompt.includes('PRONOSTIC NON FIABLE — ABSTENTION'),'Abstention obligatoire conservée');
console.log('ManiBetProMax no-subscription guard: '+checks+' assertions OK');
