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
function readPlan(row){
  return row ? {...JSON.parse(row.plan_json),id:row.id,status:row.status,created_at:row.created_at,
    received_at:row.received_at,closed_at:row.closed_at,decision:row.decision_json?JSON.parse(row.decision_json):null} : null;
}

export async function readActiveExperiment(db){
  return readPlan(await primary(db).prepare("SELECT * FROM prompt_lab_experiments WHERE status='ACTIVE'").first());
}
export async function readLabExperiments(db){
  const rows=await primary(db).prepare('SELECT * FROM prompt_lab_experiments ORDER BY created_at DESC,id DESC').all();
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
    targets.push({match_id:id,tip,...(t.source_url?{source_url:t.source_url}:{})});
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
  return {...plan,hypothesis:proposal.hypothesis,prompt:proposal.prompt,metric:proposal.metric,criterion,cohort,targets,
    effective_min_dates:Math.max(20,criterion.min_dates),exploratory:new Set(targets.map(t=>t.tip.slice(0,10))).size<20};
}

export async function processPromptInbox(db,onlyId=null){
  const session=primary(db);
  const pending=await session.prepare(`SELECT i.id,i.payload,i.received_at FROM prompt_lab_inbox i
    LEFT JOIN prompt_lab_experiments e ON e.id=i.id LEFT JOIN prompt_lab_rejections r ON r.id=i.id
    WHERE e.id IS NULL AND r.id IS NULL AND (? IS NULL OR i.id=?) ORDER BY i.received_at,i.rowid LIMIT 12`).bind(onlyId,onlyId).all();
  const processed=[];
  for(const row of pending.results){
    try{
      const plan=await validateProposal(session,JSON.parse(row.payload),row.received_at);
      const status=plan.action==='TEST'?'ACTIVE':'NO_PROMPT';
      const firstTip=status==='ACTIVE'?plan.targets.reduce((min,t)=>t.tip<min?t.tip:min,plan.targets[0].tip):null;
      const [,,out,failed]=await session.batch([
        session.prepare(`INSERT INTO prompt_lab_experiments(id,received_at,status,plan_json)
          SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM prompt_lab_rejections WHERE id=?)
            AND (?='NO_PROMPT' OR (${nowSQL}<? AND NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE status='ACTIVE')))
          ON CONFLICT DO NOTHING`).bind(row.id,row.received_at,status,JSON.stringify(plan),row.id,status,firstTip),
        session.prepare(`INSERT INTO prompt_lab_rejections(id,reason)
          SELECT ?,CASE WHEN ?>${nowSQL} THEN 'ANOTHER_PROMPT_ACTIVE' ELSE 'A_TARGET_ALREADY_STARTED' END
          WHERE NOT EXISTS(SELECT 1 FROM prompt_lab_experiments WHERE id=?) ON CONFLICT(id) DO NOTHING`).bind(row.id,firstTip,row.id),
        session.prepare('SELECT * FROM prompt_lab_experiments WHERE id=?').bind(row.id),
        session.prepare('SELECT reason FROM prompt_lab_rejections WHERE id=?').bind(row.id)
      ]);
      processed.push(out.results.length?readPlan(out.results[0]):{id:row.id,status:'REJECTED',reason:failed.results[0]?.reason});
    }catch(error){
      if(!(error instanceof ProposalError))throw error;
      await session.prepare(`INSERT INTO prompt_lab_rejections(id,reason) SELECT ?,? WHERE NOT EXISTS
        (SELECT 1 FROM prompt_lab_experiments WHERE id=?) ON CONFLICT(id) DO NOTHING`).bind(row.id,error.message,row.id).run();
      processed.push({id:row.id,status:'REJECTED',reason:error.message});
    }
  }
  return processed;
}
export async function closePromptExperiment(db,id,decision,summary){
  const aliases={PROPOSER_ADOPTION:'PROPOSE_ADOPTION',ABANDONNER:'ABANDON'};
  const status=aliases[decision]??decision;
  if(!['PROPOSE_ADOPTION','ABANDON'].includes(status)||!summary||typeof summary!=='object')throw Error('MEASURED_FINAL_VERDICT_REQUIRED');
  const session=primary(db);
  const current=readPlan(await session.prepare('SELECT * FROM prompt_lab_experiments WHERE id=?').bind(id).first());
  if(!current || current.status!=='ACTIVE')return current;
  const expected=status==='PROPOSE_ADOPTION'?'PROPOSER_ADOPTION':'ABANDONNER';
  const verified=summary.decision===expected && summary.metric===current.metric &&
    Number.isInteger(summary.evaluated_games) && summary.evaluated_games>=0 && summary.target_count===current.targets.length &&
    Number.isInteger(summary.evaluated_cases) && summary.evaluated_cases>=0 && summary.evaluated_games<=summary.target_count;
  if(!verified)throw Error('MEASURED_FINAL_VERDICT_REQUIRED');
  const horizon=Math.max(Date.parse(current.cohort.end),...current.targets.map(t=>Date.parse(t.tip)));
  const all=summary.evaluated_games===current.targets.length;
  const earliest=new Date(horizon+(all?0:72*3600000)).toISOString();
  if(status==='PROPOSE_ADOPTION' && !(all && summary.changed_games>0 && summary.evaluated_games>=current.criterion.min_games &&
    summary.evaluated_dates>=Math.max(20,current.criterion.min_dates) && Number.isFinite(summary.interval_95?.[0]) &&
    summary.interval_95[0]>=current.criterion.min_gain && Number.isFinite(summary.interval_vs_primary_95?.[0]) && summary.interval_vs_primary_95[0]>=0))
    throw Error('PROMPT_ADOPTION_CRITERION_NOT_MET');
  const [,r]=await session.batch([
    session.prepare(`UPDATE prompt_lab_experiments SET status=?,closed_at=${nowSQL},decision_json=? WHERE id=? AND status='ACTIVE' AND ${nowSQL}>=?`)
      .bind(status,JSON.stringify(summary),id,earliest),
    session.prepare('SELECT * FROM prompt_lab_experiments WHERE id=?').bind(id)
  ]);
  return readPlan(r.results[0]);
}
