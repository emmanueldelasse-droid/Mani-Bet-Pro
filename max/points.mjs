/**
 * ManiBetProMax · projections individuelles de points NBA.
 * Entrées: feuilles de match ESPN finales, pré-tip uniquement, blessures vérifiées séparément.
 * Sorties: projections conditionnelles SI LE JOUEUR PARTICIPE; modèle NON calibré.
 * Pas d'inférence des disponibilités officielles à partir d'un flux ESPN générique.
 */
export const POINTS_VERSION='max-player-points-0.2.0';
const round=(v,d=1)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sd=a=>a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/(a.length-1)):null;
const clip=(x,l,h)=>Math.min(h,Math.max(l,x));
const clean=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const time=s=>Date.parse(s);
const sum=a=>a.reduce((s,x)=>s+x,0);
function normalCdf(x){ // approximation polynomiale documentée; pas une probabilité calibrée
 const z=Math.abs(x),t=1/(1+0.2316419*z),k=0.3989422804*Math.exp(-z*z/2);
 const v=1-k*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
 return x>=0?v:1-v;
}
function recentBoxHistory(id,boxes,tip,now=tip){
 const cutoff=Math.min(time(tip),time(now)),unique=new Map();
 for(const box of Array.isArray(boxes)?boxes:[]){
  const started=time(box?.start),fetched=time(box?.fetched_at);
  if(!box?.game_id||!Number.isFinite(started)||started>=cutoff||
   !Array.isArray(box.teams?.[String(id)]?.players))continue;
  const key=String(box.game_id),prior=unique.get(key);
  if(!prior||(Number.isFinite(fetched)&&fetched>(time(prior.fetched_at)||0)))unique.set(key,box);
 }
 const a=[...unique.values()].sort((x,y)=>y.start.localeCompare(x.start)||
  String(x.game_id).localeCompare(String(y.game_id))).slice(0,12);
 const m=new Map();
 for(const b of a){
  const seen=new Set();
  for(const player of b.teams[String(id)].players){
   const playerId=String(player?.id??'');
   if(!playerId||seen.has(playerId)||!Number.isFinite(player.points)||
    player.points<0||!Number.isInteger(player.points)||
    !Number.isFinite(player.minutes)||player.minutes<=0||player.minutes>72)continue;
   seen.add(playerId);
   if(!m.has(playerId))m.set(playerId,[]);
   if(m.get(playerId).length<10)m.get(playerId).push({...player,id:playerId,
    game_id:String(b.game_id),start:b.start,source_url:b.source_url});
  }
 }
 return {games:a,players:m};
}
function sourceStatuses(injuries,verified){
 const status=new Map();
 for(const item of injuries??[]){
  if(!item?.player)continue;
  status.set(clean(item.player),{name:item.player,raw_status:String(item.status??'UNKNOWN'),
   official_for_game:false,source:'ESPN injury feed (non spécifique à ce match)',
   detail:String(item.detail??'').slice(0,180)});
 }
 for(const item of verified??[]){
  if(!item?.player||!['OUT','QUESTIONABLE','DOUBTFUL','AVAILABLE','PROBABLE','LIMITED'].includes(item.status))continue;
  status.set(clean(item.player),{name:item.player,raw_status:item.status,official_for_game:true,
   source:item.source_url,checked_at:item.checked_at,detail:item.note??''});
 }
 return status;
}
/**
 * Règle qualité : minimum 3 boxscores sur 10 matchs de l'équipe, et apparence
 * dans la fenêtre de 16 jours avant le tip. Si manque: afficher insuffisant, pas inventer.
 */
export function projectPlayerPoints(game,boxes,injuryReport,officialInjuries,teamForecast,now){
 const tip=time(game?.start),at=time(now);
 if(!Number.isFinite(tip)||!Number.isFinite(at)||at>=tip||
  !String(game.status).startsWith('STATUS_SCHEDULED'))
  return {status:'NO_PREMATCH',calibrated:false,home:[],away:[]};
 const projected=teamForecast?.status==='SIMULATED_UNCALIBRATED'?teamForecast.projected_score:null;
 const groups={};let totalProjectable=0;
 for(const [side,opponent] of [['home','away'],['away','home']]){
  const team=game[side],teamId=String(team?.id??'');
  const history=recentBoxHistory(teamId,boxes,game.start,now);
  const relevantOfficial=Array.isArray(officialInjuries)?officialInjuries.filter(x=>String(x.team_id)===teamId):[];
  const injuryEntries=Array.isArray(injuryReport?.[side])?injuryReport[side]:[];
  const statuses=sourceStatuses(injuryEntries,relevantOfficial);
  const teamScoreObserved=history.games.map(b=>b.teams[teamId]?.totals?.points)
   .filter(Number.isFinite);
  const expected=projected?.[side]??null,averageTeam=mean(teamScoreObserved);
  const teamAdjustment=Number.isFinite(expected)&&Number.isFinite(averageTeam)&&averageTeam>=75?
   clip(expected/averageTeam,0.92,1.08):1;
  const players=[];
  for(const [id,entries] of history.players){
   const last=entries[0];
   const days=(tip-time(last.start))/86400000;
   if(!Number.isFinite(days)||days>16||days<=0)continue;
   const measured=entries.filter(p=>Number.isFinite(p.points)&&Number.isFinite(p.minutes));
   const status=statuses.get(clean(last.name))??{raw_status:'NO_CURRENT_REPORT',
    official_for_game:false,source:'ESPN verified final boxscores'};
   const actual=measured.map(p=>p.points),mins=measured.map(p=>p.minutes);
   const last5=measured.slice(0,5),last3=measured.slice(0,3);
   const currentMinute=0.45*mean(last3.map(p=>p.minutes))+
    0.35*mean(last5.map(p=>p.minutes))+0.20*mean(mins);
   const enough=measured.length>=3;
   const effectiveMinutes=clip(currentMinute,1,42);
   const baseline=mean(last5.map(p=>p.points));
   const earlier=measured.slice(3);
   const roleChange=earlier.length>=3&&Math.abs(mean(last3.map(p=>p.minutes))-
    mean(earlier.map(p=>p.minutes)))>=5;
   const sampleQuality=!enough?'INSUFFICIENT':measured.length<5?'VERY_LOW':
    measured.length<10?'LOW':'LIMITED_HISTORY';
   const qualityWarnings=[...(measured.length<5?['FEWER_THAN_FIVE_APPEARANCES']:[]),
    ...(roleChange?['RECENT_MINUTES_CHANGED']:[]),
    ...((sd(mins)??0)>6?['UNSTABLE_PLAYING_TIME']:[])];
   const appeared=last.start;
   const ppm=measured.length?sum(actual)/sum(mins):null;
   const base=Number.isFinite(ppm)?ppm*effectiveMinutes*teamAdjustment:null;
   // Variabilité observée 10 rencontres et plancher conservateur pour le basket.
   const spread=base===null?null:clip(Math.max(3.5,sd(actual)??0,Math.sqrt(Math.max(0,base)*1.5)),3.5,25);
   const projectedPoints=enough&&base!==null?round(clip(base,0,55),1):null;
   const isOut=status.official_for_game&&status.raw_status==='OUT';
   const uncertain=status.official_for_game&&
    ['QUESTIONABLE','DOUBTFUL','LIMITED'].includes(status.raw_status);
   const interval=projectedPoints===null?null:[round(Math.max(0,projectedPoints-1.282*spread),0),
    round(Math.min(65,projectedPoints+1.282*spread),0)];
   const thresholds=projectedPoints===null?null:Object.fromEntries([10,15,20,25,30].map(t=>
    [String(t),round(1-normalCdf((t-0.5-projectedPoints)/spread),3)]));
   players.push({id,name:last.name,team_id:teamId,team_name:team.name,
    recent_games:measured.length,last_appearance:appeared,
    minutes_recent:round(mean(mins),1),
    projected_minutes_if_active:enough?round(effectiveMinutes,1):null,
    baseline_points_last5:enough?round(baseline,4):null,
    sample_quality:sampleQuality,quality_warnings:qualityWarnings,
    interval_calibration:'NOMINAL_80_NOT_EMPIRICALLY_CALIBRATED',
    historical_points_per_game:round(mean(actual),1),
    predicted_points_if_active:projectedPoints,
    predicted_points:isOut?0:projectedPoints,
    predicted_interval_80_if_active:interval,
    probability_points_at_least_if_active:thresholds,
    availability:isOut?'OFFICIAL_OUT':uncertain?'OFFICIAL_UNCERTAIN':
     status.official_for_game?'OFFICIALLY_LISTED':'NOT_CONFIRMED_FOR_THIS_GAME',
    reported_status:status.raw_status,official_for_game:status.official_for_game,
    injury_source:status.source,injury_note:status.detail??null,
    caution:!enough?'SAMPLE_TOO_SMALL':!status.official_for_game&&
     /out|day-to-day|questionable|doubtful/i.test(status.raw_status)?
      'ESPN_STATUS_NOT_CONFIRMED_FOR_THIS_GAME':null,
    scenarios:uncertain&&projectedPoints!==null?{
     available:{minutes:round(effectiveMinutes,1),points:projectedPoints},
     limited:{minutes:round(effectiveMinutes*0.6,1),points:round(projectedPoints*0.6,1)},
     out:{minutes:0,points:0},
     warning:'Scénarios conditionnels et non probabilités médicales'
    }:null,
    source_boxscores:measured.slice(0,3).map(x=>x.source_url).filter(Boolean),
    model:'scoring_rate_last10_times_blended_minutes_with_team_projection',
    calibrated:false});
  }
  players.sort((a,b)=>(b.predicted_points_if_active??-1)-(a.predicted_points_if_active??-1));
  const active=players.filter(p=>p.predicted_points_if_active!==null&&p.availability!=='OFFICIAL_OUT');
  totalProjectable+=active.length;
  const minutesCovered=round(sum(active.map(p=>p.projected_minutes_if_active??0)),1);
  groups[side]={team_id:teamId,team_name:team.name,opponent:game[opponent]?.name,
   boxscore_games:history.games.length,observed_team_points_avg:round(averageTeam,1),
   model_team_points_expected:Number.isFinite(expected)?expected:null,
   team_scoring_adjustment:round(teamAdjustment,3),
   forecast_label:'Conditionnel à la participation du joueur (non calibré)',
   projectable_players:active.length,
   minutes_covered:minutesCovered,
   coverage_status:history.games.length<3||active.length<5?'INSUFFICIENT':
    history.games.length>=6&&active.length>=8?'PARTIAL':'LIMITED',
   players:players.slice(0,18),
   sources:['ESPN verified final game summaries','MacFly official injury report if matched to this game']};
 }
 const bothTeamsCovered=['home','away'].every(side=>groups[side].coverage_status!=='INSUFFICIENT');
 const status=bothTeamsCovered?'PLAYER_PROJECTIONS_UNCALIBRATED':'INSUFFICIENT';
 return {schema_version:'max-player-points-v1',version:POINTS_VERSION,
  match_id:String(game.id),captured_at:now,status,calibrated:false,home:groups.home,away:groups.away,
  league_projection_mode:'Non-additive conditional scoring estimates',
  input_quality:{official_injuries_used:officialInjuries?.length??0,
   boxes:boxes.length,team_forecast:teamForecast?.status??'UNAVAILABLE'},
  caveats:['Projections conditionnelles si le joueur participe; disponibilité non garantie',
   'Un statut ESPN Out ne confirme PAS une absence pour ce match',
   'Cinq majeurs, minutes restreintes et éventuels transferts peuvent changer',
   'Les projections joueurs ne sont PAS indépendamment additives au total équipe',
   'Aucune probabilité étalonnée ni promesse de précision']};
}
export function evaluatePlayerPoints(game,box,snapshot){
 const published=time(snapshot?.at),tip=time(game?.start);
 if(!Number.isFinite(published)||!Number.isFinite(tip)||published>=tip||
  !String(game.status).includes('FINAL')||box?.game_id!==String(game.id)||
  !snapshot?.player_points)return null;
 if((snapshot.game_id&&String(snapshot.game_id)!==String(game.id))||
  (snapshot.player_points.match_id&&String(snapshot.player_points.match_id)!==String(game.id)))return null;
 const p=snapshot.player_points,rows=[],unmatched=[],availabilityErrors=[];
 for(const side of ['home','away']){
  const team=p[side],real=box.teams?.[String(game[side]?.id)];
  if(!real)continue;
  const observed=new Map(real.players.map(x=>[String(x.id),x]));
  for(const proj of team?.players??[]){
   const actual=observed.get(String(proj.id));
   if(proj.availability==='OFFICIAL_OUT'){
    if(actual&&Number.isFinite(actual.points))availabilityErrors.push({id:proj.id,
     name:proj.name,team:side,reason:'PREDICTED_ABSENT_BUT_PLAYED',points:actual.points});
    continue;
   }
   if(!Number.isFinite(proj.predicted_points_if_active))continue;
   if(!actual||!Number.isFinite(actual.points)||actual.points<0){
    unmatched.push({id:proj.id,name:proj.name,team:side,reason:'DID_NOT_PLAY_OR_MISSING'});
    continue; // erreur de présence mesurée séparément
   }
   const delta=round(proj.predicted_points_if_active-actual.points,2);
   rows.push({id:proj.id,name:proj.name,team:side,predicted:proj.predicted_points_if_active,
    observed:actual.points,error:delta,abs_error:round(Math.abs(delta),2),
    squared_error:round(delta*delta,4),coverage:proj.recent_games,
    baseline_points_last5:Number.isFinite(proj.baseline_points_last5)?proj.baseline_points_last5:null,
    baseline_abs_error:Number.isFinite(proj.baseline_points_last5)?
     Math.abs(proj.baseline_points_last5-actual.points):null});
  }
 }
 if(!rows.length)return null;
 return {schema_version:'max-player-evaluation-v1',game_id:String(game.id),
  pregame_at:snapshot.at,tip:game.start,matched:rows.length,unmatched_count:unmatched.length,
  mae:round(mean(rows.map(x=>x.abs_error)),3),
  rmse:round(Math.sqrt(mean(rows.map(x=>x.squared_error))),3),
  row_predictions:rows,unmatched:unmatched.slice(0,30),
  availability_errors:availabilityErrors.slice(0,30),availability_error_count:availabilityErrors.length,
  source:'ESPN final boxscore + immutable pregame player projection',
  warning:'MAE/RMSE uniquement parmi les joueurs effectivement entrés en jeu; taux de présence suivi séparément'};
}
export function summarizePlayerPointsEvaluations(records){
 const valid=records.filter(r=>r&&Number.isFinite(r.mae)&&r.matched>0);
 const rows=valid.flatMap(r=>r.row_predictions??[]);
 const paired=rows.filter(r=>Number.isFinite(r.baseline_abs_error)&&Number.isFinite(r.abs_error));
 return {schema_version:'max-player-evaluation-summary-v1',
  games_evaluated:valid.length,players_evaluated:rows.length,
  mae:round(mean(rows.map(r=>r.abs_error)),3),
  rmse:rows.length?round(Math.sqrt(mean(rows.map(r=>r.squared_error))),3):null,
  unmatched:valid.reduce((s,r)=>s+(r.unmatched_count||0),0),
  baseline_comparison:{paired_predictions:paired.length,
   model_mae:round(mean(paired.map(r=>r.abs_error)),3),
   last5_mean_mae:round(mean(paired.map(r=>r.baseline_abs_error)),3)},
  availability_error_count:valid.reduce((s,r)=>s+(r.availability_error_count||0),0),
  calibrated:false,last_updated:new Date().toISOString(),
  records:valid.slice(-60),warning:'Évaluation prospective avant match. Les prédictions conditionnelles sont non calibrées.'};
}


/** Retrospective walk-forward audit. Never advertised as a live pregame backtest.
 * The dataset was acquired later; only scoring/minutes history is replayed.
 * No historical injury report, team forecast or roster announcement is inferred.
 */
export function playerAuditInputSignature(boxes){
 let hash=2166136261>>>0;
 const data=(Array.isArray(boxes)?boxes:[]).filter(b=>b?.game_id).map(b=>({
  id:String(b.game_id),start:b.start,
  teams:Object.keys(b.teams??{}).sort().map(id=>[id,(b.teams[id].players??[])
   .map(p=>[String(p.id),p.minutes,p.points]).sort((a,b)=>a[0].localeCompare(b[0]))])
 })).sort((a,b)=>a.id.localeCompare(b.id));
 for(const c of JSON.stringify([POINTS_VERSION,data]))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
 return hash.toString(16).padStart(8,'0')+'-'+data.length;
}
export function auditPlayerHistory(boxes,now){
 const stamp=time(now),seen=new Map();
 for(const box of Array.isArray(boxes)?boxes:[]){
  if(!box?.game_id||!Number.isFinite(time(box.start))||time(box.start)>=stamp||
   !box.teams?.[box.home_id]||!box.teams?.[box.away_id])continue;
  seen.set(String(box.game_id),box);
 }
 const ordered=[...seen.values()].sort((a,b)=>a.start.localeCompare(b.start)).slice(-150);
 const rows=[],games=new Set();
 let testedGames=0;
 for(const target of ordered){
  const cutoff=time(target.start)-6*3600000;
  // Discard fetch time ONLY in this explicitly retrospective experiment.
  const training=ordered.filter(b=>time(b.start)<cutoff).map(b=>({...b,fetched_at:null}));
  if(training.length<3)continue;
  const game={id:String(target.game_id),start:target.start,status:'STATUS_SCHEDULED',
   home:{id:target.home_id,name:String(target.home_id)},away:{id:target.away_id,name:String(target.away_id)}};
  const prediction=projectPlayerPoints(game,training,{home:[],away:[]},[],null,
   new Date(cutoff).toISOString());
  testedGames++;
  for(const side of ['home','away']){
   const actual=new Map((target.teams[game[side].id]?.players??[]).map(p=>[String(p.id),p]));
   for(const p of prediction[side]?.players??[]){
    const y=actual.get(String(p.id));
    if(!Number.isFinite(p.predicted_points_if_active)||!Number.isFinite(p.baseline_points_last5)||
     !y||!Number.isFinite(y.points)||y.points<0||!Number.isFinite(y.minutes)||y.minutes<=0)continue;
    const delta=p.predicted_points_if_active-y.points;
    const interval=p.predicted_interval_80_if_active;
    rows.push({abs_error:Math.abs(delta),squared_error:delta*delta,
     baseline_abs_error:Math.abs(p.baseline_points_last5-y.points),
     covered:Array.isArray(interval)&&y.points>=interval[0]&&y.points<=interval[1]});
    games.add(target.game_id);
   }
  }
 }
 return {schema_version:'max-player-history-audit-v1',model_version:POINTS_VERSION,
  computed_at:now,input_signature:playerAuditInputSignature(ordered),
  kind:'RETROSPECTIVE_REPLAY_NOT_PROSPECTIVE',calibrated:false,
  status:rows.length<100||games.size<20?'INSUFFICIENT_EVIDENCE':'EXPLORATORY_COMPARISON',
  scope:'Base player points model without team adjustment, injury news or live roster knowledge',
  input_boxes:ordered.length,tested_games:testedGames,evaluated_games:games.size,
  paired_predictions:rows.length,
  model_mae:round(mean(rows.map(r=>r.abs_error)),3),
  model_rmse:round(Math.sqrt(mean(rows.map(r=>r.squared_error))??NaN),3),
  baseline_last5_mean_mae:round(mean(rows.map(r=>r.baseline_abs_error)),3),
  interval_80_observed_coverage:rows.length?round(rows.filter(r=>r.covered).length/rows.length,4):null,
  warning:'Échantillon sélectionné et collecté après les matchs. Comparaison rétrospective du modèle de base uniquement; aucune supériorité ou calibration démontrée.'};
}
