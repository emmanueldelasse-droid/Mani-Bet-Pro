/** Four grouped cycles per day. A replayed old trigger never starts a new collection. */
export const CADENCE_VERSION='max-cadence-6h-v1';
export const COLLECTION_INTERVAL_MS=6*3600000;
export const HEALTH_MAX_AGE_MS=8*3600000;
export const AUTO_CRON='0 */6 * * *';
export function cadenceMetadata(at){
 const time=Date.parse(at);
 return {version:CADENCE_VERSION,cron_utc:AUTO_CRON,interval_hours:6,
  health_grace_hours:2,next_expected_at:Number.isFinite(time)?new Date((Math.floor(time/COLLECTION_INTERVAL_MS)+1)*COLLECTION_INTERVAL_MS).toISOString():null,
  editorial_interval_hours:6,health_monitor_interval_hours:24,
  note:'Passages groupés toutes les 6 heures ; aucune surveillance de dernière minute garantie.'};
}
export function autoCollectionDue(health,nowISO){
 const now=Date.parse(nowISO),last=Date.parse(health?.last_attempt??'');
 if(!Number.isFinite(now))return false;
 if(health?.cadence?.version!==CADENCE_VERSION)return true;
 return !Number.isFinite(last)||last>now||Math.floor(now/COLLECTION_INTERVAL_MS)>Math.floor(last/COLLECTION_INTERVAL_MS);
}
