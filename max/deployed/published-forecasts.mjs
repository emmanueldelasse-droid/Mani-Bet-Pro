// Publish the complete JSON representation first. Both retries and competing publishers
// pass through the same per-game watermark inside a D1 transaction.
const nowSQL="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const usePrimary=db=>db.withSession?db.withSession('first-primary'):db;
const gameId=id=>typeof id==='string'&&/^\d{5,15}$/.test(id);
const editionId=id=>Number.isSafeInteger(id)&&id>0;
const columns='p.id,p.match_id,p.as_of,p.tip,p.published_at,p.content_hash';
const headJoin='published_forecast_heads h JOIN published_forecasts p ON p.id=h.edition_id';
const date=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value))return null;
  const ms=Date.parse(value);
  return Number.isFinite(ms)?new Date(ms).toISOString():null;
};

function canonicalPayload(value){
  // Freeze the JSON the browser receives, ignoring only object key insertion order.
  // Arrays retain their order, including player rankings and revision history.
  return JSON.stringify(value,(_key,entry)=>{
    if(!entry || typeof entry!=='object' || Array.isArray(entry))return entry;
    return Object.fromEntries(Object.keys(entry).sort().map(k=>[k,entry[k]]));
  });
}
function decode(row){
  if(!row?.id)return null;
  const {id,match_id,as_of,tip,published_at,content_hash,payload}=row;
  return {id,match_id,as_of,tip,published_at,content_hash,visible:JSON.parse(payload)};
}

export async function savePublishedForecast(db,game,asOf,visible){
  const id=String(game?.id??''),tip=date(game?.start),at=date(asOf);
  if(!gameId(id)||!tip||!at)throw Error('INVALID_PUBLICATION_ID_OR_TIME');
  if(game.status!=='STATUS_SCHEDULED'||at>=tip)return null;
  if(!visible||String(visible.id)!==id||date(visible.start)!==tip||visible.status!==game.status || Object.hasOwn(visible,'publication'))
    throw Error('PUBLICATION_CARD_MISMATCH');
  const payload=canonicalPayload(visible),bytes=new TextEncoder().encode(payload);
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
  const checked=date(visible.checked_at),integrated=date(visible.study?.integrated_at);
  const session=usePrimary(db);
  const [,,verification]=await session.batch([
    session.prepare(`INSERT INTO published_forecasts(match_id,tip,as_of,content_hash,payload)
      SELECT ?1,?2,?3,?4,?5 WHERE ?3<=${nowSQL} AND ${nowSQL}<?2
        AND NOT EXISTS(SELECT 1 FROM ${headJoin} WHERE h.match_id=?1
          AND (h.latest_as_of>=?3 OR (p.tip=?2 AND (p.content_hash=?4
            OR coalesce(?6,'')<strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(p.payload,'$.checked_at'))
            OR coalesce(?7,'')<strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(p.payload,'$.study.integrated_at'))))))`).bind(id,tip,at,hash,payload,checked,integrated),
    session.prepare(`UPDATE published_forecast_heads SET latest_as_of=?1 WHERE match_id=?2
      AND latest_as_of<?1 AND ?1<=${nowSQL} AND ${nowSQL}<?3
      AND EXISTS(SELECT 1 FROM published_forecasts p WHERE p.id=edition_id AND p.tip=?3 AND p.content_hash=?4)`).bind(at,id,tip,hash),
    session.prepare(`SELECT ${nowSQL} AS server_now,h.latest_as_of,${columns},p.payload
      FROM (SELECT 1) clock LEFT JOIN published_forecast_heads h ON h.match_id=?
      LEFT JOIN published_forecasts p ON p.id=h.edition_id`).bind(id)
  ]);
  const row=verification.results[0];
  if(at>row.server_now)throw Error('FUTURE_PUBLICATION_TIME');
  if(row.server_now>=tip)return null;
  if(row.tip===tip && row.content_hash===hash && row.payload===payload)return decode(row);
  if(row.latest_as_of>at)throw Error('STALE_PUBLICATION');
  if(row.latest_as_of===at)throw Error('PUBLICATION_TIME_CONFLICT');
  const current=row.payload?JSON.parse(row.payload):null;
  if(row.tip===tip&&((checked??'')<(date(current?.checked_at)??'') || (integrated??'')<(date(current?.study?.integrated_at)??'')))
    throw Error('STALE_PUBLICATION');
  throw Error('PUBLICATION_READBACK_FAILED');
}

export async function readPublishedForecast(db,matchId,id=null){
  const key=String(matchId);
  if(!gameId(key)||id!==null&&!editionId(id))return null;
  const session=usePrimary(db);
  const row=id===null
    ?await session.prepare(`SELECT ${columns},p.payload FROM ${headJoin} WHERE h.match_id=?`).bind(key).first()
    :await session.prepare(`SELECT ${columns},p.payload FROM published_forecasts p WHERE p.match_id=? AND p.id=?`).bind(key,id).first();
  return decode(row);
}

export async function listPublishedEditions(db,matchId,{beforeId=null,limit=50}={}){
  if(!gameId(String(matchId)) || beforeId!==null&&!editionId(beforeId))return [];
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('INVALID_EDITION_PAGE_SIZE');
  const page=await usePrimary(db).prepare(`SELECT ${columns} FROM published_forecasts p
    WHERE p.match_id=? AND (? IS NULL OR p.id<?) ORDER BY p.id DESC LIMIT ?`).bind(String(matchId),beforeId,beforeId,limit).all();
  return page.results;
}

async function readCards(db,keys){
  // Full match objects can exceed 400 KB. Each D1 query returns exactly one payload.
  const session=usePrimary(db),cards=[];
  for(let i=0;i<keys.length;i+=4){
    const batch=keys.slice(i,i+4);
    cards.push(...await Promise.all(batch.map(k=>readPublishedForecast(session,k.match_id,k.id))));
  }
  return cards.filter(Boolean);
}
export async function readPublishedForecasts(db,matchId,options){
  const page=await listPublishedEditions(db,matchId,options);
  return readCards(db,page);
}
export async function readLatestPublishedForMatches(db,ids){
  const keys=[...new Set(ids.map(String))].filter(gameId).map(match_id=>({match_id,id:null}));
  return new Map((await readCards(db,keys)).map(card=>[card.match_id,card]));
}
export async function listPublishedGames(db,fromISO,toISO){
  const from=date(fromISO),to=date(toISO);
  if(!from||!to||from>=to)throw Error('INVALID_PUBLICATION_DATE_RANGE');
  const rows=await usePrimary(db).prepare(`SELECT h.match_id,p.tip AS start,p.id AS publication_id,p.published_at,
    json_extract(p.payload,'$.home.name') AS home,json_extract(p.payload,'$.away.name') AS away
    FROM ${headJoin} WHERE p.tip>=? AND p.tip<? ORDER BY p.tip,h.match_id`).bind(from,to).all();
  return rows.results.map(({home,away,...g})=>({...g,teams:{home,away}}));
}
