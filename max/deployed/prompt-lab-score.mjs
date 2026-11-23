import {evaluateStudyGame} from './evaluation-study.mjs';

const losses = {brier:'brier', total_mae:'total_error', minutes_mae:'minutes_error',
  player_mae:'error', production_mae:'production_error'};
const playerMetrics = new Set(['minutes_mae','player_mae','production_mae']);
const utc = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const rounded = value => Number.isFinite(value) ? Number(value.toFixed(6)) : null;
const sessions = db => db.withSession ? db.withSession('first-primary') : db;
const dbClock = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const targetFor = (exp,id) => (exp?.targets??[]).find(t=>String(t.match_id)===String(id));
const versionOf = snapshot => snapshot?.forecast?.engine_version;
const isProbability = x => Number.isFinite(x) && x>=0 && x<=1;

function pairingIssue(game,expected,primary,control,variant) {
  const arms=[primary,control,variant];
  if(arms.some(a=>!a))return 'MISSING_ARM';
  if(arms.some(a=>String(a.game_id)!==String(game.id)))return 'WRONG_MATCH';
  if(arms.some(a=>utc(a.at)!==expected))return 'DIFFERENT_INSTANT';
  if(!primary.input_id || arms.some(a=>a.input_id!==primary.input_id))return 'DIFFERENT_BACKGROUND_INPUTS';
  if(!versionOf(primary)||!versionOf(control)||versionOf(control)!==versionOf(variant))return 'DIFFERENT_ENGINE';
  if(arms.some(a=>!isProbability(a.forecast?.probability_home)||
    !['home','away'].every(side=>Number.isFinite(a.forecast?.projected_score?.[side])&&a.forecast.projected_score[side]>=0)))
    return 'FORECAST_UNAVAILABLE';
  return null;
}
function metricProjection(snapshot,metric){
  if(!snapshot)return null;
  if(metric==='brier')return snapshot.forecast?.probability_home??null;
  if(metric==='total_mae')return snapshot.forecast.projected_score.home+snapshot.forecast.projected_score.away;
  return ['away','home'].flatMap(side=>(snapshot.player_points?.[side]?.players??[]).map(p=>{
    const out=p.status==='OUT'||p.availability==='OFFICIAL_OUT';
    const minutes=out?0:(p.projected_minutes_if_active??p.minutes_if_active??null);
    const points=out?0:(p.predicted_points_if_active??p.points_if_active??null);
    return [side,String(p.id),metric==='minutes_mae'?minutes:metric==='player_mae'?points:minutes>0&&points!==null?points/minutes:null];
  })).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
}

const verifiedStatuses = new Set(['AVAILABLE','OUT','QUESTIONABLE','DOUBTFUL','PROBABLE','LIMITED']);
function playerChanges(control,variant){
  function players(snap){
    const map=new Map();
    for(const side of ['home','away'])for(const p of snap?.player_points?.[side]?.players??[]){
      const out=p.availability==='OFFICIAL_OUT'||p.status==='OUT', status=p.status??p.reported_status;
      const known=verifiedStatuses.has(status) && (p.availability==null || p.availability.startsWith('OFFICIAL'));
      map.set(side+':'+p.id,{id:String(p.id),name:p.name??null,team_id:String(p.team_id??side),
        status:known?status:null,minutes:out?0:p.projected_minutes_if_active??p.minutes_if_active??null,
        points:out?0:p.predicted_points_if_active??p.points_if_active??null});
    }
    return map;
  }
  const c=players(control),v=players(variant),examples=[];
  let changedStatus=0,changedMinutes=0,changedPoints=0;
  for(const [key,right] of v){
    const left=c.get(key);if(!left)continue;
    const status=left.status!==right.status,minutes=left.minutes!==right.minutes,points=left.points!==right.points;
    if(status)changedStatus++;if(minutes)changedMinutes++;if(points)changedPoints++;
    if(status||minutes||points)examples.push({player_id:right.id,name:right.name,team_id:right.team_id,
      before:{status:left.status,minutes:left.minutes,points:left.points},after:{status:right.status,minutes:right.minutes,points:right.points}});
  }
  return {control_verified:[...c.values()].filter(p=>p.status).length,variant_verified:[...v.values()].filter(p=>p.status).length,
    changed_status:changedStatus,changed_minutes:changedMinutes,changed_points:changedPoints,examples};
}

// The caller computes three arms from one immutable context. Only the new prompt facts
// can differ between control and variant. Missing arms are visible and never backfilled.
export async function capturePromptPair(db,{experiment,game,primary,control=primary,variant,
  receipt_ids=[],facts=[],delivery_key,asOf=primary?.at}) {
  const match=String(game?.id),target=targetFor(experiment,match),tip=utc(game?.start),at=utc(asOf);
  if(!target || !at || !tip || utc(target.tip)!==tip || game.status!=='STATUS_SCHEDULED' ||
      at<utc(experiment.created_at??experiment.received_at) || at>=tip) return null;
  const invalidFact=facts.some(f=>['received_at','checked_at','published_at'].some(k=>f[k]!=null&&(!utc(f[k])||utc(f[k])>at))||
    (f.match_id!=null&&String(f.match_id)!==match));
  const exclusion=invalidFact?'INVALID_EXPERIMENT_FACT':pairingIssue(game,at,primary,control,variant);
  const changed=!exclusion && JSON.stringify(metricProjection(control,experiment.metric))!==JSON.stringify(metricProjection(variant,experiment.metric));
  const key=String(delivery_key??at);
  if(!key || key.length>512)throw Error('INVALID_PROMPT_PAIR_KEY');
  const effects=exclusion?null:playerChanges(control,variant);
  const data={primary,control,variant,exclusion,changed,effects,receipt_ids:[...new Set(receipt_ids)],facts};
  const store=sessions(db);
  const [,read]=await store.batch([
    store.prepare(`INSERT INTO prompt_lab_pairs(experiment_id,match_id,tip,as_of,delivery_key,payload)
      SELECT ?,?,?,?,?,? WHERE ?<=${dbClock} AND ${dbClock}<? AND EXISTS
      (SELECT 1 FROM prompt_lab_experiments e WHERE e.id=? AND e.status='ACTIVE' AND e.created_at<=?
       AND EXISTS (SELECT 1 FROM json_each(e.plan_json,'$.targets') t
         WHERE CAST(json_extract(t.value,'$.match_id') AS TEXT)=? AND json_extract(t.value,'$.tip')=?))
      ON CONFLICT(experiment_id,match_id,delivery_key) DO NOTHING`)
      .bind(experiment.id,match,tip,at,key,JSON.stringify(data),at,tip,experiment.id,at,match,tip),
    store.prepare('SELECT id,as_of,integrated_at FROM prompt_lab_pairs WHERE experiment_id=? AND match_id=? AND delivery_key=?')
      .bind(experiment.id,match,key)
  ]);
  return read.results[0]??null;
}

function pairedCases(exp,game,box,pair) {
  if(pair.exclusion)return {issue:pair.exclusion,cases:[]};
  const find=(primary)=>evaluateStudyGame({game,box,pair:{primary,variant:pair.variant}});
  const reference=find(pair.primary),sameEngine=find(pair.control);
  if(!reference||!sameEngine||reference.exclusion||sameEngine.exclusion)
    return {issue:reference?.exclusion??sameEngine?.exclusion??'INVALID_FINAL',cases:[]};
  const metric=exp.metric,key=losses[metric];
  if(!key)return {issue:'UNKNOWN_ENDPOINT',cases:[]};
  const readings=(a,b)=>[a.primary[key],b.primary[key],b.variant[key]];
  if(!playerMetrics.has(metric))return {cases:[readings(reference,sameEngine).map(Math.abs)]};
  if(!box)return {issue:'AWAITING_BOXSCORE',cases:[]};
  // Both comparisons use the intersection of players and available losses in all three arms.
  const id=p=>p.team_id+':'+p.id;
  const refs=new Map(reference.players.rows.map(p=>[id(p),p]));
  const cases=[];
  for(const p of sameEngine.players.rows){
    const r=refs.get(id(p));if(!r)continue;
    const values=readings(r,p);if(values.every(Number.isFinite))cases.push(values.map(Math.abs));
  }
  return {issue:cases.length?null:'NO_COMMON_PLAYER_OBSERVATIONS',cases};
}

export async function settlePromptGame(db,game,box,asOf=new Date().toISOString()){
  const at=utc(asOf),tip=utc(game?.start),observed=utc(game?.fetched_at??asOf);
  if(!tip || !at || !observed || !game?.id || !String(game.status).includes('FINAL') || observed<=tip ||
    observed>at || Date.parse(at)>Date.now()+1000 || !['home','away'].every(s=>Number.isInteger(game[s]?.score)&&game[s].score>=0) ||
    game.home.score===game.away.score)return;
  if(box && (String(box.game_id)!==String(game.id)||!utc(box.fetched_at)||utc(box.fetched_at)>at||utc(box.fetched_at)<=tip))box=null;
  const store=sessions(db),match=String(game.id);
  const selected=await store.prepare(`SELECT p.*,e.plan_json FROM prompt_lab_pairs p JOIN prompt_lab_experiments e ON e.id=p.experiment_id
    WHERE p.match_id=? AND p.id=(SELECT q.id FROM prompt_lab_pairs q
      WHERE q.experiment_id=p.experiment_id AND q.match_id=p.match_id AND q.integrated_at<p.tip
      ORDER BY q.as_of DESC,q.id DESC LIMIT 1) AND e.status='ACTIVE'`).bind(match).all();
  for(const row of selected.results){
    const exp=JSON.parse(row.plan_json),pair=JSON.parse(row.payload);
    const {cases,issue}=tip===row.tip?pairedCases(exp,game,box,pair):{cases:[],issue:'RESCHEDULED'};
    const totals=[0,0,0];
    for(const values of cases)for(let i=0;i<3;i++)totals[i]+=values[i];
    const payload={cases:cases.length,totals,issue:issue??null,changed:pair.changed,extra_fact_count:pair.facts.length};
    await store.prepare(`INSERT INTO prompt_lab_outcomes(experiment_id,match_id,pair_id,tip,observed_at,box_available,payload)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(experiment_id,match_id) DO UPDATE SET
      pair_id=excluded.pair_id,observed_at=excluded.observed_at,box_available=excluded.box_available,payload=excluded.payload
      WHERE excluded.box_available>=prompt_lab_outcomes.box_available AND excluded.observed_at>=prompt_lab_outcomes.observed_at`)
      .bind(row.experiment_id,match,row.id,tip,observed,Number(Boolean(box)),JSON.stringify(payload)).run();
  }
}

function interval(daily,reference,total,gain){
  // Cluster the paired differences by game date; ten players in one match are not ten independent matches.
  if(daily.size<20 || !total)return null;
  let residual=0;
  for(const day of daily.values())residual+=(day.totals[reference]-day.totals[2]-day.cases*gain)**2;
  const margin=2.1*Math.sqrt(daily.size/(daily.size-1)*residual)/total;
  return [rounded(gain-margin),rounded(gain+margin)];
}
export function summarizePromptScore(experiment,captures=[],outcomes=[],asOf=new Date().toISOString()){
  const targets=experiment.targets??[],byTarget=new Set(targets.map(t=>String(t.match_id)));
  const byId=new Map(outcomes.filter(r=>byTarget.has(String(r.match_id))).map(r=>[String(r.match_id),r]));
  const captured=new Map(captures.filter(r=>byTarget.has(String(r.match_id))).map(r=>[String(r.match_id),r]));
  const exclusions={},totals=[0,0,0],daily=new Map();
  let cases=0, games=0;
  for(const row of byId.values()){
    const data=row.payload;
    if(data.issue || !data.cases){const why=data.issue??'NO_PAIRED_CASES';exclusions[why]=(exclusions[why]??0)+1;continue;}
    const day=utc(row.tip).slice(0,10),block=daily.get(day)??{cases:0,totals:[0,0,0]};
    for(let i=0;i<3;i++){totals[i]+=data.totals[i];block.totals[i]+=data.totals[i];}
    block.cases+=data.cases;daily.set(day,block);cases+=data.cases;games++;
  }
  const metric=experiment.metric,criterion=experiment.criterion??experiment;
  const minimumGain=criterion.min_gain??criterion.minimum_gain,minGames=criterion.min_games,minDates=Math.max(20,criterion.min_dates??20);
  const means=totals.map(v=>cases?v/cases:null);
  const gain=cases?means[1]-means[2]:null,vsPrimary=cases?means[0]-means[2]:null;
  const ci=interval(daily,1,cases,gain),ciRef=interval(daily,0,cases,vsPrimary);
  const scored=[...captured.values()];
  const changed=scored.filter(r=>r.changed).length,extra=scored.reduce((n,r)=>n+r.extra_fact_count,0);
  const researched=scored.filter(r=>(r.ever_received??r.receipt_count)>0);
  const noFinding=researched.filter(r=>(r.ever_had_facts??r.extra_fact_count)===0).length;
  const effects={control_verified:0,variant_verified:0,changed_status:0,changed_minutes:0,changed_points:0};
  for(const row of scored)for(const k of Object.keys(effects))effects[k]+=row.effects?.[k]??0;
  const byMatch=targets.map(t=>{const c=captured.get(String(t.match_id)),r=byId.get(String(t.match_id));
    return {match_id:String(t.match_id),tip:t.tip,captured_at:c?.integrated_at??null,changed:c?.changed??null,
      extra_fact_count:c?.extra_fact_count??0,supplement_receipts:c?.receipt_count??0,player_changes:c?.effects??null,evaluated_cases:r?.payload.cases??0,exclusion:r?.payload.issue??c?.exclusion??null};});
  const horizon=Math.max(...targets.map(t=>Date.parse(t.tip)),Date.parse(experiment.cohort?.end??0)||0);
  const all=targets.length>0&&games===targets.length,grace=horizon+72*3600000;
  let decision='POURSUIVRE',reason='Collecte des prévisions et des résultats sur les matchs annoncés.';
  if(Date.parse(asOf)>=horizon && (all || Date.parse(asOf)>=grace)){
    decision='ABANDONNER';
    if(!all)reason='Échéance atteinte. Des matchs ciblés restent sans comparaison complète.';
    else if(games<minGames || daily.size<minDates)reason='Étude terminée avec trop peu de matchs ou de dates indépendantes pour proposer une adoption.';
    else if(!changed)reason='La consigne a laissé les projections de la métrique choisie identiques sur toute la cohorte.';
    else if(ci && ci[0]>0 && ci[0]>=minimumGain && ciRef && ciRef[0]>=0){
      decision='PROPOSER_ADOPTION';reason='Le gain apparié dépasse le seuil prévu, y compris à la borne basse. La comparaison au principal ne montre pas de dégradation à cette borne.';
    }else reason='Le gain minimal et la comparaison au principal ne sont pas simultanément établis sur la cohorte terminée.';
  }else if(Date.parse(asOf)>=horizon)reason='Les matchs ont commencé. Les scores et feuilles de match manquants sont attendus pendant 72 heures.';
  return {metric,primary:rounded(means[0]),control:rounded(means[1]),variant:rounded(means[2]),gain:rounded(gain),
    gain_vs_primary:rounded(vsPrimary),interval_95:ci,interval_vs_primary_95:ciRef,
    minimum_gain:minimumGain,min_games:minGames,min_dates:minDates,target_count:targets.length,forecast_games:captured.size,
    researched_games:researched.length,no_finding_games:noFinding,games_without_supplement:targets.length-researched.length,
    closed_games:byId.size,evaluated_games:games,evaluated_cases:cases,evaluated_dates:daily.size,
    missing_games:targets.length-games,changed_games:changed,extra_fact_count:extra,player_changes:effects,exclusions,matches:byMatch,
    player_scope:playerMetrics.has(metric)?'Joueurs effectivement entrés, avec valeur mesurable dans les trois prévisions.':null,
    assessment_after:Number.isFinite(horizon)?new Date(horizon).toISOString():null,
    grace_end:Number.isFinite(grace)?new Date(grace).toISOString():null,
    decision,reason,adoption_applied:false};
}

export async function readPromptScore(db,experiment,asOf=new Date().toISOString()){
  if(experiment.decision_json && experiment.status!=='ACTIVE'){
    const closed=typeof experiment.decision_json==='string'?JSON.parse(experiment.decision_json):experiment.decision_json;
    if(closed?.score?.metric)return closed.score;
    if(closed?.metric)return closed;
  }
  const store=sessions(db);
  const [pairs,rows]=await store.batch([
    store.prepare(`SELECT p.match_id,p.integrated_at,json_extract(p.payload,'$.changed') AS changed,
      (SELECT MAX(json_array_length(h.payload,'$.receipt_ids')) FROM prompt_lab_pairs h WHERE h.experiment_id=p.experiment_id AND h.match_id=p.match_id) AS ever_received,
      (SELECT MAX(json_array_length(h.payload,'$.facts')) FROM prompt_lab_pairs h WHERE h.experiment_id=p.experiment_id AND h.match_id=p.match_id) AS ever_had_facts,
      json_array_length(p.payload,'$.facts') AS extra_fact_count,json_array_length(p.payload,'$.receipt_ids') AS receipt_count,json_extract(p.payload,'$.exclusion') AS exclusion,
      json_extract(p.payload,'$.effects') AS effects
      FROM prompt_lab_pairs p WHERE p.experiment_id=? AND p.id=(SELECT q.id FROM prompt_lab_pairs q
        WHERE q.experiment_id=p.experiment_id AND q.match_id=p.match_id ORDER BY q.as_of DESC,q.id DESC LIMIT 1)`).bind(experiment.id),
    store.prepare('SELECT match_id,tip,payload FROM prompt_lab_outcomes WHERE experiment_id=? ORDER BY tip,match_id').bind(experiment.id)]);
  return summarizePromptScore(experiment,pairs.results.map(r=>({...r,changed:Boolean(r.changed),effects:r.effects?JSON.parse(r.effects):null})),rows.results.map(r=>({...r,payload:JSON.parse(r.payload)})),asOf);
}
