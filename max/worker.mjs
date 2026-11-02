/**
 * ManiBetProMax · shadow v0.1 · Cloudflare Worker autonome.
 * Lit uniquement les routes publiques du moteur historique.
 * Aucune écriture dans le KV/DB, aucun changement des décisions de ManiBetPro.
 * IA désactivée par défaut : nécessite MAX_AI_ENABLED=1, OPENAI_API_KEY,
 * MAX_OPENAI_MODEL et un plafond MAX_AI_DAILY_LIMIT.
 */
const MAX_APP_HTML = '';
const VERSION = 'max-shadow-0.1.0';
const DEFAULT_SOURCE = 'https://manibetpro.emmanueldelasse.workers.dev';
const KEY_LATEST = 'max:slate:latest';
const KEY_EVENTS = 'max:events:latest';
const KEY_HEALTH = 'max:health:last';
const ONE_DAY = 86400000;
const ACTIVE_STATUSES = new Set(['STATUS_SCHEDULED', 'STATUS_PRE', 'STATUS_HALFTIME']);
const STOP_STATUSES = new Set(['STATUS_FINAL', 'STATUS_FINAL_OT', 'STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_CANCELLED']);
const HEADERS = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
};

function json(value, status=200) {
  return new Response(JSON.stringify(value), {status,headers:HEADERS});
}
function safeISO(date) {
  const n = new Date(date).getTime();
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
function compactDate(date) {
  return date.toISOString().slice(0,10).replace(/-/g,'');
}
export function slateDates(now) {
  return [-1,0,1].map(delta=>compactDate(new Date(now.getTime()+delta*ONE_DAY)));
}
function saneText(value, max=160) {
  return typeof value === 'string' ? value.trim().slice(0,max) : '';
}
function normalizeTeam(team) {
  return {
    name:saneText(team?.name),
    abbreviation:saneText(team?.abbreviation,10),
    record:saneText(team?.record,30)
  };
}
export function normalizeGames(responses) {
  const byId=new Map();
  for(const response of responses) {
    if(!Array.isArray(response?.matches))continue;
    for(const match of response.matches) {
      const id=String(match?.id??match?.espn_id??'').trim();
      const start=safeISO(match?.datetime);
      const home=normalizeTeam(match?.home_team);
      const away=normalizeTeam(match?.away_team);
      if(!id||!start||!home.name||!away.name)continue;
      const normalized={
        id,start,
        home,away,
        status:saneText(match.status,50),
        event_type:saneText(match.event_type,25),
        season_id:saneText(match.season_id,20),
        home_season_stats:match.home_season_stats??null,
        away_season_stats:match.away_season_stats??null,
        source:'ManiBetPro / ESPN'
      };
      byId.set(id,normalized);
    }
  }
  return [...byId.values()].sort((a,b)=>a.start.localeCompare(b.start)).slice(0,40);
}
function teamKey(name) {
  return String(name??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
}
export function teamInjuries(report,team) {
  if(!report||report.available===false)return null;
  const byTeam=report.by_team;
  if(!byTeam||typeof byTeam!=='object'||Array.isArray(byTeam))return null;
  const key=teamKey(team?.name);
  const abbreviation=teamKey(team?.abbreviation);
  let rows=null;
  for(const [k,entries] of Object.entries(byTeam)) {
    if((teamKey(k)===key||teamKey(k)===abbreviation)&&Array.isArray(entries)) {
      rows=entries; break;
    }
  }
  if(rows===null)rows=[];
  return rows.map(entry=>({
    player:saneText(entry.player??entry.name??entry.athlete?.displayName,90),
    status:saneText(entry.status??entry.designation??entry.availability,40),
    detail:saneText(entry.detail??entry.description??entry.reason,140)
  })).filter(x=>x.player).sort((a,b)=>a.player.localeCompare(b.player));
}
function injurySignature(arr) {
  if(!Array.isArray(arr))return 'INCONNU';
  return arr.map(x=>[x.player,x.status,x.detail].join(':')).join('|');
}
export function fingerprint(game) {
  return JSON.stringify({
    status:game.status,
    home:injurySignature(game.injuries?.home),
    away:injurySignature(game.injuries?.away)
  });
}
export function detectChange(previous,current) {
  if(!previous)return null;
  const changes=[];
  if(previous.status!==current.status) changes.push('STATUT_MATCH');
  if(injurySignature(previous.injuries?.home)!==injurySignature(current.injuries?.home)
     ||injurySignature(previous.injuries?.away)!==injurySignature(current.injuries?.away)) {
    changes.push('RAPPORT_BLESSURES');
  }
  return changes.length?changes:null;
}
function deriveCoverage(game,reportFresh) {
  const reasons=[];
  if(!game.home?.name||!game.away?.name)reasons.push('EQUIPES_MANQUANTES');
  if(!game.start)reasons.push('HORAIRE_INVALIDE');
  if(!reportFresh||game.injuries?.home===null||game.injuries?.away===null)reasons.push('BLESSURES_NON_VERIFIEES');
  if(!game.home_season_stats||!game.away_season_stats)reasons.push('STATS_EQUIPE_INCOMPLETES');
  return {status:reasons.length?'INCONCLUSIVE':'OBSERVATION',missing:reasons};
}
async function remoteJSON(fetcher,base,path,timeout=12000) {
  const url=base+path;
  const response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new Error('HTTP_'+response.status);
  const data=await response.json();
  if(!data||typeof data!=='object')throw new Error('INVALID_JSON');
  return data;
}
function isPregame(game,nowMs) {
  const t=new Date(game.start).getTime();
  return Number.isFinite(t)&&t>nowMs&&!STOP_STATUSES.has(game.status)&&!String(game.status).includes('IN_PROGRESS');
}
function forAI(game) {
  return {match_id:game.id,start:game.start,
    home:game.home.name,away:game.away.name,
    home_season_stats:game.home_season_stats,
    away_season_stats:game.away_season_stats,
    injuries:game.injuries,source_coverage:game.coverage};
}
async function runAI(game,env,fetcher) {
  if(env.MAX_AI_ENABLED!=='1'||!env.OPENAI_API_KEY||!env.MAX_OPENAI_MODEL)return null;
  const schema={type:'object',additionalProperties:false,required:['summary','key_risks','recheck','status'],properties:{
    summary:{type:'string'},key_risks:{type:'array',items:{type:'string'}},
    recheck:{type:'array',items:{type:'string'}},
    status:{type:'string',enum:['INCONCLUSIVE','OBSERVATION']}
  }};
  const instructions='Tu es MacFly, analyste NBA critique. Ne donne aucun chiffre non calculé, aucune probabilité, aucun pari, aucune certitude et aucune information non fournie. Distingue données et hypothèses. Si données clés manquent, signale INCONCLUSIVE. Tu n’es pas le moteur statistique. Réponse JSON stricte en français.';
  const body={model:env.MAX_OPENAI_MODEL,instructions,input:JSON.stringify(forAI(game)),max_output_tokens:650,
    text:{format:{type:'json_schema',name:'max_nba_review',strict:true,schema}}};
  const r=await fetcher('https://api.openai.com/v1/responses',{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.OPENAI_API_KEY},
    body:JSON.stringify(body),signal:AbortSignal.timeout(18000)
  });
  if(!r.ok)throw new Error('AI_HTTP_'+r.status);
  const result=await r.json();
  const candidate=result.output_text??result.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text;
  if(typeof candidate!=='string')throw new Error('AI_EMPTY');
  const parsed=JSON.parse(candidate);
  if(typeof parsed.summary!=='string'||!Array.isArray(parsed.key_risks)||!Array.isArray(parsed.recheck)
    ||!['INCONCLUSIVE','OBSERVATION'].includes(parsed.status))throw new Error('AI_BAD_FORMAT');
  return {summary:parsed.summary.slice(0,600),key_risks:parsed.key_risks.slice(0,5).map(x=>String(x).slice(0,200)),
    recheck:parsed.recheck.slice(0,5).map(x=>String(x).slice(0,200)),
    status:parsed.status,model:env.MAX_OPENAI_MODEL,observed_at:new Date().toISOString(),
    drives_decision:false};
}
async function readJSON(kv,key) {
  try {return await kv.get(key,{type:'json'});}catch{return null;}
}
async function putJSON(kv,key,value,ttl=86400*30) {
  await kv.put(key,JSON.stringify(value),{expirationTtl:ttl});
}
export async function collect(env,fetcher=fetch,now=new Date()) {
  if(!env?.MAX_STATE)throw new Error('MAX_STATE_NON_CONFIGURE');
  const nowISO=now.toISOString(),nowMs=now.getTime(),base=env.LEGACY_BASE||DEFAULT_SOURCE;
  if(!/^https:\/\//.test(base))throw new Error('LEGACY_BASE_INVALIDE');
  const dates=slateDates(now);
  const requests=await Promise.allSettled([
    ...dates.map(d=>remoteJSON(fetcher,base,'/nba/matches?date='+d,12000)),
    remoteJSON(fetcher,base,'/nba/injuries/espn',15000)
  ]);
  const matchResults=requests.slice(0,3).filter(x=>x.status==='fulfilled').map(x=>x.value);
  const injuriesResult=requests[3].status==='fulfilled'?requests[3].value:null;
  const sources={
    matches:{state:matchResults.length?'OK':'ERROR',success:matchResults.length,attempted:dates.length},
    injuries:{state:injuriesResult?.by_team?'OK':'ERROR',source:'ManiBetPro / ESPN',
      checked_at:injuriesResult?.by_team?nowISO:null}
  };
  const errors=requests.map((x,i)=>x.status==='rejected'?'SOURCE_'+i+':'+String(x.reason?.message??'ERROR').slice(0,80):null).filter(Boolean);
  const health={version:VERSION,last_attempt:nowISO,sources,errors,last_success:null,game_count:0};
  const previousHealth=await readJSON(env.MAX_STATE,KEY_HEALTH);
  if(!matchResults.length){
    health.last_success=previousHealth?.last_success??null;
    health.game_count=previousHealth?.game_count??0;
    await putJSON(env.MAX_STATE,KEY_HEALTH,health);
    return {...health,updated:false};
  }
  let injuryReport=injuriesResult;
  let injuryAgeMinutes=0;
  if(!injuriesResult?.by_team){
    const oldReport=await readJSON(env.MAX_STATE,'max:injuries:last');
    injuryAgeMinutes=oldReport?.captured_at?Math.floor((nowMs-new Date(oldReport.captured_at).getTime())/60000):null;
    if(injuryAgeMinutes!==null&&injuryAgeMinutes>=0&&injuryAgeMinutes<=120)injuryReport=oldReport.payload;
  } else {
    await putJSON(env.MAX_STATE,'max:injuries:last',{captured_at:nowISO,payload:injuriesResult},86400);
  }
  const injuriesFresh=Boolean(injuryReport?.by_team&&injuryAgeMinutes!==null&&injuryAgeMinutes<=120);
  const raw=normalizeGames(matchResults);
  const previousEvents=await readJSON(env.MAX_STATE,KEY_EVENTS);
  const events=Array.isArray(previousEvents)?previousEvents.slice(0,50):[];
  const today=[];
  let aiCalls=0;
  const maxAICalls=Math.max(0,Math.min(2,Number(env.MAX_AI_CALLS_PER_CYCLE??1)));
  const dayKey='max:ai:daily:'+nowISO.slice(0,10);
  let dayCount=Number(await env.MAX_STATE.get(dayKey))||0;
  const limit=Math.max(0,Math.min(20,Number(env.MAX_AI_DAILY_LIMIT??6)));
  for(const item of raw) {
    const previous=await readJSON(env.MAX_STATE,'max:game:'+item.id);
    const game={...item,
      injuries:{home:injuriesFresh?teamInjuries(injuryReport,item.home):null,
        away:injuriesFresh?teamInjuries(injuryReport,item.away):null,
        source:'ManiBetPro / ESPN',verified_at:injuriesResult?.by_team?nowISO:null,
        cached_age_minutes:injuryAgeMinutes},
      analysis:null,analyzed_at:nowISO,source_coverage:null,
      historical_model_reference:null};
    game.coverage=deriveCoverage(game,injuriesFresh);
    const changes=detectChange(previous,game);
    // IA totalement séparée de la probabilité et des recommandations canoniques.
    if(previous?.analysis)game.analysis=previous.analysis;
    if(env.MAX_AI_ENABLED==='1'&&isPregame(game,nowMs)&&game.start
       &&new Date(game.start).getTime()-nowMs<36*3600000
       &&game.coverage.status==='OBSERVATION'
       &&(!previous?.analysis||changes?.includes('RAPPORT_BLESSURES'))
       &&aiCalls<maxAICalls&&dayCount<limit) {
      try{
        const analysis=await runAI(game,env,fetcher);
        if(analysis){game.analysis=analysis;aiCalls++;dayCount++;
          await env.MAX_STATE.put(dayKey,String(dayCount),{expirationTtl:86400*3});
        }
      }catch(err){console.warn('[MAX_AI]',String(err.message).slice(0,80));}
    }
    if(changes) {
      events.unshift({id:item.id,at:nowISO,changes,match:item.away.name+' @ '+item.home.name});
      await putJSON(env.MAX_STATE,'max:history:'+item.id+':'+nowMs,
        {schema_version:VERSION,at:nowISO,game},86400*30);
    }
    await putJSON(env.MAX_STATE,'max:game:'+item.id,game,86400*90);
    today.push(game);
  }
  const slate={schema_version:VERSION,updated_at:nowISO,games:today,sources,
    mode:'SHADOW',ai_status:env.MAX_AI_ENABLED==='1'&&env.OPENAI_API_KEY&&env.MAX_OPENAI_MODEL?'ENABLED':'NOT_CONFIGURED',
    disclaimer:'Collecte automatique, pas de pronostics ManiBetProMax validés.'};
  await putJSON(env.MAX_STATE,KEY_LATEST,slate,86400*3);
  await putJSON(env.MAX_STATE,KEY_EVENTS,events.slice(0,50),86400*30);
  health.last_success=nowISO;health.game_count=today.length;
  await putJSON(env.MAX_STATE,KEY_HEALTH,health);
  return {...health,updated:true,events_new:events.length-(Array.isArray(previousEvents)?previousEvents.length:0),ai_calls:aiCalls};
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
    if(url.pathname==='/')return new Response(MAX_APP_HTML||'ManiBetProMax · interface non empaquetée',{
      status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}
    });
    if(!env?.MAX_STATE)return json({error:'STORAGE_NOT_CONFIGURED'},503);
    if(url.pathname==='/api/health')return json((await readJSON(env.MAX_STATE,KEY_HEALTH))??{state:'NO_DATA'});
    if(url.pathname==='/api/slate')return json((await readJSON(env.MAX_STATE,KEY_LATEST))??{
      schema_version:VERSION,updated_at:null,games:[],mode:'SHADOW',ai_status:'NOT_CONFIGURED'});
    if(url.pathname==='/api/events')return json({events:(await readJSON(env.MAX_STATE,KEY_EVENTS))??[]});
    return json({error:'NOT_FOUND'},404);
  },
  async scheduled(controller,env,ctx) {
    const result=await collect(env,fetch,new Date(controller.scheduledTime??Date.now()));
    console.log('[MAX_COLLECT]',JSON.stringify(result));
  }
};
