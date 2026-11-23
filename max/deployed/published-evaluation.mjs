import {scoreObservedGame,scorePlayedProjection} from './evaluation-study.mjs';
import {analyzeFailure} from './postmortem.mjs';
import {readPublishedForecast} from './published-forecasts.mjs';

const sides=['home','away'];
const finite=Number.isFinite;
const number=x=>finite(x)?Number(x.toFixed(5)):null;
const nonnegative=x=>finite(x)&&x>=0;
const probability=x=>nonnegative(x)&&x<=1;
const instant=x=>typeof x==='string'&&finite(Date.parse(x))?new Date(x).toISOString():null;
const finalStatus=new Set(['STATUS_FINAL','STATUS_FINAL_OT','STATUS_FINAL_PENALTY']);
const session=db=>db.withSession?db.withSession('first-primary'):db;
const measurement=(forecast,actual,applicable=true)=>({
  forecast:number(forecast),actual:number(actual),error:applicable?number(finite(forecast)&&finite(actual)?forecast-actual:null):null
});

function timedGame(game,asOf){
  const at=instant(asOf),tip=instant(game?.start),observed=instant(game?.fetched_at);
  if(!at||!tip||!observed||observed<=tip||observed>at||Date.parse(at)>Date.now()||
    !/^\d{5,15}$/.test(game.id)||!finalStatus.has(game.status)||
    !sides.every(side=>game[side]?.id!=null&&Number.isInteger(game[side]?.score)&&game[side].score>=0)||
    String(game.home.id)===String(game.away.id)||game.home.score===game.away.score)return null;
  return {at,tip,observed};
}
function usableBox(game,box,t){
  const at=instant(box?.fetched_at);
  if(String(box?.game_id)!==String(game.id)||!at||at<=t.tip||at>t.at||
     (box.start!=null && instant(box.start)!==t.tip))return false;
  return sides.every(side=>{
    const team=box.teams?.[String(game[side].id)];
    return Array.isArray(team?.players) && (!finite(team.totals?.points)||team.totals.points===game[side].score);
  });
}
function observation(db,match,tip,kind,at,data){
  // A retry with an unchanged result preserves its first observed time. An official
  // correction can even return to a previously observed value after an intermediate change.
  return db.prepare(`WITH candidate(match_id,tip,kind,observed_at,payload) AS (VALUES(?,?,?,?,?))
    INSERT INTO published_final_observations(match_id,tip,kind,observed_at,payload)
    SELECT c.* FROM candidate c WHERE EXISTS
      (SELECT 1 FROM published_forecasts p WHERE p.match_id=c.match_id AND p.tip=c.tip AND p.published_at<c.tip)
      AND c.observed_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS
      (SELECT 1 FROM published_final_observations o WHERE o.match_id=c.match_id AND o.tip=c.tip AND o.kind=c.kind AND o.observed_at>=c.observed_at)
      AND c.payload IS NOT (SELECT o.payload FROM published_final_observations o
        WHERE o.match_id=c.match_id AND o.tip=c.tip AND o.kind=c.kind ORDER BY o.observed_at DESC LIMIT 1)
    ON CONFLICT(match_id,tip,kind,observed_at) DO NOTHING`).bind(match,tip,kind,at,JSON.stringify(data,(_key,value)=>
      value&&typeof value==='object'&&!Array.isArray(value)?
        Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value));
}
export async function assessPublished(db,game,box,asOf=new Date().toISOString()){
  const time=timedGame(game,asOf);
  if(!time)return null;
  const store=session(db),match=String(game.id);
  const team=s=>({id:String(game[s].id),name:game[s].name??null,score:game[s].score});
  const result={id:match,start:time.tip,status:game.status,home:team('home'),away:team('away'),source:game.source??null,
    source_url:game.source_url??('https://www.espn.com/nba/game/_/gameId/'+match)};
  const writes=[observation(store,match,time.tip,'FINAL',time.observed,result)];
  if(usableBox(game,box,time))writes.push(observation(store,match,time.tip,'BOX',instant(box.fetched_at),{
    game_id:match,teams:box.teams,source_url:box.source_url??null,home_id:result.home.id,away_id:result.away.id,
    final_score:{home:result.home.score,away:result.away.score}
  }));
  await store.batch(writes);
  return readPublishedAssessment(store,match);
}

function projectedCard(visible,edition){
  const adv=visible.independent_analysis?.advanced,primary=visible.study?.pair?.primary;
  const fresh=at=>{const d=Date.parse(edition.published_at)-Date.parse(at);return finite(d)&&d>=0&&d<=8*3600000;};
  if(primary && String(primary.game_id)===String(visible.id) && instant(primary.at) && instant(primary.at)<edition.tip &&
    instant(primary.at)<=edition.published_at){
    return {forecast:fresh(primary.at)?primary.forecast:null,players:fresh(primary.at)?primary.player_points:null,
      model:primary.model_version??primary.forecast?.engine_version??null,at:primary.at,source:'STUDY_CARD'};
  }
  const f=adv?.forecast,usable=visible.status==='STATUS_SCHEDULED'&&fresh(visible.checked_at)&&f?.status==='SIMULATED_UNCALIBRATED'&&
    probability(f?.probability_away)&&probability(f?.probability_home)&&Math.abs(f.probability_home+f.probability_away-1)<0.001;
  return {forecast:usable?f:null,players:usable?adv.player_points:null,model:adv?.version??null,at:visible.checked_at,source:'ADVANCED_CARD'};
}
function intervalMeasure(range,actual){
  if(!Array.isArray(range)||range.length!==2||!range.every(finite)||range[0]>range[1])return null;
  return {low:range[0],high:range[1],nominal:.80,covered:finite(actual)?actual>=range[0]&&actual<=range[1]:null};
}
function measuredGame(f,game,full){
  const ha=game.home.score,aa=game.away.score,h=f?.projected_score?.home,a=f?.projected_score?.away;
  const usable=probability(f?.probability_home)&&nonnegative(h)&&nonnegative(a);
  const observed=usable?scoreObservedGame(game,{forecast:f}):null;
  const p=observed?.p_home, winner=ha>aa?'home':'away';
  const same=usable&&full?.projected_score?.home===h&&full?.projected_score?.away===a&&full.probability_home===p;
  const ranges=f?.interval_80??(same?full.interval_80:null),intervals_80={};
  for(const [key,actual] of Object.entries({home:ha,away:aa,total:ha+aa,margin:ha-aa})){
    const interval=usable?intervalMeasure(ranges?.[key],actual):null;
    if(interval)intervals_80[key]=interval;
  }
  return {home:measurement(usable?h:null,ha),away:measurement(usable?a:null,aa),intervals_80,
    total:measurement(usable?h+a:null,ha+aa),margin:measurement(usable?h-a:null,ha-aa),
    winner:{actual:winner,projected:!usable||p===.5?null:p>.5?'home':'away',correct:observed?.correct??null,
      probability_home:number(p),brier:number(observed?.brier),log_loss:number(observed?.log_loss),
      open:usable?Math.max(p,1-p)<.55:null}};
}
function actualPlayer(box,teamId,id){
  const team=box?.teams?.[teamId],real=team?.players?.find(p=>String(p.id)===id);
  if(real&&nonnegative(real.minutes)&&real.minutes>0)return {kind:'PLAYED',minutes:real.minutes,points:nonnegative(real.points)?real.points:null};
  const dnp=team?.did_not_play?.find(p=>String(p.id)===id);
  return dnp?{kind:'CONFIRMED_DNP',minutes:0,points:0,reason:dnp.reason??null}:{kind:'UNKNOWN',minutes:null,points:null};
}
function scenario(label,value,real,teamActual){
  const out=['absent','out'].includes(label);
  let applicable='UNVERIFIED_CONDITION';
  if(real.kind==='CONFIRMED_DNP')applicable=out?'OBSERVED':'NOT_APPLICABLE';
  if(real.kind==='PLAYED'&&out)applicable='NOT_APPLICABLE';
  // A short appearance alone cannot establish a medical restriction or a normal workload.
  return {label,applicability:applicable,minutes:measurement(value.minutes,real.minutes,applicable==='OBSERVED'),
    points:measurement(value.points,real.points,applicable==='OBSERVED'),
    ...(finite(value.team_score)?{team_score:measurement(value.team_score,teamActual,applicable==='OBSERVED')}:{})};
}
function playerProjection(raw,side,game,box,rich){
  const id=String(raw.id),team=String(game[side].id),real=actualPlayer(box,team,id);
  const status=raw.status??raw.reported_status??null,out=raw.availability==='OFFICIAL_OUT'||status==='OUT';
  const pm=raw.projected_minutes_if_active??raw.minutes_if_active,pp=raw.predicted_points_if_active??raw.points_if_active;
  const min=nonnegative(pm)?pm:null,pts=nonnegative(pp)?pp:null;
  const plays=real.kind==='PLAYED',decided=real.kind!=='UNKNOWN';
  const minutes=measurement(min,real.minutes,plays),points=measurement(out?0:pts,real.points,out?decided:plays);
  const breakdown=plays&&!out?scorePlayedProjection({minutes:min,points:pts,out:false},real):null;
  const timeTerm=number(breakdown?.minutes_points),rateTerm=number(breakdown?.production_error);
  const same=rich && (rich.projected_minutes_if_active??rich.minutes_if_active)===pm &&
    (rich.predicted_points_if_active??rich.points_if_active)===pp && (rich.availability??null)===(raw.availability??null);
  const detail=same?rich:null,playerScenarios=raw.scenarios??detail?.scenarios??{};
  const range=raw.predicted_interval_80_if_active??detail?.predicted_interval_80_if_active;
  const activePoints=plays&&finite(real.points)?real.points:null;
  const interval=intervalMeasure(range,activePoints);
  const thresholds=raw.probability_points_at_least_if_active??detail?.probability_points_at_least_if_active??{};
  const thresholds_if_active=Object.entries(thresholds).filter(([key,p])=>/^\d+$/.test(key)&&probability(p)).map(([key,p])=>{
    const at_least=Number(key),actual=activePoints==null?null:activePoints>=at_least;
    return {at_least,probability:p,actual,brier:actual==null?null:number((p-Number(actual))**2)};
  }).sort((l,r)=>l.at_least-r.at_least);
  return {player_id:id,name:raw.name??rich?.name??null,team_id:team,side,availability:raw.availability??null,status,
    participation:real.kind,dnp_reason:real.reason??null,minutes,points,minutes_if_active:minutes,
    points_if_active:measurement(pts,real.points,plays),points_condition:out?'DECLARED_OUT':'IF_PLAYS',
    status_mismatch:out&&plays,interval_80_if_active:out?null:interval,thresholds_if_active,
    minutes_points:timeTerm,production_error:rateTerm,
    offsetting_errors:finite(timeTerm)&&finite(rateTerm)&&timeTerm*rateTerm<0&&Math.abs(timeTerm)>=2&&Math.abs(rateTerm)>=2,
    scenarios:Object.entries(playerScenarios).filter(([,v])=>v&&typeof v==='object').map(([k,v])=>scenario(k,v,real,game[side].score))};
}
function assessedPlayers(game,box,groups,details){
  return sides.flatMap(side=>{
    const extended=details?.[side]?.players??[];
    return (groups?.[side]?.players??[]).filter(p=>p.id!=null&&(p.team_id==null||String(p.team_id)===String(game[side].id)))
      .map(p=>playerProjection(p,side,game,box,extended.find(q=>String(q.id)===String(p.id))));
  });
}
function findings(measures,players,projection,game,box,observedAt){
  const result=[],note=(kind,category,text,player_ids=[])=>result.push({kind,category,text,player_ids});
  if(measures.winner.correct===true && Math.abs(measures.margin.error)>=8)
    note('OBSERVATION','MARGIN','Le favori a gagné, avec un écart de victoire différent de '+Math.abs(measures.margin.error)+' points de la projection.');
  if(finite(measures.total.error)&&Math.abs(measures.total.error)>=10)
    note('OBSERVATION','TOTAL','Le total prévu était de '+measures.total.forecast+' points. Le total final a été de '+measures.total.actual+' points.');
  if(measures.winner.correct===false && projection.forecast){
    const snap={game_id:String(game.id),at:projection.at,forecast:projection.forecast,player_points:projection.players};
    const diagnosis=analyzeFailure(game,snap,snap,box,[],observedAt);
    for(const text of diagnosis?.observed_drivers??[])note('OBSERVATION','BOX_CONTEXT',text);
  }
  const cancelling=players.filter(p=>p.offsetting_errors).sort((a,b)=>Math.abs(a.points.error)-Math.abs(b.points.error))[0];
  if(cancelling)note('OBSERVATION','OFFSETTING_PLAYER_ERRORS','Pour '+cancelling.name+', l’écart de temps de jeu et l’écart de production se compensent en partie ('+
    cancelling.minutes_points+' et '+cancelling.production_error+' points).',[cancelling.player_id]);
  const misses=players.filter(p=>p.status_mismatch);
  if(misses.length)note('OBSERVATION','AVAILABILITY','Joueurs entrés en jeu après une absence annoncée : '+misses.map(p=>p.name).join(', ')+'.',misses.map(p=>p.player_id));
  const largest=[...players].filter(p=>finite(p.minutes.error)).sort((a,b)=>Math.abs(b.minutes.error)-Math.abs(a.minutes.error))[0];
  if(largest && Math.abs(largest.minutes.error)>=5)
    note('HYPOTHESIS','MINUTES','Pour '+largest.name+', vérifier sur d’autres matchs si les informations de rotation disponibles avant match réduisent l’erreur de minutes.',[largest.player_id]);
  const rate=[...players].filter(p=>finite(p.production_error)).sort((a,b)=>Math.abs(b.production_error)-Math.abs(a.production_error))[0];
  if(rate && Math.abs(rate.production_error)>=5)
    note('OBSERVATION','PRODUCTION','Aux minutes réellement jouées par '+rate.name+', son rythme de marque prévu donne '+Math.abs(rate.production_error)+' points '+(rate.production_error>0?'de plus':'de moins')+' que sa production finale.',[rate.player_id]);
  if(!result.length && measures.winner.correct!==null)note('OBSERVATION','WINNER',measures.winner.correct?'Le favori annoncé a gagné.':'Le favori annoncé a perdu.');
  return result;
}

export async function readPublishedAssessment(db,matchId,editionId=null){
  const store=session(db),id=String(matchId);
  if(editionId!=null && (!Number.isSafeInteger(Number(editionId))||Number(editionId)<1))return null;
  const row=await readPublishedForecast(store,id,editionId==null?null:Number(editionId));
  if(!row)return null;
  const observations=await store.prepare(`SELECT o.id,o.kind,o.observed_at,o.payload FROM published_final_observations o
    WHERE o.match_id=? AND o.tip=? AND o.id=(SELECT j.id FROM published_final_observations j WHERE j.match_id=o.match_id
    AND j.tip=o.tip AND j.kind=o.kind ORDER BY j.observed_at DESC LIMIT 1)`).bind(id,row.tip).all();
  const savedFinal=observations.results.find(o=>o.kind==='FINAL'),savedBox=observations.results.find(o=>o.kind==='BOX');
  if(!savedFinal)return null;
  const game=JSON.parse(savedFinal.payload),visible=row.visible,candidate=savedBox?JSON.parse(savedBox.payload):null;
  if(String(visible.id)!==id||instant(visible.start)!==row.tip||
    sides.some(s=>String(visible[s]?.id)!==String(game[s]?.id)))return null;
  const box=candidate && sides.every(s=>candidate.final_score[s]===game[s].score&&candidate[s+'_id']===game[s].id)?candidate:null;
  const advanced=visible.independent_analysis?.advanced,basis=projectedCard(visible,row),main=measuredGame(basis.forecast,game,advanced?.forecast);
  const players=assessedPlayers(game,box,basis.players,advanced?.player_points),publishedTab=assessedPlayers(game,box,advanced?.player_points,null);
  const playerKey=p=>p.side+':'+p.player_id;
  const tabOnly=publishedTab.filter(p=>!players.some(q=>playerKey(q)===playerKey(p)));
  const all=[...players,...tabOnly];
  const report=visible.automatic_report?.sections?.find(s=>s.section_id===6)?.data?.scenarios?.players??[];
  const teamScenarios=report.filter(p=>sides.includes(p.team)&&String(p.team_id)===game[p.team].id).map(p=>{
    const real=actualPlayer(box,game[p.team].id,String(p.player_id));
    return {player_id:String(p.player_id),name:p.player,team_id:String(p.team_id),status:p.official_status??null,source:p.source_url??null,
      variants:Object.entries(p.variants??{}).map(([k,v])=>scenario(k,{minutes:v.player_minutes,points:v.player_points_if_active,
        team_score:v.projected_score_hypothesis?.[p.team]},real,game[p.team].score))};
  });
  const observedAt=box&&savedBox.observed_at>savedFinal.observed_at?savedBox.observed_at:savedFinal.observed_at;
  return {schema_version:'published-assessment-v1',assessment_state:'FINAL',edition_id:row.id,match_id:id,tip:row.tip,
    published_at:row.published_at,as_of:row.as_of,model:basis.model,forecast_source:basis.source,forecast_at:basis.at,
    observed_at:observedAt,assessment_key:[row.id,savedFinal.id,box?savedBox.id:0].join(':'),final_observation_id:savedFinal.id,score_observed_at:savedFinal.observed_at,
    box_observation_id:box?savedBox.id:null,box_observed_at:box?savedBox.observed_at:null,
    result_source:game.source_url,box_source:box?.source_url??null,game:main,players:all,player_tab:publishedTab,team_scenarios:teamScenarios,
    findings:findings(main,all,basis,game,box,observedAt),
    coverage:{game_projection:main.winner.probability_home!==null,box_available:Boolean(box),
      listed_players:all.length,played:all.filter(p=>p.participation==='PLAYED').length,
      confirmed_dnp:all.filter(p=>p.participation==='CONFIRMED_DNP').length,unknown:all.filter(p=>p.participation==='UNKNOWN').length,
      measured_minutes:all.filter(p=>p.minutes.error!==null).length,measured_points:all.filter(p=>p.points.error!==null).length},
    error_convention:'Projection moins résultat réel. Minutes et production sont deux composantes descriptives de l’écart de points.'};
}
