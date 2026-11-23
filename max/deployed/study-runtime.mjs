import {captureForPrompt,reviewPromptLab,promptLabSummary} from './prompt-lab-runner.mjs';
import {settlePromptGame} from './prompt-lab-score.mjs';
import {eligibleForExperiment,readActiveExperiment} from './prompt-lab-store.mjs';
export {promptLabSummary};
import { ADVANCED_VERSION } from './advanced.mjs';
import { projectPlayerPoints } from './points.mjs';
import { rotationTrial } from './experiments.mjs';
import { reportTimestamp, rosterFilteredBoxes } from './collectors.mjs';
import { playerIdentity } from './identity.mjs';
import { classifyFacts, forecastView, readJournalVersions, readInboxRows, readResearchInbox, saveJournalVersion } from './research-journal.mjs';
import { studyPair, evaluateStudyGame, summarizeStudy } from './evaluation-study.mjs';
import {agendaFromGames,researchPriority,RESEARCH_MAX_AGE_MS} from './scheduler.mjs';
import { MARKET_RULE, recordMarket, recordFinalMarket, readMarket, readDecisions } from './market-study.mjs';

const sides = ['home','away'];
const current = () => new Date().toISOString();
const primary = db => db.withSession ? db.withSession('first-primary') : db;
const validAt = (g,at) => g.status === 'STATUS_SCHEDULED' && Date.parse(at) < Date.parse(g.start);
const rosterKey = (f) => String(f.team_id) + ':' + playerIdentity(f.player);
const dateOfFact = f => Date.parse(f.published_at ?? reportTimestamp(f.source_url) ?? f.checked_at);

// Keep up to twenty recent team boxes for the existing player windows and rotations.
export function contextForStudy(game, sourceAt, signature, forecast, injuries, medical, boxes, rosters, legacy) {
  const ids = sides.map(s => String(game[s].id));
  const selected = new Map();
  for (const id of ids) {
    const teamBoxes = boxes.filter(b => b.teams?.[id] && Date.parse(b.start) < Date.parse(sourceAt))
      .sort((a,b)=>b.start.localeCompare(a.start)).slice(0,20);
    for (const b of teamBoxes) {
      let box = selected.get(b.game_id);
      if (!box) { box = {...b, teams:{}}; selected.set(b.game_id,box); }
      box.teams[id] = b.teams[id];
    }
  }
  return {game:{id:String(game.id),start:game.start,status:game.status,home:game.home,away:game.away},
    sourceAt, signature, forecast, injuries, medical, boxes:[...selected.values()],
    rosters:ids.flatMap(id=>rosters.has(id)?[[id,rosters.get(id)]]:[]), legacy:legacy??null};
}
async function saveContext(db, ctx) {
  await db.prepare(`INSERT INTO study_context(match_id,source_at,tip,context) VALUES (?,?,?,?)
    ON CONFLICT(match_id) DO UPDATE SET source_at=excluded.source_at, tip=excluded.tip,context=excluded.context
    WHERE excluded.source_at > study_context.source_at`).bind(ctx.game.id,ctx.sourceAt,ctx.game.start,JSON.stringify(ctx)).run();
}

function selectInputs(ctx, editorial, legacy, at) {
  const roles = new Map(), injuries = new Map();
  const medical = ctx.medical && Date.parse(at) - Date.parse(ctx.medical.published_at) <= 12*3600000 ? ctx.medical : null;
  const direct = sides.flatMap(s=>medical?.teams?.[s]?.players??[]);
  for (const f of direct) injuries.set(rosterKey(f),f);
  for (const report of [legacy,editorial]) {
    for (const f of report?.verified_injuries??[]) {
      const side=sides.find(s=>String(ctx.game[s].id)===String(f.team_id));
      const directTeam=medical?.teams?.[side];
      if (directTeam?.status==='SUBMITTED' && Date.parse(medical.published_at)>=dateOfFact(f)) continue;
      const key=rosterKey(f), previous=injuries.get(key);
      if (!previous || dateOfFact(f)>=dateOfFact(previous)) injuries.set(key,f);
    }
    for (const f of report?.verified_role_facts??[]) {
      const key=rosterKey(f), previous=roles.get(key);
      if (!previous || dateOfFact(f)>=dateOfFact(previous)) roles.set(key,f);
    }
  }
  return {direct,official:[...injuries.values()],roles:[...roles.values()],medical};
}

function additionalInputs(inputs,extra,standardFacts,extraFacts,legacyRaw){
  // Verification time alone cannot reverse a conflicting, dated announcement.
  const official=new Map(inputs.official.map(f=>[rosterKey(f),f]));
  const roles=new Map(inputs.roles.map(f=>[rosterKey(f),f]));
  const publication=(f,facts,report)=>{
    const known=facts.find(r=>r.team_id===String(f.team_id)&&rosterKey(r)===rosterKey(f)
      && r.source_url===f.source_url && r.checked_at===f.checked_at);
    const inReport=report?.sources?.find(s=>s.url===f.source_url);
    return Date.parse(f.published_at??known?.published_at??reportTimestamp(f.source_url)??inReport?.published_at);
  };
  for(const [items,map,isMedical] of [[extra.verified_injuries,official,true],[extra.verified_role_facts,roles,false]]){
    for(const f of items??[]){
      const key=rosterKey(f), prior=map.get(key);
      const date=publication(f,extraFacts,null);
      const team=Object.values(inputs.medical?.teams??{}).find(t=>String(t.team_id)===String(f.team_id));
      if(isMedical && team?.status==='SUBMITTED' && (!Number.isFinite(date)||Date.parse(inputs.medical.published_at)>=date))continue;
      if(prior){
        if(isMedical?f.status===prior.status:f.minutes_limit===prior.minutes_limit)continue;
        const previous=publication(prior,standardFacts,legacyRaw);
        if(!Number.isFinite(previous)||!Number.isFinite(date)||date<=previous)continue;
      }
      map.set(key,{...f,...(Number.isFinite(date)?{published_at:new Date(date).toISOString()}:{})});
    }
  }
  return {...inputs,official:[...official.values()],roles:[...roles.values()]};
}

function model(ctx, rosters, inputs, at){
  const pp=projectPlayerPoints(ctx.game,ctx.boxes,ctx.injuries,inputs.official,ctx.forecast,at);
  const trial=rotationTrial(ctx.game,ctx.boxes,rosters,inputs.official,inputs.roles,
    {...ctx.forecast,engine_version:ADVANCED_VERSION},at,inputs.medical);
  return {points:pp,trial,view:forecastView(ctx.forecast,pp,trial)};
}
function compactPair(game,at,token,forecast,points,trial){
  const pair=studyPair(game,at,token,{...forecast,engine_version:ADVANCED_VERSION},points,trial);
  for(const snap of [pair.primary,pair.variant].filter(Boolean)){
    snap.forecast={probability_home:snap.forecast?.probability_home,projected_score:snap.forecast?.projected_score,
      engine_version:snap.forecast?.engine_version??snap.forecast?.model??null};
    snap.player_points=Object.fromEntries(sides.map(s=>[s,{players:(snap.player_points?.[s]?.players??[]).map(p=>({
      id:p.id,team_id:game[s].id,name:p.name,availability:p.availability,status:p.status??p.reported_status,
      predicted_points_if_active:p.predicted_points_if_active??p.points_if_active,
      projected_minutes_if_active:p.projected_minutes_if_active??p.minutes_if_active,scenarios:p.scenarios
    }))}]));
  }
  return pair;
}
async function digest(value){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))));
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function publicRevision(version) {
  const r=version?.revision;
  if(!r)return null;
  const control=version.pair?.incremental_before??r.without_macfly;
  const numbers=view=>['primary','challenger'].map(key=>{
    const f=view?.[key];return f?[f.probability_home,f.total,...f.players.map(p=>[p.team_id,p.player_id,p.minutes,p.points])]:null;
  });
  return {...r,changed:JSON.stringify(numbers(control))!==JSON.stringify(numbers(r.after)),without_macfly:control,
    at:version.integrated_at,group_id:String(version.id)};
}
const changedVersion = v => v.revision?.changes?.length>0;
function publicCard(versions,decision){
  const latest=versions.at(-1);
  return {pair:latest?{primary:latest.pair?.primary,variant:latest.pair?.variant}:null,
    revision:publicRevision(versions.filter(changedVersion).at(-1)),last_impact:versions.filter(changedVersion).map(publicRevision).filter(r=>r.changed && r.changes.some(f=>f.effect==='APPLIED')).at(-1)??null,decision:decision??null,
    integrated_at:latest?.integrated_at??null};
}

async function publishCard(db,game,versions,decision,report){
  const latest=versions.at(-1),card=publicCard(versions,decision);
  await db.prepare(`INSERT INTO study_display(match_id,version_id,card,report) VALUES(?,?,?,?)
    ON CONFLICT(match_id) DO UPDATE SET version_id=excluded.version_id,card=excluded.card,report=excluded.report
    WHERE excluded.version_id>=study_display.version_id`).bind(String(game.id),latest.id,JSON.stringify(card),report?JSON.stringify(report):null).run();
  return card;
}
// Isolated research replay: the standard cards, NBA research inbox and Winamax freeze are read-only here.
async function replayPrompt(db,ctx,validateResearch,trigger,active=null,known=null){
  const at=known?.at??current(), exp=active??await readActiveExperiment(db);
  if(!exp || !eligibleForExperiment(exp,ctx.game,at))return;
  const cutoff=Date.parse(at);
  if(Date.parse(ctx.sourceAt)>cutoff || Date.parse(ctx.medical?.checked_at)>cutoff ||
    ctx.rosters.some(([,r])=>Date.parse(r.checked_at)>cutoff) || ctx.boxes.some(b=>Date.parse(b.fetched_at)>cutoff))return;
  const rosters=new Map(ctx.rosters);
  const inbox=known?.inbox??await readResearchInbox(db,ctx.game,at,validateResearch,rosters);
  const legacy=validateResearch(ctx.legacy,ctx.game,at);
  const inputs=known?.inputs??selectInputs(ctx,inbox.verified,legacy,at);
  const standard=known?.full??model(ctx,rosters,inputs,at);
  const signature=known?.signature??await digest([ctx, inbox.receipts.map(r=>r.id),inbox.facts]);
  const pair=(m)=>compactPair(ctx.game,at,signature,ctx.forecast,m.points,m.trial);
  return captureForPrompt(db,{ctx,trigger,at,active:exp,standardInbox:inbox,normalInputs:inputs,normalPair:pair(standard),
    validateResearch,baseSignature:signature,makeExperimental:(extra,extraFacts)=>{
      const branch=additionalInputs(inputs,extra,inbox.facts,extraFacts,ctx.legacy);
      return {pair:pair(model(ctx,rosters,branch,at)),inputs:branch};
    }});
}
async function baselinePromptCapture(db,ctx,validateResearch,version,known=null){
  // The journal/market write has completed. A lab failure cannot interrupt the main operation.
  try{await replayPrompt(db,ctx,validateResearch,'standard:'+version.id,null,known);}
  catch(err){console.error('[PROMPT_LAB_CAPTURE]',ctx.game.id,String(err.message).slice(0,180));}
}

export async function tickPromptLab(db,validateResearch){
  const processed=await reviewPromptLab(db);
  for(const exp of processed.filter(x=>x.status==='ACTIVE')){
    // At registration, freeze both arms for upcoming targets already present between scheduled cycles.
    const now=current(),limit=new Date(Date.parse(now)+48*3600000).toISOString();
    const scheduled=await db.prepare(`SELECT c.context FROM study_context c
      JOIN prompt_lab_experiments e ON e.id=?
      JOIN json_each(e.plan_json,'$.targets') t ON json_extract(t.value,'$.match_id')=c.match_id
      WHERE c.tip>? AND c.tip<=? ORDER BY c.tip`).bind(exp.id,now,limit).all();
    for(const row of scheduled.results)await replayPrompt(db,JSON.parse(row.context),validateResearch,'registration:'+exp.id,exp);
  }
  return processed;
}

export async function refreshStudy(db, ctx, validateResearch, {persistContext=false, delivery=false}={}) {
  db=primary(db);
  const at=current(), game=ctx.game;
  if(!validAt(game,at))return null;
  if(persistContext)await saveContext(db,ctx);
  const rosters=new Map(ctx.rosters);
  const [versions,rows]=await Promise.all([readJournalVersions(db,game.id),readInboxRows(db,game,at)]);
  const inbox=await readResearchInbox(db,game,at,validateResearch,rosters,null,rows);
  const prior=versions.at(-1), ids=inbox.receipts.map(r=>r.id);
  const previousIds=new Set(prior?.receipts.map(r=>r.id)??[]);
  const fresh=ids.filter(id=>!previousIds.has(id));
  if(delivery && prior && fresh.length===0 && prior.as_of>=ctx.sourceAt){
    const decision=await recordMarket(db,game,prior,current());
    await baselinePromptCapture(db,ctx,validateResearch,prior);
    return {card:await publishCard(db,game,versions,decision,inbox.verified)};
  }
  const legacy=validateResearch(ctx.legacy,game,at);
  const inputs=selectInputs(ctx,inbox.verified,legacy,at);
  const baseInputs=selectInputs(ctx,null,legacy,at);
  const full=model(ctx,rosters,inputs,at);
  const base=inbox.facts.length?model(ctx,rosters,baseInputs,at):full;
  // At the same instant retain previous MacFly reports, remove only the newly received group.
  let previousModel=base;
  if(fresh.length && previousIds.size){
    const previous=await readResearchInbox(db,game,at,validateResearch,rosters,previousIds,rows);
    previousModel=model(ctx,rosters,selectInputs(ctx,previous.verified,legacy,at),at);
  }else if(!fresh.length)previousModel=full;
  const contextId=await digest([ctx.signature,ctx.forecast?.projected_score,ctx.forecast?.probability_home,baseInputs.official.map(f=>[rosterKey(f),f.status]),ctx.rosters.map(([id,r])=>[id,r.players.map(p=>[p.id,p.name])]),
    ctx.boxes.map(b=>[b.game_id,b.fetched_at]),ctx.injuries,legacy?.generated_at??null]);
  const evidenceId=await digest([contextId,inbox.facts,ids]);
  const pair=compactPair(game,at,evidenceId,ctx.forecast,full.points,full.trial);
  pair.control=compactPair(game,at,evidenceId,ctx.forecast,previousModel.points,previousModel.trial);
  pair.incremental_before=previousModel.view;
  pair.new_receipt_ids=fresh;
  pair.known_roles=inputs.roles.map(f=>({team_id:f.team_id,player_id:f.player_id,minutes_limit:f.minutes_limit,
    starter:f.starter,source_url:f.source_url,checked_at:f.checked_at}));
  pair.role_evidence_complete=true;
  const known=baseInputs.official;
  const facts=classifyFacts(inbox.facts,{official:inputs.official,direct:known,roles:inputs.roles});
  const saved=await saveJournalVersion(db,{game,asOf:at,receipts:inbox.receipts,facts,baseline:base.view,
    after:full.view,pair,inputSignature:contextId,deliveryKey:delivery?evidenceId:null});
  if(!saved)return null;
  const decision=await recordMarket(db,game,saved,current());
  await baselinePromptCapture(db,ctx,validateResearch,saved,{at,inbox,inputs,full,signature:evidenceId});
  const currentVersions=versions.some(v=>v.id===saved.id)?versions:[...versions,saved];
  return {card:await publishCard(db,game,currentVersions,decision,inbox.verified),research:inbox.verified,raw:inbox.raw,
    points:full.points,trial:full.trial,official:inputs.official,roles:inputs.roles};
}

function evaluationGroup(v,engine) {
  const changes=v.revision.changes.filter(f=>v.pair?.new_receipt_ids?.includes(f.receipt_id));
  if(!changes.length)return null;
  const key=engine==='principal'?'primary':'variant';
  return {at:v.as_of,group_id:String(v.id)+'-'+key,kinds:[...new Set(changes.map(f=>f.kind))],
    player_ids:changes.map(f=>f.player_id).filter(Boolean),controlled:true,
    already_known:changes.every(f=>f.effect==='ALREADY_KNOWN'),before:v.pair.control?.[key],after:v.pair[key]};
}
export async function settleStudy(db,game,box,asOf=current()){
  db=primary(db);
  const cutoff=Date.parse(asOf),tip=Date.parse(game.start),observed=Date.parse(game.fetched_at??asOf);
  if(![cutoff,tip,observed].every(Number.isFinite) || cutoff>Date.now()+1000 || observed<=tip || observed>cutoff || !String(game.status).includes('FINAL'))return;
  if(box && (String(box.game_id)!==String(game.id) || !Number.isFinite(Date.parse(box.fetched_at)) || Date.parse(box.fetched_at)>cutoff || Date.parse(box.fetched_at)<=tip))box=null;
  try{await settlePromptGame(db,game,box,asOf);}
  catch(err){console.error('[PROMPT_LAB_FINAL]',game.id,String(err.message).slice(0,180));}
  const versions=(await readJournalVersions(db,String(game.id))).filter(v=>v.tip===new Date(game.start).toISOString() && Date.parse(v.integrated_at)<Date.parse(game.start));
  if(!versions.length)return;
  await recordFinalMarket(db,game,asOf);
  // Pre-specified: last published capture before tip, even when the challenger is unavailable.
  const latest=versions.at(-1);
  const evalEngine=engine=>evaluateStudyGame({game,box,pair:latest.pair,revisions:versions.map(v=>evaluationGroup(v,engine)).filter(Boolean)});
  const result=evalEngine('variante');
  if(!result)return;
  result.observed_at=current();
  result.primary_information=evalEngine('principal')?.revisions??[];
  await db.prepare(`INSERT INTO study_results(match_id,tip,box_available,result) VALUES (?,?,?,?)
    ON CONFLICT(match_id) DO UPDATE SET result=excluded.result,box_available=excluded.box_available
    WHERE excluded.box_available>=study_results.box_available`).bind(String(game.id),game.start,Number(Boolean(box)),JSON.stringify(result)).run();
}

export async function studySummary(db) {
  const [rows,market,coverage]=await Promise.all([db.prepare('SELECT result FROM study_results ORDER BY tip,match_id').all(),readMarket(db),
    db.prepare(`SELECT count(DISTINCT match_id) AS games FROM max_forecast_versions
      WHERE json_type(payload,'$.pair.primary.forecast.probability_home') IN ('real','integer')`).first()]);
  market.decisionGames=market.analyzedGames;
  market.analyzedGames=coverage.games;
  const records=rows.results.map(r=>JSON.parse(r.result));
  const sport=summarizeStudy(records);
  sport.primary_macfly=summarizeStudy(records.map(r=>({...r,revisions:r.primary_information}))).macfly;
  return {sport,market,rule:MARKET_RULE,
    legacy_audit:{date:'2026-11-23',compared_checkpoints:301,over_15_minutes:15,unpaired:4,prospective:false},
    capture_rule:'Dernière capture publiée avant le coup d’envoi. Même heure et mêmes entrées pour les deux moteurs.'};
}
export async function gameStudy(db,id,knownTip=null){
  const [versions,decisions,record,receipts,context]=await Promise.all([readJournalVersions(db,id),readDecisions(db,[id]),
    db.prepare('SELECT result FROM study_results WHERE match_id=?').bind(id).first(),
    db.prepare('SELECT id,generated_at,received_at FROM macfly_inbox WHERE match_id=? ORDER BY id').bind(id).all(),
    db.prepare('SELECT tip FROM study_context WHERE match_id=?').bind(id).first()]);
  const used=new Map();
  for(const v of versions)for(const r of v.receipts)if(!used.has(r.id))used.set(r.id,v.integrated_at);
  const tip=context?.tip??versions.at(-1)?.tip??knownTip;
  const deliveries=receipts.results.map(r=>({...r,integrated_at:used.get(r.id)??null,state:used.has(r.id)?'INTEGRATED':
    Date.parse(r.received_at)>=Date.parse(tip)?'AFTER_TIP':'RECEIVED'}));
  return {...publicCard(versions,decisions.get(id)),deliveries,revisions:versions.map(v=>({id:v.id,integrated_at:v.integrated_at,
    as_of:v.as_of,revision:publicRevision(v)})),evaluation:record?JSON.parse(record.result):null};
}
export async function overlaySlate(db,slate){
  if(!slate?.games?.length)return slate;
  const ids=slate.games.map(g=>String(g.id));
  const placeholders=ids.map(()=>'?').join(',');
  const cache=await db.prepare(`SELECT match_id,card,report FROM study_display WHERE match_id IN (${placeholders})`).bind(...ids).all();
  const cards=new Map(cache.results.map(row=>[row.match_id,row]));
  const missing=ids.filter(id=>!cards.has(id));
  const [rows,decisions]=!missing.length?[{results:[]},new Map()]:await Promise.all([db.prepare(`SELECT match_id,payload,integrated_at FROM max_forecast_versions
    WHERE id IN (SELECT max(id) FROM max_forecast_versions WHERE match_id IN (${missing.map(()=>'?').join(',')}) GROUP BY match_id)`).bind(...missing).all(),readDecisions(db,missing)]);
  const latest=new Map(rows.results.map(row=>[row.match_id,row]));
  for(const g of slate.games){
    const cached=cards.get(String(g.id));
    if(cached){
      g.study=JSON.parse(cached.card);
      const report=cached.report?JSON.parse(cached.report):null;
      if(report && Date.now()-Date.parse(report.generated_at)<=RESEARCH_MAX_AGE_MS && validAt(g,current())){
        g.research=report;
        g.research_fingerprint=report.generated_at;
        g.ai_review={...report,model:'MacFly · ChatGPT',web_search_enabled:true};
        g.research_diagnostics={...g.research_diagnostics,state:'AVAILABLE',generated_at:report.generated_at,age_minutes:Math.floor((Date.now()-Date.parse(report.generated_at))/60000),
          expires_at:new Date(Date.parse(report.generated_at)+RESEARCH_MAX_AGE_MS).toISOString(),official_injuries_accepted:report.verified_injuries.length};
        g.research_priority=researchPriority(g,report,current(),Date.parse(g.source_signal_at)>Date.parse(report.generated_at)?['RAPPORT_BLESSURES']:[]);
      }
      continue;
    }
    const row=latest.get(String(g.id));if(!row)continue;
    const data=JSON.parse(row.payload);
    let revision=g.study?.revision??null, lastImpact=g.study?.last_impact??null;
    if(data.facts.length && (!g.study || g.study.integrated_at!==row.integrated_at)){
      const versions=await readJournalVersions(db,String(g.id));
      const card=publicCard(versions,decisions.get(String(g.id)));
      revision=card.revision;lastImpact=card.last_impact;
    }
    g.study={pair:{primary:data.pair.primary,variant:data.pair.variant},revision,last_impact:lastImpact,integrated_at:row.integrated_at,
      decision:decisions.get(String(g.id))??null};
  }
  if(cards.size){
    const agenda=agendaFromGames(slate.games,current());
    const inScope=new Set(agenda.all.map(g=>g.match_id));
    const eligible=slate.games.filter(g=>inScope.has(String(g.id)));
    slate.research_agenda=agenda;
    slate.research_count=slate.games.filter(g=>g.research).length;
    slate.research_coverage={eligible:eligible.length,available:eligible.filter(g=>g.research).length,
      missing:eligible.filter(g=>g.research_diagnostics?.state==='MISSING').length,
      expired:eligible.filter(g=>g.research_diagnostics?.state==='EXPIRED').length,
      invalid:eligible.filter(g=>['INVALID','POST_TIP'].includes(g.research_diagnostics?.state)).length,
      non_eligible:slate.games.length-eligible.length,due:agenda.due_count};
  }
  return slate;
}

async function bootstrapContext(env,id) {
  const kv=env.MAX_STATE, g=await kv.get('max:game:'+id,{type:'json'});
  if(!g || !validAt(g,current()))return null;
  const adv=g.independent_analysis?.advanced;
  if(!adv?.forecast)return null;
  const rosterRows=await Promise.all(sides.map(s=>kv.get('max:roster:'+g[s].id,{type:'json'})));
  const rosters=new Map(rosterRows.filter(Boolean).map(r=>[String(r.team_id),r]));
  // Migration only: read cached ESPN final boxes. No network collection during an editorial delivery.
  let cursor; const keys=[];
  do{
    const list=await kv.list({prefix:'max:box:',limit:1000,...(cursor?{cursor}:{})});
    keys.push(...list.keys.map(x=>x.name).filter(k=>/^max:box:\d+$/.test(k)));
    cursor=list.list_complete?null:list.cursor;
  }while(cursor);
  const selected=keys.sort().slice(-150), boxes=[];
  for(let i=0;i<selected.length;i+=50){
    const batch=await kv.get(selected.slice(i,i+50),{type:'json'});
    for(const b of batch.values())if(b?.schema_version==='max-box-v1')boxes.push(b);
  }
  const legacy=await kv.get('max:research:'+id,{type:'json'});
  return contextForStudy(g,g.checked_at,adv.forecast_signature,adv.forecast,g.injuries,g.official_medical,
    rosterFilteredBoxes(boxes,rosters),rosters,legacy??g.research);
}
export async function handleResearchQueue(batch,env,validateResearch){
  for(const message of batch.messages){
    if(message.body?.type==='prompt_lab_review'){
      // This private Queue message wakes the lab only. GET endpoints never activate a proposal.
      await tickPromptLab(primary(env.MAX_JOURNAL),validateResearch);message.ack();continue;
    }
    const id=String(message.body?.match_id??''), timestamp=message.body?.generated_at;
    if(!/^\d{5,15}$/.test(id)){message.ack();continue;}
    if(message.body?.type==='prompt_lab_supplement'){
      const expId=message.body.experiment_id, cutoff=Date.parse(timestamp);
      if(typeof expId!=='string'||!Number.isFinite(cutoff)){message.ack();continue;}
      const db=primary(env.MAX_JOURNAL),exp=await readActiveExperiment(db);
      if(exp?.id!==expId){message.ack();continue;}
      const receipt=await db.prepare('SELECT id FROM prompt_lab_supplements WHERE experiment_id=? AND match_id=? AND generated_at=?')
        .bind(expId,id,new Date(cutoff).toISOString()).first();
      if(!receipt)throw Error('Missing prompt supplement for '+id);
      const row=await db.prepare('SELECT context FROM study_context WHERE match_id=?').bind(id).first();
      const context=row?JSON.parse(row.context):await bootstrapContext(env,id);
      if(context)await replayPrompt(db,context,validateResearch,'extra:'+receipt.id,exp);
      message.ack();continue;
    }
    if(message.body?.type==='start_study'){
      const db=primary(env.MAX_JOURNAL);
      const exists=await db.prepare('SELECT id FROM max_forecast_versions WHERE match_id=? LIMIT 1').bind(id).first();
      if(!exists){
        const context=await bootstrapContext(env,id);
        if(context)await refreshStudy(db,context,validateResearch,{persistContext:true});
      }
      message.ack();continue;
    }
    if(!Number.isFinite(Date.parse(timestamp))){message.ack();continue;}
    const db=primary(env.MAX_JOURNAL);
    const receipt=await db.prepare('SELECT received_at FROM macfly_inbox WHERE match_id=? AND generated_at=?')
      .bind(id,new Date(timestamp).toISOString()).first();
    if(!receipt)throw Error('Editorial receipt missing: '+id);
    const row=await db.prepare('SELECT context FROM study_context WHERE match_id=?').bind(id).first();
    const ctx=row?JSON.parse(row.context):await bootstrapContext(env,id);
    if(ctx)await refreshStudy(db,ctx,validateResearch,{persistContext:!row,delivery:true});
    message.ack();
  }
}
