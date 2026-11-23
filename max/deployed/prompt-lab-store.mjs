// Only this small schema is interpreted as a research experiment. Original instructions are data.
import {playerIdentity} from './identity.mjs';
import {reportTimestamp} from './collectors.mjs';

const canonicalTime = x => {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)) return null;
  const t=Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const nowSQL="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const primary=db=>db.withSession ? db.withSession('first-primary') : db;
const isId=x=>typeof x==='string' && /^\d{5,15}$/.test(x);
const metrics=new Set(['brier','total_mae','player_mae','minutes_mae','production_mae']);
const diagnoses=new Set(['MISSING','TRANSMISSION','ALREADY_USED','INCONCLUSIVE']);
class ProposalError extends Error {}
function requireValue(condition,message){if(!condition)throw new ProposalError(message);}
const exactText=(s,max=4000)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const registrySelect=`SELECT v.id,v.plan_json,v.family_id,v.parent_id,v.version,v.registered_at,v.review_at,v.change_reason,
  i.received_at,e.created_at,e.closed_at,e.decision_json,
  (SELECT h.status FROM prompt_lab_status_history h WHERE h.experiment_id=v.id ORDER BY h.seq DESC LIMIT 1) status,
  (SELECT json_group_array(json_object('status',x.status,'at',x.at,'reason',x.reason)) FROM
    (SELECT h.status,h.at,h.reason FROM prompt_lab_status_history h WHERE h.experiment_id=v.id ORDER BY h.seq) x) history_json
  FROM prompt_lab_versions v JOIN prompt_lab_inbox i ON i.id=v.id LEFT JOIN prompt_lab_experiments e ON e.id=v.id`;
function readPlan(row){
  if(!row)return null;
  const plan=JSON.parse(row.plan_json),history=JSON.parse(row.history_json??'[]');
  const terminal=['ABANDON','PROPOSE_ADOPTION','INCONCLUSIVE'].includes(row.status);
  const decision=row.decision_json?JSON.parse(row.decision_json):terminal&&row.status==='INCONCLUSIVE'?{
    decision:'NON_CONCLUANTE',reason:history.at(-1)?.reason,metric:plan.metric,evaluated_cases:0,evaluated_games:0,
    closed_games:0,target_count:plan.targets.length,min_games:plan.criterion.min_games,review_at:row.review_at,adoption_applied:false}:null;
  return {...plan,id:row.id,status:row.status,created_at:row.created_at??row.registered_at,activated_at:row.created_at??null,
    received_at:row.received_at,registered_at:row.registered_at,closed_at:row.closed_at??(terminal?history.at(-1)?.at:null),
    decision,family_id:row.family_id,parent_id:row.parent_id,version:row.version,change_reason:row.change_reason,
    review_at:row.review_at,review_condition:plan.review_condition??(plan.action==='TEST'?reviewCondition:null),status_history:history};
}
const reviewCondition='Une revue unique à la date prévue une fois les résultats des matchs ciblés disponibles. Si des observations manquent, attendre 72 heures supplémentaires.';
export async function readLabExperiment(db,id){
  return readPlan(await primary(db).prepare(registrySelect+' WHERE v.id=?').bind(id).first());
}
export async function readActiveExperiment(db){
  return readPlan(await primary(db).prepare(registrySelect+" WHERE e.status='ACTIVE'").first());
}
export async function readLabExperiments(db){
  const rows=await primary(db).prepare(registrySelect+' ORDER BY v.registered_at DESC,v.version DESC,v.id DESC').all();
  return rows.results.map(readPlan);
}
export function eligibleForExperiment(exp,game,at){
  const time=canonicalTime(at),tip=canonicalTime(game?.start??game?.tip);
  if(!exp || exp.status!=='ACTIVE' || !time || !tip || time<exp.created_at || time>=tip
    || (game.status && game.status!=='STATUS_SCHEDULED'))return false;
  return exp.targets.some(t=>t.match_id===String(game.id??game.match_id) && t.tip===tip);
}

function corroboratedSource(source,id){
  if(!source)return false;
  try {
    const u=new URL(source);
    return u.protocol==='https:' && !u.username && !u.password && !u.port &&
      ((u.hostname==='www.espn.com' && u.pathname.split('/').some((p,i,a)=>p===id && a[i-1]==='gameId'))
      || (u.hostname==='site.api.espn.com' && u.pathname==='/apis/site/v2/sports/basketball/nba/summary' && u.searchParams.get('event')===id));
  }catch{return false;}
}

async function validateTargets(db,proposal,receivedAt) {
  const start=canonicalTime(proposal.cohort?.start),end=canonicalTime(proposal.cohort?.end);
  requireValue(start && end && start<end && end>receivedAt,'INVALID_COHORT_WINDOW');
  const raw=proposal.targets;
  requireValue(Array.isArray(raw)&&raw.length>0&&raw.length<=600,'EXPLICIT_FUTURE_TARGETS_REQUIRED');
  const targets=[], distinct=new Set();
  const schedule=new Map();
  for(let i=0;i<raw.length;i+=80){
    const batch=raw.slice(i,i+80);
    requireValue(batch.every(t=>isId(t?.match_id)),'INVALID_TARGET_MATCH');
    const q=await db.prepare(`SELECT match_id,tip FROM study_context WHERE match_id IN (${batch.map(()=>'?').join(',')})`)
      .bind(...batch.map(t=>t.match_id)).all();
    for(const row of q.results)schedule.set(row.match_id,canonicalTime(row.tip));
  }
  for(const t of raw){
    const tip=canonicalTime(t.tip), id=t.match_id;
    requireValue(!distinct.has(id)&&tip&&tip>receivedAt&&tip>=start&&tip<end,'TARGET_OUTSIDE_FUTURE_COHORT');
    if(schedule.has(id))requireValue(schedule.get(id)===tip,'TARGET_SCHEDULE_MISMATCH');
    else requireValue(corroboratedSource(t.source_url,id),'FUTURE_SCHEDULE_REFERENCE_REQUIRED');
    distinct.add(id);
    if(t.player_ids!==undefined)requireValue(!['brier','total_mae'].includes(proposal.metric) && Array.isArray(t.player_ids)
      && t.player_ids.length>0 && t.player_ids.length<=50 && t.player_ids.every(p=>typeof p==='string'&&/^\d{1,15}$/.test(p))
      && new Set(t.player_ids).size===t.player_ids.length,'INVALID_PREREGISTERED_PLAYERS');
    targets.push({match_id:id,tip,...(t.source_url?{source_url:t.source_url}:{}),...(t.player_ids?{player_ids:[...t.player_ids]}:{})});
  }
  return {targets,cohort:{start,end}};
}

function verifyCriterion(proposal,targets) {
  const c=proposal.criterion;
  requireValue(metrics.has(proposal.metric),'UNKNOWN_PRIMARY_METRIC');
  requireValue(proposal.target!=='AVAILABILITY' || !['brier','total_mae'].includes(proposal.metric),'METRIC_UNAFFECTED_BY_AVAILABILITY_BRANCH');
  requireValue(c && Number.isSafeInteger(c.min_games)&&c.min_games>=1&&c.min_games<=targets.length
    && Number.isSafeInteger(c.min_dates)&&c.min_dates>=1&&c.min_dates<=new Set(targets.map(t=>t.tip.slice(0,10))).size
    && typeof c.min_gain==='number'&&Number.isFinite(c.min_gain)&&c.min_gain>0,'INVALID_DECISION_CRITERION');
  return {min_games:c.min_games,min_dates:c.min_dates,min_gain:c.min_gain};
}

const targetFact=(f,target)=> target==='AVAILABILITY'?f.kind==='INJURY':f.kind==='ROTATION'&&Number.isFinite(f.minutes_limit);

function reportedFact(row,player,target,cutoff){
  const report=JSON.parse(row.report_json);
  const entries=target==='AVAILABILITY'?report.verified_injuries:report.verified_role_facts;
  return (Array.isArray(entries)?entries:[]).some(f=>{
    if(String(f.match_id)!==row.match_id || String(f.team_id)!==String(player.team_id))return false;
    if(f.player_id!=null ? String(f.player_id)!==String(player.player_id) : playerIdentity(f.player)!==playerIdentity(player.name))return false;
    if(target==='MINUTES_LIMIT' && !Number.isFinite(f.minutes_limit))return false;
    const checked=canonicalTime(f.checked_at);
    return checked && checked<=cutoff && Date.parse(cutoff)-Date.parse(checked)<=12*3600000 && report.sources?.some(s=>s.url===f.source_url && s.kind==='OFFICIAL');
  });
}

// A single missing item can justify research when a later, separate receipt proves that
// the exact official source was already public at the time of the original forecast.
function missedPublicFact(ref,receipts,version,player,target){
  if(!ref)return null;
  const receipt=receipts.find(r=>r.id===ref.receipt_id);
  const fail=()=>{throw new ProposalError('MISSED_SOURCE_NOT_CORROBORATED');};
  if(!receipt || !player || typeof ref.source_url!=='string')return fail();
  let url;try{url=new URL(ref.source_url);}catch{return fail();}
  if(url.protocol!=='https:' || url.username || url.password || url.port || !/^(?:[a-z0-9-]+\.)*nba\.com$/.test(url.hostname))return fail();
  const report=JSON.parse(receipt.report_json);
  const src=report.sources?.find(s=>s.url===ref.source_url && s.kind==='OFFICIAL');
  const facts=target==='AVAILABILITY'?report.verified_injuries:report.verified_role_facts;
  const fact=(Array.isArray(facts)?facts:[]).find(f=>String(f.player_id)===String(player.player_id) && String(f.team_id)===String(player.team_id)
    && String(f.match_id)===version.match_id && canonicalTime(f.event_start)===canonicalTime(version.tip) && f.source_url===ref.source_url);
  const published=reportTimestamp(ref.source_url) ?? canonicalTime(src?.published_at);
  const read=canonicalTime(fact?.checked_at),sourceRead=canonicalTime(src?.checked_at),authored=canonicalTime(report.generated_at);
  if(!fact || !src || !published || !read || !sourceRead || !authored || published>version.as_of ||
    Date.parse(version.as_of)-Date.parse(published)>12*3600000 || read<=version.as_of || sourceRead<=version.as_of ||
    read>=version.tip || sourceRead>=version.tip || read>authored || sourceRead>authored || authored>receipt.received_at)return fail();
  if(target==='AVAILABILITY' ? !['OUT','DOUBTFUL','QUESTIONABLE','PROBABLE','AVAILABLE'].includes(fact.status)
    : !(Number.isFinite(fact.minutes_limit)&&fact.minutes_limit>=0&&fact.minutes_limit<=48))return fail();
  return {source_url:src.url,receipt_id:receipt.id,published_at:published,checked_at:read,
    received_at:receipt.received_at,player_id:String(player.player_id),team_id:String(player.team_id),
    ...(target==='AVAILABILITY'?{status:fact.status}:{minutes_limit:fact.minutes_limit})};
}

async function verifyEvidence(db,proposal,evidence,receivedAt){
  requireValue(isId(evidence?.match_id)&&Number.isSafeInteger(evidence.version_id)&&evidence.version_id>0
    && typeof evidence.player_id==='string'&&/^\d{1,15}$/.test(evidence.player_id)
    && exactText(evidence.observation,1000),'EVIDENCE_NEEDS_MATCH_CAPTURE_PLAYER_OBSERVATION');
  const [v,receipts,latest,result,context]=await db.batch([
    db.prepare('SELECT id,match_id,integrated_at,as_of,tip,payload FROM max_forecast_versions WHERE id=? AND match_id=? AND integrated_at<=?')
      .bind(evidence.version_id,evidence.match_id,receivedAt),
    db.prepare('SELECT id,match_id,received_at,report_json FROM macfly_inbox WHERE match_id=? AND received_at<=?').bind(evidence.match_id,receivedAt),
    db.prepare('SELECT id FROM max_forecast_versions WHERE match_id=? AND integrated_at<=? ORDER BY as_of DESC,id DESC LIMIT 1')
      .bind(evidence.match_id,receivedAt),
    db.prepare('SELECT tip,result FROM study_results WHERE match_id=?').bind(evidence.match_id),
    db.prepare("SELECT source_at,json_extract(context,'$.legacy') AS legacy,json_type(context,'$.legacy') AS legacy_type FROM study_context WHERE match_id=?").bind(evidence.match_id)
  ]);
  const row=v.results[0];
  requireValue(row&&row.as_of<row.tip && row.integrated_at<row.tip,'EVIDENCE_CAPTURE_NOT_VERIFIED');
  const p=JSON.parse(row.payload);
  const player=p.after?.primary?.players?.find(a=>String(a.player_id)===evidence.player_id);
  const missed=missedPublicFact(evidence.missed_source,receipts.results,row,player,proposal.target);
  const facts=(p.facts??[]).filter(f=>String(f.player_id)===evidence.player_id&&targetFact(f,proposal.target));
  let raw=receipts.results;
  if(evidence.receipt_id!=null){
    requireValue(Number.isSafeInteger(evidence.receipt_id)&&raw.some(r=>r.id===evidence.receipt_id),'EVIDENCE_RECEIPT_NOT_VERIFIED');
    raw=raw.filter(r=>r.id===evidence.receipt_id);
    requireValue(facts.some(f=>f.receipt_id===evidence.receipt_id)||player&&raw.some(r=>reportedFact(r,player,proposal.target,row.as_of)),'EVIDENCE_RECEIPT_UNRELATED');
  }
  const effective=facts.filter(f=>f.effect==='APPLIED'||f.effect==='ALREADY_KNOWN');
  const source=effective.at(-1);
  // Old snapshots omit some display flags. The paired player projections still identify a
  // game-specific official status, and historical rotation snapshots may retain its source.
  const projectionFor=arm=>['home','away'].flatMap(side=>p.pair?.[arm]?.player_points?.[side]?.players??[])
    .find(x=>String(x.id)===evidence.player_id && (!player || String(x.team_id)===String(player.team_id)));
  const primaryPlayer=projectionFor('primary'), trialPlayer=projectionFor('variant');
  const officialAvailability=player?.official_for_game || ['OFFICIAL_OUT','OFFICIAL_UNCERTAIN','OFFICIALLY_LISTED'].includes(primaryPlayer?.availability);
  const ctx=context.results[0];
  let legacyLimitUsed=false;
  if(proposal.target==='MINUTES_LIMIT' && ctx?.legacy && ctx.source_at<=row.as_of && p.pair?.variant){
    const old=JSON.parse(ctx.legacy);
    legacyLimitUsed=(old.verified_role_facts??[]).some(f=>String(f.match_id)===row.match_id &&
      String(f.player_id)===evidence.player_id && String(f.team_id)===String(player?.team_id) &&
      Number.isFinite(f.minutes_limit) && canonicalTime(f.checked_at) && canonicalTime(f.checked_at)<=row.as_of &&
      Date.parse(row.as_of)-Date.parse(f.checked_at)<=12*3600000 && old.sources?.some(s=>s.kind==='OFFICIAL' && s.url===f.source_url));
  }
  const archivedRoles=p.pair?.known_roles;
  const knownRole=Array.isArray(archivedRoles)&&archivedRoles.some(f=>String(f.player_id)===evidence.player_id &&
    String(f.team_id)===String(player?.team_id) && Number.isFinite(f.minutes_limit));
  const roleCoverage=p.pair?.role_evidence_complete===true || (ctx && ctx.source_at<=row.as_of && ctx.legacy_type!=null);
  let classification,detail;
  if(effective.length || (officialAvailability && proposal.target==='AVAILABILITY') || (proposal.target==='MINUTES_LIMIT' && (trialPlayer?.role_source || knownRole || legacyLimitUsed))){
    classification='ALREADY_USED';detail='La capture contenait déjà cette information identifiée pour le joueur.';
  }else if(player && raw.some(r=>reportedFact(r,player,proposal.target,row.as_of))){
    classification='TRANSMISSION';detail='Le rapport source avait vérifié ce fait avant la coupure. Son reçu ou son application au moteur a manqué cette capture.';
  }else if(player && (missed || latest.results[0]?.id===row.id) && !facts.length && (proposal.target!=='MINUTES_LIMIT'||roleCoverage)){
    classification='MISSING';detail='Ce renseignement ne figure ni dans les sources reçues à temps ni dans la dernière capture disponible pour ce joueur.';
  }else{
    classification='INCONCLUSIVE';detail='Le rapprochement entre la collecte, le joueur et la capture reste incomplet.';
  }
  const proof={match_id:row.match_id,version_id:row.id,player_id:evidence.player_id,player_name:player?.name??source?.player??null,
    receipt_id:evidence.receipt_id??source?.receipt_id??null,observation:evidence.observation,classification,detail,
    checked_at_capture:row.as_of,source_url:source?.source_url??missed?.source_url??null,missed_source:missed,final_result:null};
  if(result.results[0]){
    const current=JSON.parse(result.results[0].result);
    // A result must already be known when the diagnosis is submitted. Use the forecast reference if it matches.
    const resultAt=canonicalTime(current.observed_at);
    if(resultAt && resultAt<=receivedAt && resultAt>row.tip && current.at===row.as_of)proof.final_result={
      observed_at:resultAt,
      home:current.final_score?.home??null,away:current.final_score?.away??null,
      primary_correct:current.primary?.correct??null,
      primary_player:current.players?.rows?.find(r=>String(r.id)===evidence.player_id)?.primary??null};
  }
  if(evidence.result_id!=null)requireValue(String(evidence.result_id)===row.match_id&&proof.final_result,'EVIDENCE_RESULT_UNAVAILABLE');
  return proof;
}

async function validateProposal(db,proposal,receivedAt){
  requireValue(proposal.author==='MacFly'&&['TEST','NO_PROMPT'].includes(proposal.action),'MACFLY_ACTION_REQUIRED');
  requireValue(['AVAILABILITY','MINUTES_LIMIT'].includes(proposal.target)&&diagnoses.has(proposal.diagnosis),'UNKNOWN_DIAGNOSIS_OR_TARGET');
  requireValue(exactText(proposal.problem)&&Array.isArray(proposal.evidence)&&proposal.evidence.length<=12,'PROBLEM_AND_EVIDENCE_REQUIRED');
  requireValue(proposal.evidence.length>0 || (proposal.action==='NO_PROMPT'&&proposal.diagnosis==='INCONCLUSIVE'),'VERIFIABLE_EVIDENCE_REQUIRED');
  const evidence=[];
  for(const e of proposal.evidence)evidence.push(await verifyEvidence(db,proposal,e,receivedAt));
  const classes=new Set(evidence.map(e=>e.classification));
  if(proposal.diagnosis!=='INCONCLUSIVE')requireValue(classes.size===1 && classes.has(proposal.diagnosis),'DIAGNOSIS_CONTRADICTED_BY_JOURNAL');
  const plan={id:proposal.id,author:'MacFly',action:proposal.action,problem:proposal.problem,diagnosis:proposal.diagnosis,
    target:proposal.target,evidence,hypothesis:null,prompt:null,metric:null,criterion:null,cohort:null,targets:[],reason:null};
  if(proposal.action==='NO_PROMPT'){
    requireValue(!proposal.prompt && !proposal.targets?.length && exactText(proposal.reason),'NO_PROMPT_REQUIRES_REASON_ONLY');
    return {...plan,reason:proposal.reason};
  }
  requireValue(proposal.diagnosis==='MISSING'&&(new Set(evidence.map(e=>e.match_id)).size>=2 || evidence.some(e=>e.missed_source)),'NEW_RESEARCH_REQUIRES_REPEATED_OR_CORROBORATED_MISSING_INPUT');
  requireValue(exactText(proposal.hypothesis)&&exactText(proposal.prompt,8000),'EXACT_PROMPT_AND_HYPOTHESIS_REQUIRED');
  const {targets,cohort}=await validateTargets(db,proposal,receivedAt);
  const criterion=verifyCriterion(proposal,targets);
  const reviewAt=proposal.review_at===undefined?cohort.end:canonicalTime(proposal.review_at);
  requireValue(reviewAt && reviewAt>=cohort.end,'REVIEW_DATE_PRECEDES_COHORT_END');
  const parentId=proposal.parent_id??null;
  if(parentId!==null){
    requireValue(typeof parentId==='string'&&parentId!==proposal.id&&exactText(proposal.change_reason,1500),'REVISION_REQUIRES_PARENT_AND_REASON');
    const parent=await readLabExperiment(db,parentId);
    requireValue(parent && parent.action==='TEST','UNKNOWN_PREVIOUS_PROMPT_VERSION');
    const family=await db.prepare('SELECT id,plan_json FROM prompt_lab_versions WHERE family_id=? ORDER BY version DESC').bind(parent.family_id).all();
    requireValue(family.results[0]?.id===parentId,'PARENT_NOT_LATEST_VERSION');
    const oldIds=new Set(family.results.flatMap(v=>JSON.parse(v.plan_json).targets.map(t=>t.match_id)));
    requireValue(targets.every(t=>!oldIds.has(t.match_id)),'REVISION_REUSES_AN_EARLIER_TARGET');
  }
  return {...plan,parent_id:parentId,change_reason:parentId?proposal.change_reason:'Première consigne de cette expérience.',review_at:reviewAt,review_condition:reviewCondition,hypothesis:proposal.hypothesis,prompt:proposal.prompt,metric:proposal.metric,criterion,cohort,targets,
    effective_min_dates:Math.max(20,criterion.min_dates),exploratory:new Set(targets.map(t=>t.tip.slice(0,10))).size<20};
}

const firstTarget = "SELECT min(json_extract(t.value,'$.tip')) FROM json_each(v.plan_json,'$.targets') t";
const isQueued = `EXISTS(SELECT 1 FROM prompt_lab_status_history h WHERE h.experiment_id=v.id AND h.status='QUEUED')
  AND NOT EXISTS(SELECT 1 FROM prompt_lab_status_history h WHERE h.experiment_id=v.id AND h.status IN('ACTIVE','INCONCLUSIVE','ABANDON','PROPOSE_ADOPTION'))`;
async function advanceQueue(session){
  // At most one fresh cohort may become active. A delayed start never silently removes matches that have started.
  const [,activation]=await session.batch([
    session.prepare(`INSERT OR IGNORE INTO prompt_lab_status_history(experiment_id,status,reason)
      SELECT v.id,'INCONCLUSIVE','Un match préinscrit avait déjà commencé avant la libération de la place. Aucun résultat attribué à cette version.'
      FROM prompt_lab_versions v WHERE ${isQueued} AND (${firstTarget})<=${nowSQL}`),
    session.prepare(`INSERT INTO prompt_lab_experiments(id,received_at,status,plan_json)
      SELECT v.id,i.received_at,'ACTIVE',v.plan_json FROM prompt_lab_versions v JOIN prompt_lab_inbox i ON i.id=v.id
      WHERE ${isQueued} AND (${firstTarget})>${nowSQL}
        AND NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE status='ACTIVE')
        AND EXISTS(SELECT 1 FROM prompt_lab_status_history h WHERE h.experiment_id=v.parent_id AND h.status IN('ABANDON','PROPOSE_ADOPTION','INCONCLUSIVE'))
      ORDER BY v.registered_at,v.version,v.id LIMIT 1 ON CONFLICT DO NOTHING RETURNING id`)
  ]);
  const id=activation.results[0]?.id;
  return id?readPlan(await session.prepare(registrySelect+' WHERE v.id=?').bind(id).first()):null;
}
export async function processPromptInbox(db,onlyId=null){
  const session=primary(db);
  const activated=await advanceQueue(session);
  const pending=await session.prepare(`SELECT i.id,i.payload,i.received_at FROM prompt_lab_inbox i
    LEFT JOIN prompt_lab_versions v ON v.id=i.id LEFT JOIN prompt_lab_rejections r ON r.id=i.id
    WHERE v.id IS NULL AND r.id IS NULL AND (? IS NULL OR i.id=?) ORDER BY i.received_at,i.rowid LIMIT 12`).bind(onlyId,onlyId).all();
  const processed=activated?[activated]:[];
  for(const row of pending.results){
    try{
      const plan=await validateProposal(session,JSON.parse(row.payload),row.received_at);
      const status=plan.action==='TEST'?'ACTIVE':'NO_PROMPT';
      const firstTip=status==='ACTIVE'?plan.targets.reduce((min,t)=>t.tip<min?t.tip:min,plan.targets[0].tip):null;
      const parent=plan.parent_id??null, body=JSON.stringify(plan);
      const [,,,,,out,failed]=await session.batch([
        session.prepare(`INSERT INTO prompt_lab_versions(id,family_id,version,parent_id,change_reason,plan_json,review_at)
          SELECT ?,coalesce(parent.family_id,?),coalesce(parent.version+1,1),?,?,?,?
          FROM (SELECT 1) anchor LEFT JOIN prompt_lab_versions parent ON parent.id=?
          WHERE (? IS NULL OR (parent.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM prompt_lab_versions c WHERE c.parent_id=parent.id)))
            AND (?='NO_PROMPT' OR (${nowSQL}<? AND (parent.id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE status='ACTIVE'))))
            AND NOT EXISTS(SELECT 1 FROM prompt_lab_rejections WHERE id=?)
          ON CONFLICT DO NOTHING`).bind(row.id,row.id,parent,plan.change_reason??plan.reason,body,plan.review_at??null,parent,parent,status,firstTip,row.id),
        session.prepare(`INSERT OR IGNORE INTO prompt_lab_status_history(experiment_id,status,reason)
          SELECT id,'REGISTERED',change_reason FROM prompt_lab_versions WHERE id=? AND NOT EXISTS(SELECT 1 FROM prompt_lab_status_history WHERE experiment_id=?)`).bind(row.id,row.id),
        session.prepare(`INSERT INTO prompt_lab_experiments(id,received_at,status,plan_json)
          SELECT v.id,i.received_at,?,v.plan_json FROM prompt_lab_versions v JOIN prompt_lab_inbox i ON i.id=v.id
          WHERE v.id=? AND (?='NO_PROMPT' OR ((${firstTarget})>${nowSQL}
            AND NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE status='ACTIVE')
            AND (v.parent_id IS NULL OR EXISTS(SELECT 1 FROM prompt_lab_status_history h WHERE h.experiment_id=v.parent_id AND h.status IN('ABANDON','INCONCLUSIVE','PROPOSE_ADOPTION')))))
          ON CONFLICT DO NOTHING`).bind(status,row.id,status),
        session.prepare(`INSERT OR IGNORE INTO prompt_lab_status_history(experiment_id,status,reason)
          SELECT v.id,'QUEUED','Version figée. Démarrage après clôture de la version précédente et libération de la place de test.'
          FROM prompt_lab_versions v WHERE v.id=? AND NOT EXISTS(SELECT 1 FROM prompt_lab_experiments e WHERE e.id=v.id)
            AND NOT EXISTS(SELECT 1 FROM prompt_lab_status_history h WHERE h.experiment_id=v.id AND h.status='INCONCLUSIVE')`).bind(row.id),
        session.prepare(`INSERT INTO prompt_lab_rejections(id,reason) SELECT ?,CASE WHEN ? IS NOT NULL AND EXISTS
          (SELECT 1 FROM prompt_lab_versions WHERE parent_id=?) THEN 'PARENT_NOT_LATEST_VERSION' WHEN ?>${nowSQL} THEN 'ANOTHER_PROMPT_ACTIVE' ELSE 'A_TARGET_ALREADY_STARTED' END
          WHERE NOT EXISTS(SELECT 1 FROM prompt_lab_versions WHERE id=?) ON CONFLICT(id) DO NOTHING`).bind(row.id,parent,parent,firstTip,row.id),
        session.prepare(registrySelect+' WHERE v.id=?').bind(row.id),
        session.prepare('SELECT reason FROM prompt_lab_rejections WHERE id=?').bind(row.id)
      ]);
      processed.push(out.results.length?readPlan(out.results[0]):{id:row.id,status:'REJECTED',reason:failed.results[0]?.reason});
    }catch(error){
      if(!(error instanceof ProposalError))throw error;
      await session.prepare(`INSERT INTO prompt_lab_rejections(id,reason) SELECT ?,? WHERE NOT EXISTS
        (SELECT 1 FROM prompt_lab_versions WHERE id=?) ON CONFLICT(id) DO NOTHING`).bind(row.id,error.message,row.id).run();
      processed.push({id:row.id,status:'REJECTED',reason:error.message});
    }
  }
  return processed;
}
export async function closePromptExperiment(db,id,decision,summary){
  const aliases={PROPOSER_ADOPTION:'PROPOSE_ADOPTION',ABANDONNER:'ABANDON',NON_CONCLUANTE:'INCONCLUSIVE'};
  let status=aliases[decision]??decision;
  if(!['PROPOSE_ADOPTION','ABANDON','INCONCLUSIVE'].includes(status)||!summary||typeof summary!=='object')throw Error('MEASURED_FINAL_VERDICT_REQUIRED');
  const session=primary(db);
  const current=await readLabExperiment(session,id);
  if(!current || current.status!=='ACTIVE')return current;
  const expected=status==='PROPOSE_ADOPTION'?'PROPOSER_ADOPTION':status==='INCONCLUSIVE'?'NON_CONCLUANTE':'ABANDONNER';
  const verified=summary.decision===expected && summary.metric===current.metric &&
    Number.isInteger(summary.evaluated_games) && summary.evaluated_games>=0 && summary.target_count===current.targets.length &&
    Number.isInteger(summary.evaluated_cases) && summary.evaluated_cases>=0 && summary.evaluated_games<=summary.target_count;
  if(!verified)throw Error('MEASURED_FINAL_VERDICT_REQUIRED');
  const horizon=Math.max(Date.parse(current.review_at),Date.parse(current.cohort.end),...current.targets.map(t=>Date.parse(t.tip)));
  const all=summary.evaluated_games===current.targets.length;
  if(status==='ABANDON' && (!all || summary.evaluated_games<current.criterion.min_games ||
    !Number.isInteger(summary.evaluated_dates) || summary.evaluated_dates<current.effective_min_dates)){
    // Older callers used ABANDONNER for missing documentation. Preserve the measured
    // observations and distinguish inconclusive evidence from a negative result.
    status='INCONCLUSIVE';
    summary={...summary,decision:'NON_CONCLUANTE',conclusion:'INCONCLUSIVE',
      reason:'Documentation insuffisante pour conclure. '+(summary.reason??'Couverture de la cohorte incomplète.')};
  }
  const earliest=new Date(horizon+(all?0:72*3600000)).toISOString();
  if(status==='PROPOSE_ADOPTION' && !(all && summary.changed_games>0 && summary.reference_cases===summary.evaluated_cases &&
    summary.evaluated_games>=current.criterion.min_games &&
    summary.evaluated_dates>=Math.max(20,current.criterion.min_dates) && Number.isFinite(summary.interval_95?.[0]) &&
    summary.interval_95[0]>=current.criterion.min_gain && Number.isFinite(summary.interval_vs_primary_95?.[0]) && summary.interval_vs_primary_95[0]>=0))
    throw Error('PROMPT_ADOPTION_CRITERION_NOT_MET');
  const [,r]=await session.batch([
    session.prepare(`UPDATE prompt_lab_experiments SET status=?,closed_at=${nowSQL},decision_json=? WHERE id=? AND status='ACTIVE' AND ${nowSQL}>=?`)
      .bind(status==='INCONCLUSIVE'?'ABANDON':status,JSON.stringify(summary),id,earliest),
    session.prepare(registrySelect+' WHERE v.id=?').bind(id)
  ]);
  return readPlan(r.results[0]);
}
