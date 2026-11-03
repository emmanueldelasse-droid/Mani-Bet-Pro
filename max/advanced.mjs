/**
 * ManiBetProMax · moteur statistique autonome (sources ESPN historiques uniquement).
 * Aucun appel à un fournisseur payant, aucune donnée du projet ManiBetPro.
 * Les scénarios et prévisions sont des HYPOTHÈSES NON CALIBRÉES.
 */
export const ADVANCED_VERSION='max-quant-0.3.0';
const num=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
const round=(v,d=1)=>Number.isFinite(v)?Math.round(v*10**d)/10**d:null;
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const sd=a=>a.length>1?Math.sqrt(a.reduce((s,x)=>s+(x-avg(a))**2,0)/(a.length-1)):null;
const clip=(v,min,max)=>Math.max(min,Math.min(max,v));
const nameKey=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const pair=v=>{const m=String(v??'').match(/^(\d+)-(\d+)$/);return m?[Number(m[1]),Number(m[2])]:null;};
const minute=v=>{
 const m=String(v??'').match(/^(\d{1,2}):(\d{1,2})$/);
 const x=m?Number(m[1])+Number(m[2])/60:num(v);
 return x!==null&&x>=0&&x<=72?x:null;
};
/** ESPN summary boxscore: n'accepte que les minutes/équipes et scores cohérents. */
export function parseBoxscore(data,game){
 if(!game||!Array.isArray(data?.boxscore?.players)||!String(game.id).match(/^\d{5,15}$/))return null;
 const ids=[String(game.home.id),String(game.away.id)],groups={};
 for(const b of data.boxscore.players){
  const team=String(b.team?.id??'');
  if(!ids.includes(team))continue;
  const rows=[];
  for(const group of b.statistics??[]){
   const labels=(group.names??group.labels??[]).map(x=>String(x).toUpperCase());
   if(!labels.includes('MIN'))continue;
   for(const line of group.athletes??[]){
    const stats=Array.isArray(line.stats)?line.stats:[];
    const get=k=>{const idx=labels.indexOf(k);return idx>=0?stats[idx]:null;};
    const mins=minute(get('MIN')),id=String(line.athlete?.id??'');
    if(!id||!line.athlete?.displayName||mins===null||mins<=0||line.didNotPlay)continue;
    const fg=pair(get('FG')),tp=pair(get('3PT')),ft=pair(get('FT'));
    rows.push({id,name:String(line.athlete.displayName).slice(0,90),team_id:team,
     minutes:round(mins,2),points:num(get('PTS')),fgm:fg?.[0]??null,fga:fg?.[1]??null,
     three_made:tp?.[0]??null,fta:ft?.[1]??null,oreb:num(get('OREB')),
     dreb:num(get('DREB')),turnovers:num(get('TO')),assists:num(get('AST')),
     starter:line.starter===true});
   }
  }
  const mins=rows.reduce((s,p)=>s+p.minutes,0);
  if(rows.length<5||mins<190||mins>355)return null;
  const sum=k=>rows.every(p=>Number.isFinite(p[k]))?rows.reduce((s,p)=>s+p[k],0):null;
  const total={points:sum('points'),fgm:sum('fgm'),fga:sum('fga'),three_made:sum('three_made'),
   fta:sum('fta'),oreb:sum('oreb'),dreb:sum('dreb'),turnovers:sum('turnovers')};
  const vals=[total.fga,total.fta,total.oreb,total.turnovers];
  const poss=vals.every(Number.isFinite)?total.fga+0.44*total.fta-total.oreb+total.turnovers:null;
  total.possessions=poss!==null&&poss>60&&poss<160?round(poss,2):null;
  total.off_rating=total.possessions!==null&&total.points!==null?round(100*total.points/total.possessions,2):null;
  total.efg_pct=total.fga>0&&total.fgm!==null&&total.three_made!==null?
   round(100*(total.fgm+0.5*total.three_made)/total.fga,2):null;
  total.tov_pct=total.possessions!==null&&total.turnovers!==null?round(100*total.turnovers/total.possessions,2):null;
  total.ft_rate=total.fga>0&&total.fta!==null?round(total.fta/total.fga,3):null;
  groups[team]={players:rows,totals:total,minutes:round(mins,1)};
 }
 if(!ids.every(id=>groups[id]))return null;
 for(const [id,score] of [[ids[0],game.home.score],[ids[1],game.away.score]]){
  const total=groups[id].totals.points;
  if(total!==null&&score!==null&&Math.abs(total-score)>5)return null;
 }
 for(const [self,opp] of [[ids[0],ids[1]],[ids[1],ids[0]]]){
  const a=groups[self].totals,b=groups[opp].totals;
  a.orb_pct=a.oreb!==null&&b.dreb!==null&&a.oreb+b.dreb>0?
   round(100*a.oreb/(a.oreb+b.dreb),2):null;
 }
 return {schema_version:'max-box-v1',game_id:String(game.id),start:game.start,
  home_id:ids[0],away_id:ids[1],teams:groups,
  source:'ESPN summary boxscore',source_url:
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event='+game.id,
  fetched_at:data._fetched_at??null};
}
export function rotationAnalysis(teamId,boxes,injuries,tip){
 const id=String(teamId),end=Date.parse(tip),matches=[];
 for(const box of boxes){
  if(Date.parse(box?.start)>=end||!box?.teams?.[id]?.players)continue;
  for(const p of box.teams[id].players)matches.push({...p,game_id:box.game_id,start:box.start});
 }
 matches.sort((a,b)=>b.start.localeCompare(a.start));
 const players=new Map();
 for(const row of matches){
  if(!players.has(row.id))players.set(row.id,[]);
  const list=players.get(row.id);
  if(list.length<5&&!list.some(p=>p.game_id===row.game_id))list.push(row);
 }
 const injured=new Map((injuries??[]).map(x=>[nameKey(x.player),x]));
 const rotation=[];
 for(const [playerId,rs] of players){
  const i=injured.get(nameKey(rs[0].name));
  const status=i?String(i.status):'NO_CONFIRMED_INJURY_STATUS';
  const out=/^(out|inactive|suspended)$/i.test(status.trim());
  const uncertain=/^(questionable|doubtful|day-to-day|game-time decision)$/i.test(status.trim());
  const mm=avg(rs.map(x=>x.minutes)),ppm=avg(rs.filter(x=>x.points!==null).map(x=>x.points/x.minutes));
  rotation.push({id:playerId,name:rs[0].name,games:rs.length,
   minutes_last5:round(mm),points_last5:round(avg(rs.map(x=>x.points).filter(Number.isFinite))),
   points_per_minute:round(ppm,3),injury_status:status,
   availability:out?'OUT':uncertain?'UNCERTAIN':'NOT_OFFICIALLY_CONFIRMED',
   minutes_hypothesis:out?0:round(mm)});
 }
 rotation.sort((a,b)=>b.minutes_last5-a.minutes_last5);
 const missing=(injuries??[]).filter(i=>!rotation.some(x=>nameKey(x.name)===nameKey(i.player)));
 const reserves=rotation.filter(p=>p.availability==='NOT_OFFICIALLY_CONFIRMED'&&p.minutes_last5<23&&p.games>=2&&p.points_per_minute!==null);
 const replacement=avg(reserves.map(p=>p.points_per_minute));
 const importance=p=>p.games>=2&&replacement!==null&&p.points_per_minute!==null?
  round((p.points_per_minute-replacement)*p.minutes_last5):null;
 const pick=state=>rotation.filter(p=>p.availability===state&&p.minutes_last5>=15)
  .map(p=>({name:p.name,minutes_recent:p.minutes_last5,scoring_replacement_proxy:importance(p)}));
 return {source:'ESPN final boxscores + ESPN injuries',team_id:id,
  box_games:new Set(matches.map(p=>p.game_id)).size,rotation:rotation.slice(0,13),
  confirmed_out:pick('OUT'),uncertain:pick('UNCERTAIN'),
  unmatched_injuries:missing.map(x=>x.player).slice(0,12),
  scenarios:[
   {id:'AVAILABLE',note:'Hypothèse joueur présent, minutes historiques indicatives'},
   {id:'LIMITED',note:'Hypothèse restriction de minutes, amplitude non vérifiée'},
   {id:'OUT',note:'Hypothèse absence, remplaçants et redistribution à recontrôler'}
  ],
  impact_warning:'Proxy points par minute NON CAUSAL; aucun ajustement automatique des probabilités de victoire.',
  data_quality:matches.length>=35?'PARTIAL':'LOW_SAMPLE'};
}
const scores=(id,games,cut)=>games.filter(g=>Date.parse(g.start)<cut&&
  Number.isFinite(g.home?.score)&&Number.isFinite(g.away?.score)&&
  (String(g.home.id)===String(id)||String(g.away.id)===String(id)))
 .sort((a,b)=>a.start.localeCompare(b.start)).slice(-10)
 .map(g=>String(g.home.id)===String(id)?{for:g.home.score,against:g.away.score}:
  {for:g.away.score,against:g.home.score});
function boxMetrics(teamId,boxes,cut){
 const id=String(teamId),games=boxes.filter(b=>Date.parse(b?.start)<cut&&b?.teams?.[id])
  .sort((a,b)=>a.start.localeCompare(b.start)).slice(-10);
 const mean=k=>round(avg(games.map(b=>b.teams[id].totals[k]).filter(Number.isFinite)),2);
 return {games:games.length,off_rating:mean('off_rating'),
  def_rating:round(avg(games.map(b=>b.teams[id===b.home_id?b.away_id:b.home_id].totals.off_rating).filter(Number.isFinite)),2),
  possessions:mean('possessions'),efg_pct:mean('efg_pct'),tov_pct:mean('tov_pct'),
  orb_pct:mean('orb_pct'),ft_rate:mean('ft_rate')};
}
function randomGen(id){
 let s=2166136261>>>0;
 for(const c of String(id))s=Math.imul(s^c.charCodeAt(0),16777619)>>>0;
 return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return (s>>>0)/4294967296;};
}
function normal(random){
 const a=Math.max(1e-12,random()),b=random();
 return Math.sqrt(-2*Math.log(a))*Math.cos(2*Math.PI*b);
}
function quantile(data,p){return round(data[Math.floor((data.length-1)*p)]);}
export function forecastGame(game,historical,boxes,now,runs=50000){
 const cut=Date.parse(game?.start),t=Date.parse(now);
 if(!Number.isFinite(cut)||!Number.isFinite(t)||t>=cut||!String(game.status).startsWith('STATUS_SCHEDULED'))
  return {status:'NO_PREMATCH',simulated_runs:0,calibrated:false};
 const home=scores(game.home.id,historical,cut),away=scores(game.away.id,historical,cut);
 const league=historical.filter(g=>Date.parse(g.start)<cut&&Number.isFinite(g.home?.score)&&Number.isFinite(g.away?.score));
 const baseline=avg(league.map(g=>(g.home.score+g.away.score)/2));
 const advanced={home:boxMetrics(game.home.id,boxes,cut),away:boxMetrics(game.away.id,boxes,cut)};
 const coverage={home_games:home.length,away_games:away.length,league_games:league.length,
  box_home:advanced.home.games,box_away:advanced.away.games};
 if(home.length<5||away.length<5||league.length<30||baseline===null)
  return {status:'LOW_SAMPLE',simulated_runs:0,calibrated:false,coverage,advanced,
   warning:'Échantillon insuffisant. Aucune simulation présentée comme probabilité.'};
 const shrink=(a,k)=>(a*k+baseline*8)/(k+8);
 let h=(shrink(avg(home.map(x=>x.for)),home.length)+shrink(avg(away.map(x=>x.against)),away.length))/2+1.5;
 let a=(shrink(avg(away.map(x=>x.for)),away.length)+shrink(avg(home.map(x=>x.against)),home.length))/2-1.5;
 let model='score_form_with_league_shrinkage';
 if(advanced.home.games>=5&&advanced.away.games>=5&&
  ['off_rating','def_rating','possessions'].every(k=>Number.isFinite(advanced.home[k])&&Number.isFinite(advanced.away[k]))){
  const pace=(advanced.home.possessions+advanced.away.possessions)/2;
  h=0.6*h+0.4*((advanced.home.off_rating+advanced.away.def_rating)*pace/200+1.5);
  a=0.6*a+0.4*((advanced.away.off_rating+advanced.home.def_rating)*pace/200-1.5);
  model='form_60pct_and_rating_pace_40pct';
 }
 const sigmaH=clip(sd(home.map(x=>x.for))??12,8,23),sigmaA=clip(sd(away.map(x=>x.for))??12,8,23);
 const count=Number.isInteger(runs)&&runs>=100&&runs<=50000?runs:50000;
 const random=randomGen(game.id),hs=[],as=[],totals=[];
 let won=0,tie=0;
 for(let i=0;i<count;i++){
  const shared=normal(random),nh=normal(random),na=normal(random);
  const scoreH=clip(h+sigmaH*(0.12*shared+Math.sqrt(1-0.12**2)*nh),50,195);
  const scoreA=clip(a+sigmaA*(0.12*shared+Math.sqrt(1-0.12**2)*na),50,195);
  hs.push(scoreH);as.push(scoreA);totals.push(scoreH+scoreA);
  if(scoreH>scoreA)won++;
  if(scoreH===scoreA)tie++;
 }
 hs.sort((x,y)=>x-y);as.sort((x,y)=>x-y);totals.sort((x,y)=>x-y);
 const p=(won+tie*0.5)/count;
 return {status:'SIMULATED_UNCALIBRATED',calibrated:false,simulated_runs:count,model,
  probability_home:round(p,4),probability_away:round(1-p,4),
  projected_score:{home:round(h),away:round(a)},
  interval_80:{home:[quantile(hs,0.1),quantile(hs,0.9)],
   away:[quantile(as,0.1),quantile(as,0.9)],total:[quantile(totals,0.1),quantile(totals,0.9)]},
  advanced,coverage,market_odds:null,ev:null,
  assumptions:['Avantage domicile théorique de 1.5 point',
   'Régression vers score moyen observé sur 8 rencontres',
   'Écarts-types empiriques bornés 8-23 points, corrélation 0.12',
   'Ajustement blessures NON activé faute de validation causale'],
  source:'ESPN historical finals before tip + verified final boxscores',
  warning:'Probabilité exploratoire : aucun étalonnage hors-échantillon démontré.'};
}
export function evaluatePregame(game,snapshot){
 const at=Date.parse(snapshot?.at),tip=Date.parse(game?.start);
 const p=snapshot?.forecast?.probability_home;
 if(!Number.isFinite(at)||!Number.isFinite(tip)||at>=tip||!Number.isFinite(p)||p<=0||p>=1
  ||!String(game.status).includes('FINAL')||
  !Number.isFinite(game.home?.score)||!Number.isFinite(game.away?.score)||game.home.score===game.away.score)
  return null;
 const y=game.home.score>game.away.score?1:0;
 return {schema_version:'max-eval-v1',match_id:game.id,tip:game.start,
  pregame_at:snapshot.at,checkpoint:snapshot.checkpoint,model:snapshot.forecast.model,
  p_home:p,actual_home_win:y,correct:(p>=0.5?1:0)===y,
  brier:round((p-y)**2,6),
  log_loss:round(-y*Math.log(p)-(1-y)*Math.log(1-p),6),
  final_score:{home:game.home.score,away:game.away.score},
  source:'ESPN verified final; immutable pregame snapshot'};
}
export function summarizeEvaluations(rows){
 const valid=rows.filter(r=>r&&Number.isFinite(r.brier)&&Number.isFinite(r.log_loss));
 return {schema_version:'max-eval-summary-v1',games_evaluated:valid.length,
  brier:round(avg(valid.map(r=>r.brier)),5),log_loss:round(avg(valid.map(r=>r.log_loss)),5),
  accuracy_pct:valid.length?round(100*valid.filter(r=>r.correct).length/valid.length,1):null,
  roi:null,clv:null,calibrated:false,records:valid.slice(-120),
  warning:valid.length<100?'Échantillon trop faible pour conclure sur la performance du modèle.':'Calibration à valider sur données futures hors échantillon.'};
}
