/**
 * ManiBetProMax standalone · NBA collection and analysis.
 * Aucune dépendance réseau, donnée, secret ou moteur vers ManiBetPro.
 * Sources directes ESPN ; une source non disponible reste INCONCLUSIVE.
 */
import {ENGINE_VERSION,parseESPNScoreboards,parseESPNInjuries,analyzeNBA,verifiedFinalGames} from './engine.mjs';
import {ADVANCED_VERSION,parseBoxscore,rotationAnalysis,forecastGame,evaluatePregame,summarizeEvaluations} from './advanced.mjs';

const MAX_APP_HTML='';
const MAX_ANALYST_PROMPT=''; // méthode publique, lue par MacFly depuis GitHub.
const VERSION='max-independent-0.3.0';
const BOXES_PER_CYCLE=2;
const KEY_METRICS='max:metrics:predictions';
const ESPN='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const KEY_HEALTH='max:health:last';
const KEY_SLATE='max:slate:latest';
const KEY_EVENTS='max:events:latest';
const DAY_MS=86400000;
const HISTORY_DAYS=45;
const HISTORY_PER_CYCLE=4;
const GAME_CACHE_TTL=86400*90;
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});}
function dateKey(now,days=0){return new Date(now.getTime()+days*DAY_MS).toISOString().slice(0,10).replace(/-/g,'');}
export function slateDates(now){return [-1,0,1].map(i=>dateKey(now,i));}
function validGame(game){return game&&game.id&&game.start&&game.home?.id&&game.away?.id;}
function injurySignature(rows){return Array.isArray(rows)?rows.map(i=>[i.player,i.status,i.detail].join(':')).join('|'):'SOURCE_UNCONFIRMED';}
export function detectChange(old,current){
 if(!old)return null;
 const changes=[];
 if(old.status!==current.status)changes.push('STATUT_MATCH');
 if(injurySignature(old.injuries?.home)!==injurySignature(current.injuries?.home)
  ||injurySignature(old.injuries?.away)!==injurySignature(current.injuries?.away))
  changes.push('RAPPORT_BLESSURES');
 return changes.length?changes:null;
}
export function changesForGame(prior,current){
 if(!prior||!prior.independent_analysis)return []; // old schema: migration != injury news
 const changes=detectChange(prior,current)??[];
 const oldResearch=prior.research_fingerprint??prior.research?.generated_at??null;
 const newResearch=current.research_fingerprint??current.research?.generated_at??null;
 if(oldResearch!==newResearch)changes.push('RECHERCHE_MACFLY');
 return changes;
}
async function read(kv,key){try{return await kv.get(key,{type:'json'});}catch{return null;}}
async function put(kv,key,obj,ttl=GAME_CACHE_TTL){
 await kv.put(key,JSON.stringify(obj),{expirationTtl:ttl});
}
async function sourceJSON(fetcher,path,timeout=12500){
 const url=ESPN+path;
 const r=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeout)});
 if(!r.ok)throw new Error('PROVIDER_HTTP_'+r.status);
 const v=await r.json();
 if(!v||typeof v!=='object')throw new Error('PROVIDER_INVALID_JSON');
 v._fetched_at=new Date().toISOString();
 return v;
}
function recoverInjury(report,previous,nowMS) {
 if(report)return {value:report,age_min:0,state:'OK'};
 const oldMS=Date.parse(previous?.captured_at??'');
 const age=Number.isFinite(oldMS)?Math.floor((nowMS-oldMS)/60000):null;
 return {value:age!==null&&age>=0&&age<=90?previous?.report:null,
  age_min:age,state:'ERROR'};
}
function currentCheckpoint(game,nowMs){
 const hours=(Date.parse(game.start)-nowMs)/3600000;
 if(hours<=0||hours>26||String(game.status).includes('FINAL'))return null;
 return hours<=1.25?'H1':hours<=3.25?'H3':hours<=6.25?'H6':hours<=24.25?'H24':null;
}
function sanitizeText(x,max=400){return typeof x==='string'?x.slice(0,max):'';}
function forAI(game){
 return {snapshot_time:game.checked_at,match_id:game.id,
  start:game.start,teams:{home:game.home,away:game.away},
  injuries:game.injuries,
  statistical_analysis:game.independent_analysis,
  context_status:game.coverage,
  verified_sources:game.sources};
}
/**
 * MacFly se lance dans ChatGPT (automation séparée), pas dans un appel API facturé.
 * Les recherches sont écrites dans le KV Max par l'automatisation autorisée.
 * On n'accepte que les rapports sourcés, récents et émis avant tip-off.
 */
export function validateResearch(record,game,nowISO) {
 if(!record||typeof record!=='object'||record.schema_version!=='max-research-v1')return null;
 if(String(record.match_id)!==String(game.id))return null;
 const published=Date.parse(record.generated_at),now=Date.parse(nowISO),tip=Date.parse(game.start);
 if(!Number.isFinite(published)||published>now||now-published>12*3600000)return null;
 if(Number.isFinite(tip)&&published>=tip)return null; // pas de rétroprediction
 if(!Array.isArray(record.sources)||!record.sources.length)return null;
 const sources=record.sources.filter(s=>
  s&&typeof s.url==='string'&&/^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(s.url)
  &&typeof s.title==='string'&&typeof s.checked_at==='string'
  &&Number.isFinite(Date.parse(s.checked_at))
  &&Date.parse(s.checked_at)<=now
  &&Date.parse(s.checked_at)<=published+5*60000
 ).slice(0,16).map(s=>({url:s.url.slice(0,400),title:s.title.slice(0,150),
   checked_at:s.checked_at,kind:String(s.kind??'PUBLIC').slice(0,40)}));
 if(!sources.length)return null;
 const summary=sanitizeText(record.summary,2000);
 if(!summary)return null;
 const rows=Array.isArray(record.sections)?record.sections:[];
 const sections=rows.slice(0,16).map(s=>({
  section_id:Number(s?.section_id)||0,
  title:sanitizeText(s?.title,100),
  status:['VERIFIED','PARTIAL','UNAVAILABLE','CONFLICT'].includes(s?.status)?s.status:'UNAVAILABLE',
  findings:Array.isArray(s?.findings)?s.findings.slice(0,8).map(v=>sanitizeText(v,300)):[],
  missing:Array.isArray(s?.missing)?s.missing.slice(0,8).map(v=>sanitizeText(v,150)):[]
 })).filter(s=>s.section_id>=1&&s.section_id<=16);
 const unique=new Set(sections.map(s=>s.section_id));
 const full=unique.size===16;
 return {schema_version:record.schema_version,match_id:String(record.match_id),
  generated_at:new Date(published).toISOString(),sources,summary,
  key_risks:Array.isArray(record.key_risks)?record.key_risks.slice(0,6).map(s=>sanitizeText(s,250)):[],
  recheck:Array.isArray(record.recheck)?record.recheck.slice(0,8).map(s=>sanitizeText(s,250)):[],
  sections,coverage_sections:unique.size,
  status:full&&sections.every(s=>s.status==='VERIFIED')?'RESEARCH_COMPLETE':'RESEARCH_PARTIAL',
  drives_decision:false,web_sources_checked:sources.length};
}
export async function collect(env,fetcher=fetch,now=new Date()){
 if(!env?.MAX_STATE)throw new Error('MAX_STATE_MISSING');
 const kv=env.MAX_STATE,nowMs=now.getTime(),nowISO=now.toISOString();
 const dates=slateDates(now);
 const responses=await Promise.allSettled([
  ...dates.map(d=>sourceJSON(fetcher,'/scoreboard?dates='+d+'&limit=25')),
  sourceJSON(fetcher,'/injuries',13000)
 ]);
 const slateData=responses.slice(0,3).filter(x=>x.status==='fulfilled'&&Array.isArray(x.value.events))
  .map(x=>x.value);
 const injuryRaw=responses[3].status==='fulfilled'?responses[3].value:null;
 const report=parseESPNInjuries(injuryRaw);
 const sources={scoreboard:{state:slateData.length?'OK':'ERROR',success:slateData.length,expected:3,
    base:'ESPN direct'},
   injuries:{state:report?'OK':'ERROR',source:'ESPN direct',checked_at:report?nowISO:null},
   historic:{state:'PENDING',days_loaded:0,target:HISTORY_DAYS}};
 const errors=responses.map((x,i)=>x.status==='rejected'?'SOURCE_'+i+':'+String(x.reason?.message??'FETCH_FAILED').slice(0,75):null).filter(Boolean);
 const previousHealth=await read(kv,KEY_HEALTH);
 const health={version:VERSION,engine_version:ENGINE_VERSION,last_attempt:nowISO,
  last_success:previousHealth?.last_success??null,sources,errors,game_count:previousHealth?.game_count??0};
 if(!slateData.length){
  await put(kv,KEY_HEALTH,health,86400*7);
  return {...health,updated:false};
 }
 const cachedInjury=await read(kv,'max:injuries:cached');
 const injury=recoverInjury(report,cachedInjury,nowMs);
 if(report){
  const unchanged=JSON.stringify(report.by_team)===JSON.stringify(cachedInjury?.report?.by_team);
  if(!unchanged||nowMs-Date.parse(cachedInjury?.captured_at??'')>=30*60000)
   await put(kv,'max:injuries:cached',{captured_at:nowISO,report},86400*3);
 }
 const coreGames=parseESPNScoreboards(slateData).filter(validGame);
 const historyRaw=[];
 const fetchDates=[];
 let cachedHistoryDays=0;
 for(let d=2;d<=HISTORY_DAYS+1;d++){
  const day=dateKey(now,-d);
  const snapshot=await read(kv,'max:scoreboard:'+day);
  if(snapshot?.date===day&&Array.isArray(snapshot.games)){
   cachedHistoryDays++;
   historyRaw.push(...snapshot.games);
  }else if(fetchDates.length<HISTORY_PER_CYCLE){
   fetchDates.push(day);
  }
 }
 const fetched=await Promise.allSettled(fetchDates.map(async d=>{
  const raw=await sourceJSON(fetcher,'/scoreboard?dates='+d+'&limit=25');
  if(!Array.isArray(raw.events))throw new Error('BAD_SCOREBOARD_SHAPE');
  const games=parseESPNScoreboards([raw]);
  await put(kv,'max:scoreboard:'+d,{date:d,games,saved_at:nowISO},86400*90);
  return {date:d,games};
 }));
 for(const x of fetched)if(x.status==='fulfilled')historyRaw.push(...x.value.games);
 for(const x of fetched)if(x.status==='rejected')errors.push('HISTORY:'+String(x.reason?.message??'ERROR').slice(0,65));
 const loaded=cachedHistoryDays+fetched.filter(x=>x.status==='fulfilled').length;
 sources.historic={state:loaded>=HISTORY_DAYS?'OK':loaded>=10?'PARTIAL':'WARMING',
  days_loaded:loaded,target:HISTORY_DAYS,source:'ESPN direct'};
 const combined=new Map();
 for(const x of [...historyRaw,...coreGames])if(validGame(x))combined.set(x.id,x);
 const historical=[...combined.values()];
 // Enrichissement des statistiques avec deux vrais boxscores par collecte,
 // contrôles de cohérence et cache indépendant des autres Workers.
 const candidates=verifiedFinalGames(historical,nowISO)
  .sort((a,b)=>b.start.localeCompare(a.start)).slice(0,150);
 const boxes=[],pending=[];
 for(const x of candidates){
  const cached=await read(kv,'max:box:'+x.id);
  if(cached?.schema_version==='max-box-v1'&&cached.game_id===x.id)boxes.push(cached);
  else if(pending.length<BOXES_PER_CYCLE&&!await read(kv,'max:box:failed:'+x.id))pending.push(x);
 }
 let newBoxes=0;
 for(const x of pending){
  try{
   const raw=await sourceJSON(fetcher,'/summary?event='+x.id,12000);
   const box=parseBoxscore(raw,x);
   if(!box)throw new Error('BOXSCORE_INVALID_OR_INCOMPLETE');
   await put(kv,'max:box:'+x.id,box,86400*120);
   boxes.push(box);newBoxes++;
  }catch(err){
   errors.push('BOX:'+x.id+':'+String(err?.message??'FAILED').slice(0,60));
   await put(kv,'max:box:failed:'+x.id,{at:nowISO,reason:String(err?.message??'FAILED').slice(0,80)},86400);
  }
 }
 sources.player_boxes={state:boxes.length?'PARTIAL':'WARMING',
  cached:boxes.length,possible:candidates.length,fetched:newBoxes,
  source:'ESPN game summary',checked_at:nowISO};
 const previousEvents=await read(kv,KEY_EVENTS);
 const events=Array.isArray(previousEvents)?previousEvents.slice(0,50):[];
 const games=[];let changed=0,researchCount=0;
 const oldMetrics=await read(kv,KEY_METRICS);
 const metricsRows=Array.isArray(oldMetrics?.records)?oldMetrics.records.slice(-120):[];
 let newEvaluations=0;
 for(const sourceGame of coreGames.slice(0,40)){
  const prior=await read(kv,'max:game:'+sourceGame.id);
  const statistical=analyzeNBA(sourceGame,historical,injury.value,nowISO);
  const forecast=forecastGame(sourceGame,historical,boxes,nowISO);
  const rotations=statistical.pregame?{
   home:rotationAnalysis(sourceGame.home.id,boxes,statistical.injuries.home,sourceGame.start),
   away:rotationAnalysis(sourceGame.away.id,boxes,statistical.injuries.away,sourceGame.start)
  }:null;
  const advanced={version:ADVANCED_VERSION,forecast,rotations,
   source_games:historical.length,boxscore_games:boxes.length,calibrated:false};
  const rawResearch=await read(kv,'max:research:'+sourceGame.id);
  const verifiedResearch=validateResearch(rawResearch,sourceGame,nowISO);
  if(verifiedResearch)researchCount++;
  const g={...sourceGame,checked_at:nowISO,
   injuries:{...statistical.injuries,source:'ESPN direct',
    source_status:injury.state,cache_age_minutes:injury.age_min},
   independent_analysis:{...statistical,advanced},
   quantitative_version:ADVANCED_VERSION,
   coverage:{status:statistical.status,missing:statistical.missing,
    forecast_status:forecast.status,boxes_available:boxes.length},
   sources:{matches:'ESPN direct',injuries:'ESPN direct',
     stats:'ESPN scoreboard 45 days + verified ESPN player boxes',research:'MacFly / sources publiques tracées'},
   research:verifiedResearch,
   research_fingerprint:verifiedResearch?.generated_at??null,
   ai_review:verifiedResearch?{...verifiedResearch,
     model:'MacFly · ChatGPT',web_search_enabled:true}:null};
  const changes=changesForGame(prior,g);
  if(changes.length){
   changed++;
   events.unshift({id:g.id,match:g.away.name+' @ '+g.home.name,changes,at:nowISO});
   await put(kv,'max:history:'+g.id+':'+nowMs,{at:nowISO,changes,game:g},86400*30);
  }
  const isPregame=statistical.pregame;
  const cp=isPregame?currentCheckpoint(g,nowMs):null;
  if(isPregame){
   for(const checkpoint of ['EARLIEST',...(cp?[cp]:[])]){
    const key='max:pre:'+g.id+':'+checkpoint;
    if(!(await read(kv,key)))await put(kv,key,{
     at:nowISO,checkpoint,game_id:g.id,model:statistical.elo,
     forecast:{...forecast,engine_version:ADVANCED_VERSION},
     context_status:statistical.status,injuries:statistical.injuries,
     analysis_schema:statistical.schema_version,drives_bet:false},86400*120);
   }
  }
  if(String(g.status).includes('FINAL')&&Number.isFinite(g.home.score)&&Number.isFinite(g.away.score)){
   const existing=await read(kv,'max:eval:'+g.id);
   if(!existing){
    for(const checkpoint of ['H1','H3','H6','H24','EARLIEST']){
     const snap=await read(kv,'max:pre:'+g.id+':'+checkpoint);
     const evaluation=evaluatePregame(g,snap);
     if(evaluation){
      await put(kv,'max:eval:'+g.id,evaluation,86400*180);
      metricsRows.push(evaluation);newEvaluations++;
      break;
     }
    }
   }
  }
  if(!prior||!prior.independent_analysis||changes.length||prior.quantitative_version!==ADVANCED_VERSION)
   await put(kv,'max:game:'+g.id,g);
  games.push(g);
 }
 if(newEvaluations){
  const distinct=[...new Map(metricsRows.map(x=>[x.match_id,x])).values()]
   .sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-120);
  await put(kv,KEY_METRICS,{...summarizeEvaluations(distinct),updated_at:nowISO},86400*180);
 }
 const metrics=await read(kv,KEY_METRICS)??summarizeEvaluations([]);
 const slate={schema_version:VERSION,engine_version:ENGINE_VERSION,
  advanced_version:ADVANCED_VERSION,
  metrics_summary:{games_evaluated:metrics.games_evaluated,
   brier:metrics.brier,log_loss:metrics.log_loss,calibrated:false},
  updated_at:nowISO,mode:'INDEPENDENT_SHADOW',
  games,sources,errors:errors.slice(0,20),
  ai_status:'MACFLY_CHATGPT_HOURLY',research_count:researchCount,boxscore_count:boxes.length,external_paid_api:false,
  disclaimer:'Analyse indépendante expérimentale ; aucune preuve de calibration ni recommandation de pari.'};
 await put(kv,KEY_SLATE,slate,86400*3);
 if(changed)await put(kv,KEY_EVENTS,events.slice(0,50),86400*30);
 health.last_success=nowISO;health.game_count=games.length;
 await put(kv,KEY_HEALTH,health,86400*7);
 return {...health,updated:true,events_new:changed,research_reports:researchCount,boxes_cached:boxes.length,boxes_new:newBoxes,new_evaluations:newEvaluations,external_paid_api:false,history_fetched:fetched.filter(x=>x.status==='fulfilled').length};
}
export default{
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
  if(path==='/')return new Response(MAX_APP_HTML||'ManiBetProMax',{
   status:200,headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store',
    'X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff'}});
  if(!env?.MAX_STATE)return json({error:'STORAGE_NOT_CONFIGURED'},503);
  if(path==='/api/health')return json(await read(env.MAX_STATE,KEY_HEALTH)??{state:'NO_DATA'});
  if(path==='/api/slate')return json(await read(env.MAX_STATE,KEY_SLATE)??{
   schema_version:VERSION,updated_at:null,games:[],mode:'INDEPENDENT_SHADOW',
   ai_status:'NOT_CONFIGURED'});
  if(path==='/api/events')return json({events:await read(env.MAX_STATE,KEY_EVENTS)??[]});
  if(path==='/api/metrics')return json(await read(env.MAX_STATE,KEY_METRICS)??summarizeEvaluations([]));
  if(path==='/api/methodology')return new Response(MAX_ANALYST_PROMPT,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  return json({error:'NOT_FOUND'},404);
 },
 async scheduled(controller,env){
  try{console.log('[MAX_INDEPENDENT]',JSON.stringify(await collect(env,fetch,new Date(controller.scheduledTime??Date.now()))));}
  catch(err){console.error('[MAX_INDEPENDENT_FAILURE]',String(err?.message??'ERROR').slice(0,180));}
 }
};
