/**
 * ManiBetProMax standalone · NBA collection and analysis.
 * Aucune dépendance réseau, donnée, secret ou moteur vers ManiBetPro.
 * Sources directes ESPN ; une source non disponible reste INCONCLUSIVE.
 */
import {ENGINE_VERSION,parseESPNScoreboards,parseESPNInjuries,analyzeNBA} from './engine.mjs';

const MAX_APP_HTML='';
const MAX_ANALYST_PROMPT='';
const VERSION='max-independent-0.2.0';
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
async function runAI(game,env,fetcher){
 if(env.MAX_AI_ENABLED!=='1'||!env.OPENAI_API_KEY||!env.MAX_OPENAI_MODEL)return null;
 const schema={type:'object',additionalProperties:false,
  required:['summary','key_risks','recheck','status','sources'],
  properties:{summary:{type:'string'},key_risks:{type:'array',items:{type:'string'}},
   recheck:{type:'array',items:{type:'string'}},
   status:{type:'string',enum:['INCONCLUSIVE','OBSERVATION']},
   sources:{type:'array',items:{type:'string'}}}};
 const payload={model:env.MAX_OPENAI_MODEL,
  instructions:MAX_ANALYST_PROMPT||'Tu es un analyste NBA critique, aucune donnée inventée, aucun pari ou pourcentage non calculé.',
  input:JSON.stringify(forAI(game)),max_output_tokens:1600,
  text:{format:{type:'json_schema',name:'max_independent_nba_analysis',strict:true,schema}}};
 if(env.MAX_AI_WEB_ENABLED==='1')payload.tools=[{type:'web_search'}];
 const res=await fetcher('https://api.openai.com/v1/responses',{
  method:'POST',headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify(payload),signal:AbortSignal.timeout(35000)});
 if(!res.ok)throw new Error('AI_HTTP_'+res.status);
 const data=await res.json();
 const text=data.output_text??data.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text;
 if(typeof text!=='string')throw new Error('AI_NO_RESPONSE');
 const parsed=JSON.parse(text);
 if(!['INCONCLUSIVE','OBSERVATION'].includes(parsed.status)
  ||typeof parsed.summary!=='string'||!Array.isArray(parsed.key_risks)||!Array.isArray(parsed.recheck)||!Array.isArray(parsed.sources))
  throw new Error('AI_INVALID_SCHEMA');
 return {status:parsed.status,summary:sanitizeText(parsed.summary,900),
  key_risks:parsed.key_risks.slice(0,6).map(x=>sanitizeText(x,220)),
  recheck:parsed.recheck.slice(0,8).map(x=>sanitizeText(x,220)),
  sources:parsed.sources.slice(0,10).map(x=>sanitizeText(x,300)),
  generated_at:new Date().toISOString(),model:env.MAX_OPENAI_MODEL,
  web_search_enabled:env.MAX_AI_WEB_ENABLED==='1',drives_decision:false};
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
 for(let d=2;d<=HISTORY_DAYS+1;d++){
  const day=dateKey(now,-d);
  const snapshot=await read(kv,'max:scoreboard:'+day);
  if(snapshot?.date===day&&Array.isArray(snapshot.games)){
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
 const loaded=HISTORY_DAYS-fetchDates.length+fetched.filter(x=>x.status==='fulfilled').length;
 sources.historic={state:loaded>=HISTORY_DAYS?'OK':loaded>=10?'PARTIAL':'WARMING',
  days_loaded:loaded,target:HISTORY_DAYS,source:'ESPN direct'};
 const combined=new Map();
 for(const x of [...historyRaw,...coreGames])if(validGame(x))combined.set(x.id,x);
 const historical=[...combined.values()];
 const previousEvents=await read(kv,KEY_EVENTS);
 const events=Array.isArray(previousEvents)?previousEvents.slice(0,50):[];
 const games=[];let changed=0,aiCalls=0;
 const maxAI=Math.max(0,Math.min(2,Number(env.MAX_AI_CALLS_PER_CYCLE??1)));
 const maxDaily=Math.max(0,Math.min(20,Number(env.MAX_AI_DAILY_LIMIT??6)));
 const dayCounter='max:ai:daily:'+nowISO.slice(0,10);
 let count=Number(await kv.get(dayCounter))||0;
 for(const sourceGame of coreGames.slice(0,40)){
  const prior=await read(kv,'max:game:'+sourceGame.id);
  const statistical=analyzeNBA(sourceGame,historical,injury.value,nowISO);
  const g={...sourceGame,checked_at:nowISO,
   injuries:{...statistical.injuries,source:'ESPN direct',
    source_status:injury.state,cache_age_minutes:injury.age_min},
   independent_analysis:statistical,
   coverage:{status:statistical.status,missing:statistical.missing},
   sources:{matches:'ESPN direct',injuries:'ESPN direct',stats:'ESPN direct / rolling 45 days'},
   ai_review:prior?.ai_review??null};
  const changes=detectChange(prior,g);
  if(changes){
   changed++;
   events.unshift({id:g.id,match:g.away.name+' @ '+g.home.name,changes,at:nowISO});
   await put(kv,'max:history:'+g.id+':'+nowMs,{at:nowISO,changes,game:g},86400*30);
  }
  const isPregame=statistical.pregame;
  // Aucune analyse IA sur un match déjà commencé.
  if(env.MAX_AI_ENABLED==='1'&&isPregame&&Date.parse(g.start)-nowMs<36*3600000
   &&(!prior?.ai_review||changes?.includes('RAPPORT_BLESSURES'))
   &&count<maxDaily&&aiCalls<maxAI){
   try{
    const review=await runAI(g,env,fetcher);
    if(review){
     g.ai_review=review;count++;aiCalls++;
     await kv.put(dayCounter,String(count),{expirationTtl:86400*3});
    }
   }catch(e){errors.push('AI_REVIEW_FAILED:'+String(e.message).slice(0,70));}
  }
  const cp=isPregame?currentCheckpoint(g,nowMs):null;
  if(cp){
   const key='max:pre:'+g.id+':'+cp;
   if(!(await read(kv,key)))await put(kv,key,{
    at:nowISO,checkpoint:cp,game_id:g.id,model:statistical.elo,
    context_status:statistical.status,injuries:statistical.injuries,
    analysis_schema:statistical.schema_version,drives_bet:false},86400*90);
  }
  if(!prior||changes||!prior.ai_review&&g.ai_review)await put(kv,'max:game:'+g.id,g);
  games.push(g);
 }
 const slate={schema_version:VERSION,engine_version:ENGINE_VERSION,
  updated_at:nowISO,mode:'INDEPENDENT_SHADOW',
  games,sources,errors:errors.slice(0,20),
  ai_status:env.MAX_AI_ENABLED==='1'&&env.OPENAI_API_KEY&&env.MAX_OPENAI_MODEL?'ENABLED':'NOT_CONFIGURED',
  disclaimer:'Analyse indépendante expérimentale ; aucune preuve de calibration ni recommandation de pari.'};
 await put(kv,KEY_SLATE,slate,86400*3);
 if(changed)await put(kv,KEY_EVENTS,events.slice(0,50),86400*30);
 health.last_success=nowISO;health.game_count=games.length;
 await put(kv,KEY_HEALTH,health,86400*7);
 return {...health,updated:true,events_new:changed,ai_calls:aiCalls,history_fetched:fetched.filter(x=>x.status==='fulfilled').length};
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
  return json({error:'NOT_FOUND'},404);
 },
 async scheduled(controller,env){
  try{console.log('[MAX_INDEPENDENT]',JSON.stringify(await collect(env,fetch,new Date(controller.scheduledTime??Date.now()))));}
  catch(err){console.error('[MAX_INDEPENDENT_FAILURE]',String(err?.message??'ERROR').slice(0,180));}
 }
};
