import assert from 'node:assert/strict';
import {checkpointPhase,researchPriority,forecastInputSignature,canReuseForecast,agendaFromGames} from '../scheduler.mjs';
let n=0;const eq=(x,y,m)=>{assert.deepEqual(x,y,m);n++};
const ok=(x,m)=>{assert.ok(x,m);n++};
const tip='2026-11-04T00:00:00Z';
const g={id:'401999999',start:tip,status:'STATUS_SCHEDULED',home:{id:'1',name:'Denver Nuggets'},away:{id:'2',name:'Los Angeles Lakers'}};
const at=hours=>new Date(Date.parse(tip)-hours*3600000).toISOString();
eq(checkpointPhase(g,at(49)),null,'aucune recherche 49 heures avant');
eq(checkpointPhase(g,at(30)).name,'PREP','préparation non urgente H48');
eq(checkpointPhase(g,at(20)).name,'H24','premier rapport complet H24');
eq(checkpointPhase(g,at(5)).name,'H6','révisions H6');
eq(checkpointPhase(g,at(2)).name,'H3','révisions H3');
eq(checkpointPhase(g,at(1)).name,'H1','révisions H1');
eq(checkpointPhase(g,at(0.25)).name,'H30','vigilance H30');
eq(checkpointPhase(g,at(-0.1)),null,'aucune analyse pré-match après tip');
eq(checkpointPhase({...g,status:'STATUS_FINAL'},at(0.2)),null,'événement terminé ignoré');
let planned=researchPriority(g,null,at(20));
eq(planned.action,'DEEP','analyse initiale approfondie');
eq(planned.due,true,'première analyse due');
const covered={match_id:g.id,generated_at:at(19.75)};
planned=researchPriority(g,covered,at(18));
eq(planned.due,false,'rapport dans la fenêtre => pas de recherche répétée');
eq(planned.reason,'FENETRE_DEJA_COUVERTE','justification explicite');
eq(researchPriority(g,covered,at(5)).action,'DELTA','nouvelle fenêtre H6 => mise à jour ciblée');
eq(researchPriority(g,covered,at(5),['RAPPORT_BLESSURES']).action,'RECHECK','alerte blessure force nouveau contrôle');
eq(researchPriority(g,covered,at(18),['STATUT_MATCH']).action,'RECHECK','changement horaire/statut recheck');
eq(researchPriority(g,{match_id:'wrong',generated_at:at(18)},at(18)).due,true,'mauvais match ne couvre jamais phase');
const past=agendaFromGames([g,{...g,id:'401999998',start:at(-1),status:'STATUS_FINAL'}],at(5));
eq(past.eligible,1,'match terminé exclu');
eq(past.due_count,1,'une recherche seulement');
eq(past.due[0].phase,'H6','priorité H6');
const finals=[{id:'401100001',start:'2026-10-31T21:00:00Z',event_type:'REGULAR',status:'STATUS_FINAL',
 home:{id:'1',score:115},away:{id:'2',score:104}}];
const signature=forecastInputSignature(g,finals,[],'v1');
eq(signature,forecastInputSignature(g,[...finals],[],'v1'),'signature stable');
ok(signature!==forecastInputSignature(g,[{...finals[0],home:{id:'1',score:116}}],[],'v1'),'score corrigé invalide cache');
ok(signature!==forecastInputSignature(g,finals,[],'v2'),'version moteur invalide cache');
const prior={independent_analysis:{advanced:{forecast_signature:signature,forecast:{status:'SIMULATED_UNCALIBRATED',simulated_runs:50000}}}};
eq(canReuseForecast(prior,signature,g,at(1)),true,'réutilisation valide quand invariants');
eq(canReuseForecast(prior,signature,g,at(-1)),false,'aucune rétroprédiction réutilisée');
eq(canReuseForecast(prior,signature,{...g,status:'STATUS_FINAL'},at(1)),false,'match final invalidation');
eq(canReuseForecast(prior,'bad',g,at(1)),false,'signature différente => simulation refaite');
const box={game_id:'401100001',start:'2026-10-31T21:00:00Z',home_id:'1',away_id:'2',
 teams:{'1':{totals:{points:115,off_rating:112.2,possessions:99,efg_pct:54}},
 '2':{totals:{points:104,off_rating:102,possessions:99,efg_pct:49}}}};
ok(forecastInputSignature(g,finals,[box],'v1')!==signature,'feuille de match nouvelle invalide cache');
ok(forecastInputSignature(g,finals,[{...box,teams:{...box.teams,'1':{totals:{...box.teams['1'].totals,off_rating:119}}}}],'v1')!==
 forecastInputSignature(g,finals,[box],'v1'),'statistique corrigée invalide cache');
console.log('ManiBetProMax adaptive scheduler: '+n+' assertions OK');
