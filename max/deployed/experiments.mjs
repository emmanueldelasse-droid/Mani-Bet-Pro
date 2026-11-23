import {playerIdentity} from './identity.mjs';
/** Prospective rotation challenger. No primary prediction override; no retrospective performance claim. */
export const TRIAL_VERSION='max-rotation-shadow-0.1.0';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(x,n=3)=>finite(x)?Math.round(x*10**n)/10**n:null;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const norm=playerIdentity;
const normal=x=>{const t=1/(1+.2316419*Math.abs(x)),d=.3989422804*Math.exp(-x*x/2),p=1-d*t*(.319381530+t*(-.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p;};
export function validateRoleFacts(record,game,nowISO){
 const now=Date.parse(nowISO),tip=Date.parse(game?.start),published=Date.parse(record?.generated_at);
 if(!finite(now)||!finite(tip)||now>=tip||record?.match_id!==String(game.id)||!finite(published)||published>now||now-published>12*3600000)return [];
 const seen=new Set();
 return (Array.isArray(record.verified_role_facts)?record.verified_role_facts:[]).filter(f=>{
  const key=String(f?.team_id)+':'+String(f?.player_id),at=Date.parse(f?.checked_at);
  if(seen.has(key)||!f?.player||!f.player_id||f.match_id!==String(game.id)||f.event_start!==game.start||
   ![String(game.home.id),String(game.away.id)].includes(String(f.team_id))||!finite(at)||at>now||at>=tip||at>published+300000||now-at>12*3600000)return false;
  let host;try{host=new URL(f.source_url).hostname;}catch{return false;}
  if(!(host==='nba.com'||host.endsWith('.nba.com'))||!(record.sources??[]).some(s=>s.url===f.source_url&&s.kind==='OFFICIAL'&&Date.parse(s.checked_at)<=now&&now-Date.parse(s.checked_at)<=12*3600000))return false;
  if(f.minutes_limit!==undefined&&(!finite(f.minutes_limit)||f.minutes_limit<0||f.minutes_limit>48))return false;
  if(f.starter!==undefined&&typeof f.starter!=='boolean')return false;
  if(f.minutes_limit===undefined&&f.starter===undefined)return false;
  seen.add(key);return true;
 }).slice(0,30).map(f=>({match_id:String(game.id),event_start:game.start,team_id:String(f.team_id),player_id:String(f.player_id),player:String(f.player).slice(0,100),
  ...(finite(f.minutes_limit)?{minutes_limit:f.minutes_limit}:{}),...(typeof f.starter==='boolean'?{starter:f.starter}:{}),source_url:f.source_url,checked_at:f.checked_at}));
}
function teamTrial(game,side,boxes,roster,official,roles,nowISO){
 const id=String(game[side].id),at=Date.parse(nowISO);
 if(roster?.team_id!==id||!Array.isArray(roster.players)||!finite(Date.parse(roster.checked_at))||at-Date.parse(roster.checked_at)>36*3600000||Date.parse(roster.checked_at)>at)return {state:'UNAVAILABLE',reason:'CURRENT_ROSTER_UNVERIFIED'};
 const allowed=new Set(roster.players.map(p=>String(p.id))),unique=new Map();
 for(const b of boxes??[])if(b?.game_id&&Date.parse(b.start)<at&&b.teams?.[id]&&Array.isArray(b.teams[id].players))unique.set(String(b.game_id),b);
 const sample=[...unique.values()].sort((a,b)=>b.start.localeCompare(a.start)).slice(0,10);
 if(sample.length<5)return {state:'UNAVAILABLE',reason:'FEWER_THAN_FIVE_TEAM_BOXES',sample:sample.length};
 const rows=new Map();let minutes=0,totalMinutes=0;
 for(const b of sample){totalMinutes+=b.teams[id].minutes??0;
  for(const p of b.teams[id].players){if(!allowed.has(String(p.id))||!finite(p.minutes)||p.minutes<=0||!finite(p.points))continue;
   minutes+=p.minutes;const key=String(p.id);const a=rows.get(key)??{id:key,name:p.name,minutes:0,points:0,appearances:0,entries:[]};
   a.minutes+=p.minutes;a.points+=p.points;a.appearances++;a.entries.push({minutes:p.minutes,points:p.points});rows.set(key,a);
  }
 }
 const coverage=totalMinutes>0?minutes/totalMinutes:0;
 if(coverage<.85)return {state:'UNAVAILABLE',reason:'ROSTER_HISTORY_COVERAGE_BELOW_85_PERCENT',coverage:round(coverage),sample:sample.length};
 const statuses=new Map(official.filter(p=>String(p.team_id)===id).map(p=>[norm(p.player),p]));
 const teamRoles=new Map(roles.filter(p=>p.team_id===id).map(p=>[p.player_id,p]));
 const planned=[];let missing=0,lost=0;
 for(const p of rows.values()){
  const baseline=p.minutes/sample.length,rate=p.points/p.minutes,status=statuses.get(norm(p.name));
  const role=teamRoles.get(p.id),cap=finite(role?.minutes_limit)?role.minutes_limit:48;
  const out=status?.status==='OUT';
  // Already absent games contribute zero minutes: do not remove a second full absence.
  const target=out?0:Math.min(baseline,cap),removed=baseline-target;
  missing+=removed;lost+=removed*rate;
  planned.push({...p,entries:undefined,baseline_minutes:baseline,planned_minutes:target,ppm:rate,
   status:status?.status??'UNKNOWN',minutes_cap:cap,extra_minutes:0,removed_minutes:removed,
   minutes_limit_source:role?.source_url??null});
 }
 const candidates=planned.filter(p=>!['OUT','QUESTIONABLE','DOUBTFUL','LIMITED'].includes(p.status)&&p.appearances>=3&&p.baseline_minutes<30)
  .sort((a,b)=>b.baseline_minutes-a.baseline_minutes);
 let regained=0;
 for(const p of candidates){const extra=Math.max(0,Math.min(missing,8,42-p.planned_minutes,p.minutes_cap-p.planned_minutes));
  p.extra_minutes=extra;p.planned_minutes+=extra;missing-=extra;regained+=extra*p.ppm;
 }
 const maxShift=8,rawDelta=regained-lost;
 const delta=missing>.5?null:clamp(rawDelta,-maxShift,maxShift);
 const players=planned.map(p=>{
  const observed=rows.get(p.id).entries,conditionalMinutes=observed.reduce((s,x)=>s+x.minutes,0)/observed.length;
  const proposed=p.status==='OUT'?0:Math.min(42,p.minutes_cap,conditionalMinutes+p.extra_minutes);
  return {id:p.id,name:p.name,status:p.status,appearances:p.appearances,
   baseline_expected_minutes:round(p.baseline_minutes,2),planned_expected_minutes:round(p.planned_minutes,2),
   expected_extra_minutes:round(p.extra_minutes,2),minutes_if_active:round(proposed,2),
   points_if_active:p.appearances>=3?round(proposed*p.ppm,2):null,
   role_source:p.minutes_limit_source,conditional:true};
 });
 return {state:delta===null?'PARTIAL_UNALLOCATED_MINUTES':'CALCULATED_HYPOTHESIS',sample:sample.length,coverage:round(coverage),
  removed_minutes:round(planned.reduce((s,p)=>s+p.removed_minutes,0),2),unallocated_minutes:round(missing,2),
  score_delta:round(delta),raw_scoring_proxy:round(rawDelta),delta_cap:8,players,
  caveat:'Proxy de remplacement non causal ; plafonds 8 minutes par remplaçant, 42 par joueur, 8 points par équipe. Hypothèses à comparer prospectivement.'};
}
export function rotationTrial(game,boxes,rosters,official,roles,baseForecast,nowISO,medical=null){
 const now=Date.parse(nowISO),tip=Date.parse(game?.start);
 const base={version:TRIAL_VERSION,match_id:String(game?.id),captured_at:nowISO,calibrated:false,drives_primary_forecast:false,drives_bet:false};
 if(!finite(now)||!finite(tip)||now>=tip||game.status!=='STATUS_SCHEDULED')return {...base,state:'NO_PREMATCH'};
 if(baseForecast?.status!=='SIMULATED_UNCALIBRATED')return {...base,state:'UNAVAILABLE',reason:'BASE_FORECAST_UNAVAILABLE'};
 const eligible=(official??[]).filter(p=>p.match_id===String(game.id)&&p.event_start===game.start&&
  /^https:\/\/(ak-static\.cms\.nba\.com\/referee\/injury\/|official\.nba\.com\/nba-injury-report-)/.test(p.source_url??'')&&
  finite(Date.parse(p.checked_at))&&Date.parse(p.checked_at)<=now&&now-Date.parse(p.checked_at)<=12*3600000);
 const teams=Object.fromEntries(['home','away'].map(side=>[side,teamTrial(game,side,boxes,rosters.get(String(game[side].id)),eligible,roles,nowISO)]));
 const deltas=['home','away'].map(side=>teams[side].score_delta);
 if(!deltas.every(finite))return {...base,state:'UNAVAILABLE',teams,reason:'INCOMPLETE_ROTATION_EVIDENCE'};
 const deviations=['home','away'].map(side=>{const x=baseForecast.interval_80?.[side];return x?.length===2&&(x.every(finite))?(x[1]-x[0])/(2*1.282):null;});
 const score={home:round(baseForecast.projected_score.home+deltas[0],2),away:round(baseForecast.projected_score.away+deltas[1],2)};
 const variance=deviations.every(finite)?deviations[0]**2+deviations[1]**2-2*.0144*deviations[0]*deviations[1]:null;
 const probability=deltas.every(x=>x===0)?baseForecast.probability_home:variance>0?normal((score.home-score.away)/Math.sqrt(variance)):null;
 if(!finite(probability))return {...base,state:'UNAVAILABLE',teams,reason:'VARIANCE_UNAVAILABLE'};
 return {...base,state:'SHADOW_FORECAST',medical_complete:['home','away'].every(side=>medical?.teams?.[side]?.status==='SUBMITTED'),teams,forecast:{status:'SIMULATED_UNCALIBRATED',model:TRIAL_VERSION,
  engine_version:TRIAL_VERSION,method:'NORMAL_APPROXIMATION_NOT_MONTE_CARLO',simulated_runs:0,
  probability_home:round(clamp(probability,.001,.999),4),probability_away:round(1-clamp(probability,.001,.999),4),
  projected_score:score,calibrated:false},
  primary_forecast:structuredClone(baseForecast),
  qualification:'EXPÉRIENCE EN PARALLÈLE. Pas de supériorité ni calibration démontrée. Les incertains sont conditionnels, jamais transformés en probabilités médicales.'};
}
export function trialEvaluation(game,box,snapshot,primaryPlayerSnapshot=null){
 const trial=snapshot?.trial,at=Date.parse(snapshot?.at),tip=Date.parse(game?.start),p=trial?.forecast?.probability_home;
 if(!trial||trial.version!==TRIAL_VERSION||snapshot.game_id!==String(game.id)||trial.match_id!==String(game.id)||!finite(at)||at>=tip||!String(game.status).includes('FINAL')||!finite(p)||!finite(game.home.score)||!finite(game.away.score)||game.home.score===game.away.score)return null;
 const y=Number(game.home.score>game.away.score),base=trial.primary_forecast,players=[];
 if(box?.game_id===String(game.id))for(const side of ['home','away']){
  const observed=new Map((box.teams?.[String(game[side].id)]?.players??[]).map(p=>[String(p.id),p]));
  for(const p of trial.teams[side]?.players??[]){const real=observed.get(p.id);
   if(p.status==='OUT'||!real||!finite(p.points_if_active)||!finite(real.points))continue;
   const control=primaryPlayerSnapshot?.game_id===String(game.id)&&Date.parse(primaryPlayerSnapshot.at)<tip?primaryPlayerSnapshot.player_points?.[side]?.players?.find(x=>String(x.id)===p.id):null;
   players.push({id:p.id,team:side,predicted:p.points_if_active,observed:real.points,abs_error:round(Math.abs(p.points_if_active-real.points)),
    primary_abs_error:control?.availability!=='OFFICIAL_OUT'&&finite(control?.predicted_points_if_active)?round(Math.abs(control.predicted_points_if_active-real.points)):null,
    primary_minutes_abs_error:control?.availability!=='OFFICIAL_OUT'&&finite(control?.projected_minutes_if_active)&&finite(real.minutes)?round(Math.abs(control.projected_minutes_if_active-real.minutes)):null,
    minutes_abs_error:finite(real.minutes)?round(Math.abs(p.minutes_if_active-real.minutes)):null});
  }
 }
 const scoreError=f=>Math.abs(f.projected_score.home+f.projected_score.away-game.home.score-game.away.score);
 return {version:TRIAL_VERSION,game_id:String(game.id),pregame_at:snapshot.at,tip:game.start,
  primary_engine_version:base.engine_version??'UNRECORDED',medical_complete:trial.medical_complete===true,
  adjustment_applied:['home','away'].some(side=>Math.abs(trial.teams[side]?.score_delta??0)>.001),
  p_home:p,actual_home_win:y,correct:Number(p>=.5)===y,brier:round((p-y)**2,6),
  primary_correct:Number(base.probability_home>=.5)===y,primary_brier:round((base.probability_home-y)**2,6),
  total_abs_error:round(scoreError(trial.forecast)),primary_total_abs_error:round(scoreError(base)),players,
  prospective:true,calibrated:false};
}
export function trialSummary(rows){
 const valid=rows.filter(r=>r?.version===TRIAL_VERSION&&r.prospective===true&&Date.parse(r.pregame_at)<Date.parse(r.tip));
 const mean=x=>x.length?x.reduce((s,v)=>s+v,0)/x.length:null,players=valid.flatMap(r=>r.players??[]),pairedPlayers=players.filter(p=>finite(p.primary_abs_error)&&finite(p.abs_error)),changed=valid.filter(r=>r.adjustment_applied);
 return {version:TRIAL_VERSION,paired_games:valid.length,challenger_accuracy_pct:valid.length?round(100*mean(valid.map(r=>Number(r.correct)))):null,
  primary_accuracy_pct:valid.length?round(100*mean(valid.map(r=>Number(r.primary_correct)))):null,
  challenger_brier:round(mean(valid.map(r=>r.brier))),primary_brier:round(mean(valid.map(r=>r.primary_brier))),
  total_mae:round(mean(valid.map(r=>r.total_abs_error))),primary_total_mae:round(mean(valid.map(r=>r.primary_total_abs_error))),
  changed_games:changed.length,medical_complete_games:valid.filter(r=>r.medical_complete).length,
  changed_cases_comparison:{n:changed.length,challenger_brier:round(mean(changed.map(r=>r.brier))),primary_brier:round(mean(changed.map(r=>r.primary_brier)))},
  paired_player_comparison:{n:pairedPlayers.length,challenger_mae:round(mean(pairedPlayers.map(p=>p.abs_error))),primary_mae:round(mean(pairedPlayers.map(p=>p.primary_abs_error))),
   challenger_minutes_mae:round(mean(pairedPlayers.map(p=>p.minutes_abs_error).filter(finite))),primary_minutes_mae:round(mean(pairedPlayers.map(p=>p.primary_minutes_abs_error).filter(finite)))},
  players_evaluated:players.length,player_mae:round(mean(players.map(r=>r.abs_error))),
  minutes_mae:round(mean(players.map(r=>r.minutes_abs_error).filter(finite))),
  review_gate:{minimum_paired_games:100,ready_for_review:valid.length>=100,auto_promotion:false},
  calibrated:false,records:valid.slice(-120),state:valid.length?'PROSPECTIVE_COMPARISON':'WAITING_FOR_FIRST_FUTURE_RESULT'};
}
