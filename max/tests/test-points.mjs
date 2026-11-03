import assert from 'node:assert/strict';
import {projectPlayerPoints,evaluatePlayerPoints,summarizePlayerPointsEvaluations} from '../points.mjs';
let n=0;const ok=(v,msg)=>{assert.ok(v,msg);n++};const eq=(a,b,msg)=>{assert.deepEqual(a,b,msg);n++};
const game={id:'401999999',status:'STATUS_SCHEDULED',start:'2026-11-04T01:00:00.000Z',
 home:{id:'1',name:'Denver Nuggets'},away:{id:'2',name:'Los Angeles Lakers'}};
const now='2026-11-03T15:00:00.000Z';
const boxes=Array.from({length:8},(_,i)=>{
 const start=new Date(Date.parse('2026-10-25T20:00:00Z')+i*86400000).toISOString();
 return {schema_version:'max-box-v1',game_id:String(401100000+i),start,
 source_url:'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+(401100000+i),
 home_id:'1',away_id:'2',teams:{
 '1':{totals:{points:115},players:[
 {id:'100',name:'Star Alpha',minutes:34,points:23+i,team_id:'1'},
 {id:'101',name:'Role Beta',minutes:25,points:12+i%4,team_id:'1'}]},
 '2':{totals:{points:108},players:[
 {id:'200',name:'Star Gamma',minutes:32,points:21+i%5,team_id:'2'},
 {id:'201',name:'Role Delta',minutes:21,points:10+i%3,team_id:'2'}]}
 }}});
const f={status:'SIMULATED_UNCALIBRATED',projected_score:{home:118,away:112}};
const generic={home:[{player:'Star Alpha',status:'Out',detail:'out last Monday'}],away:[]};
let p=projectPlayerPoints(game,boxes,generic,[],f,now);
ok(p.home.players.length===2,'historique joueur ESPN utilisé');
ok(p.home.players[0].predicted_points_if_active>0,'points calculés');
eq(p.home.players.find(x=>x.id==='100').availability,'NOT_CONFIRMED_FOR_THIS_GAME',
 'Un OUT ESPN générique ne signifie PAS OUT sur ce match');
ok(p.home.players.find(x=>x.id==='100').caution==='ESPN_STATUS_NOT_CONFIRMED_FOR_THIS_GAME','alerte stale');
ok(p.home.players.find(x=>x.id==='100').predicted_interval_80_if_active[1]>p.home.players.find(x=>x.id==='100').predicted_interval_80_if_active[0],'fourchette positive');
ok(p.home.players.find(x=>x.id==='100').probability_points_at_least_if_active['20']>=0,'seuil >=20 borné');
ok(p.home.players[0].source_boxscores.length>0,'sources joueurs tracées');
const officialOut=[{team_id:'1',player:'Star Alpha',status:'OUT',source_url:'https://ak-static.cms.nba.com/referee/injury/sample.pdf',checked_at:now}];
p=projectPlayerPoints(game,boxes,generic,officialOut,f,now);
eq(p.home.players.find(x=>x.id==='100').predicted_points,0,'absent officiellement = 0 point');
eq(p.home.players.find(x=>x.id==='100').availability,'OFFICIAL_OUT','statut sûr distinct');
const questionable=[{team_id:'1',player:'Star Alpha',status:'QUESTIONABLE',source_url:'https://ak-static.cms.nba.com/referee/injury/sample.pdf',checked_at:now}];
p=projectPlayerPoints(game,boxes,generic,questionable,f,now);
eq(p.home.players.find(x=>x.id==='100').availability,'OFFICIAL_UNCERTAIN','incertain clairement identifié');
ok(p.home.players.find(x=>x.id==='100').scenarios.limited.points<p.home.players.find(x=>x.id==='100').scenarios.available.points,'scénario minutes limitées');
eq(p.home.players.find(x=>x.id==='100').scenarios.out.points,0,'scénario absent');
eq(projectPlayerPoints(game,boxes,generic,[],f,'2026-11-05T01:00:00Z').status,'NO_PREMATCH','aucune projection après match');
eq(projectPlayerPoints(game,[],generic,[],f,now).status,'INSUFFICIENT','aucun chiffre quand source joueurs absente');
const frozen={at:'2026-11-03T23:00:00Z',player_points:projectPlayerPoints(game,boxes,generic,[],f,now)};
const finalGame={...game,status:'STATUS_FINAL',home:{...game.home,score:120},away:{...game.away,score:109}};
const box={...boxes[0],game_id:game.id,teams:{
 '1':{players:[{id:'100',points:29},{id:'101',points:10}]},
 '2':{players:[{id:'200',points:20},{id:'201',points:12}]}
}};
eq(evaluatePlayerPoints(finalGame,box,{...frozen,at:'2026-11-04T02:00:00Z'}),null,'snapshot post-tip rejeté');
const evaluated=evaluatePlayerPoints(finalGame,box,frozen);
ok(evaluated?.matched===4,'quatre joueurs réellement apparus évalués');
ok(evaluated.mae>=0&&evaluated.rmse>=evaluated.mae,'erreurs propres');
const summary=summarizePlayerPointsEvaluations([evaluated]);
eq(summary.games_evaluated,1,'évaluation historique');
eq(summary.players_evaluated,4,'quatre prévisions individuelles');
eq(summary.calibrated,false,'calibration non prétendue');
const sparse=projectPlayerPoints(game,boxes.slice(0,1),generic,[],f,now);
ok(sparse.home.players.every(x=>x.predicted_points_if_active===null),'1 match insuffisant');
console.log('ManiBetProMax player points : '+n+' assertions OK');