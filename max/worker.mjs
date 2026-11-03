/**
 * ManiBetProMax standalone · NBA collection and analysis.
 * Aucune dépendance réseau, donnée, secret ou moteur vers ManiBetPro.
 * Sources directes ESPN ; une source non disponible reste INCONCLUSIVE.
 */
import {ENGINE_VERSION,parseESPNScoreboards,parseESPNInjuries,analyzeNBA,verifiedFinalGames} from './engine.mjs';
import {ADVANCED_VERSION,parseBoxscore,rotationAnalysis,forecastGame,evaluatePregame,summarizeEvaluations} from './advanced.mjs';
import {POINTS_VERSION,projectPlayerPoints,evaluatePlayerPoints,summarizePlayerPointsEvaluations} from './points.mjs';

const MAX_APP_HTML='';
const MAX_ANALYST_PROMPT=''; // méthode publique, lue par MacFly depuis GitHub.
const VERSION='max-independent-0.5.0';
const BOXES_PER_CYCLE=2;
const KEY_METRICS='max:metrics:predictions';
const KEY_PLAYER_METRICS='max:metrics:player-points';
const KEY_ARCHIVE='max:archive:progress';
// Archives isolées de la prédiction live : pas de fuite des résultats futurs.
const ARCHIVE_SEASONS=[
 {season:'2024-25',start:'20241022',end:'20250630'},
 {season:'2025-26',start:'20251021',end:'20260630'}
];
const ARCHIVE_PER_CYCLE=2;
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
function utcDay(s){return Date.UTC(Number(s.slice(0,4)),Number(s.slice(4,6))-1,Number(s.slice(6,8)));}
function nextArchiveDay(s){return new Date(utcDay(s)+DAY_MS).toISOString().slice(0,10).replace(/-/g,'');}
function archiveTarget(){return ARCHIVE_SEASONS.reduce((sum,s)=>sum+1+Math.round((utcDay(s.end)-utcDay(s.start))/DAY_MS),0);}
export async function archiveStep(kv,fetcher,nowISO,errors=[]){
 const prior=await read(kv,KEY_ARCHIVE);
 const p=prior&&Number.isInteger(prior.season_index)&&Number.isInteger(prior.saved_days)?{...prior}:
  {season_index:0,next_date:ARCHIVE_SEASONS[0].start,saved_days:0,saved_games:0};
 const target=archiveTarget();
 if(p.season_index>=ARCHIVE_SEASONS.length)
  return {state:'COMPLETE',days:p.saved_days,target,games:p.saved_games};
 // Réessayer les échecs seulement après 1h : ne jamais insister sur une source en panne.
 if(p.last_error_at&&Date.parse(nowISO)-Date.parse(p.last_error_at)<3600000)
  return {state:'RETRY_PAUSED',days:p.saved_days,target,games:p.saved_games,last_error:p.last_error};
 let advanced=0;
 for(let i=0;i<ARCHIVE_PER_CYCLE;i++){
  let season=ARCHIVE_SEASONS[p.season_index];
  if(!season)break;
  if(p.next_date>season.end){
   p.season_index++;season=ARCHIVE_SEASONS[p.season_index];
   if(!season)break;
   p.next_date=season.start;
  }
  const key=p.next_date;
  try{
   const raw=await sourceJSON(fetcher,'/scoreboard?dates='+key+'&limit=25',12500);
   if(!Array.isArray(raw.events))throw Error('ARCHIVE_RESPONSE_INVALID');
   const games=parseESPNScoreboards([raw]);
   await put(kv,'max:archive:scoreboard:'+key,{date:key,season:season.season,
    games,source:'ESPN scoreboard',saved_at:nowISO},86400*365*3);
   p.saved_days++;p.saved_games+=games.length;p.next_date=nextArchiveDay(key);
   p.last_success=nowISO;p.last_error=null;p.last_error_at=null;
   advanced++;
  }catch(err){
   p.last_error=String(err?.message??'ARCHIVE_UNKNOWN').slice(0,100);
   p.last_error_at=nowISO;
   errors.push('ARCHIVE:'+key+':'+p.last_error);
   break;
  }
 }
 if(advanced||p.last_error_at)await put(kv,KEY_ARCHIVE,p,86400*365*3);
 return {state:p.season_index>=ARCHIVE_SEASONS.length?'COMPLETE':p.last_error_at?'ERROR':'WARMING',
  days:p.saved_days,target,games:p.saved_games,
  current_season:ARCHIVE_SEASONS[p.season_index]?.season??null,
  next_date:p.next_date,advanced,last_error:p.last_error??null};
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
 // Le flux ESPN générique n'est pas une confirmation pour CE match.
 // Accepter les statuts officiels structurés par MacFly uniquement si
 // match, équipes, heure et PDF NBA officiel correspondent.
 const allowed=new Set(['OUT','QUESTIONABLE','DOUBTFUL','AVAILABLE','PROBABLE','LIMITED']);
 const verified_injuries=Array.isArray(record.verified_injuries)?
  record.verified_injuries.slice(0,30).filter(item=>{
   if(!item||typeof item.player!=='string'||item.player.length<2||
    String(item.match_id)!==String(game.id)||item.event_start!==game.start||
    ![String(game.home.id),String(game.away.id)].includes(String(item.team_id))||
    !allowed.has(item.status)||typeof item.source_url!=='string')return false;
   const matching=sources.find(x=>x.url===item.source_url&&x.kind==='OFFICIAL');
   if(!matching||!(/^https:\/\/ak-static\.cms\.nba\.com\/referee\/injury\//.test(matching.url)||
     /^https:\/\/official\.nba\.com\/nba-injury-report-/.test(matching.url)))return false;
   const checked=Date.parse(item.checked_at);
   return Number.isFinite(checked)&&checked<=published+300000&&checked<=now&&checked<tip;
  }).map(item=>({match_id:String(game.id),team_id:String(item.team_id),
   player:sanitizeText(item.player,100),status:item.status,event_start:game.start,
   source_url:item.source_url,checked_at:item.checked_at,note:sanitizeText(item.note,200)})):[];
 return {schema_version:record.schema_version,match_id:String(record.match_id),
  generated_at:new Date(published).toISOString(),sources,summary,
  verified_injuries,
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
 const historicDays=Array.from({length:HISTORY_DAYS},(_,i)=>dateKey(now,-i-2));
 const historicCache=await Promise.all(historicDays.map(day=>read(kv,'max:scoreboard:'+day)));
 for(let i=0;i<historicDays.length;i++){
  const day=historicDays[i],snapshot=historicCache[i];
  if(snapshot?.date===day&&Array.isArray(snapshot.games)){
   cachedHistoryDays++;historyRaw.push(...snapshot.games);
  }else if(fetchDates.length<HISTORY_PER_CYCLE)fetchDates.push(day);
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
 const cachedBoxes=await Promise.all(candidates.map(x=>read(kv,'max:box:'+x.id)));
 for(let i=0;i<candidates.length;i++){
  const x=candidates[i],cached=cachedBoxes[i];
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
 const archive=await archiveStep(kv,fetcher,nowISO,errors);
 sources.archive={...archive,source:'ESPN historical scoreboard',
  label:'Training/backtest archive only; excluded from live forecast to prevent leakage'};
 const previousEvents=await read(kv,KEY_EVENTS);
 const events=Array.isArray(previousEvents)?previousEvents.slice(0,50):[];
 const games=[];let changed=0,researchCount=0;
 const activeGames=coreGames.slice(0,40);
 const [priors,researches]=await Promise.all([
  Promise.all(activeGames.map(x=>read(kv,'max:game:'+x.id))),
  Promise.all(activeGames.map(x=>read(kv,'max:research:'+x.id)))
 ]);
 const gameWrites=[];
 const [oldMetrics,oldPlayerMetrics]=await Promise.all([read(kv,KEY_METRICS),read(kv,KEY_PLAYER_METRICS)]);
 const metricsRows=Array.isArray(oldMetrics?.records)?oldMetrics.records.slice(-120):[];
 const playerRows=Array.isArray(oldPlayerMetrics?.records)?oldPlayerMetrics.records.slice(-60):[];
 let newEvaluations=0,newPlayerEvaluations=0;
 for(let gameIndex=0;gameIndex<activeGames.length;gameIndex++){
  const sourceGame=activeGames[gameIndex],prior=priors[gameIndex];
  const statistical=analyzeNBA(sourceGame,historical,injury.value,nowISO);
  const forecast=forecastGame(sourceGame,historical,boxes,nowISO);
  const rawResearch=researches[gameIndex];
  const verifiedResearch=validateResearch(rawResearch,sourceGame,nowISO);
  if(verifiedResearch)researchCount++;
  const official=verifiedResearch?.verified_injuries??[];
  const perTeam=id=>official.filter(x=>x.team_id===String(id)).map(x=>({player:x.player,status:x.status}));
  const rotations=statistical.pregame?{
   home:rotationAnalysis(sourceGame.home.id,boxes,perTeam(sourceGame.home.id),sourceGame.start),
   away:rotationAnalysis(sourceGame.away.id,boxes,perTeam(sourceGame.away.id),sourceGame.start)
  }:null;
  const playerPoints=projectPlayerPoints(sourceGame,boxes,statistical.injuries,
   official,forecast,nowISO);
  const advanced={version:ADVANCED_VERSION,player_points_version:POINTS_VERSION,
   forecast,player_points:playerPoints,rotations,
   official_injuries_count:official.length,
   source_games:historical.length,boxscore_games:boxes.length,calibrated:false};
  const g={...sourceGame,checked_at:nowISO,
   injuries:{...statistical.injuries,source:'ESPN direct',
    source_status:injury.state,cache_age_minutes:injury.age_min},
   independent_analysis:{...statistical,advanced},
   quantitative_version:POINTS_VERSION,
   coverage:{status:statistical.status,missing:statistical.missing,
    forecast_status:forecast.status,player_points_status:playerPoints.status,
    boxes_available:boxes.length,official_injuries_count:official.length},
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
   // Prévisions joueurs figées, sans écraser les anciens relevés existants.
   for(const checkpoint of ['PLAYER_V1',...(cp?['PLAYER_'+cp]:[])]){
    const key='max:pre:'+g.id+':'+checkpoint;
    if(!(await read(kv,key)))await put(kv,key,{
     at:nowISO,checkpoint,game_id:g.id,forecast:{...forecast,engine_version:ADVANCED_VERSION},
     player_points:playerPoints,context_status:statistical.status,
     official_injuries:official,analysis_schema:'max-player-points-v1',drives_bet:false
    },86400*120);
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
  if(String(g.status).includes('FINAL')&&Number.isFinite(g.home.score)&&Number.isFinite(g.away.score)){
   const exists=await read(kv,'max:eval:players:'+g.id);
   const finalBox=boxes.find(b=>b.game_id===g.id);
   if(!exists&&finalBox){
    for(const checkpoint of ['PLAYER_H1','PLAYER_H3','PLAYER_H6','PLAYER_H24','PLAYER_V1']){
     const snap=await read(kv,'max:pre:'+g.id+':'+checkpoint);
     const ev=evaluatePlayerPoints(g,finalBox,snap);
     if(ev){
      await put(kv,'max:eval:players:'+g.id,ev,86400*180);
      playerRows.push(ev);newPlayerEvaluations++;break;
     }
    }
   }
  }
  if(!prior||!prior.independent_analysis||changes.length||prior.quantitative_version!==POINTS_VERSION)
   gameWrites.push(put(kv,'max:game:'+g.id,g));
  games.push(g);
 }
 await Promise.all(gameWrites);
 if(newEvaluations){
  const distinct=[...new Map(metricsRows.map(x=>[x.match_id,x])).values()]
   .sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-120);
  await put(kv,KEY_METRICS,{...summarizeEvaluations(distinct),updated_at:nowISO},86400*180);
 }
 if(newPlayerEvaluations){
  const unique=[...new Map(playerRows.map(x=>[x.game_id,x])).values()]
   .sort((a,b)=>a.tip.localeCompare(b.tip)).slice(-60);
  await put(kv,KEY_PLAYER_METRICS,{
   ...summarizePlayerPointsEvaluations(unique),updated_at:nowISO},86400*180);
 }
 const [metrics,playerMetrics]=await Promise.all([
  read(kv,KEY_METRICS),read(kv,KEY_PLAYER_METRICS)
 ]);
 const slate={schema_version:VERSION,engine_version:ENGINE_VERSION,
  advanced_version:ADVANCED_VERSION,points_version:POINTS_VERSION,
  metrics_summary:{games_evaluated:metrics?.games_evaluated??0,
   brier:metrics?.brier??null,log_loss:metrics?.log_loss??null,
   player_games:playerMetrics?.games_evaluated??0,
   player_predictions:playerMetrics?.players_evaluated??0,
   player_mae:playerMetrics?.mae??null,player_rmse:playerMetrics?.rmse??null,
   calibrated:false},
  updated_at:nowISO,mode:'INDEPENDENT_SHADOW',
  games,sources,errors:errors.slice(0,20),
  ai_status:'MACFLY_CHATGPT_HOURLY',research_count:researchCount,boxscore_count:boxes.length,archive_progress:archive,external_paid_api:false,
  disclaimer:'Analyse indépendante expérimentale ; aucune preuve de calibration ni recommandation de pari.'};
 await put(kv,KEY_SLATE,slate,86400*3);
 if(changed)await put(kv,KEY_EVENTS,events.slice(0,50),86400*30);
 health.last_success=nowISO;health.game_count=games.length;
 await put(kv,KEY_HEALTH,health,86400*7);
 return {...health,updated:true,events_new:changed,research_reports:researchCount,boxes_cached:boxes.length,boxes_new:newBoxes,new_evaluations:newEvaluations,new_player_evaluations:newPlayerEvaluations,external_paid_api:false,history_fetched:fetched.filter(x=>x.status==='fulfilled').length};
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
  if(path==='/api/game'){
   const id=new URL(request.url).searchParams.get('id')??'';
   if(!/^\d{5,15}$/.test(id))return json({error:'INVALID_GAME_ID'},400);
   const slate=await read(env.MAX_STATE,KEY_SLATE);
   const game=slate?.games?.find(g=>String(g.id)===id);
   if(!game)return json({error:'GAME_NOT_FOUND'},404);
   const checkpoints=['EARLIEST','H24','H6','H3','H1','PLAYER_V1','PLAYER_H24','PLAYER_H6','PLAYER_H3','PLAYER_H1'];
   const [snapshots,evaluation,playerEvaluation]=await Promise.all([
    Promise.all(checkpoints.map(cp=>read(env.MAX_STATE,'max:pre:'+id+':'+cp))),
    read(env.MAX_STATE,'max:eval:'+id),
    read(env.MAX_STATE,'max:eval:players:'+id)
   ]);
   const timeline=snapshots.filter(p=>p&&p.game_id===id&&
    Number.isFinite(Date.parse(p.at))&&Date.parse(p.at)<Date.parse(game.start))
    .sort((a,b)=>a.at.localeCompare(b.at))
    .map(p=>({checkpoint:p.checkpoint,at:p.at,model:p.model,
     forecast:p.forecast??null,player_points:p.player_points??null,
     context_status:p.context_status??'UNKNOWN',
     injury_counts:{
      home:Array.isArray(p.injuries?.home)?p.injuries.home.length:null,
      away:Array.isArray(p.injuries?.away)?p.injuries.away.length:null
     }}));
   return json({match_id:id,start:game.start,teams:{home:game.home.name,away:game.away.name},
    timeline,evaluation:evaluation?.pregame_at&&Date.parse(evaluation.pregame_at)<Date.parse(game.start)?
     evaluation:null,player_evaluation:playerEvaluation?.pregame_at&&Date.parse(playerEvaluation.pregame_at)<Date.parse(game.start)?playerEvaluation:null,
     source:'Max immutable pre-tip snapshots',
    warning:'Snapshots réellement enregistrés avant coup d’envoi uniquement ; pas de reconstruction rétroactive.'});
  }
  if(path==='/api/slate')return json(await read(env.MAX_STATE,KEY_SLATE)??{
   schema_version:VERSION,updated_at:null,games:[],mode:'INDEPENDENT_SHADOW',
   ai_status:'NOT_CONFIGURED'});
  if(path==='/api/events')return json({events:await read(env.MAX_STATE,KEY_EVENTS)??[]});
  if(path==='/api/metrics')return json(await read(env.MAX_STATE,KEY_METRICS)??summarizeEvaluations([]));
  if(path==='/api/player-metrics')return json(await read(env.MAX_STATE,KEY_PLAYER_METRICS)??summarizePlayerPointsEvaluations([]));
  if(path==='/api/archive')return json({progress:await read(env.MAX_STATE,KEY_ARCHIVE)??{
   season_index:0,saved_days:0,saved_games:0,next_date:ARCHIVE_SEASONS[0].start},
   seasons:ARCHIVE_SEASONS,target_days:archiveTarget(),live_predictions_include_archive:false});
  if(path==='/api/methodology')return new Response(MAX_ANALYST_PROMPT,{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  return json({error:'NOT_FOUND'},404);
 },
 async scheduled(controller,env){
  try{console.log('[MAX_INDEPENDENT]',JSON.stringify(await collect(env,fetch,new Date(controller.scheduledTime??Date.now()))));}
  catch(err){console.error('[MAX_INDEPENDENT_FAILURE]',String(err?.message??'ERROR').slice(0,180));}
 }
};
