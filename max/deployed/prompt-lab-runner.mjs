import {readResearchInbox,classifyFacts} from './research-journal.mjs';
import {eligibleForExperiment,readActiveExperiment,processPromptInbox,readLabExperiments,closePromptExperiment} from './prompt-lab-store.mjs';
import {capturePromptPair,readPromptScore} from './prompt-lab-score.mjs';

const clock = () => new Date().toISOString();

function scopedReport(row, experiment) {
  const raw = JSON.parse(row.envelope).report;
  if (!raw || typeof raw.summary !== 'string' || !raw.summary.trim()) return null;
  const earliest = Math.max(Date.parse(row.baseline_received_at),Date.parse(experiment.created_at));
  const last = Date.parse(row.generated_at);
  const timely = f => {
    const t = Date.parse(f?.checked_at);
    return Number.isFinite(t) && t >= earliest && t <= last;
  };
  const sources=(Array.isArray(raw.sources)?raw.sources:[]).filter(timely);
  const injuries=raw.verified_injuries??[],roles=raw.verified_role_facts??[];
  if(!Array.isArray(injuries)||!Array.isArray(roles))return null;
  if(row.outcome==='NO_FINDING')return injuries.length||roles.length?null:{negative:true,sources};
  const availability=experiment.target==='AVAILABILITY';
  // A supplement cannot change the other field, a starter, a quote or the team model.
  if((availability && roles.length) || (!availability && injuries.length)) return null;
  const entries=availability?injuries:roles;
  if(!entries.length || entries.some(f=>!timely(f) || !sources.some(s=>s.url===f.source_url) ||
      (!availability && (!Number.isFinite(f.minutes_limit)||f.starter!==undefined))))return null;
  return {report:{schema_version:raw.schema_version,match_id:row.match_id,generated_at:row.generated_at,
    summary:raw.summary,sources,verified_injuries:availability?entries:[],verified_role_facts:availability?[]:entries}};
}

// Model and common inputs are provided by the existing main collection. The optional branch
// creates three in-memory outputs and only the experimental tables receive the result.
export async function captureForPrompt(db,{ctx,at,trigger,standardInbox,normalInputs,normalPair,
  validateResearch,makeExperimental,baseSignature,active=null}) {
  const exp=active??await readActiveExperiment(db), g=ctx.game;
  if(!exp || !eligibleForExperiment(exp,g,at))return;
  const data=await db.prepare(`SELECT s.*,b.received_at AS baseline_received_at FROM prompt_lab_supplements s
    JOIN macfly_inbox b ON b.id=s.baseline_receipt_id AND b.match_id=s.match_id
    WHERE s.experiment_id=? AND s.match_id=? AND s.received_at<=? AND s.received_at<?
    ORDER BY s.generated_at,s.id`).bind(exp.id,String(g.id),at,g.start).all();
  const baselineIds=new Set(standardInbox.receipts.map(r=>r.id));
  const rows=[],negative=[];
  for(const item of data.results){
    if(!baselineIds.has(item.baseline_receipt_id))continue;
    const scoped=scopedReport(item,exp);
    if(!scoped)continue;
    if(scoped.negative){negative.push(item.id);continue;}
    rows.push({...item,report_json:JSON.stringify(scoped.report)});
  }
  const extra=await readResearchInbox(db,g,at,validateResearch,new Map(ctx.rosters),null,rows);
  const reviewed=new Set(extra.facts.filter(f=>f.player_id).map(f=>f.receipt_id));
  const receiptIds=[...negative,...extra.receipts.map(r=>r.id).filter(id=>reviewed.has(id))].sort((a,b)=>a-b);
  const {pair:withPrompt,inputs}=extra.verified?makeExperimental(extra.verified,extra.facts):{pair:normalPair,inputs:normalInputs};
  const facts=classifyFacts(extra.facts,{official:inputs.official,direct:normalInputs.official,roles:inputs.roles}).map(f=>{
    if(f.kind==='ROTATION' && f.effect!=='UNMATCHED_PLAYER'){
      const matches=r=>String(r.player_id)===f.player_id && String(r.team_id)===f.team_id && r.minutes_limit===f.minutes_limit;
      if(normalInputs.roles.some(matches))return {...f,effect:'ALREADY_KNOWN'};
      if(f.effect==='APPLIED' && !inputs.roles.some(matches))return {...f,effect:'SUPERSEDED'};
    }
    return f;
  });
  const rotation=exp.target==='MINUTES_LIMIT';
  const primary=normalPair.primary,control=rotation?normalPair.variant:primary,variant=rotation?withPrompt.variant:withPrompt.primary;
  // Distinct timed editions of a changing normal input can coexist. A redelivery of the
  // same sealed context and identical research cannot manufacture another evaluated game.
  return capturePromptPair(db,{experiment:exp,game:g,primary,control,variant,receipt_ids:receiptIds,
    facts,delivery_key:await contentHash([exp.id,g.id,trigger,baseSignature,receiptIds,
      [primary,control,variant].map(s=>s?[s.forecast,s.player_points]:null)])});
}

async function contentHash(value){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}

export async function reviewPromptLab(db){
  const active=await readActiveExperiment(db);
  if(active){
    const score=await readPromptScore(db,active,clock());
    if(['ABANDONNER','PROPOSER_ADOPTION'].includes(score.decision))await closePromptExperiment(db,active.id,score.decision,score);
  }
  return processPromptInbox(db);
}
export async function promptLabSummary(db){
  const rows=await readLabExperiments(db);
  const reviews=rows.filter(x=>x.action==='NO_PROMPT');
  const experiments=await Promise.all(rows.filter(x=>x.action==='TEST').map(async x=>({...x,
    score:x.decision_summary??x.decision??await readPromptScore(db,x,clock())})));
  return {experiments,reviews,active_id:experiments.find(x=>x.status==='ACTIVE')?.id??null,
    simulation_only:true,auto_adoption:false};
}
