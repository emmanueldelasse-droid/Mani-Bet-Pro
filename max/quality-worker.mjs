/** Validation supplement: no paid provider, no changes to existing schedules. */
import core from './worker.mjs';
import {POINTS_VERSION,auditPlayerHistory,playerAuditInputSignature} from './points.mjs';
export const QUALITY_VERSION='max-quality-0.1.0';
export const VALIDATION_KEY='max:validation:player-history';
const INTERVAL_MS=6*3600000;
const response=data=>new Response(JSON.stringify(data),{headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff'}});
export async function refreshPlayerValidation(kv,now=new Date()){
 if(!kv)throw Error('MAX_STATE_MISSING');
 const nowMs=now.getTime(),iso=now.toISOString();
 const prior=await kv.get(VALIDATION_KEY,{type:'json'});
 const checked=Date.parse(prior?.last_checked_at??prior?.computed_at??'');
 if(prior?.model_version===POINTS_VERSION&&Number.isFinite(checked)&&
  checked<=nowMs&&nowMs-checked<INTERVAL_MS)return {state:'CACHED',writes:0};
 const health=await kv.get('max:health:last',{type:'json'});
 const success=Date.parse(health?.last_success??'');
 if(!Number.isFinite(success)||success>nowMs+300000||nowMs-success>45*60000)
  return {state:'SOURCE_STALE',writes:0};
 const keys=[];let cursor,complete=false;
 for(let page=0;page<10;page++){
  const result=await kv.list({prefix:'max:box:',limit:1000,...(cursor?{cursor}:{})});
  for(const item of result.keys??[])if(/^max:box:\d+$/.test(item.name))keys.push(item.name);
  if(result.list_complete===true){complete=true;break;}
  if(!result.cursor)break;
  cursor=result.cursor;
 }
 if(!complete)return {state:'SOURCE_LIST_INCOMPLETE',writes:0};
 const selected=[...new Set(keys)].sort().slice(-150);
 const boxes=(await Promise.all(selected.map(key=>kv.get(key,{type:'json'}))))
  .filter(b=>b?.schema_version==='max-box-v1');
 const fingerprint=playerAuditInputSignature(boxes);
 const audit=prior?.model_version===POINTS_VERSION&&prior.input_signature===fingerprint?
  {...prior}:auditPlayerHistory(boxes,iso);
 audit.last_checked_at=iso;
 audit.quality_version=QUALITY_VERSION;
 audit.listed_box_keys=keys.length;
 audit.selected_box_keys=selected.length;
 audit.selection='Latest 150 lexicographic box keys, ordered chronologically for evaluation';
 await kv.put(VALIDATION_KEY,JSON.stringify(audit),{expirationTtl:180*86400});
 return {state:'UPDATED',writes:1,paired_predictions:audit.paired_predictions,
  evaluated_games:audit.evaluated_games,status:audit.status};
}
export default {
 async fetch(request,env,ctx){
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path==='/api/player-validation'){
   if(!env?.MAX_STATE)return new Response('Storage unavailable',{status:503});
   return response(await env.MAX_STATE.get(VALIDATION_KEY,{type:'json'})??{
    quality_version:QUALITY_VERSION,model_version:POINTS_VERSION,
    status:'AWAITING_FIRST_AUDIT',kind:'RETROSPECTIVE_REPLAY_NOT_PROSPECTIVE',
    paired_predictions:0,calibrated:false});
  }
  const result=await core.fetch(request,env,ctx);
  if(request.method==='GET'&&path==='/api/health'&&result.ok){
   const data=await result.json();
   return response({...data,quality_version:QUALITY_VERSION,points_version:POINTS_VERSION});
  }
  return result;
 },
 async scheduled(controller,env,ctx){
  await core.scheduled(controller,env,ctx);
  try{console.log('[MAX_PLAYER_VALIDATION]',JSON.stringify(await refreshPlayerValidation(env.MAX_STATE)));}
  catch(error){console.error('[MAX_PLAYER_VALIDATION_FAILURE]',String(error?.message??'Unknown error').slice(0,180));}
 }
};
