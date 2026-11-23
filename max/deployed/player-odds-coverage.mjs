import {readPublishedForecast} from './published-forecasts.mjs';
import {listProjectedOddsPlayers,fetchPlayerOddsProfile} from './player-odds.mjs';
import {fetchPlayerMarketIndex} from './player-market-index.mjs';
import {recordQuotedDecisions} from './odds-study.mjs';

const utc=ms=>new Date(ms).toISOString();
const clockSql="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const windowMs=6*3600000,spacing=35000,leaseMs=75000;
const dbFor=env=>env.MAX_JOURNAL.withSession?env.MAX_JOURNAL.withSession('first-primary'):env.MAX_JOURNAL;
const key=w=>[w.match_id,w.tip];
const getWindow=(db,id,tip)=>db.prepare('SELECT * FROM player_odds_windows WHERE match_id=? AND tip=?').bind(id,tip).first();
const delay=(ms,clock)=>Math.max(0,Math.min(43200,Math.ceil((ms-clock())/1000)));
function backoff(value,at){
  const requested=/^\s*\d+\s*$/.test(String(value??''))?at+Number(value)*1000:Date.parse(value);
  return utc(Math.max(at+15*60000,Number.isFinite(requested)?requested:0));
}
async function pauseSource(db,until){
  await db.prepare('UPDATE player_odds_source_gate SET backoff_until=max(coalesce(backoff_until,?),?) WHERE id=1').bind(until,until).run();
}
async function sendCurrent(env,db,w,ready,clock){
  if(!w||w.status!=='OPEN'||w.sent_generation>=w.generation)return;
  // Sending before marking is deliberate: a failed send is recoverable. Duplicate messages
  // carry the same generation and cannot reserve a second HTTP attempt.
  await env.MAX_RESEARCH_QUEUE.send({type:'player_odds_coverage',match_id:w.match_id,tip:w.tip,generation:w.generation},
    {delaySeconds:delay(Math.min(ready,Date.parse(w.tip)),clock)});
  await db.prepare('UPDATE player_odds_windows SET sent_generation=max(sent_generation,?) WHERE match_id=? AND tip=?')
    .bind(w.generation,...key(w)).run();
}
async function advance(env,db,w,token,status,ready,clock){
  await db.prepare(`UPDATE player_odds_windows SET generation=generation+1,lease=NULL,lease_until=NULL,status=?
    WHERE match_id=? AND tip=? AND generation=? AND lease IS ?`).bind(status,...key(w),w.generation,token).run();
  const latest=await getWindow(db,...key(w));
  await sendCurrent(env,db,latest,ready,clock);
}
const verifiedPairs=`SELECT subject,max(observed_at) observed_at,source_url FROM (
  SELECT subject,observed_at,json_extract(payload,'$.source_url') source_url FROM odds_study_quotes
  WHERE match_id=?1 AND market='PLAYER_POINTS_OT' AND bookmaker='DraftKings' AND json_extract(payload,'$.source')='LineSmart'
    AND json_extract(payload,'$.period')='FULL_GAME_OT' AND observed_at>=?2 AND observed_at<?3
  GROUP BY subject,observed_at,group_key HAVING count(DISTINCT side)=2) GROUP BY subject`;

export async function schedulePlayerOddsCoverage(env,games,{lookups=[],clock=Date.now}={}){
  const db=dbFor(env),now=clock(),output=[];
  for(const game of new Map(games.map(g=>[String(g.id),g])).values()){
    const id=String(game.id),start=Date.parse(game.start);
    if(!Number.isFinite(start))continue;
    const tip=utc(start),until=start-now;
    if(game.status!=='STATUS_SCHEDULED'||until<=0||until>windowMs)continue;
    const head=await readPublishedForecast(db,id);
    if(!head||head.tip!==tip)continue;
    const players=listProjectedOddsPlayers(head.visible).map(p=>({id:String(p.id),team:String(p.team_id),name:p.name}));
    const [,,,known]=await db.batch([
      db.prepare(`INSERT INTO player_odds_windows(match_id,tip,edition_id) SELECT ?,?,? WHERE ${clockSql}<? ON CONFLICT DO NOTHING`).bind(id,tip,head.id,tip),
      db.prepare(`INSERT INTO player_odds_tasks(match_id,tip,player_id,team_id,player_name,ranking)
        SELECT ?1,?2,json_extract(j.value,'$.id'),json_extract(j.value,'$.team'),json_extract(j.value,'$.name'),j.key
        FROM player_odds_windows w JOIN json_each(?3) j WHERE w.match_id=?1 AND w.tip=?2 AND w.mode='AWAITING_INDEX' AND w.status='OPEN'
        ON CONFLICT DO NOTHING`).bind(id,tip,JSON.stringify(players)),
      db.prepare(`UPDATE player_odds_windows SET status='DONE' WHERE match_id=? AND tip=? AND mode='AWAITING_INDEX'
        AND NOT EXISTS(SELECT 1 FROM player_odds_tasks t WHERE t.match_id=player_odds_windows.match_id AND t.tip=player_odds_windows.tip)`).bind(id,tip),
      db.prepare(verifiedPairs).bind(id,utc(Date.parse(tip)-windowMs),tip)
    ]);
    const observed=new Map(known.results.map(q=>[q.subject,q]));
    const seeds=[...observed.values()].map(q=>({player_id:q.subject,status:'OBSERVED',source_url:q.source_url,observed_at:q.observed_at}));
    for(const l of lookups){
      if(String(l.match_id)!==id||observed.has(String(l.player_id))||Date.parse(l.observed_at)>now||Date.parse(l.observed_at)<Date.parse(tip)-windowMs||l.observed_at>=tip)continue;
      seeds.push({...l,status:l.status==='OBSERVED'?'UNVERIFIED_OR_UNAVAILABLE':l.status});
      if(l.status==='HTTP_429')await pauseSource(db,backoff(l.retry_after,Date.parse(l.observed_at)));
    }
    if(seeds.length)await db.batch(seeds.map(s=>db.prepare(`UPDATE player_odds_tasks SET planned=1,status=?,source_url=?,observed_at=?,recorded_at=${clockSql}
      WHERE match_id=? AND tip=? AND player_id=? AND status IN ('PROJECTED','QUEUED')`).bind(s.status,s.source_url??null,s.observed_at,id,tip,String(s.player_id))));
    const w=await getWindow(db,id,tip);
    await sendCurrent(env,db,w,now+output.length*spacing,clock);if(w)output.push({match_id:id,status:w.status});
  }
  return output;
}
async function markIndex(db,w,edition,options){
  let index={status:'UNAVAILABLE',reason:'INTERRUPTED_INDEX',players:[]},cost=0;
  if(!w.index_status){
    await db.prepare("UPDATE player_odds_windows SET index_status='STARTED' WHERE match_id=? AND tip=? AND lease=?").bind(...key(w),w.lease).run();
    index=await (options.fetchIndex??fetchPlayerMarketIndex)(edition.visible,options);cost++;
  }
  const ranked=listProjectedOddsPlayers(edition.visible),ids=new Set((index.players??[]).map(p=>String(p.id)));
  const verified=index.status==='INDEXED',complete=verified&&index.all_reported_players_scanned===true&&
    ids.size===index.listed_players;
  if(!complete)for(const p of ranked.slice(0,4))ids.add(String(p.id));
  const mode=complete?'LISTED_POINTS':verified?'PARTIAL_INDEX_PLUS_TOP4':'FALLBACK_TOP_4';
  const {players:unused,...metadata}=index;
  metadata.matched_listed_players=(index.players??[]).length;
  const code=index.http_status===429?'HTTP_429':index.status;
  const writes=[
    db.prepare(`UPDATE player_odds_windows SET mode=?,index_status=?,index_url=?,index_at=?,index_json=?
      WHERE match_id=? AND tip=? AND lease=?`).bind(mode,code,index.source_url??null,index.observed_at??null,JSON.stringify(metadata),...key(w),w.lease),
    db.prepare(`UPDATE player_odds_tasks SET status=CASE WHEN player_id IN (SELECT value FROM json_each(?1)) THEN 'QUEUED' ELSE ?2 END,
      planned=CASE WHEN player_id IN (SELECT value FROM json_each(?1)) THEN 1 ELSE 0 END
      WHERE match_id=?3 AND tip=?4 AND status='PROJECTED'`).bind(JSON.stringify([...ids]),complete?'NOT_LISTED':'NOT_VERIFIED_IN_INDEX',...key(w))
  ];
  if(index.http_status===429){
    const until=backoff(index.retry_after,options.clock());
    writes.push(db.prepare('UPDATE player_odds_source_gate SET backoff_until=max(coalesce(backoff_until,?),?) WHERE id=1').bind(until,until));
  }
  await db.batch(writes);
  return cost;
}
async function commitStaged(db,w,edition,task,clock){
  const observed=JSON.parse(task.staged_quotes);
  if(clock()<Date.parse(w.tip))await recordQuotedDecisions(db,edition,observed,utc(clock()));
  const saved=await db.prepare(`SELECT side,decimal_odds,json_extract(payload,'$.line') line,json_extract(payload,'$.source_url') source_url
    FROM odds_study_quotes WHERE match_id=? AND market='PLAYER_POINTS_OT' AND subject=? AND observed_at=?
    AND bookmaker='DraftKings' AND json_extract(payload,'$.source')='LineSmart'`).bind(w.match_id,task.player_id,task.observed_at).all();
  const verified=['OVER','UNDER'].every(side=>observed.some(q=>q.side===side&&saved.results.some(s=>s.side===side&&
    s.decimal_odds===q.decimal_odds&&s.line===q.line&&s.source_url===q.source_url)));
  await db.prepare(`UPDATE player_odds_tasks SET status=?,recorded_at=${clockSql},staged_quotes=NULL
    WHERE match_id=? AND tip=? AND player_id=? AND status='STAGED'`).bind(verified?'OBSERVED':'NOT_RECORDED',...key(w),task.player_id).run();
}

export async function processPlayerOddsCoverage(env,body,{fetcher=fetch,clock=Date.now,fetchIndex,fetchProfile}={}){
  if(!body||!/^\d{5,15}$/.test(String(body.match_id))||!Number.isSafeInteger(body.generation))return;
  const db=dbFor(env),w=await getWindow(db,String(body.match_id),body.tip);
  if(!w||w.status!=='OPEN')return;
  const now=clock(),tip=Date.parse(w.tip),at=utc(now);
  if(now>=tip){
    await db.prepare("UPDATE player_odds_windows SET status='EXPIRED',lease=NULL,lease_until=NULL WHERE match_id=? AND tip=?").bind(...key(w)).run();return;
  }
  if(body.generation!==w.generation){await sendCurrent(env,db,w,now+spacing,clock);return;}
  // A delivery may be retried after an interrupted worker. Reserve per-player before HTTP;
  // a sealed quote group is replayable, an interrupted network attempt is never repeated.
  const token=crypto.randomUUID();
  const [,,gate,lease]=await db.batch([
    db.prepare(`UPDATE player_odds_source_gate SET token=?1,next_at=?2 WHERE id=1
      AND coalesce(next_at,'')<=${clockSql} AND coalesce(backoff_until,'')<=${clockSql} AND EXISTS
      (SELECT 1 FROM player_odds_windows WHERE match_id=?3 AND tip=?4 AND generation=?5
       AND status='OPEN' AND coalesce(lease_until,'')<=${clockSql} AND ${clockSql}<tip)`).bind(token,utc(now+spacing),...key(w),w.generation),
    db.prepare(`UPDATE player_odds_windows SET lease=?1,lease_until=?2 WHERE match_id=?3 AND tip=?4 AND generation=?5
      AND EXISTS(SELECT 1 FROM player_odds_source_gate WHERE id=1 AND token=?1)`).bind(token,utc(now+leaseMs),...key(w),w.generation),
    db.prepare('SELECT next_at,backoff_until FROM player_odds_source_gate WHERE id=1'),
    db.prepare('SELECT lease,lease_until FROM player_odds_windows WHERE match_id=? AND tip=?').bind(...key(w))
  ]);
  const slot=gate.results[0],lock=lease.results[0];
  if(lock.lease!==token){
    const ready=Math.max(now+1000,...[slot.next_at,slot.backoff_until,lock.lease_until].filter(Boolean).map(Date.parse));
    if(!lock.lease)await advance(env,db,w,null,'OPEN',ready,clock);
    else if(lock.lease_until<=at)await advance(env,db,w,lock.lease,'OPEN',ready,clock);
    else{
      // Do not acknowledge away the only recovery if the earlier owner crashed.
      await env.MAX_RESEARCH_QUEUE.send(body,{delaySeconds:delay(ready,clock)});
    }
    return;
  }
  w.lease=token;
  const edition=await readPublishedForecast(db,w.match_id);
  if(!edition||edition.tip!==w.tip){await advance(env,db,w,token,'SUPERSEDED',now,clock);return;}
  await db.prepare(`UPDATE player_odds_tasks SET status='INTERRUPTED',recorded_at=${clockSql}
    WHERE match_id=? AND tip=? AND status='STARTED'`).bind(...key(w)).run();
  const staged=await db.prepare("SELECT * FROM player_odds_tasks WHERE match_id=? AND tip=? AND status='STAGED'").bind(...key(w)).all();
  for(const task of staged.results){
    const sealedEdition=task.edition_id===edition.id?edition:await readPublishedForecast(db,w.match_id,task.edition_id);
    if(sealedEdition)await commitStaged(db,w,sealedEdition,task,clock);
  }
  let cost=0;
  if(w.mode==='AWAITING_INDEX'&&clock()<tip)cost=await markIndex(db,w,edition,{fetcher,clock,fetchIndex});
  const pending=await db.prepare("SELECT * FROM player_odds_tasks WHERE match_id=? AND tip=? AND status='QUEUED' ORDER BY ranking,player_id LIMIT ?").bind(...key(w),4-cost).all();
  const roster=new Map(listProjectedOddsPlayers(edition.visible).map(p=>[String(p.id),p]));
  for(const t of pending.results){
    const p=roster.get(t.player_id);
    if(!p||String(p.team_id)!==t.team_id){await db.prepare("UPDATE player_odds_tasks SET status='NO_CURRENT_PROJECTION' WHERE match_id=? AND tip=? AND player_id=? AND status='QUEUED'").bind(...key(w),t.player_id).run();continue;}
    const started=await db.prepare(`UPDATE player_odds_tasks SET status='STARTED',started_at=${clockSql},edition_id=?
      WHERE match_id=? AND tip=? AND player_id=? AND status='QUEUED' AND ${clockSql}<tip
      AND EXISTS(SELECT 1 FROM player_odds_source_gate WHERE id=1 AND coalesce(backoff_until,'')<=${clockSql})
      RETURNING player_id`).bind(edition.id,...key(w),t.player_id).first();
    if(!started)break;
    if(clock()>=tip){
      await db.prepare("UPDATE player_odds_tasks SET status='EXPIRED_BEFORE_REQUEST',started_at=NULL WHERE match_id=? AND tip=? AND player_id=? AND status='STARTED'")
        .bind(...key(w),t.player_id).run();
      break;
    }
    const {quotes,lookup}=await (fetchProfile??fetchPlayerOddsProfile)(edition.visible,p,{fetcher,clock});
    const late=Date.parse(lookup.observed_at)>=tip,status=late?'FINISHED_AFTER_TIP':quotes.length?'STAGED':
      lookup.status==='OBSERVED'?'NOT_RECORDED':lookup.status;
    // A newer published edition can appear while the HTTP request is in flight.
    // Bind the observation to the latest version already visible at its true observation time.
    const bound=status==='STAGED'?await db.prepare(`SELECT id FROM published_forecasts WHERE match_id=? AND tip=?
      AND published_at<=? ORDER BY id DESC LIMIT 1`).bind(w.match_id,w.tip,lookup.observed_at).first():null;
    const writes=[db.prepare(`UPDATE player_odds_tasks SET status=?,source_url=?,observed_at=?,staged_quotes=?,edition_id=coalesce(?,edition_id),recorded_at=${clockSql}
      WHERE match_id=? AND tip=? AND player_id=? AND status='STARTED'`).bind(status,lookup.source_url??null,lookup.observed_at,status==='STAGED'?JSON.stringify(quotes):null,bound?.id??null,...key(w),t.player_id)];
    if(lookup.status==='HTTP_429'){
      const until=backoff(lookup.retry_after,clock());
      writes.push(db.prepare('UPDATE player_odds_source_gate SET backoff_until=max(coalesce(backoff_until,?),?) WHERE id=1').bind(until,until));
    }
    await db.batch(writes);
    if(status==='STAGED'){
      const captured=bound?.id&&bound.id!==edition.id?await readPublishedForecast(db,w.match_id,bound.id):edition;
      await commitStaged(db,w,captured,{...t,staged_quotes:JSON.stringify(quotes),observed_at:lookup.observed_at},clock);
    }
    if(lookup.status==='HTTP_429'||late)break;
  }
  const more=await db.prepare("SELECT 1 n FROM player_odds_tasks WHERE match_id=? AND tip=? AND status IN ('PROJECTED','QUEUED','STAGED') LIMIT 1").bind(...key(w)).first();
  const next=await db.prepare('SELECT next_at,backoff_until FROM player_odds_source_gate WHERE id=1').first();
  await advance(env,db,w,token,clock()>=tip?'EXPIRED':more?'OPEN':'DONE',
    Math.max(clock(),...[next.next_at,next.backoff_until].filter(Boolean).map(Date.parse)),clock);
}

export async function readPlayerOddsCoverage(db,matchId=null){
  const store=db.withSession?db.withSession('first-primary'):db,id=matchId==null?null:String(matchId);
  const windowFrom=id?null:utc(Date.now()-72*3600000);
  const [rows,profiles,gate]=await store.batch([
    store.prepare('SELECT * FROM player_odds_windows WHERE (?1 IS NULL OR match_id=?1) AND (?2 IS NULL OR tip>=?2) ORDER BY tip DESC,match_id').bind(id,windowFrom),
    store.prepare(`SELECT t.match_id,t.tip,t.player_id,t.player_name,t.status,t.planned,t.started_at,t.observed_at,t.source_url
      FROM player_odds_windows w CROSS JOIN player_odds_tasks t ON t.match_id=w.match_id AND t.tip=w.tip
      WHERE (?1 IS NULL OR w.match_id=?1) AND (?2 IS NULL OR w.tip>=?2) ORDER BY t.match_id,t.tip,t.ranking`).bind(id,windowFrom),
    store.prepare('SELECT backoff_until FROM player_odds_source_gate WHERE id=1')
  ]);
  const byWindow=new Map();
  for(const t of profiles.results){const k=t.match_id+'|'+t.tip;if(!byWindow.has(k))byWindow.set(k,[]);byWindow.get(k).push(t);}
  const windows=rows.results.map(w=>{
    const tasks=byWindow.get(w.match_id+'|'+w.tip)??[],index=JSON.parse(w.index_json??'{}');
    const attempted=tasks.filter(t=>t.started_at||t.observed_at);
    const observed=attempted.filter(t=>t.status==='OBSERVED'),refused=attempted.filter(t=>/^HTTP_(401|403|429)$/.test(t.status));
    const unavailable=attempted.filter(t=>t.status!=='OBSERVED'&&!/^HTTP_(401|403|429)$/.test(t.status)&&!['STARTED','STAGED'].includes(t.status));
    return {match_id:w.match_id,tip:w.tip,edition_id:w.edition_id,mode:w.mode,status:w.status,
      index_status:w.index_status,index_url:w.index_url,index_at:w.index_at,index_http_status:index.http_status??null,
      reported_players:index.reported_players??null,matched_listed_players:index.matched_listed_players??null,
      all_reported_players_scanned:index.all_reported_players_scanned??null,
      projected_players:tasks.length,listed_players:index.listed_players??0,planned_players:tasks.filter(t=>t.planned).length,
      attempted_players:attempted.length,observed_players:observed.length,refused_players:refused.length,unavailable_players:unavailable.length,
      pending_players:w.status==='OPEN'?tasks.filter(t=>['QUEUED','STARTED','STAGED'].includes(t.status)).length:0,
      expired_unchecked:w.status==='EXPIRED'?tasks.filter(t=>!t.started_at&&!t.observed_at&&['QUEUED','PROJECTED','EXPIRED_BEFORE_REQUEST'].includes(t.status)).length:0,
      not_listed_players:tasks.filter(t=>t.status==='NOT_LISTED').length,
      outside_verified_index:tasks.filter(t=>t.status==='NOT_VERIFIED_IN_INDEX').length,
      attempts:attempted.map(({player_id,player_name,source_url,started_at,observed_at,status})=>({player_id,player_name,source_url,started_at,observed_at,status}))};
  });
  const totals=Object.fromEntries(['projected_players','listed_players','planned_players','attempted_players','observed_players','refused_players','unavailable_players','pending_players']
    .map(k=>[k,windows.reduce((n,w)=>n+w[k],0)]));
  return {source:'LineSmart',match_id:id,window_from:windowFrom,backoff_until:gate.results[0]?.backoff_until??null,...totals,windows};
}
