// One unit is simulated independently for each named sportsbook. No orders are transmitted.
import {directPage,directDnpTerms} from './observed-odds.mjs';
import {readPublishedForecast} from './published-forecasts.mjs';

export const ODDS_RULE=Object.freeze({
  id:'published-sportsbook-markets-v1',stake_units:1,max_quote_age_minutes:60,window_minutes:360,min_odds:1,
  band_min_dates:30,band_min_settled:50,band_min_wins_and_losses:5,
  min_moneyline_return:.05,total_edge:3,spread_edge:2,player_edge:2,simulation_only:true,
  description:'Premier relevé complet et récent de chaque bookmaker dans les six heures avant le match. Une unité virtuelle. Vainqueur prévu si probabilité × cote ≥ 1,05. Pour un total, un handicap ou les points d’un joueur, il faut respectivement 3, 2 ou 2 points d’écart avec la ligne. Une seule décision par match, bookmaker, marché et joueur. Prolongations incluses.'
});
const utc=s=>typeof s==='string'&&/(?:Z|[+-]\d\d:\d\d)$/i.test(s)&&Number.isFinite(Date.parse(s))?new Date(s).toISOString():null;
const session=db=>db.withSession?db.withSession('first-primary'):db;
const clock="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const sidesFor={MONEYLINE_OT:['HOME','AWAY'],SPREAD_OT:['HOME','AWAY'],TOTAL_POINTS_OT:['OVER','UNDER'],PLAYER_POINTS_OT:['OVER','UNDER']};
const finite=Number.isFinite,round=x=>finite(x)?Number(x.toFixed(6)):null;
const named=s=>typeof s==='string'&&s.trim().length>0&&s.length<=120;
const ruleId=ODDS_RULE.id;
function sourceBelongs(q,id){
  if(q.source==='MACFLY')return directPage(q.bookmaker,q.source_url);
  if(q.source==='LineSmart'){
    try{
      const u=new URL(q.source_url);
      return q.bookmaker==='DraftKings' && q.market==='PLAYER_POINTS_OT' && u.origin==='https://linesmart.app' &&
        !u.username&&!u.password&&/^\/nba\/props\/[a-z0-9-]+\/$/.test(u.pathname) && !u.search && !u.hash;
    }catch{return false;}
  }
  if(q.source!=='ESPN'||q.market==='PLAYER_POINTS_OT'||q.bookmaker!=='DraftKings'||String(q.provider_id)!=='100')return false;
  try{
    const u=new URL(q.source_url);
    if(u.protocol!=='https:'||u.username||u.password||u.port)return false;
    if(u.hostname==='www.espn.com' && u.pathname==='/nba/game/_/gameId/'+id)return true;
    return u.hostname==='site.api.espn.com' && u.pathname==='/apis/site/v2/sports/basketball/nba/scoreboard' &&
      /^\d{8}$/.test(u.searchParams.get('dates')??'') && q.event_url==='https://www.espn.com/nba/game/_/gameId/'+id;
  }catch{return false;}
}
function validQuote(q,game,at,activation){
  if(!q||q.period!=='FULL_GAME_OT'||!named(q.bookmaker)||utc(q.event_start)!==utc(game.start)||
    !sidesFor[q.market]?.includes(q.side)||String(q.match_id)!==game.id||String(q.home_team_id)!==String(game.home.id)||
    String(q.away_team_id)!==String(game.away.id)||!finite(q.decimal_odds)||q.decimal_odds<=1||!sourceBelongs(q,game.id))return false;
  const observed=utc(q.observed_at),updated=utc(q.provider_updated_at);
  if(q.source==='LineSmart' && (!updated || !observed || updated>observed || Date.parse(observed)-Date.parse(updated)>3600000))return false;
  if(!observed||observed<activation||observed>at||observed>=game.start)return false;
  if(q.market==='PLAYER_POINTS_OT' && (!/^\d+$/.test(String(q.player_id??'')) || ![String(game.home.id),String(game.away.id)].includes(String(q.team_id))))return false;
  if(q.market!=='PLAYER_POINTS_OT' && q.player_id!=null)return false;
  return q.market==='MONEYLINE_OT'?q.line===null:finite(q.line);
}
function sealed(q,game){
  const player=q.market==='PLAYER_POINTS_OT'?String(q.player_id):null;
  const book=q.bookmaker.trim();
  const quotedLine=q.market==='SPREAD_OT' && q.side==='AWAY'?-q.line:q.line;
  const parsed={match_id:game.id,home_team_id:String(game.home.id),away_team_id:String(game.away.id),
    bookmaker:book,provider_id:q.provider_id==null?null:String(q.provider_id),market:q.market,player_id:player,side:q.side,line:q.line,
    decimal_odds:q.decimal_odds,american_odds:q.american_odds??null,observed_at:utc(q.observed_at),source_url:q.source_url,
    provider_updated_at:utc(q.provider_updated_at),event_url:q.event_url??null,source:q.source,period:'FULL_GAME_OT',rules_source_url:q.rules_source_url??null,
    early_exit_rule:q.market==='PLAYER_POINTS_OT' && book==='DraftKings'?'DK_NBA_FIRST_HALF_INJURY':null,
    dnp_rule:q.dnp_rule==='VOID' && directDnpTerms(q.bookmaker,q.rules_source_url)?'VOID':null,
    quoted_team_id:q.team_id??null,group_key:JSON.stringify([q.source,q.source_url,book,q.provider_id??null,q.group_key??null,quotedLine])};
  return parsed;
}
function projected(game,market,playerId,at){
  const adv=game.independent_analysis?.advanced,study=game.study?.pair?.primary;
  const own=study && String(study.game_id)===game.id && utc(study.at)&&utc(study.at)<=at;
  const forecastAt=utc(own?study.at:(adv?.forecast_calculated_at??game.checked_at));
  const f=own?study.forecast:adv?.forecast;
  if(!forecastAt||Date.parse(at)-Date.parse(forecastAt)>8*3600000)return {value:null,reason:'FORECAST_UNAVAILABLE'};
  if(market==='MONEYLINE_OT'){
    const p=f?.probability_home;
    return {value:finite(p)&&p>=0&&p<=1?p:null};
  }
  if(market==='PLAYER_POINTS_OT'){
    const groups=own?study.player_points:adv?.player_points;
    const matches=['home','away'].flatMap(s=>(groups?.[s]?.players??[]).filter(p=>String(p.id)===playerId)
      .map(p=>({...p,team_id:String(game[s].id)})));
    if(matches.length!==1)return {value:null,reason:'PLAYER_PROJECTION_UNAVAILABLE'};
    const p=matches[0],value=p.predicted_points_if_active??p.points_if_active;
    const result={value,player_name:p.name??null,team_id:p.team_id,conditional:true};
    if(p.status==='OUT'||p.reported_status==='OUT'||p.availability==='OFFICIAL_OUT')return {...result,value:null,reason:'PLAYER_RULED_OUT'};
    return {...result,value:finite(value)&&value>=0?value:null};
  }
  const h=f?.projected_score?.home,a=f?.projected_score?.away;
  return {value:finite(h)&&finite(a)?(market==='TOTAL_POINTS_OT'?h+a:h-a):null};
}

function choose(game,edition,offers,at){
  const first=offers[0],market=first.market,sides=sidesFor[market],projection=projected(game,market,first.player_id,at);
  const base={match_id:game.id,edition_id:edition.id,tip:edition.tip,teams:{home:game.home.name,away:game.away.name},
    home_team_id:String(game.home.id),away_team_id:String(game.away.id),bookmaker:first.bookmaker,market,
    player_id:first.player_id,player_name:projection.player_name??null,team_id:projection.team_id??null,
    projection:projection.value,conditional:projection.conditional??false,offered_quote_ids:offers.map(q=>q.id),selected:false,reason:null,stake_units:0};
  const groups=new Map();
  for(const quote of offers){
    const group=groups.get(quote.group_key)??[];group.push(quote);groups.set(quote.group_key,group);
  }
  const complete=[];
  for(const group of groups.values()){
    const pair=sides.map(side=>group.filter(q=>q.side===side));
    if(pair.some(p=>!p.length))continue;
    if(pair.some(p=>p.some(q=>q.decimal_odds!==p[0].decimal_odds||q.line!==p[0].line)))return {...base,reason:'CONFLICTING_OFFERS'};
    complete.push(pair.map(p=>p[0]));
  }
  if(!complete.length)return null;
  // A simultaneous discrepancy freezes a skip. When identical prices are corroborated,
  // quote priority follows provenance and URL, never the size of the price.
  if(complete.some(pair=>pair.some((q,i)=>q.line!==complete[0][i].line||q.decimal_odds!==complete[0][i].decimal_odds)))
    return {...base,reason:'CONFLICTING_OFFERS'};
  const rank={MACFLY:0,ESPN:1,LineSmart:2};
  complete.sort(([a],[b])=>rank[a.source]-rank[b.source]||a.source_url.localeCompare(b.source_url));
  const [reference,other]=complete[0];
  if(market==='PLAYER_POINTS_OT' && reference.quoted_team_id!==projection.team_id)return {...base,reason:'PLAYER_TEAM_MISMATCH'};
  if(market==='MONEYLINE_OT'){
    base.market_favorite=reference.decimal_odds===other.decimal_odds?null:reference.decimal_odds<other.decimal_odds?'HOME':'AWAY';
    base.max_pick=!finite(projection.value)||projection.value===.5?null:projection.value>.5?'HOME':'AWAY';
  }
  if(!finite(projection.value))return {...base,reason:projection.reason??'FORECAST_UNAVAILABLE'};
  let difference,threshold;
  if(market==='MONEYLINE_OT'){
    difference=projection.value-.5;threshold=0;
  }else if(market==='SPREAD_OT'){
    difference=projection.value+reference.line;threshold=ODDS_RULE.spread_edge;
  }else{
    difference=projection.value-reference.line;threshold=market==='TOTAL_POINTS_OT'?ODDS_RULE.total_edge:ODDS_RULE.player_edge;
  }
  if(difference===0)return {...base,reason:'NO_DIRECTION'};
  const chosen=difference>0?reference:other;
  const expected=market==='MONEYLINE_OT'?(difference>0?projection.value:1-projection.value)*chosen.decimal_odds-1:null;
  const selected=expected!==null?expected+1e-12>=ODDS_RULE.min_moneyline_return:Math.abs(difference)>=threshold;
  return {...base,...chosen,quote_id:chosen.id,forecast_edge:market==='MONEYLINE_OT'?null:round(Math.abs(difference)),
    expected_return:round(expected),selected,reason:selected?'SELECTED':'BELOW_THRESHOLD',stake_units:selected?1:0};
}

export async function recordQuotedDecisions(db,edition,quotes,asOf=new Date().toISOString()){
  const at=utc(asOf),store=session(db);
  if(!at||!edition?.id||!Array.isArray(quotes))return [];
  const [saved,timing]=await Promise.all([readPublishedForecast(store,edition.match_id,edition.id),
    store.prepare('SELECT p.frozen_at AS activated_at,p.parameters,'+clock+' AS server_now FROM odds_study_protocols p WHERE p.rule_id=?').bind(ruleId).first()]);
  if(timing && timing.parameters!==JSON.stringify({rule:ODDS_RULE,bands}))throw Error('ODDS_RULE_VERSION_MISMATCH');
  if(!saved||!timing||saved.published_at<timing.activated_at||saved.published_at>at||at>timing.server_now||timing.server_now>=saved.tip)return [];
  const game=saved.visible;
  const observed=quotes.flatMap(q=>Array.isArray(q?.sides)?q.sides.map(side=>({...q,side:side?.side,line:side?.line,decimal_odds:side?.decimal_odds})):q?[q]:[]);
  const rows=observed.filter(q=>validQuote(q,game,at,timing.activated_at)).map(q=>sealed(q,game));
  // Keep every admissible offer, even if a price is missing on the other side or the first decision is already frozen.
  for(let i=0;i<rows.length;i+=50)await store.batch(rows.slice(i,i+50).map(q=>store.prepare(`INSERT OR IGNORE INTO odds_study_quotes
    (rule_id,edition_id,match_id,bookmaker,market,subject,group_key,observed_at,side,decimal_odds,payload)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${clock}<?`).bind(ruleId,saved.id,game.id,q.bookmaker,q.market,q.player_id??'',q.group_key,q.observed_at,q.side,q.decimal_odds,JSON.stringify(q),saved.tip)));
  if(Date.parse(saved.tip)-Date.parse(at)>ODDS_RULE.window_minutes*60000)return [];
  const cutoff=new Date(Date.parse(at)-ODDS_RULE.max_quote_age_minutes*60000).toISOString();
  const read=await store.prepare(`SELECT id,payload,received_at FROM odds_study_quotes WHERE rule_id=? AND match_id=? AND observed_at>=?
    AND observed_at<=? AND received_at<=${clock} ORDER BY observed_at DESC,id`).bind(ruleId,game.id,cutoff,at).all();
  const grouped=new Map();
  for(const row of read.results){
    const q={...JSON.parse(row.payload),id:row.id,received_at:row.received_at};
    const key=JSON.stringify([q.bookmaker,q.market,q.player_id]);
    const group=grouped.get(key)??[];
    if(!group.length||group[0].observed_at===q.observed_at)group.push(q);
    grouped.set(key,group);
  }
  const writes=[];
  for(const group of grouped.values()){
    const d=choose(game,saved,group,at);
    if(!d)continue;
    writes.push(store.prepare(`INSERT INTO odds_study_decisions(rule_id,edition_id,match_id,bookmaker,market,subject,quote_id,payload)
      SELECT ?,?,?,?,?,?,?,? WHERE ${clock}<? AND EXISTS
        (SELECT 1 FROM published_forecast_heads WHERE match_id=? AND edition_id=?)
        AND ${clock}<=? ON CONFLICT(rule_id,match_id,bookmaker,market,subject) DO NOTHING`)
      .bind(ruleId,saved.id,game.id,d.bookmaker,d.market,d.player_id??'',d.quote_id??null,JSON.stringify(d),saved.tip,game.id,saved.id,
        new Date(Date.parse(group[0].observed_at)+ODDS_RULE.max_quote_age_minutes*60000).toISOString()));
  }
  if(writes.length)await store.batch(writes);
  return (await store.prepare('SELECT id,decided_at,payload FROM odds_study_decisions WHERE rule_id=? AND match_id=?').bind(ruleId,game.id).all()).results;
}

function observedOutcome(d,game,box,at){
  const home=game.home.score,away=game.away.score;
  let actual,margin,observed=utc(game.fetched_at),url=game.source_url??'https://www.espn.com/nba/game/_/gameId/'+game.id;
  if(d.market==='PLAYER_POINTS_OT'){
    const boxAt=utc(box?.fetched_at);
    if(!boxAt||boxAt<=game.start||boxAt>at||box?.game_id!==game.id||utc(box.start)!==utc(game.start) ||
      !['home','away'].every(s=>box.teams?.[String(game[s].id)]?.totals?.points===game[s].score))return null;
    const team=box.teams[String(d.team_id)],p=team?.players?.find(x=>String(x.id)===d.player_id);
    observed=boxAt>observed?boxAt:observed;url=box.source_url??null;
    if(!url)return null;
    if(!p || !Number.isFinite(p.minutes)||p.minutes<=0){
      if(!team?.did_not_play?.some(x=>String(x.id)===d.player_id))return null;
      const voided=d.dnp_rule==='VOID';
      return {status:voided?'VOID':'UNSETTLEABLE',actual:0,net_units:voided?0:null,observed_at:observed,source_url:url};
    }
    if(!Number.isInteger(p.points)||p.points<0)return null;
    actual=p.points;margin=(actual-d.line)*(d.side==='OVER'?1:-1);
    // Standard DraftKings NBA overs can be void after a qualifying first-half injury. A box with
    // 24 minutes or fewer does not establish participation after halftime or the reason for leaving.
    if(d.early_exit_rule==='DK_NBA_FIRST_HALF_INJURY' && d.side==='OVER' && margin<=0 && p.minutes<=24)
      return {status:'UNSETTLEABLE',actual,net_units:null,observed_at:observed,source_url:url};
  }else if(d.market==='TOTAL_POINTS_OT'){
    actual=home+away;margin=(actual-d.line)*(d.side==='OVER'?1:-1);
  }else{
    actual=d.side==='HOME'?home-away:away-home;
    margin=actual+(d.market==='SPREAD_OT'?d.line:0);
  }
  return {status:margin===0?'PUSH':margin>0?'WON':'LOST',actual,net_units:d.selected?(margin>0?d.decimal_odds-1:margin<0?-1:0):null,
    observed_at:observed,source_url:url};
}

export async function settleQuotedDecisions(db,game,box,asOf=new Date().toISOString()){
  const at=utc(asOf),observed=utc(game?.fetched_at),tip=utc(game?.start);
  if(!at||!tip||!observed||!['STATUS_FINAL','STATUS_FINAL_OT'].includes(game.status)||observed<=tip||observed>at||Date.parse(at)>Date.now()||
    !['home','away'].every(s=>Number.isInteger(game[s]?.score)&&game[s].score>=0)||game.home.score===game.away.score)return;
  const store=session(db),rows=await store.prepare(`SELECT d.id,d.payload FROM odds_study_decisions d JOIN published_forecasts p ON p.id=d.edition_id
    WHERE d.match_id=? AND p.tip=? AND (json_extract(d.payload,'$.selected')=1 OR (d.market='MONEYLINE_OT' AND json_type(d.payload,'$.max_pick')='text' AND json_type(d.payload,'$.side')='text'))`).bind(String(game.id),tip).all();
  const writes=[];
  for(const row of rows.results){
    const d=JSON.parse(row.payload);
    if(String(game.home.id)!==d.home_team_id || String(game.away.id)!==d.away_team_id)continue;
    const r=observedOutcome(d,game,box,at);
    if(!r)continue;
    writes.push(store.prepare(`INSERT INTO odds_study_settlements(decision_id,observed_at,status,actual,net_units,source_url)
     SELECT ?1,?2,?3,?4,?5,?6 WHERE ?2<=${clock}
       AND NOT EXISTS(SELECT 1 FROM odds_study_settlements WHERE decision_id=?1 AND observed_at>=?2)
       AND NOT EXISTS(SELECT 1 FROM odds_study_settlements WHERE id=(
         SELECT id FROM odds_study_settlements WHERE decision_id=?1 ORDER BY observed_at DESC LIMIT 1)
         AND status=?3 AND actual IS ?4 AND net_units IS ?5) ON CONFLICT(decision_id,observed_at) DO NOTHING`)
      .bind(row.id,r.observed_at,r.status,r.actual,r.net_units,r.source_url));
  }
  if(writes.length)await store.batch(writes);
}

const bands=[
  {id:'1-1.5',label:'1,00 à moins de 1,50',min:1,max:1.5},
  {id:'1.5-2',label:'1,50 à moins de 2,00',min:1.5,max:2},
  {id:'2-3',label:'2,00 à moins de 3,00',min:2,max:3},
  {id:'3+',label:'3,00 et plus',min:3,max:Infinity}
];
// Transfer only sufficient statistics for the full history. Corrections change equity on
// their actual settlement date. Simultaneous corrections contribute a single equity step.
function aggregatePerformance(where){
  return `WITH selected AS (
    SELECT d.id,substr(json_extract(d.payload,'$.tip'),1,10) day,
      CASE WHEN json_extract(d.payload,'$.decimal_odds')<1.5 THEN '1-1.5'
        WHEN json_extract(d.payload,'$.decimal_odds')<2 THEN '1.5-2'
        WHEN json_extract(d.payload,'$.decimal_odds')<3 THEN '2-3' ELSE '3+' END band
    FROM odds_study_decisions d WHERE ${where} AND json_extract(d.payload,'$.selected')=1
  ), scopes AS (
    SELECT id,day,'all' bucket FROM selected UNION ALL SELECT id,day,band FROM selected
  ), latest AS (
    SELECT x.bucket,x.day,coalesce(s.status,'PENDING') status,coalesce(s.net_units,0) net FROM scopes x
    LEFT JOIN odds_study_settlements s ON s.id=(SELECT j.id FROM odds_study_settlements j
      WHERE j.decision_id=x.id ORDER BY j.observed_at DESC,j.id DESC LIMIT 1)
  ), counts AS (
    SELECT bucket,count(*) selections,sum(status='WON') wins,sum(status='LOST') losses,sum(status='PUSH') pushes,
      sum(status='VOID') voids,sum(status='PENDING') pending,sum(status='UNSETTLEABLE') unsettleable
    FROM latest GROUP BY bucket
  ), daily AS (
    SELECT bucket,day,count(*) n,sum(net) net FROM latest
    WHERE status IN ('WON','LOST','PUSH','VOID') GROUP BY bucket,day
  ), days AS (
    SELECT bucket,count(*) dates,sum(n) settled,sum(net) net,sum(net*net) ss_net,
      sum(n*net) s_n_net,sum(n*n) ss_n FROM daily GROUP BY bucket
  ), changes AS (
    SELECT s.decision_id,s.settled_at,coalesce(s.net_units,0)-lag(coalesce(s.net_units,0),1,0)
      OVER(PARTITION BY s.decision_id ORDER BY s.settled_at,s.id) change
    FROM selected c JOIN odds_study_settlements s ON s.decision_id=c.id
  ), moments AS (
    SELECT x.bucket,e.settled_at,sum(e.change) change FROM changes e JOIN scopes x ON x.id=e.decision_id
    GROUP BY x.bucket,e.settled_at
  ), trajectory AS (
    SELECT bucket,settled_at,sum(change) OVER(PARTITION BY bucket ORDER BY settled_at) equity FROM moments
  ), losses AS (
    SELECT bucket,max(0,max(equity) OVER(PARTITION BY bucket ORDER BY settled_at))-equity drawdown FROM trajectory
  ), risk AS (SELECT bucket,max(drawdown) drawdown FROM losses GROUP BY bucket)
  SELECT c.*,v.dates,v.settled,v.net,v.ss_net,v.s_n_net,v.ss_n,r.drawdown FROM counts c
  LEFT JOIN days v USING(bucket) LEFT JOIN risk r USING(bucket)`;
}

function performance(row={}){
  const {selections=0,wins=0,losses=0,pushes=0,voids=0,pending=0,unsettleable=0}=row;
  const n=row.settled??0,dates=row.dates??0,net=n?row.net:null,roi=n?net/n:null;
  let interval=null;
  if(dates>=ODDS_RULE.band_min_dates && n>=ODDS_RULE.band_min_settled &&
    Math.min(wins,losses)>=ODDS_RULE.band_min_wins_and_losses){
    const residual=Math.max(0,row.ss_net-2*roi*row.s_n_net+roi*roi*row.ss_n);
    const width=2.8*Math.sqrt(dates/(dates-1)*residual)/n;
    interval=[round(roi-width),round(roi+width)];
  }
  return {selections,wins,losses,pushes,voids,pending,unsettleable,staked_units:selections,settled_units:n,
    net_units:round(net),roi:round(roi),roi_on_staked:n?round(net/selections):null,
    max_drawdown_units:n?round(row.drawdown):null,dates,interval_95:interval};
}
const historyPageSize=50;
function oddsScope(matchId,filters){
  const clauses=['d.rule_id=?'],args=[ruleId];
  for(const [field,value] of [['match_id',matchId],['bookmaker',filters.bookmaker],['market',filters.market]]){
    if(value!=null && value!==''){clauses.push('d.'+field+'=?');args.push(value);}
  }
  return {where:clauses.join(' AND '),args};
}
function detailPage(store,kind,scope,before=null,settlementLimit=null){
  const cursor=before==null?'':' AND d.id<?',args=[...scope.args,...(before==null?[]:[before])];
  const bound=settlementLimit==null?'':' AND a.id<=?';
  const query=kind==='quotes'?`SELECT d.id,d.edition_id,d.received_at,d.payload FROM odds_study_quotes d`:
    `SELECT d.id,d.edition_id,d.payload,d.decided_at,s.status,s.actual,s.net_units,s.settled_at,
      s.observed_at AS result_observed_at,s.source_url AS result_source_url FROM odds_study_decisions d
      LEFT JOIN odds_study_settlements s ON s.id=(SELECT a.id FROM odds_study_settlements a
      WHERE a.decision_id=d.id ${bound} ORDER BY a.observed_at DESC,a.id DESC LIMIT 1)`;
  return store.prepare(query+' WHERE '+scope.where+cursor+' ORDER BY d.id DESC LIMIT '+historyPageSize)
    .bind(...(kind==='decisions'&&settlementLimit!=null?[settlementLimit]:[]),...args);
}
async function remainingDetails(store,kind,scope,first,fetchAll,settlementLimit){
  const rows=[...first];let page=first;
  while(fetchAll && page.length===historyPageSize){
    page=(await detailPage(store,kind,scope,page.at(-1).id,settlementLimit).all()).results;
    rows.push(...page);
  }
  return rows.map(({payload,...row})=>{
    const value={...JSON.parse(payload),...row};
    if(kind==='decisions')value.status=value.selected?(row.status??'PENDING'):'SKIPPED';
    return value;
  });
}
export async function oddsStudySummary(db,matchId=null,filters={}){
  const store=session(db),scope=oddsScope(matchId,filters),catalog=oddsScope(matchId,{});
  const sql=(q)=>store.prepare(q).bind(...scope.args);
  const [rule,analysis,quotesMeta,options,decisionsMeta,stats,baseline,quotesPage,decisionsPage]=await store.batch([
    store.prepare('SELECT frozen_at AS activated_at FROM odds_study_protocols WHERE rule_id=?').bind(ruleId),
    store.prepare(`SELECT count(DISTINCT match_id) n FROM published_forecasts
      WHERE published_at>=(SELECT frozen_at FROM odds_study_protocols WHERE rule_id=?) ${matchId?'AND match_id=?':''}`).bind(ruleId,...(matchId?[matchId]:[])),
    sql('SELECT count(*) n,count(DISTINCT d.match_id) games FROM odds_study_quotes d WHERE '+scope.where),
    store.prepare('SELECT DISTINCT d.bookmaker,d.market FROM odds_study_quotes d WHERE '+catalog.where).bind(...catalog.args),
    sql(`SELECT count(*) decisions,count(DISTINCT CASE WHEN json_extract(d.payload,'$.reason')
        NOT IN ('CONFLICTING_OFFERS','PLAYER_TEAM_MISMATCH') THEN d.match_id END) priced_games,
      (SELECT coalesce(max(id),0) FROM odds_study_settlements) settlement_limit
      FROM odds_study_decisions d WHERE ${scope.where}`),
    sql(aggregatePerformance(scope.where)),
    sql(`WITH paired AS (
      SELECT d.bookmaker,json_extract(d.payload,'$.max_pick') max_pick,json_extract(d.payload,'$.market_favorite') fav,
        CASE WHEN s.actual>0 THEN json_extract(d.payload,'$.side')
          WHEN json_extract(d.payload,'$.side')='HOME' THEN 'AWAY' ELSE 'HOME' END winner
      FROM odds_study_decisions d JOIN odds_study_settlements s ON s.id=(SELECT j.id FROM odds_study_settlements j
        WHERE j.decision_id=d.id ORDER BY j.observed_at DESC,j.id DESC LIMIT 1)
      WHERE ${scope.where} AND d.market='MONEYLINE_OT' AND s.actual IS NOT NULL
        AND json_extract(d.payload,'$.side') IN ('HOME','AWAY')
    ) SELECT bookmaker,count(*) games,sum(max_pick=winner) max_correct,sum(fav=winner) favorite_correct
      FROM paired WHERE max_pick IN ('HOME','AWAY') AND fav IN ('HOME','AWAY') GROUP BY bookmaker ORDER BY bookmaker`),
    detailPage(store,'quotes',scope),detailPage(store,'decisions',scope)
  ]);
  const meta=decisionsMeta.results[0],qmeta=quotesMeta.results[0],specific=matchId!=null;
  const [quote_rows,decision_rows,latest]=await Promise.all([
    remainingDetails(store,'quotes',scope,quotesPage.results,specific,meta.settlement_limit),
    remainingDetails(store,'decisions',scope,decisionsPage.results,specific,meta.settlement_limit),
    specific?readPublishedForecast(store,matchId):null
  ]);
  const byBand=new Map(stats.results.map(row=>[row.bucket,row]));
  const summaries=bands.map(({id,label})=>({id,label,...performance(byBand.get(id))}));
  const best=summaries.every(b=>b.interval_95 && !b.pending && !b.unsettleable)
    ?summaries.find(b=>summaries.every(x=>x===b||b.interval_95[0]>x.interval_95[1])):null;
  const compared_with_market=baseline.results.map(r=>({...r,max_accuracy:round(r.max_correct/r.games),favorite_accuracy:round(r.favorite_correct/r.games)}));
  const {unpriced_projections,coverage}=coverageFor(latest,quote_rows,filters);
  return {rule:{...ODDS_RULE,activated_at:rule.results[0]?.activated_at??null},simulation_only:true,coverage,unpriced_projections,compared_with_market,
    analyzed_games:analysis.results[0].n,priced_games:meta.priced_games,observed_games:qmeta.games,observations:qmeta.n,decisions:meta.decisions,
    recent_limit:specific?null:historyPageSize,...performance(byBand.get('all')),bands:summaries,best_band:best?.id??null,
    bookmakers:[...new Set(options.results.map(r=>r.bookmaker))].sort(),markets:[...new Set(options.results.map(r=>r.market))].sort(),
    decision_rows,quote_rows};
}

function coverageFor(edition,quotes,filters){
  const unavailable=[],roster=new Set(),priced=new Set();
  if(!edition)return {unpriced_projections:unavailable,coverage:{projected_players:null,priced_players:null}};
  const game=edition.visible,groups=game.study?.pair?.primary?.player_points??game.independent_analysis?.advanced?.player_points;
  for(const market of Object.keys(sidesFor)){
    if(filters.market&&market!==filters.market)continue;
    const ids=market==='PLAYER_POINTS_OT'?['home','away'].flatMap(s=>(groups?.[s]?.players??[]).map(p=>String(p.id))):[null];
    for(const id of new Set(ids)){
      const p=projected(game,market,id,edition.published_at);
      if(!finite(p.value))continue;
      if(id)roster.add(id);
      if(quotes.some(q=>q.market===market&&q.player_id===id)){
        if(id)priced.add(id);
        continue;
      }
      unavailable.push({match_id:game.id,edition_id:edition.id,market,player_id:id,player_name:p.player_name??null,forecast:p.value,
        label:'Rendement non évaluable'});
    }
  }
  return {unpriced_projections:unavailable,coverage:{projected_players:roster.size,priced_players:priced.size}};
}
