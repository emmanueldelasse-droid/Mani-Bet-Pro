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

function comparisonIssue(game,at,left,right,requireSameEngine) {
  if(!left||!right)return 'MISSING_ARM';
  const arms=[left,right];
  if(arms.some(s=>String(s.game_id)!==String(game.id)))return 'WRONG_MATCH';
  if(arms.some(s=>utc(s.at)!==at))return 'DIFFERENT_INSTANT';
  if(arms.some(s=>typeof s.input_id!=='string'||!s.input_id))return 'UNVERIFIED_INPUTS';
  if(left.input_id!==right.input_id)return 'DIFFERENT_BACKGROUND_INPUTS';
  if(arms.some(s=>!versionOf(s)))return 'UNVERIFIED_ENGINE';
  if(requireSameEngine && (versionOf(left)!==versionOf(right) || left.model_version!==right.model_version))return 'DIFFERENT_ENGINE';
  if(arms.some(s=>!isProbability(s.forecast.probability_home)||
    !['home','away'].every(side=>Number.isFinite(s.forecast.projected_score?.[side])&&s.forecast.projected_score[side]>=0)))
    return 'FORECAST_UNAVAILABLE';
  return null;
}

const positiveValue=x=>Number.isFinite(x)&&x>=0;
const verifiedStatuses = new Set(['AVAILABLE','OUT','QUESTIONABLE','DOUBTFUL','PROBABLE','LIMITED']);
function playerArm(snap,targets) {
  const out=new Map();
  for(const side of ['home','away'])for(const p of snap?.player_points?.[side]?.players??[]){
    if(p.id==null || (targets && !targets.has(String(p.id))))continue;
    const absent=p.availability==='OFFICIAL_OUT'||p.status==='OUT';
    const minutes=absent?0:p.projected_minutes_if_active??p.minutes_if_active;
    const points=absent?0:p.predicted_points_if_active??p.points_if_active;
    const status=p.status??p.reported_status;
    const known=verifiedStatuses.has(status) && (p.availability==null || p.availability.startsWith('OFFICIAL'));
    out.set(side+':'+p.id,{side,id:String(p.id),name:p.name??null,team_id:p.team_id==null?null:String(p.team_id),
      status:known?status:null,minutes:positiveValue(minutes)?minutes:null,points:positiveValue(points)?points:null});
  }
  return out;
}
function playerValue(p,metric) {
  if(!p)return null;
  if(metric==='minutes_mae')return positiveValue(p.minutes)?p.minutes:null;
  if(metric==='player_mae')return positiveValue(p.points)?p.points:null;
  return positiveValue(p.points)&&positiveValue(p.minutes)&&p.minutes>0?p.points/p.minutes:null;
}
function projectedCases(metric,control,variant,selected) {
  if(!playerMetrics.has(metric)){
    const value=s=>metric==='brier'?s.forecast.probability_home:s.forecast.projected_score.home+s.forecast.projected_score.away;
    return {eligible:1,changed:value(control)!==value(variant),ineligible:0};
  }
  const c=playerArm(control,selected),v=playerArm(variant,selected);
  let eligible=0,changed=false;
  for(const [id,p] of c){
    const l=playerValue(p,metric),r=playerValue(v.get(id),metric);
    if(l==null||r==null)continue;
    eligible++;
    if(l!==r)changed=true;
  }
  const universe=selected?.size??new Set([...c.keys(),...v.keys()]).size;
  return {eligible,ineligible:Math.max(0,universe-eligible),changed};
}
const targetIds=target=>Array.isArray(target?.player_ids)?new Set(target.player_ids.map(String)):null;
const pairingTrace=(primary,control,variant)=>({
  primary_at:primary?.at??null,control_at:control?.at??null,variant_at:variant?.at??null,
  primary_engine:primary?.model_version??versionOf(primary)??null,
  control_engine:control?.model_version??versionOf(control)??null,
  variant_engine:variant?.model_version??versionOf(variant)??null,
  common_input_id:control?.input_id&&control.input_id===variant?.input_id?control.input_id:null,
  control_input_id:control?.input_id??null,variant_input_id:variant?.input_id??null
});
function playerChanges(control,variant,selected){
  const c=playerArm(control,selected),v=playerArm(variant,selected),examples=[];
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
function nominatedComparisons(ids,control,variant){
  if(!ids)return [];
  const c=playerArm(control,ids),v=playerArm(variant,ids);
  const find=(map,id)=>map.get('home:'+id)??map.get('away:'+id);
  const projection=p=>p?{minutes:p.minutes,points:p.points,status:p.status}:null;
  return [...ids].map(player_id=>{
    const left=find(c,player_id),right=find(v,player_id);
    return {player_id,name:left?.name??right?.name??null,team_id:left?.team_id??right?.team_id??null,
      control:projection(left),variant:projection(right)};
  });
}
function observedPlayers(ids,box){
  if(!ids || !box)return [];
  return Object.entries(box.teams??{}).flatMap(([team_id,team])=>(team.players??[])
    .filter(p=>ids.has(String(p.id))).map(p=>({player_id:String(p.id),team_id,name:p.name??null,
      minutes:positiveValue(p.minutes)?p.minutes:null,points:positiveValue(p.points)?p.points:null})));
}

// The caller computes three arms from one immutable context. Only the new prompt facts
// can differ between control and variant. Missing arms are visible and never backfilled.
export async function capturePromptPair(db,{experiment,game,primary,control=primary,variant,
  receipt_ids=[],facts=[],delivery_key,input_exclusion=null,asOf=control?.at??primary?.at}) {
  const match=String(game?.id),target=targetFor(experiment,match),tip=utc(game?.start),at=utc(asOf);
  if(!target || !at || !tip || utc(target.tip)!==tip || game.status!=='STATUS_SCHEDULED' ||
      at<utc(experiment.created_at??experiment.received_at) || at>=tip) return null;
  const invalidFact=facts.some(f=>['received_at','checked_at','published_at'].some(k=>f[k]!=null&&(!utc(f[k])||utc(f[k])>at))||
    (f.match_id!=null&&String(f.match_id)!==match));
  const ids=targetIds(target);
  const exclusion=input_exclusion??(invalidFact?'INVALID_EXPERIMENT_FACT':comparisonIssue(game,at,control,variant,true));
  const reference_issue=input_exclusion??comparisonIssue(game,at,primary,variant,false);
  const eligible=exclusion?{eligible:0,ineligible:ids?.size??0,changed:false}:projectedCases(experiment.metric,control,variant,ids);
  const changed=eligible.changed;
  const key=String(delivery_key??at);
  if(!key || key.length>512)throw Error('INVALID_PROMPT_PAIR_KEY');
  const effects=exclusion?null:playerChanges(control,variant,ids);
  const data={primary,control,variant,trace:pairingTrace(primary,control,variant),eligible,exclusion,reference_issue,changed,effects,
    player_comparisons:nominatedComparisons(ids,control,variant),receipt_ids:[...new Set(receipt_ids)],facts};
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

function addObservation(out,control,variant,reference) {
  out.cases++;out.totals[1]+=control;out.totals[2]+=variant;
  if(Number.isFinite(reference)){out.reference_cases++;out.totals[0]+=reference;out.reference_variant_total+=variant;}
}
function pairedCases(exp,game,box,pair,metric) {
  const out={cases:0,totals:[0,0,0],reference_cases:0,reference_variant_total:0,case_exclusions:{},issue:pair.exclusion??null};
  if(out.issue)return out;
  const usableReference=!pair.reference_issue && pair.primary;
  if(!playerMetrics.has(metric)){
    const measure=primary=>evaluateStudyGame({game,box:null,pair:{primary,variant:pair.variant}});
    const causal=measure(pair.control),published=usableReference?measure(pair.primary):null;
    if(!causal||causal.exclusion){out.issue=causal?.exclusion??'INVALID_FINAL';return out;}
    const key=losses[metric];
    addObservation(out,Math.abs(causal.primary[key]),Math.abs(causal.variant[key]),
      published&&!published.exclusion?Math.abs(published.primary[key]):null);
    return out;
  }
  if(!box){out.issue='AWAITING_BOXSCORE';return out;}
  const ids=targetIds(targetFor(exp,game.id)), c=playerArm(pair.control,ids),v=playerArm(pair.variant,ids),p=playerArm(usableReference?pair.primary:null,ids);
  const seenIds=new Set(),allKeys=new Set([...c.keys(),...v.keys()]);
  const excluded=reason=>{out.case_exclusions[reason]=(out.case_exclusions[reason]??0)+1;};
  for(const k of allKeys){
    const row=c.get(k)??v.get(k),cl=playerValue(c.get(k),metric),vl=playerValue(v.get(k),metric),pub=playerValue(p.get(k),metric);
    seenIds.add(row.id);
    if(cl===null||vl===null){excluded('NO_COMMON_PROJECTION');continue;}
    const actual=box.teams?.[String(game[row.side]?.id)]?.players?.find(a=>String(a.id)===row.id);
    if(!actual){excluded('PLAYER_NOT_IN_FINAL_BOX');continue;}
    if(!positiveValue(actual.minutes)||actual.minutes===0){excluded('NO_PLAYING_MINUTES');continue;}
    if(metric!=='minutes_mae' && !positiveValue(actual.points)){excluded('NO_ACTUAL_POINTS');continue;}
    const loss=value=>Math.abs(metric==='minutes_mae'?value-actual.minutes:
      metric==='player_mae'?value-actual.points:value*actual.minutes-actual.points);
    addObservation(out,loss(cl),loss(vl),pub==null?null:loss(pub));
  }
  if(ids)for(const id of ids)if(!seenIds.has(id))excluded('NO_COMMON_PROJECTION');
  if(!out.cases)out.issue='NO_COMMON_PLAYER_OBSERVATIONS';
  return out;
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
    const result=(metric)=>tip===row.tip?pairedCases(exp,game,box,pair,metric):
      {cases:0,totals:[0,0,0],reference_cases:0,reference_variant_total:0,issue:'RESCHEDULED'};
    const payload={...result(exp.metric),changed:pair.changed,extra_fact_count:pair.facts.length,
      final_score:{home:game.home.score,away:game.away.score},
      observed_players:observedPlayers(targetIds(targetFor(exp,match)),box),
      source:box?.source_url??'https://www.espn.com/nba/game/_/gameId/'+match};
    if(exp.metric==='minutes_mae')payload.secondary=result('player_mae');
    await store.prepare(`INSERT INTO prompt_lab_outcomes(experiment_id,match_id,pair_id,tip,observed_at,box_available,payload)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(experiment_id,match_id) DO UPDATE SET
      pair_id=excluded.pair_id,observed_at=excluded.observed_at,box_available=excluded.box_available,payload=excluded.payload
      WHERE excluded.box_available>=prompt_lab_outcomes.box_available AND excluded.observed_at>=prompt_lab_outcomes.observed_at`)
      .bind(row.experiment_id,match,row.id,tip,box&&utc(box.fetched_at)>observed?utc(box.fetched_at):observed,
        Number(Boolean(box)),JSON.stringify(payload)).run();
  }
}

function clusterStats(blocks){
  let n=0,left=0,right=0;
  for(const block of blocks.values()){n+=block.n;left+=block.left;right+=block.right;}
  if(!n)return {n:0,left:null,right:null,gain:null,ci:null};
  const gain=(left-right)/n;
  let ci=null;
  if(blocks.size>=20){
    let residual=0;
    for(const block of blocks.values())residual+=(block.left-block.right-block.n*gain)**2;
    const margin=2.1*Math.sqrt(blocks.size/(blocks.size-1)*residual)/n;
    ci=[rounded(gain-margin),rounded(gain+margin)];
  }
  return {n,left:rounded(left/n),right:rounded(right/n),gain:rounded(gain),ci};
}
const count=(bag,key,n=1)=>{bag[key]=(bag[key]??0)+n;};
function addBlock(blocks,date,n,left,right){
  if(!n)return;
  const block=blocks.get(date)??{n:0,left:0,right:0};
  block.n+=n;block.left+=left;block.right+=right;blocks.set(date,block);
}
function metricSummary(rows,metric,secondary=false){
  const causal=new Map(),published=new Map(),case_exclusions={};
  let games=0,refGames=0;
  for(const row of rows){
    const data=secondary?row.payload.secondary:row.payload;
    if(!data)continue;
    for(const [reason,n] of Object.entries(data.case_exclusions??{}))count(case_exclusions,reason,n);
    if(data.issue || !data.cases)continue;
    games++;
    const date=utc(row.tip).slice(0,10),[p,c,v]=data.totals;
    addBlock(causal,date,data.cases,c,v);
    const refCount=data.reference_cases??data.cases;
    if(refCount){refGames++;addBlock(published,date,refCount,p,data.reference_variant_total??v);}
  }
  const a=clusterStats(causal),b=clusterStats(published);
  return {metric,control:a.left,variant:a.right,gain:a.gain,interval_95:a.ci,
    primary:b.left,variant_vs_primary:b.right,gain_vs_primary:b.gain,interval_vs_primary_95:b.ci,
    evaluated_games:games,evaluated_cases:a.n,evaluated_dates:causal.size,
    reference_cases:b.n,reference_games:refGames,reference_dates:published.size,case_exclusions,
    uncertainty_method:'Intervalle apparié approximatif à 95 %, groupé par date UTC, à partir de 20 dates.'};
}
function qualityCounts(attempts){
  const output={attempted_captures:0,eligible_captures:0,incompatible_captures:0,by_reason:{}};
  for(const row of attempts){
    const n=row.n??1;output.attempted_captures+=n;
    if(row.exclusion){output.incompatible_captures+=n;count(output.by_reason,row.exclusion,n);}
    else output.eligible_captures+=n;
  }
  return output;
}

export function summarizePromptScore(experiment,captures=[],outcomes=[],asOf=new Date().toISOString(),attempts=captures,receipts=[]){
  const targets=experiment.targets??[],byTarget=new Set(targets.map(t=>String(t.match_id)));
  const byId=new Map(outcomes.filter(r=>byTarget.has(String(r.match_id))).map(r=>[String(r.match_id),r]));
  const captured=new Map(captures.filter(r=>byTarget.has(String(r.match_id))).map(r=>[String(r.match_id),r]));
  const summary=metricSummary(byId.values(),experiment.metric);
  const secondary=experiment.metric==='minutes_mae'?metricSummary(byId.values(),'player_mae',true):null;
  const {evaluated_games:games,evaluated_dates:dates,interval_95:ci,interval_vs_primary_95:ciRef}=summary;
  const criterion=experiment.criterion??experiment;
  const minimumGain=criterion.min_gain??criterion.minimum_gain,minGames=criterion.min_games,minDates=Math.max(20,criterion.min_dates??20);
  const scored=[...captured.values()];
  const changed=scored.filter(r=>r.changed&&!r.exclusion).length,extra=scored.reduce((n,r)=>n+r.extra_fact_count,0);
  const researched=scored.filter(r=>(r.ever_received??r.receipt_count)>0);
  const submitted=receipts.filter(r=>byTarget.has(String(r.match_id)));
  const integrated=submitted.filter(r=>r.integrated_count>0);
  const noFinding=integrated.filter(r=>r.confirmed_no_finding_count>0).length;
  const effects={control_verified:0,variant_verified:0,changed_status:0,changed_minutes:0,changed_points:0};
  for(const row of scored)for(const k of Object.keys(effects))effects[k]+=row.effects?.[k]??0;
  const exclusions={},reference_exclusions={},missing={};
  const quality=attempts.filter(r=>byTarget.has(String(r.match_id)));
  const grouped=new Map();
  for(const r of quality){const list=grouped.get(r.match_id)??[];list.push(r);grouped.set(r.match_id,list);}
  let eligibleGames=0,eligibleCases=0,ineligibleCases=0;
  const byMatch=targets.map(t=>{
    const id=String(t.match_id),c=captured.get(id),r=byId.get(id);
    const issue=r?.payload.issue??c?.exclusion??null;
    if(issue)count(exclusions,issue);
    const tipPassed=Date.parse(asOf)>=Date.parse(t.tip);
    if(!c && tipPassed)count(missing,'NO_PRETIP_CAPTURE');
    else if(c && !r && tipPassed)count(missing,'AWAITING_FINAL');
    if(c?.reference_issue)count(reference_exclusions,c.reference_issue);
    // Older fixtures lack a prospective eligible-case count; their measured cases are a lower bound.
    const eligible=c?.eligible?.eligible??(!c?.exclusion&&c?(r?.payload.cases??0):0);
    if(c&&!c.exclusion&&eligible>0)eligibleGames++;
    eligibleCases+=eligible;ineligibleCases+=c?.eligible?.ineligible??0;
    const player_comparisons=(c?.player_comparisons??[]).map(p=>{
      const actual=r?.payload.observed_players?.find(a=>a.player_id===p.player_id && (p.team_id==null||a.team_id===p.team_id));
      return {...p,name:p.name??actual?.name??null,team_id:p.team_id??actual?.team_id??null,
        actual:actual?{minutes:actual.minutes,points:actual.points}:null};
    });
    return {match_id:id,tip:t.tip,pair_id:c?.pair_id??null,player_comparisons,target_player_ids:t.player_ids??null,captured_at:c?.integrated_at??null,as_of:c?.as_of??null,
      ...c?.trace,changed:c?.changed??null,extra_fact_count:c?.extra_fact_count??0,supplement_receipts:c?.receipt_count??0,
      player_changes:c?.effects??null,eligible_cases:eligible,evaluated_cases:r?.payload.cases??0,
      case_exclusions:r?.payload.case_exclusions??{},exclusion:issue,reference_exclusion:c?.reference_issue??null,
      pair_quality:qualityCounts(grouped.get(id)??[]),
      result_observed_at:r?.observed_at??null,result_source:r?.payload.source??null,final_score:r?.payload.final_score??null,
      primary_result:r?{cases:r.payload.cases,totals:r.payload.totals,reference_cases:r.payload.reference_cases??r.payload.cases}:null,
      secondary_result:r?.payload.secondary??null};
  });
  const horizon=Math.max(...targets.map(t=>Date.parse(t.tip)), ...[experiment.cohort?.end,experiment.review_at].filter(Boolean).map(Date.parse));
  const all=targets.length>0&&games===targets.length,grace=horizon+72*3600000;
  let decision='POURSUIVRE',conclusion='PENDING',reason='Collecte des prévisions et des résultats sur les matchs annoncés.';
  if(Date.parse(asOf)>=horizon && (all || Date.parse(asOf)>=grace)){
    decision='NON_CONCLUANTE';conclusion='INCONCLUSIVE';
    if(!all)reason='Échéance atteinte avec des matchs ou observations manquants. Le gain reste indéterminé.';
    else if(games<minGames || dates<minDates)reason='Échantillon insuffisant en matchs ou en dates indépendantes pour conclure.';
    else if(!changed && integrated.length!==targets.length)reason='Aucune révision mesurable et des collectes expérimentales restent sans reçu intégré. L’effet de la consigne est indéterminé.';
    else if(!changed){
      decision='ABANDONNER';conclusion='NO_BENEFIT';reason='Les projections du critère fixé sont restées identiques sur tous les matchs mesurés.';
    }else if(ci && ci[0]>0 && ci[0]>=minimumGain &&
      summary.reference_cases===summary.evaluated_cases && ciRef && ciRef[0]>=0){
      decision='PROPOSER_ADOPTION';conclusion='FAVOURABLE';reason='Le gain apparié dépasse le seuil fixé à la borne basse. Le repère publié a été vérifié sur tous les mêmes cas.';
    }else if(ci && ci[1]<0){
      decision='ABANDONNER';conclusion='UNFAVOURABLE';reason='L’erreur a augmenté par rapport au même moteur sans la consigne, y compris à la borne haute du gain.';
    }else if(ci && ci[1]<minimumGain){
      decision='ABANDONNER';conclusion='NO_BENEFIT';reason='Même la borne haute du gain mesuré reste inférieure au seuil fixé avant le test.';
    }else if(ciRef && ciRef[1]<0 && summary.reference_cases===summary.evaluated_cases){
      decision='ABANDONNER';conclusion='UNFAVOURABLE';reason='La comparaison au principal publié montre une dégradation sur les mêmes cas.';
    }else reason='Les mesures ne permettent pas de trancher au seuil enregistré, compte tenu de l’incertitude et de la couverture du repère publié.';
  }else if(Date.parse(asOf)>=horizon)reason='Les résultats des matchs et les feuilles manquantes sont attendus pendant 72 heures.';
  return {...summary,secondary,minimum_gain:minimumGain,min_games:minGames,min_dates:minDates,target_count:targets.length,
    nominated_player_cases:targets.some(t=>t.player_ids)?targets.reduce((n,t)=>n+(t.player_ids?.length??0),0):null,
    forecast_games:captured.size,eligible_games:eligibleGames,eligible_cases:eligibleCases,
    ineligible_cases:ineligibleCases,paired_games:games,
    researched_games:researched.length,no_finding_games:noFinding,games_without_supplement:targets.length-researched.length,
    submitted_games:submitted.length,games_without_received_supplement:targets.length-submitted.length,
    confirmed_no_finding_games:noFinding,integrated_games:integrated.length,unintegrated_games:submitted.length-integrated.length,
    closed_games:byId.size,missing_games:targets.length-games,changed_games:changed,extra_fact_count:extra,player_changes:effects,
    exclusions,reference_exclusions,missing,pair_quality:qualityCounts(quality),matches:byMatch,
    player_scope:playerMetrics.has(experiment.metric)?'Joueurs ciblés effectivement entrés avec les deux projections mesurables. Repère publié évalué sur ses cas disponibles.':null,
    assessment_after:Number.isFinite(horizon)?new Date(horizon).toISOString():null,
    grace_end:Number.isFinite(grace)?new Date(grace).toISOString():null,
    decision,conclusion,reason,adoption_applied:false};
}

export async function readPromptScore(db,experiment,asOf=new Date().toISOString()){
  if(experiment.decision_json && experiment.status!=='ACTIVE'){
    const closed=typeof experiment.decision_json==='string'?JSON.parse(experiment.decision_json):experiment.decision_json;
    if(closed?.score?.metric)return closed.score;
    if(closed?.metric)return closed;
  }
  const store=sessions(db);
  const [pairs,rows,attempts,receipts]=await store.batch([
    store.prepare(`SELECT p.id AS pair_id,p.match_id,p.as_of,p.integrated_at,json_extract(p.payload,'$.changed') AS changed,
      json_extract(p.payload,'$.trace') AS trace,json_extract(p.payload,'$.eligible') AS eligible,
      json_extract(p.payload,'$.reference_issue') AS reference_issue,
      json_extract(p.payload,'$.player_comparisons') AS player_comparisons,
      CASE WHEN json_type(p.payload,'$.player_comparisons') IS NULL THEN p.payload END AS legacy,
      (SELECT MAX(json_array_length(h.payload,'$.receipt_ids')) FROM prompt_lab_pairs h WHERE h.experiment_id=p.experiment_id AND h.match_id=p.match_id) AS ever_received,
      (SELECT MAX(json_array_length(h.payload,'$.facts')) FROM prompt_lab_pairs h WHERE h.experiment_id=p.experiment_id AND h.match_id=p.match_id) AS ever_had_facts,
      json_array_length(p.payload,'$.facts') AS extra_fact_count,json_array_length(p.payload,'$.receipt_ids') AS receipt_count,json_extract(p.payload,'$.exclusion') AS exclusion,
      json_extract(p.payload,'$.effects') AS effects
      FROM prompt_lab_pairs p WHERE p.experiment_id=? AND p.id=(SELECT q.id FROM prompt_lab_pairs q
        WHERE q.experiment_id=p.experiment_id AND q.match_id=p.match_id ORDER BY q.as_of DESC,q.id DESC LIMIT 1)`).bind(experiment.id),
    store.prepare('SELECT match_id,tip,observed_at,payload FROM prompt_lab_outcomes WHERE experiment_id=? ORDER BY tip,match_id').bind(experiment.id),
    store.prepare(`SELECT match_id,json_extract(payload,'$.exclusion') AS exclusion,count(*) AS n FROM prompt_lab_pairs
      WHERE experiment_id=? GROUP BY match_id,json_extract(payload,'$.exclusion')`).bind(experiment.id),
    store.prepare(`WITH integrated AS (
      SELECT DISTINCT p.match_id,r.value AS receipt_id FROM prompt_lab_pairs p,json_each(p.payload,'$.receipt_ids') r
      WHERE p.experiment_id=? AND json_extract(p.payload,'$.exclusion') IS NULL
    )
    SELECT s.match_id,count(*) AS submitted_count,count(i.receipt_id) AS integrated_count,
      sum(CASE WHEN i.receipt_id IS NOT NULL AND s.outcome='NO_FINDING' THEN 1 ELSE 0 END) AS confirmed_no_finding_count
      FROM prompt_lab_supplements s LEFT JOIN integrated i ON i.match_id=s.match_id AND i.receipt_id=s.id
      WHERE s.experiment_id=? GROUP BY s.match_id`).bind(experiment.id,experiment.id)]);
  const captures=pairs.results.map(r=>{
    const old=r.legacy?JSON.parse(r.legacy):null;
    return {...r,changed:Boolean(r.changed),effects:r.effects?JSON.parse(r.effects):null,
      player_comparisons:r.player_comparisons?JSON.parse(r.player_comparisons):
        nominatedComparisons(targetIds(targetFor(experiment,r.match_id)),old?.control,old?.variant),
      trace:r.trace?JSON.parse(r.trace):old?pairingTrace(old.primary,old.control,old.variant):null,
      eligible:r.eligible?JSON.parse(r.eligible):old&&!old.exclusion?
        projectedCases(experiment.metric,old.control,old.variant,targetIds(targetFor(experiment,r.match_id))):null};
  });
  return summarizePromptScore(experiment,captures,rows.results.map(r=>({...r,payload:JSON.parse(r.payload)})),asOf,attempts.results,receipts.results);
}
