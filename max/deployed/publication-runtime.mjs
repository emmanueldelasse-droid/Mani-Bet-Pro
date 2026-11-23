import { rotationAnalysis } from './advanced.mjs';
import { playerIdentity } from './identity.mjs';
import { composeReport } from './report.mjs';
import { readStudyProjection, refreshStudy } from './study-runtime.mjs';
import { readLatestPublishedForMatches, readPublishedForecast, savePublishedForecast } from './published-forecasts.mjs';
import { researchPriority, RESEARCH_MAX_AGE_MS } from './scheduler.mjs';

const sides=['home','away'];
const now=()=>new Date().toISOString();
const pregame=(g,at)=>g?.status==='STATUS_SCHEDULED' && Date.parse(at)<Date.parse(g.start);
const primary=db=>db.withSession?db.withSession('first-primary'):db;

function publicationMeta(edition){
  const {id,as_of,published_at,content_hash,tip}=edition;
  return {id,as_of,published_at,content_hash,tip};
}

// A schedule update can supply a score, status or navigation link; the edition
// remains the sole source of the pregame forecast, including after tip-off.
function showEdition(game,edition){
  if(!edition || game?.start && edition.tip!==game.start){
    if(!game)return null;
    if(game.status!=='STATUS_SCHEDULED')return game;
    const {id,start,status,event_type,season_type,home,away,source,checked_at}=game;
    return {id,start,status,event_type,season_type,home,away,source,checked_at,
      publication:null,publication_status:'AWAITING_PREGAME_PUBLICATION'};
  }
  const result={...edition.visible,publication:publicationMeta(edition)};
  if(!game)return result;
  result.status=game.status;
  for(const side of sides)if(Object.hasOwn(game[side]??{},'score')){
    result[side]={...result[side],score:game[side].score};
  }
  if(game.study?.prompt_experiments)result.study={...result.study,prompt_experiments:game.study.prompt_experiments};
  return result;
}
export async function publishedGame(env,game,edition){
  if(edition===undefined && game?.id && env.MAX_JOURNAL)edition=await readPublishedForecast(env.MAX_JOURNAL,String(game.id));
  return showEdition(game,edition);
}
export async function publishedSlate(env,slate){
  if(!slate?.games?.length)return slate;
  const entries=env.MAX_JOURNAL?await readLatestPublishedForMatches(env.MAX_JOURNAL,slate.games.map(g=>String(g.id))):new Map();
  return {...slate,games:slate.games.map(g=>showEdition(g,entries.get(String(g.id))))};
}

function assertSameModel(snap,forecast,players,trial=false){
  if(!snap)return;
  const expected=snap.forecast;
  if((expected?.probability_home??null)!==(forecast?.probability_home??null) ||
    sides.some(side=>(expected?.projected_score?.[side]??null)!==(forecast?.projected_score?.[side]??null))){
    throw Error('EDITION_TEAM_FORECAST_MISMATCH');
  }
  for(const side of sides){
    const archived=snap.player_points?.[side]?.players??[],full=players?.[side]?.players??[];
    const byId=new Map(full.map(p=>[String(p.id),p]));
    if(full.length!==archived.length||archived.some(p=>{
      const model=byId.get(String(p.id));
      return !model || (p.predicted_points_if_active??null)!==((trial?model.points_if_active:model.predicted_points_if_active)??null)
        || (p.projected_minutes_if_active??null)!==((trial?model.minutes_if_active:model.projected_minutes_if_active)??null);
    }))throw Error('EDITION_PLAYER_FORECAST_MISMATCH');
  }
}
function reportAt(game,inputs,sourceAt){
  const {context,history,boxes,rosters,metrics,playerMetrics}=inputs;
  const known=game.automatic_report;
  const report=composeReport(game,history??[],boxes??context?.boxes??[],rosters??new Map(context?.rosters??[]),
    metrics,playerMetrics,sourceAt);
  // A Queue delivery has the two-team modeling sample, not the complete prior
  // schedule or opponents' box totals. Preserve those observed summaries only
  // when the underlying sports collection is the same.
  if(!history && known?.generated_at===game.checked_at){
    for(const id of [4,8,15]){
      const prior=known.sections?.find(s=>s.section_id===id);
      if(prior)report.sections[report.sections.findIndex(s=>s.section_id===id)]=prior;
    }
    report.section_counts=report.sections.reduce((counts,s)=>{counts[s.status]=(counts[s.status]??0)+1;return counts;},{});
    const teamWindows=known.sections.find(s=>s.section_id===4)?.data?.windows;
    const preservedUrls=new Set(sides.flatMap(side=>Object.values(teamWindows?.[side]??{})
      .flatMap(window=>window.sources??[])));
    const preservedSources=(known.sources??[]).filter(s=>preservedUrls.has(s.url));
    report.sources=[...new Map([...preservedSources,...report.sources].map(s=>[s.url,s])).values()];
  }
  const info=report.sections.find(s=>s.section_id===1);
  info.findings=info.findings.map(line=>line.startsWith('Dernière collecte : ')?'Dernière collecte sportive : '+game.checked_at:line);
  info.data={...info.data,sports_collected_at:game.checked_at,model_as_of:sourceAt};
  report.model_as_of=sourceAt;
  report.generated_at=inputs.asOf??sourceAt;
  return report;
}

export function coherentGameForecast(input,options={}){
  // composeReport enriches the market observation; its mutation must remain inside this edition.
  const game=structuredClone(input);
  delete game.publication;
  delete game.publication_status;
  const update=options.studyUpdate,context=options.context??update?.context;
  const modelAt=update?.as_of??update?.card?.pair?.primary?.at??game.study?.pair?.primary?.at??game.checked_at;
  if(update?.card)game.study={...update.card,...(game.study?.prompt_experiments?{prompt_experiments:game.study.prompt_experiments}:{})};
  if(update?.points && context){
    const a=game.independent_analysis?.advanced;
    if(!a || String(context.game.id)!==String(game.id) || context.game.start!==game.start || context.sourceAt!==game.checked_at)
      throw Error('EDITION_CONTEXT_MISMATCH');
    const official=update.official??[],roles=update.roles??[],rosters=options.rosters??new Map(context.rosters??[]);
    a.forecast=context.forecast;
    a.forecast_signature=context.signature;
    a.player_points=update.points;
    a.rotation_trial=update.trial;
    a.rotations=Object.fromEntries(sides.map(side=>[side,rotationAnalysis(game[side].id,context.boxes,
      official.filter(f=>String(f.team_id)===String(game[side].id)),game.start)]));
    a.official_injuries_count=official.length;
    const matches=p=>(rosters.get(String(p.team_id))?.players??[]).filter(r=>playerIdentity(r.name)===playerIdentity(p.player)).length===1;
    a.official_injuries_matched=official.filter(matches).length;
    a.unmatched_official_names=official.filter(p=>!matches(p)).map(({team_id,player,status})=>({team_id,player,status}));
    a.data_gaps={...a.data_gaps,minutes_limits_confirmed:roles.some(f=>Number.isFinite(f.minutes_limit)),
      starters_confirmed:sides.every(s=>roles.filter(f=>f.starter===true&&String(f.team_id)===String(game[s].id)).length===5)};
    if(game.coverage)game.coverage={...game.coverage,player_points_status:update.points.status,official_injuries_count:official.length};
    const existing=game.research;
    const matchingLegacy=existing && existing.generated_at===context.legacy?.generated_at
      && Date.parse(existing.generated_at)<=Date.parse(modelAt)
      && Date.parse(modelAt)-Date.parse(existing.generated_at)<=RESEARCH_MAX_AGE_MS;
    const editorial=update.research??options.legacyResearch??(matchingLegacy?existing:null);
    game.research=editorial;
    game.research_fingerprint=editorial?.generated_at??null;
    game.ai_review=editorial?{...editorial,model:'MacFly · ChatGPT',web_search_enabled:true}:null;
    if(editorial){
      game.research_diagnostics={...game.research_diagnostics,state:'AVAILABLE',generated_at:editorial.generated_at,
        expires_at:new Date(Date.parse(editorial.generated_at)+RESEARCH_MAX_AGE_MS).toISOString(),
        age_minutes:Math.floor((Date.parse(modelAt)-Date.parse(editorial.generated_at))/60000),
        official_injuries_accepted:editorial.verified_injuries?.length??0};
    }else if(game.research_diagnostics?.state==='AVAILABLE'){
      const generated=game.research_diagnostics.generated_at;
      game.research_diagnostics={...game.research_diagnostics,
        state:Date.parse(modelAt)-Date.parse(generated)>RESEARCH_MAX_AGE_MS?'EXPIRED':'MISSING',
        official_injuries_accepted:0};
    }
    game.research_priority=researchPriority(game,editorial,modelAt,
      Date.parse(game.source_signal_at)>Date.parse(editorial?.generated_at)?['RAPPORT_BLESSURES']:[]);
    game.automatic_report=reportAt(game,{...options,context},modelAt);
  }
  const advanced=game.independent_analysis?.advanced,pair=game.study?.pair;
  assertSameModel(pair?.primary,advanced?.forecast,advanced?.player_points);
  assertSameModel(pair?.variant,advanced?.rotation_trial?.forecast,advanced?.rotation_trial?.teams,true);
  return game;
}

export async function publishGameEdition(env,g,options={}){
  const asOf=options.asOf??now();
  if(!env.MAX_JOURNAL || !pregame(g,asOf))return null;
  const db=primary(env.MAX_JOURNAL),game=coherentGameForecast(g,options);
  const inputTimes=[asOf,game.checked_at,game.study?.integrated_at].filter(Boolean).map(Date.parse);
  const effectiveAt=new Date(Math.max(...inputTimes)).toISOString();
  try{return await savePublishedForecast(db,game,effectiveAt,game);}
  catch(error){
    if(error.message!=='STALE_PUBLICATION'&&error.message!=='PUBLICATION_TIME_CONFLICT')throw error;
    return readPublishedForecast(db,String(g.id));
  }
}

export async function publishQueuedEdition(env,id,validateResearch,studyUpdate=null){
  const asOf=now(),db=primary(env.MAX_JOURNAL);
  const [g,row,display]=await Promise.all([
    env.MAX_STATE.get('max:game:'+id,{type:'json'}),
    db.prepare('SELECT context FROM study_context WHERE match_id=?').bind(String(id)).first(),
    db.prepare('SELECT card FROM study_display WHERE match_id=?').bind(String(id)).first()
  ]);
  if(!pregame(g,asOf))return null;
  if(!row){
    // Games can have unavailable inputs; preserve the actual unavailable card.
    if(g.study?.pair)throw Error('EDITION_STUDY_CONTEXT_MISSING');
    return publishGameEdition(env,g,{asOf});
  }
  const context=JSON.parse(row.context);
  if(context.sourceAt!==g.checked_at || context.game.start!==g.start)throw Error('EDITION_AWAITING_MATCHED_COLLECTOR_STATE');
  const card=display?JSON.parse(display.card):null;
  // The current collection and journal edition have already been durably exposed.
  // This also avoids rebuilding an inferior report on a retry with fewer cached boxscores.
  const prior=await readPublishedForecast(db,String(id));
  if(prior?.tip===g.start && prior.visible.checked_at===g.checked_at && card?.integrated_at
    && prior.visible.study?.integrated_at===card.integrated_at)return prior;
  let update=studyUpdate?.points && studyUpdate.card?.integrated_at===card?.integrated_at?studyUpdate:null;
  if(!update)update=await readStudyProjection(db,context,validateResearch,card);
  if(!update){
    // Existing compact captures cannot stand in for intervals and thresholds.
    // A new calculation is a new pregame revision with the real server clock.
    update=await refreshStudy(db,context,validateResearch);
    if(!update?.points)return null;
  }
  const at=update.as_of??update.card?.pair?.primary?.at;
  return publishGameEdition(env,g,{asOf,context,studyUpdate:update,legacyResearch:validateResearch(context.legacy,context.game,at)});
}
