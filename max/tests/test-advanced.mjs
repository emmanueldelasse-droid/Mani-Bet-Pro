import assert from 'node:assert/strict';
import {parseBoxscore,rotationAnalysis,forecastGame,evaluatePregame,summarizeEvaluations,ADVANCED_VERSION} from '../advanced.mjs';
let checks=0;
function ok(value,description){assert.ok(value,description);checks++;}
function eq(value,expected,description){assert.deepEqual(value,expected,description);checks++;}
const team=(id,score)=>({team:{id},statistics:[{names:['MIN','FG','3PT','FT','OREB','DREB','AST','TO','PTS'],
 athletes:Array.from({length:8},(_,i)=>({athlete:{id:id+'-'+i,displayName:'Test player '+id+' '+i},starter:i<5,
 stats:['30','5-11','2-4','2-2','1','4','3','2',String(i===7?score-98:14)]}))}]});
const game={id:'401999999',start:'2026-11-02T20:00:00Z',status:'STATUS_FINAL',
 home:{id:'1',score:111},away:{id:'2',score:104}};
const box=parseBoxscore({boxscore:{players:[team('1',111),team('2',104)]}},game);
ok(box,'ESPN summary complet accepté');
eq(box.teams['1'].players.length,8,'8 joueurs valides');
eq(box.teams['1'].totals.points,111,'points vérifiés');
eq(box.teams['1'].minutes,240,'minutes cohérentes');
ok(box.teams['1'].totals.possessions>60,'possessions estimées');
ok(box.teams['1'].totals.efg_pct>0,'eFG calculé');
eq(parseBoxscore({boxscore:{players:[team('1',111),team('2',104)]}},
 {...game,home:{id:'1',score:120}}),null,'source incohérente refusée');
eq(parseBoxscore({boxscore:{players:[]}},game),null,'boxscore incomplet refusé');
const rotations=rotationAnalysis('1',[box],[{player:'Test player 1 0',status:'Out'}],'2026-11-03T20:00:00Z');
eq(rotations.rotation.length,8,'rotation réelle');
eq(rotations.confirmed_out[0].name,'Test player 1 0','blessure recoupée');
eq(rotations.rotation[0].minutes_hypothesis,0,'out => 0 minute théorique');
eq(rotations.scenarios.length,3,'trois scénarios distincts');
ok(rotations.impact_warning.includes('NON CAUSAL'),'aucune causalité inventée');
const finals=Array.from({length:40},(_,i)=>({
 id:String(401700000+i),start:new Date(Date.parse('2026-10-01T20:00:00Z')+i*86400000).toISOString(),
 status:'STATUS_FINAL',event_type:'REGULAR',
 home:{id:i%3===0?'3':'1',score:110+i%9},
 away:{id:i%3===0?'4':'2',score:97+i%9}
})).filter(x=>x.start<'2026-11-11T12:00:00Z');
const future={id:'401123456',start:'2026-11-12T00:00:00Z',status:'STATUS_SCHEDULED',
 home:{id:'1',score:null},away:{id:'2',score:null}};
const p=forecastGame(future,finals,[],'2026-11-11T12:00:00Z');
eq(p.status,'SIMULATED_UNCALIBRATED','simulation qualifiée');
eq(p.simulated_runs,50000,'50 000 tirages RÉELLEMENT exécutés');
ok(p.probability_home>0&&p.probability_home<1,'probas strictement bornées');
eq(p.probability_home+p.probability_away,1,'somme des probabilités');
eq(p,forecastGame(future,finals,[],'2026-11-11T12:00:00Z'),'même entrée => tirages reproductibles');
eq(forecastGame(future,[],[],'2026-11-11T12:00:00Z').status,'LOW_SAMPLE','manque => abstention');
eq(forecastGame(future,finals,[],'2026-11-13T12:00:00Z').status,'NO_PREMATCH','pas de rétro-pronostic');
const final={...future,status:'STATUS_FINAL',home:{id:'1',score:111},away:{id:'2',score:106}};
eq(evaluatePregame(final,{at:'2026-11-12T01:00:00Z',forecast:p}),null,'snapshot post-tip refusé');
const y=evaluatePregame(final,{at:'2026-11-11T22:00:00Z',checkpoint:'H3',forecast:p});
ok(y&&Number.isFinite(y.brier),'évaluation uniquement avec snapshot pré-match');
eq(y.brier,Math.round((1-p.probability_home)**2*1e6)/1e6,'Brier calculé');
const metrics=summarizeEvaluations([y]);
eq(metrics.games_evaluated,1,'évaluation enregistrée');
eq(metrics.calibrated,false,'aucune calibration indue');
eq(metrics.roi,null,'pas de ROI fabriqué');
ok(ADVANCED_VERSION.startsWith('max-quant-'),'version moteur');
console.log('ManiBetProMax advanced validation: '+checks+' assertions OK');
