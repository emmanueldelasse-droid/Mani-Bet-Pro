import {ODDS_RULE,recordQuotedDecisionsWithReceipt} from './odds-study.mjs';

const clockSql="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const dbFor=env=>env.MAX_JOURNAL.withSession?env.MAX_JOURNAL.withSession('first-primary'):env.MAX_JOURNAL;
const iso=n=>new Date(n).toISOString();
const at=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?iso(Date.parse(x)):null;
const delaySchedule=[10,45,120];
const summaryColumns='id,edition_id,match_id,source,tip,received_at,observed_at,status,attempts,reason,available_at,json_array_length(quotes_json) quote_count';
const stable=o=>JSON.stringify(o,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const asRow=row=>({...row,stashed:true});
const transient=new Set(['DATABASE_CLOCK_TOO_FAR_BEHIND','DATABASE_CLOCK_BEHIND_OBSERVATION','QUOTE_READBACK_MISSING','FUTURE_REQUEST_TIME']);
// Queue delivery order is independent of the immutable order in which D1 received price groups.
const predecessor=`SELECT earlier.id FROM odds_intake earlier WHERE earlier.match_id=target.match_id
  AND earlier.status IN('STAGED','RETRY','WORKING') AND earlier.observed_at>=?5
  AND (earlier.received_at,earlier.observed_at,earlier.rowid)<(target.received_at,target.observed_at,target.rowid)
  AND EXISTS(SELECT 1 FROM json_each(earlier.quotes_json) a JOIN json_each(target.quotes_json) b
    ON json_extract(a.value,'$.bookmaker')=json_extract(b.value,'$.bookmaker'))
  ORDER BY earlier.received_at,earlier.observed_at,earlier.rowid LIMIT 1`;
function continuation(receipt){
  const missing=receipt.quotes.filter(q=>q.status!=='STORED');
  return transient.has(receipt.reason)||missing.length>0&&missing.every(q=>transient.has(q.reason));
}
async function build({edition,quotes}){
  if(!Number.isSafeInteger(edition?.id)||!edition.match_id||!at(edition.tip)||!Array.isArray(quotes)||!quotes.length)
    throw Error('INVALID_ODDS_INTAKE_GROUP');
  const flat=quotes.flatMap(q=>{
    if(!Array.isArray(q?.sides))return [q];
    const {sides,...common}=q;return sides.map(side=>({...common,...side}));
  });
  const source=flat[0]?.source;
  if(!source||!flat.every(q=>q&&q.source===source&&String(q.match_id)===String(edition.match_id)&&at(q.event_start)===at(edition.tip)&&at(q.observed_at)&&
      Number.isFinite(q.decimal_odds)&&q.decimal_odds>1&&typeof q.source_url==='string'&&q.source_url.startsWith('https://')))
    throw Error('INCONSISTENT_ODDS_INTAKE_GROUP');
  const observed=flat.map(q=>at(q.observed_at)).sort();
  if(observed.at(-1)>=at(edition.tip)||Date.parse(observed.at(-1))>Date.now())throw Error('INVALID_ODDS_OBSERVATION_TIME');
  const quotesJson='['+flat.map(stable).sort().join(',')+']';
  // The same quote group keeps the edition first pinned to its authentic observation.
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(quotesJson)));
  const id=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
  return {id,edition_id:edition.id,match_id:String(edition.match_id),tip:at(edition.tip),source,observed_from:observed[0],observed_at:observed.at(-1),quotes_json:quotesJson};
}
async function deliver(env,rows,delaySeconds=0){
  if(!rows.length)return [];
  if(!env.MAX_RESEARCH_QUEUE){
    const results=[];for(const row of rows)results.push(await sealObservedMarkets(env,row.id));
    return results;
  }
  try{
    const messages=rows.map(r=>({body:{type:'seal_observed_odds',id:r.id},delaySeconds}));
    if(env.MAX_RESEARCH_QUEUE.sendBatch){
      for(let i=0;i<messages.length;i+=100)await env.MAX_RESEARCH_QUEUE.sendBatch(messages.slice(i,i+100));
    }
    else for(const msg of messages)await env.MAX_RESEARCH_QUEUE.send(msg.body,{delaySeconds});
    return rows;
  }catch(error){
    // The immutable staged prices already exist. Mark this dispatch failure when budget
    // remains, and let the ordinary cadence redispatch from D1 even if this write fails.
    const detail='QUEUE_SEND_FAILED: '+String(error?.message??error).slice(0,300);
    try{await dbFor(env).prepare(`UPDATE odds_intake SET reason=? WHERE status IN('STAGED','RETRY') AND id IN(SELECT value FROM json_each(?))`)
      .bind(detail,JSON.stringify(rows.map(r=>r.id))).run();}catch{}
    return rows.map(r=>({...r,dispatch_error:detail}));
  }
}

export async function submitObservedMarketGroups(env,groups){
  if(!groups.length)return [];
  const plan=await Promise.allSettled(groups.map(build));
  const prepared=plan.filter(x=>x.status==='fulfilled').map(x=>x.value),byId=new Map(prepared.map(g=>[g.id,g]));
  const rejection=(item,i)=>({match_id:groups[i]?.edition?.match_id??null,status:'REJECTED',stashed:false,reason:String(item.reason?.message??item.reason)});
  if(!prepared.length)return plan.map(rejection);
  const collection=[...byId.values()],db=dbFor(env);
  // One board, one write statement. A subrequest limit can no longer cut the source board
  // in two between game 3 and game 9. The second statement reads each sealed input verbatim.
  const [,read]=await db.batch([
    db.prepare(`INSERT INTO odds_intake(id,edition_id,match_id,tip,source,observed_from,observed_at,quotes_json)
      SELECT json_extract(j.value,'$.id'),p.id,p.match_id,p.tip,json_extract(j.value,'$.source'),json_extract(j.value,'$.observed_from'),
        json_extract(j.value,'$.observed_at'),json_extract(j.value,'$.quotes_json') FROM json_each(?) j JOIN published_forecasts p
        ON p.id=json_extract(j.value,'$.edition_id') AND p.match_id=json_extract(j.value,'$.match_id') AND p.tip=json_extract(j.value,'$.tip')
      WHERE p.tip>${clockSql} AND p.published_at<=${clockSql} ON CONFLICT DO NOTHING`).bind(JSON.stringify(collection)),
    db.prepare(`SELECT ${summaryColumns},quotes_json,${clockSql} server_now FROM odds_intake WHERE id IN(SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(collection.map(g=>g.id)))
  ]);
  const rows=new Map();
  for(const {quotes_json,server_now,...row} of read.results){
    if(byId.get(row.id)?.quotes_json!==quotes_json)throw Error('ODDS_INTAKE_READBACK_CONFLICT');
    rows.set(row.id,asRow(row));
  }
  const send=[...rows.values()].filter(r=>r.status==='STAGED'&&r.tip>iso(Date.now()));
  for(const response of await deliver(env,send))rows.set(response.id,response);
  return plan.map((item,i)=>{
    if(item.status==='rejected')return rejection(item,i);
    const g=item.value;
    return rows.get(g.id)??{id:g.id,match_id:g.match_id,stashed:false,status:Date.parse(g.tip)<=Date.now()?'EXPIRED':'NOT_STAGED',quote_count:JSON.parse(g.quotes_json).length};
  });
}
export async function submitObservedMarkets(env,edition,quotes){
  return (await submitObservedMarketGroups(env,[{edition,quotes}]))[0];
}

async function fetched(db,id){
  const row=await db.prepare(`SELECT ${summaryColumns},receipt_json FROM odds_intake WHERE id=?`).bind(id).first();
  if(!row)return {id,status:'NOT_FOUND',stashed:false};
  const {receipt_json,...rest}=row;
  return {...asRow(rest),receipt:receipt_json?JSON.parse(receipt_json):null};
}
// A collector may pass several source timestamps in one group. Process each reading in
// timestamp order so that a later price cannot displace an earlier qualifying selection.
async function sealReadings(db,edition,quotes){
  const readings=new Map();
  for(const q of quotes){const key=at(q.observed_at);if(!readings.has(key))readings.set(key,[]);readings.get(key).push(q);}
  const receipts=[],decisions=new Map();
  for(const stamp of [...readings.keys()].sort()){
    const result=await recordQuotedDecisionsWithReceipt(db,edition,readings.get(stamp),iso(Date.now()));
    const ids=new Set(result.receipt.quotes.filter(q=>q.status==='STORED').map(q=>q.quote_id));
    for(const row of result.decisions){
      const d=JSON.parse(row.payload);
      if(ids.has(d.quote_id))decisions.set(row.id,{id:row.id,decided_at:row.decided_at,quote_id:d.quote_id,
        selected:d.selected,stake_units:d.stake_units,reason:d.reason});
    }
    receipts.push(result.receipt);
    // A transient failure of an earlier observation must keep later readings out of the decision tally.
    if(!result.receipt.complete&&continuation(result.receipt))break;
  }
  if(receipts.length===1&&readings.size===1)return {...receipts[0],decisions:[...decisions.values()]};
  const items=receipts.flatMap(r=>r.quotes);
  const failure=receipts.find(r=>!r.complete);
  return {...receipts[0],server_at:receipts.at(-1).server_at,complete:!failure&&items.length===quotes.length,
    reason:failure?.reason??null,submitted_count:quotes.length,stored_count:items.filter(q=>q.status==='STORED').length,
    quotes:items,readings:receipts.map(r=>({reason:r.reason,submitted_count:r.submitted_count,stored_count:r.stored_count})),
    decisions:[...decisions.values()]};
}
export async function sealObservedMarkets(env,id,{retryIssue=false,followPredecessor=true}={}){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))return {id,status:'NOT_FOUND',stashed:false};
  const db=dbFor(env),ticket=crypto.randomUUID(),now=Date.now();
  const fresh=iso(now-ODDS_RULE.max_quote_age_minutes*60000);
  const [,,claim,blocker]=await db.batch([
    db.prepare(`UPDATE odds_intake SET status='EXPIRED',reason='TIP_REACHED',ticket=NULL,available_at=NULL
      WHERE id=? AND status IN('STAGED','RETRY','WORKING') AND tip<=${clockSql}`).bind(id),
    db.prepare(`UPDATE odds_intake SET status='ISSUE',reason='INTERRUPTED_ATTEMPT_LIMIT',ticket=NULL,available_at=NULL
      WHERE id=? AND status='WORKING' AND attempts>=4 AND available_at<=${clockSql}`).bind(id),
    db.prepare(`UPDATE odds_intake AS target SET status='WORKING',attempts=attempts+1,ticket=?1,available_at=?2
      WHERE id=?3 AND tip>${clockSql} AND (status='STAGED' OR (status IN('WORKING','RETRY') AND available_at<=${clockSql})
      OR (?4=1 AND status='ISSUE')) AND NOT EXISTS(${predecessor}) RETURNING ${summaryColumns},quotes_json`).bind(ticket,iso(now+60000),id,retryIssue?1:0,fresh),
    db.prepare(`SELECT (${predecessor.replace('?5','?2')}) AS earlier FROM odds_intake target WHERE target.id=?1
      AND target.status IN ('STAGED','RETRY','WORKING') AND target.tip>${clockSql}`).bind(id,fresh)
  ]);
  if(!claim.results.length){
    const earlier=blocker.results[0]?.earlier;
    if(earlier&&followPredecessor){
      const prior=await sealObservedMarkets(env,earlier,{followPredecessor:false});
      if(['SEALED','ISSUE','EXPIRED'].includes(prior.status))
        return sealObservedMarkets(env,id,{retryIssue,followPredecessor:false});
      const current=await fetched(db,id);
      const wait=Math.max(3,Math.min(125,Math.ceil((Date.parse(prior.available_at??iso(now+5000))-now)/1000)));
      if(env.MAX_RESEARCH_QUEUE)await deliver(env,[current],wait);
      return {...current,waiting_for:earlier};
    }
    const current=await fetched(db,id);
    if(env.MAX_RESEARCH_QUEUE&&(earlier||['WORKING','RETRY'].includes(current.status))){
      const wait=Math.max(3,Math.min(125,Math.ceil((Date.parse(current.available_at??iso(now+5000))-now)/1000)));
      await deliver(env,[current],wait);
    }
    return current;
  }
  const input=claim.results[0],edition={id:input.edition_id,match_id:input.match_id,tip:input.tip};
  let receipt,reason,retry=false;
  try{
    receipt=await sealReadings(db,edition,JSON.parse(input.quotes_json));reason=receipt.reason;retry=continuation(receipt);
  }catch(error){
    reason=String(error?.message??error).slice(0,400);
    retry=!reason.includes('ODDS_RULE_VERSION_MISMATCH');
  }
  const seconds=delaySchedule[input.attempts-1];
  const status=receipt?.complete?'SEALED':Date.now()>=Date.parse(input.tip)||reason==='TIP_REACHED'?'EXPIRED':
    retry&&seconds!=null?'RETRY':'ISSUE';
  const next=status==='RETRY'?iso(Math.min(Date.now()+seconds*1000,Date.parse(input.tip))):null;
  await db.prepare('UPDATE odds_intake SET status=?,available_at=?,ticket=NULL,reason=?,receipt_json=? WHERE id=? AND ticket=?')
    .bind(status,next,reason??null,receipt?JSON.stringify(receipt):null,id,ticket).run();
  const current=await fetched(db,id);
  if(current.status==='RETRY'&&env.MAX_RESEARCH_QUEUE)
    await deliver(env,[current],Math.max(1,Math.ceil((Date.parse(current.available_at)-Date.now())/1000)));
  return current;
}

export async function resumeObservedMarkets(env){
  const db=dbFor(env);
  const [,due]=await db.batch([
    db.prepare(`UPDATE odds_intake SET status='EXPIRED',available_at=NULL,ticket=NULL,reason='TIP_REACHED'
      WHERE status IN('STAGED','WORKING','RETRY') AND tip<=${clockSql}`),
    db.prepare(`SELECT ${summaryColumns} FROM odds_intake WHERE tip>${clockSql} AND
      (status='STAGED' OR (status IN('RETRY','WORKING') AND available_at<=${clockSql})) ORDER BY tip,received_at LIMIT 80`)
  ]);
  const rows=await deliver(env,due.results.map(asRow));
  return {groups:rows.length,ids:rows.map(r=>r.id),dispatch_errors:rows.filter(r=>r.dispatch_error).length};
}
