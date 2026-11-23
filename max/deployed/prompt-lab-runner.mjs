import {readResearchInbox,classifyFacts} from './research-journal.mjs';
import {eligibleForExperiment,readActiveExperiment,processPromptInbox,readLabExperiment,readLabExperiments,closePromptExperiment} from './prompt-lab-store.mjs';
import {capturePromptPair,readPromptScore} from './prompt-lab-score.mjs';

const clock = () => new Date().toISOString();

const session = db => db.withSession ? db.withSession('first-primary') : db;
const utc = stamp => typeof stamp==='string' && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;

export async function confirmPromptRead(db,experimentId,baselineReceiptId) {
  if(!Number.isSafeInteger(baselineReceiptId) || baselineReceiptId<1)throw Error('INVALID_PROMPT_READ_RECEIPT');
  const store=session(db);
  const [,readback]=await store.batch([
    store.prepare(`INSERT INTO prompt_lab_read_confirmations(read_id)
      SELECT id FROM prompt_lab_reads WHERE experiment_id=? AND baseline_receipt_id=?
      ON CONFLICT(read_id) DO NOTHING`).bind(experimentId,baselineReceiptId),
    store.prepare(`SELECT r.id AS read_id,r.experiment_id,r.baseline_receipt_id,r.run_id,c.confirmed_at
      FROM prompt_lab_reads r JOIN prompt_lab_read_confirmations c ON c.read_id=r.id
      WHERE r.experiment_id=? AND r.baseline_receipt_id=?`).bind(experimentId,baselineReceiptId)
  ]);
  if(!readback.results[0])throw Error('PROMPT_READ_NOT_FOUND');
  return readback.results[0];
}

function publishedSource(s){
  if(!s || typeof s.url!=='string' || !utc(s.checked_at))return false;
  try {
    const u=new URL(s.url);
    return u.protocol==='https:' && !u.username && !u.password && !u.port
      && (u.hostname==='nba.com' || u.hostname.endsWith('.nba.com')) && s.kind==='OFFICIAL'
      && (s.published_at==null || utc(s.published_at) && utc(s.published_at)<=utc(s.checked_at));
  }catch{return false;}
}

function scopedReport(row,experiment){
  const raw=JSON.parse(row.envelope).report;
  if(!raw || typeof raw.summary!=='string' || !raw.summary.trim())return {issue:'Résumé du supplément absent.'};
  if(!row.confirmed_at)return {issue:'Aucun acquittement de lecture enregistré pour cette édition.'};
  const earliest=Math.max(Date.parse(row.confirmed_at),Date.parse(row.baseline_received_at),Date.parse(experiment.created_at));
  const timely=f=>Date.parse(f?.checked_at)>=earliest && Date.parse(f?.checked_at)<=Date.parse(row.generated_at);
  const sources=Array.isArray(raw.sources)?raw.sources:[];
  if(sources.some(s=>!publishedSource(s)||!timely(s)))return {issue:'Source officielle ou heure de vérification invalide pour ce passage.'};
  const injuries=raw.verified_injuries??[],roles=raw.verified_role_facts??[];
  if(!Array.isArray(injuries)||!Array.isArray(roles))return {issue:'Liste de faits invalide.'};
  if(row.outcome==='NO_FINDING'){
    if(injuries.length || roles.length)return {issue:'Le rapport déclaré sans résultat contient un fait.'};
    if(!sources.length && (typeof raw.access_issue!=='string'||!raw.access_issue.trim()))
      return {issue:'Aucune vérification ni difficulté d’accès documentée.'};
    return {negative:true};
  }
  const availability=experiment.target==='AVAILABILITY';
  // Each experiment alters a single research question. Extra fields never enter the ordinary engine.
  if((availability && roles.length) || (!availability && injuries.length))return {issue:'Fait hors du sujet préenregistré.'};
  const entries=availability?injuries:roles;
  const target=experiment.targets.find(t=>String(t.match_id)===row.match_id);
  if(target?.player_ids && entries.some(f=>!target.player_ids.includes(String(f?.player_id))))return {issue:'Joueur hors de la liste préenregistrée.'};
  if(!entries.length || entries.some(f=>!timely(f) || !sources.some(s=>s.url===f.source_url) ||
    (!availability && (!Number.isFinite(f.minutes_limit) || f.starter!==undefined))))
    return {issue:'Fait ou heure de vérification incompatible avec les sources du passage.'};
  return {report:{schema_version:raw.schema_version,match_id:row.match_id,generated_at:row.generated_at,
    summary:raw.summary,sources,verified_injuries:availability?entries:[],verified_role_facts:availability?[]:entries}};
}

// Model and common inputs are provided by the existing main collection. The optional branch
// creates three in-memory outputs and only the experimental tables receive the result.
export async function captureForPrompt(db,{ctx,at,trigger,standardInbox,normalInputs,normalPair,
  validateResearch,makeExperimental,baseSignature,active=null}) {
  const exp=active??await readActiveExperiment(db), g=ctx.game;
  if(!exp || !eligibleForExperiment(exp,g,at))return;
  const data=await db.prepare(`SELECT s.*,b.received_at AS baseline_received_at,c.confirmed_at FROM prompt_lab_supplements s
    JOIN macfly_inbox b ON b.id=s.baseline_receipt_id AND b.match_id=s.match_id
    JOIN prompt_lab_reads r ON r.id=json_extract(s.envelope,'$.read_id') AND r.experiment_id=s.experiment_id AND r.baseline_receipt_id=s.baseline_receipt_id
    JOIN prompt_lab_read_confirmations c ON c.read_id=r.id
    WHERE s.experiment_id=? AND s.match_id=? AND s.received_at<=? AND s.received_at<?
    ORDER BY s.generated_at,s.id`).bind(exp.id,String(g.id),at,g.start).all();
  const baselineIds=new Set(standardInbox.receipts.map(r=>r.id));
  const unblinded=await db.prepare(`SELECT u.baseline_receipt_id FROM prompt_lab_unblinded_baselines u
    JOIN macfly_inbox b ON b.id=u.baseline_receipt_id WHERE b.match_id=? AND b.received_at<=?`).bind(String(g.id),at).all();
  const input_exclusion=unblinded.results.some(r=>baselineIds.has(r.baseline_receipt_id))?'BASELINE_AFTER_PROMPT_READ':null;
  const rows=[],negative=[];
  for(const item of data.results){
    if(!baselineIds.has(item.baseline_receipt_id))continue;
    const scoped=scopedReport(item,exp);
    if(scoped.issue)continue;
    if(scoped.negative){negative.push(item.id);continue;}
    rows.push({...item,report_json:JSON.stringify(scoped.report)});
  }
  const extra=await readResearchInbox(db,g,at,validateResearch,new Map(ctx.rosters),null,rows);
  const reviewed=new Set(extra.facts.filter(f=>f.player_id).map(f=>f.receipt_id));
  const receiptIds=[...negative,...extra.receipts.map(r=>r.id).filter(id=>reviewed.has(id))].sort((a,b)=>a-b);
  const {pair:withPrompt,inputs}=extra.verified?makeExperimental(extra.verified,extra.facts):{pair:normalPair,inputs:normalInputs};
  const facts=classifyFacts(extra.facts,{official:inputs.official,direct:normalInputs.official,roles:inputs.roles}).map(f=>{
    if(f.kind==='ROTATION' && ['APPLIED','ALREADY_KNOWN','SUPERSEDED'].includes(f.effect)){
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
  return capturePromptPair(db,{experiment:exp,game:g,primary,control,variant,asOf:at,input_exclusion,receipt_ids:receiptIds,
    facts,delivery_key:await contentHash([exp.id,g.id,trigger,baseSignature,receiptIds,
      [primary,control,variant].map(s=>s?[s.forecast,s.player_points]:null)])});
}

async function contentHash(value){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}

// The public history follows recorded foreign keys and the actual receipts in each frozen pair.
// It never writes an acknowledgment or deduces one from a page view.
export async function readPromptExecutionTrace(db,experimentOrId){
  const experiment=typeof experimentOrId==='string'?await readLabExperiment(db,experimentOrId):experimentOrId;
  if(!experiment?.targets?.length)return [];
  const store=session(db),id=experiment.id;
  const [readRows,reports,pairs,outcomes,normalVersions]=await store.batch([
    store.prepare(`SELECT r.id,r.run_id,r.received_at,c.confirmed_at,b.id AS baseline_receipt_id,b.match_id,b.received_at AS baseline_received_at
      FROM prompt_lab_reads r JOIN macfly_inbox b ON b.id=r.baseline_receipt_id
      LEFT JOIN prompt_lab_read_confirmations c ON c.read_id=r.id WHERE r.experiment_id=? ORDER BY r.id`).bind(id),
    store.prepare(`SELECT s.*,b.received_at AS baseline_received_at FROM prompt_lab_supplements s
      JOIN macfly_inbox b ON b.id=s.baseline_receipt_id WHERE s.experiment_id=? ORDER BY s.id`).bind(id),
    store.prepare(`SELECT id,match_id,as_of,integrated_at,json_extract(payload,'$.exclusion') AS exclusion,
      json_extract(payload,'$.facts') AS facts,json_extract(payload,'$.receipt_ids') AS receipt_ids,
      json_extract(payload,'$.changed') AS changed,json_extract(payload,'$.effects') AS effects
      FROM prompt_lab_pairs WHERE experiment_id=? AND json_array_length(payload,'$.receipt_ids')>0 ORDER BY integrated_at,id`).bind(id),
    store.prepare(`SELECT match_id,pair_id,observed_at,json_extract(payload,'$.cases') AS cases,
      json_extract(payload,'$.issue') AS issue FROM prompt_lab_outcomes WHERE experiment_id=?`).bind(id),
    store.prepare(`WITH baselines AS (
      SELECT baseline_receipt_id FROM prompt_lab_reads WHERE experiment_id=?
      UNION SELECT baseline_receipt_id FROM prompt_lab_supplements WHERE experiment_id=?
    )
    SELECT b.id AS receipt_id,v.id AS version_id,v.integrated_at FROM baselines x JOIN macfly_inbox b ON b.id=x.baseline_receipt_id
      JOIN max_forecast_versions v ON v.id=(SELECT j.id FROM max_forecast_versions j,json_each(j.payload,'$.receipts') r
        WHERE j.match_id=b.match_id AND j.as_of>=b.received_at AND j.integrated_at<j.tip
        AND json_extract(r.value,'$.id')=b.id AND json_extract(r.value,'$.match_id')=b.match_id
        ORDER BY j.integrated_at,j.id LIMIT 1)`).bind(id,id)
  ]);
  const normalByReceipt=new Map(normalVersions.results.map(v=>[v.receipt_id,v]));
  const byReport=new Map();
  for(const p of pairs.results){
    const pair={...p,facts:JSON.parse(p.facts??'[]'),receipt_ids:JSON.parse(p.receipt_ids??'[]'),effects:JSON.parse(p.effects??'null')};
    for(const receiptId of pair.receipt_ids){
      if(!byReport.has(receiptId))byReport.set(receiptId,[]);
      byReport.get(receiptId).push(pair);
    }
  }
  const result=new Map(outcomes.results.map(r=>[r.match_id,r]));
  const traces=[];
  for(const target of experiment.targets){
    const reads=readRows.results.filter(r=>r.match_id===target.match_id);
    const supplements=reports.results.filter(r=>r.match_id===target.match_id);
    const seenReads=new Set();
    function trace(read=null,row=null){
      const envelope=row?JSON.parse(row.envelope):null,raw=envelope?.report;
      const versions=(byReport.get(row?.id)??[]).filter(p=>p.match_id===target.match_id && p.as_of>=row.received_at && p.integrated_at<target.tip);
      const first=versions.find(p=>!p.exclusion);
      const final=result.get(target.match_id);
      const used=versions.some(p=>p.id===final?.pair_id && !p.exclusion);
      const facts=(first?.facts??[]).filter(f=>f.receipt_id===row?.id);
      const sources=(Array.isArray(raw?.sources)?raw.sources:[]).filter(publishedSource).map(s=>({
        url:s.url,title:typeof s.title==='string'?s.title:null,published_at:utc(s.published_at),checked_at:utc(s.checked_at)}));
      const baselineId=row?.baseline_receipt_id??read?.baseline_receipt_id??null, normal=normalByReceipt.get(baselineId);
      const entry={match_id:target.match_id,tip:target.tip,read_id:read?.id??null,run_id:read?.run_id??null,
        read_at:read?.received_at??null,confirmed_at:read?.confirmed_at??null,
        baseline_receipt_id:baselineId,standard_version_id:normal?.version_id??null,standard_integrated_at:normal?.integrated_at??null,baseline_received_at:row?.baseline_received_at??read?.baseline_received_at??null,
        report_id:row?.id??null,generated_at:row?.generated_at??null,received_at:row?.received_at??null,
        version_id:first?.id??null,as_of:first?.as_of??null,integrated_at:first?.integrated_at??null,
        outcome_pair_id:used?final.pair_id:null,outcome_at:used?final.observed_at:null,
        evaluated_cases:used&&!final.issue?final.cases:null,outcome_used:used,sources,facts,changed:null};
      if(!row){
        if(!read)return {...entry,state:'NOT_READ',reason:'Aucune lecture authentifiée enregistrée pour ce match.'};
        return read.confirmed_at?{...entry,state:'READ',reason:'Lecture confirmée. Aucun supplément reçu pour ce passage.'}
          :{...entry,state:'READ_PENDING',reason:'Le reçu de lecture attend l’acquittement de la file.'};
      }
      if(!read?.confirmed_at)return {...entry,state:'LEGACY_UNATTESTED',reason:'Cette édition précède la preuve de lecture. Seules ses traces enregistrées sont disponibles.'};
      if(!first){
        const scope=scopedReport({...row,confirmed_at:read.confirmed_at},experiment);
        const exclusion=versions.find(p=>p.exclusion)?.exclusion;
        const reason=row.received_at>=target.tip?'Le supplément est arrivé après le début du match.'
          :scope.issue??(exclusion?'Comparaison écartée ('+exclusion+').':'Aucune prévision appariée recevable ne contient ce rapport.');
        return {...entry,state:'NOT_INTEGRATED',reason};
      }
      if(row.outcome==='NO_FINDING')return {...entry,state:'NO_FINDING',reason:raw.access_issue??raw.summary,changed:false};
      if(facts.length && facts.every(f=>f.effect==='ALREADY_KNOWN'))
        return {...entry,state:'ALREADY_KNOWN',reason:'Le moteur disposait déjà des faits confirmés par ce rapport.',changed:false};
      if(!facts.some(f=>f.effect==='APPLIED'))
        return {...entry,state:'NOT_INTEGRATED',reviewed_at:first.integrated_at,integrated_at:null,reason:'Aucun fait applicable de ce rapport dans la version. '+[...new Set(facts.map(f=>f.effect))].join(', '),changed:false};
      const appliedTogether=new Set(first.facts.filter(f=>f.effect==='APPLIED').map(f=>f.receipt_id));
      // A joint revision can be attributed only to the group of simultaneously applied reports.
      const changed=Boolean(first.changed||first.effects?.changed_status||first.effects?.changed_minutes||first.effects?.changed_points);
      return {...entry,state:'FOUND',changed:appliedTogether.size===1?changed:null,group_report_ids:[...appliedTogether],
        reason:appliedTogether.size>1?'Cette version compare conjointement les faits de plusieurs rapports.':changed?
          'Information appliquée. La projection expérimentale a changé.':'Information appliquée sans changement chiffré.'};
    }
    for(const row of supplements){
      const readId=JSON.parse(row.envelope).read_id;
      const read=reads.find(r=>r.id===readId && r.baseline_receipt_id===row.baseline_receipt_id);
      if(read)seenReads.add(read.id);
      traces.push(trace(read,row));
    }
    for(const read of reads)if(!seenReads.has(read.id))traces.push(trace(read));
    if(!reads.length && !supplements.length)traces.push(trace());
  }
  return traces;
}

export async function reviewPromptLab(db){
  const active=await readActiveExperiment(db);
  if(active){
    const score=await readPromptScore(db,active,clock());
    if(['ABANDONNER','PROPOSER_ADOPTION','NON_CONCLUANTE'].includes(score.decision))await closePromptExperiment(db,active.id,score.decision,score);
  }
  return processPromptInbox(db);
}
export async function promptLabSummary(db,id=null){
  const rows=id==null?await readLabExperiments(db):[await readLabExperiment(db,id)].filter(Boolean);
  const reviews=rows.filter(x=>x.action==='NO_PROMPT');
  const experiments=await Promise.all(rows.filter(x=>x.action==='TEST').map(async x=>{
    const [trace,score]=await Promise.all([readPromptExecutionTrace(db,x),
      x.decision_summary??x.decision??readPromptScore(db,x,clock())]);
    return {...x,trace,score};
  }));
  return {experiments,reviews,active_id:experiments.find(x=>x.status==='ACTIVE')?.id??null,
    simulation_only:true,auto_adoption:false};
}
