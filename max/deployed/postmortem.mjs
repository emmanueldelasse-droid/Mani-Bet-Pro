/** Retrospective diagnostics ONLY. Never produces or modifies a pre-match prediction. */
import {playerIdentity} from './identity.mjs';
const num=x=>typeof x==='number'&&Number.isFinite(x);
const rnd=(x,n=1)=>num(x)?Math.round(x*10**n)/10**n:null;
export function analyzeFailure(game,snapshot,playerSnapshot,box,history,analyzedAt=new Date().toISOString()){
 const f=snapshot?.forecast,tip=Date.parse(game?.start),at=Date.parse(snapshot?.at),now=Date.parse(analyzedAt);
 if(!String(game?.status).includes('FINAL')||!num(now)||now<tip||!num(at)||at>=tip||snapshot.game_id!==String(game.id)||
  !num(f?.probability_home)||f.probability_home<=0||f.probability_home>=1||!num(game.home.score)||!num(game.away.score)||game.home.score===game.away.score)return null;
 const expected=f.probability_home>=.5?'home':'away',winner=game.home.score>game.away.score?'home':'away';
 if(expected===winner)return null;
 const loser=winner==='home'?'away':'home',known=f.projected_score;
 const contaminated={};
 for(const side of ['home','away']){
  const xs=[...new Map((history??[]).filter(g=>g.id&&Date.parse(g.start)<tip&&num(g.home?.score)&&num(g.away?.score)&&
   [String(g.home.id),String(g.away.id)].includes(String(game[side].id))).map(g=>[String(g.id),g])).values()]
   .sort((a,b)=>b.start.localeCompare(a.start)).slice(0,10);
  contaminated[side]={observed:xs.length,preseason:xs.filter(g=>g.event_type==='PRESEASON').length,
   nonfinal:xs.filter(g=>!String(g.status).includes('FINAL')).length,scope:'RECONSTRUCTED_AT_AUDIT_NOT_EXACT_ARCHIVED_INPUT'};
 }
 if(!num(Date.parse(playerSnapshot?.at))||Date.parse(playerSnapshot.at)>=tip)playerSnapshot=null;
 const official=playerSnapshot?.official_injuries??[],nameIssues=[],surprises=[],keyAbsences=[];
 for(const side of ['home','away']){
  const real=new Map((box?.teams?.[String(game[side].id)]?.players??[]).map(p=>[String(p.id),p]));
  for(const p of playerSnapshot?.player_points?.[side]?.players??[]){
   const medical=official.find(x=>String(x.team_id)===String(game[side].id)&&playerIdentity(x.player)===playerIdentity(p.name));
   if(medical?.status==='OUT'&&p.projected_minutes_if_active>=15)keyAbsences.push({player:p.name,team:game[side].name,recent_minutes:p.projected_minutes_if_active,status:'OUT',source_url:medical.source_url,checked_at:medical.checked_at,actually_played:real.has(String(p.id))});
   if(medical?.status==='OUT'&&p.availability!=='OFFICIAL_OUT')nameIssues.push({player:p.name,medical_name:medical.player,stored_availability:p.availability,
    kind:'OFFICIAL_OUT_NOT_APPLIED_TO_PLAYER',played:real.has(String(p.id)),source_url:medical.source_url,checked_at:medical.checked_at});
   const actual=real.get(String(p.id));
   if(actual&&num(p.predicted_points_if_active)&&num(actual.points)&&Math.abs(actual.points-p.predicted_points_if_active)>=10){
    const projectedMinutes=p.projected_minutes_if_active;
    const minutesPart=num(projectedMinutes)&&projectedMinutes>0?p.predicted_points_if_active/projectedMinutes*(actual.minutes-projectedMinutes):null;
    surprises.push({player:p.name,team:game[side].name,predicted:p.predicted_points_if_active,actual:actual.points,
     projected_minutes:projectedMinutes,actual_minutes:actual.minutes,error: rnd(actual.points-p.predicted_points_if_active),
     minutes_component:rnd(minutesPart),remaining_rate_component:num(minutesPart)?rnd(actual.points-p.predicted_points_if_active-minutesPart):null,
     kind:'DESCRIPTIVE_DECOMPOSITION_NOT_CAUSAL'});
   }
  }
 }
 surprises.sort((a,b)=>Math.abs(b.error)-Math.abs(a.error));
 const winners=box?.teams?.[String(game[winner].id)],losers=box?.teams?.[String(game[loser].id)];
 const w=winners?.totals??{},l=losers?.totals??{},drivers=[];
 if(num(w.efg_pct)&&num(l.efg_pct)&&w.efg_pct-l.efg_pct>=5)drivers.push('Le vainqueur a eu '+rnd(w.efg_pct-l.efg_pct)+' points de pourcentage d’avance en adresse effective au tir.');
 if(num(w.oreb)&&num(l.oreb)&&w.oreb-l.oreb>=4)drivers.push('Le vainqueur a pris '+(w.oreb-l.oreb)+' rebonds offensifs de plus.');
 if(num(w.turnovers)&&num(l.turnovers)&&l.turnovers-w.turnovers>=3)drivers.push('Le vainqueur a perdu '+(l.turnovers-w.turnovers)+' ballons de moins.');
 if(num(w.fta)&&num(l.fta)&&w.fta-l.fta>=4)drivers.push('Le vainqueur a obtenu '+(w.fta-l.fta)+' tentatives de lancers francs supplémentaires.');
 const scorer=(winners?.players??[]).filter(p=>num(p.points)).sort((a,b)=>b.points-a.points)[0];
 if(scorer)drivers.push(scorer.name+' a marqué '+scorer.points+' points pour '+game[winner].name+'.');
 const p=100*Math.max(f.probability_home,1-f.probability_home),small=p<55;
 const reasons=[];
 if(small)reasons.push('Le signal était très faible ('+rnd(p,2)+' %) : le modèle ne dégageait pas un avantage net.');
 if(num(known?.home)&&num(known?.away)){
  const predicted=known[expected],actual=game[expected].score;
  reasons.push('Le favori '+game[expected].name+' était attendu à '+predicted+' points et en a marqué '+actual+' ('+rnd(actual-predicted)+' points d’écart).');
 }
 if(nameIssues.length)reasons.push(nameIssues.length+' statut(s) OUT officiel(s) n’avaient pas été appliqués au bon joueur dans la projection individuelle.');
 const old=f.engine_version==='max-quant-0.3.0';
 if(old&&(contaminated.home.preseason||contaminated.away.preseason))reasons.push('L’ancien moteur ne filtrait pas la présaison ; la fenêtre reconstruite en contient '+contaminated.away.preseason+' côté visiteur et '+contaminated.home.preseason+' côté domicile.');
 const missing=[...(!snapshot.source_provenance?['Provenance complète des entrées et état des bulletins non archivés dans ce relevé ancien']:[]),
  'Cinq majeurs et restrictions de minutes confirmés avant match non structurés',
  'Effet chiffré et validé des absences sur le score d’équipe absent du modèle',
  'Qualité des adversaires non corrigée, repos et déplacements non intégrés au modèle de score',
  ...(!snapshot.market_observation?['Cotes de marché observées avant match absentes de ce relevé']:[])];
 return {schema_version:'max-error-audit-v1',kind:'POSTMATCH_DIAGNOSTIC_NOT_PREDICTION',match_id:String(game.id),tip:game.start,
  analyzed_at:analyzedAt,teams:{home:game.home.name,away:game.away.name},favorite:game[expected].name,favorite_probability_pct:rnd(p,2),
  expected_score:known??null,actual_score:{home:game.home.score,away:game.away.score},winner:game[winner].name,
  pregame_at:snapshot.at,engine_version:f.engine_version??'UNRECORDED',player_version:playerSnapshot?.player_points?.version??'UNRECORDED',
  margin_error:num(known?.home)&&num(known?.away)?rnd(Math.abs((known.home-known.away)-(game.home.score-game.away.score))):null,
  diagnosis:reasons,observed_drivers:drivers.slice(0,3),individual_surprises:surprises.slice(0,3),
  archived_key_absences:keyAbsences.sort((a,b)=>b.recent_minutes-a.recent_minutes),confirmed_identity_errors:nameIssues,reconstructed_input_window:contaminated,missing_information:missing,
  medical_statuses_archived:official.length,primary_injury_adjustment:false,
  causal_attribution:'NON_DEMONTREE : les constats après match décrivent l’erreur, sans prouver qu’un facteur unique l’a causée ni qu’elle était évitable.',
  sources:{snapshot_key:snapshot.storage_key??'max:pre:'+game.id+':'+snapshot.checkpoint,player_snapshot_key:playerSnapshot?(playerSnapshot.storage_key??'max:pre:'+game.id+':'+playerSnapshot.checkpoint):null,
   boxscore:box?.source_url??null,public_game:'https://www.espn.com/nba/game/_/gameId/'+game.id},
  replaces_original:false,affects_success_rate:false};
}
