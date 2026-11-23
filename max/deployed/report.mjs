import {playerIdentity} from './identity.mjs';
/** Canonical automatic report. Measured inputs, derived values and hypotheses stay separate. */
export const REPORT_VERSION='max-report-0.1.0';
const number=x=>typeof x==='number'&&Number.isFinite(x);
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const round=(n,d=2)=>number(n)?Math.round(n*10**d)/10**d:null;
const norm=playerIdentity;
const value=n=>number(n)?String(round(n,1)):'non disponible';
const unique=a=>[...new Set(a.filter(Boolean))];
function recentBoxes(id,boxes,cutoff){
 const seen=new Map();for(const b of boxes??[]){
  if(!b?.game_id||!number(Date.parse(b.start))||Date.parse(b.start)>=cutoff||!b.teams?.[id])continue;
  const old=seen.get(String(b.game_id));if(!old||Date.parse(b.fetched_at)>Date.parse(old.fetched_at))seen.set(String(b.game_id),b);
 }return [...seen.values()].sort((a,b)=>b.start.localeCompare(a.start));
}
export function teamWindows(id,boxes,cutoff){
 const all=recentBoxes(String(id),boxes,cutoff),result={};
 for(const n of [5,10,20]){
  const sample=all.slice(0,n),sum=k=>sample.length&&sample.every(b=>number(b.teams[id].totals?.[k]))?
   sample.reduce((s,b)=>s+b.teams[id].totals[k],0):null;
  const own=sample.map(b=>b.teams[id]),other=sample.map(b=>b.teams[String(id)===String(b.home_id)?b.away_id:b.home_id]);
  const pts=sum('points'),fga=sum('fga'),fgm=sum('fgm'),threes=sum('three_made'),fta=sum('fta');
  const minutes=sample.map(b=>b.teams[id].minutes).filter(number);
  const opp=sumKey=>sample.length&&other.every(t=>number(t?.totals?.[sumKey]))?other.reduce((s,t)=>s+t.totals[sumKey],0):null;
  const possessions=sum('possessions'),oppPossessions=opp('possessions'),opponentPoints=opp('points');
  const ratio=(a,b,m=100)=>number(a)&&number(b)&&b>0?round(m*a/b):null;
  const off=ratio(pts,possessions),def=ratio(opponentPoints,oppPossessions);
  result['last'+n]={requested:n,observed:sample.length,complete_window:sample.length===n,
   off_rating_estimated:off,def_rating_estimated:def,net_rating_estimated:number(off)&&number(def)?round(off-def):null,
   points:sample.length&&number(pts)?round(pts/sample.length):null,
   pace_estimated:possessions!==null&&minutes.length===sample.length&&minutes.every(x=>x>0)?
    round(mean(sample.map((b,i)=>b.teams[id].totals.possessions*240/minutes[i]))):null,
   efg_pct:number(fgm)&&number(threes)?ratio(fgm+0.5*threes,fga):null,
   ts_pct:number(fga)&&number(fta)?ratio(pts,2*(fga+0.44*fta)):null,
   tov_pct:ratio(sum('turnovers'),possessions),ft_rate:ratio(fta,fga,1),
   three_point_attempt_rate:ratio(sum('three_attempted'),fga,1),
   assists_to_turnovers:ratio(sum('assists'),sum('turnovers'),1),
   orb_pct:number(sum('oreb'))&&number(opp('dreb'))?ratio(sum('oreb'),sum('oreb')+opp('dreb')):null,
   drb_pct:number(sum('dreb'))&&number(opp('oreb'))?ratio(sum('dreb'),sum('dreb')+opp('oreb')):null,
   sources:unique(sample.map(b=>b.source_url)),
   evidence_kind:'CALCULATED_FROM_VERIFIED_BOXSCORES',
   caveat:'Possessions estimées par boxscore ; ni ratings ajustés par adversaire, ni données officielles play-by-play.'};
 }return result;
}
export function playerWindows(id,teamId,boxes,cutoff){
 const entries=[];
 for(const b of recentBoxes(String(teamId),boxes,cutoff)){
  const p=(b.teams[teamId].players??[]).find(x=>String(x.id)===String(id));
  if(p&&number(p.minutes)&&p.minutes>0&&number(p.points))entries.push({...p,source_url:b.source_url,
   team_minutes:b.teams[teamId].minutes,team_totals:b.teams[teamId].totals});
 }
 const result={};
 for(const n of [3,5,10]){
  const rs=entries.slice(0,n),sum=k=>rs.length&&rs.every(p=>number(p[k]))?rs.reduce((s,p)=>s+p[k],0):null;
  const pts=sum('points'),mins=sum('minutes'),fga=sum('fga'),fta=sum('fta'),fgm=sum('fgm'),three=sum('three_made');
  const usg=rs.map(p=>{
   const t=p.team_totals,den=t?.fga+0.44*t?.fta+t?.turnovers;
   return [p.fga,p.fta,p.turnovers,p.team_minutes,p.minutes,den].every(number)&&p.minutes>0&&den>0?
    100*(p.fga+0.44*p.fta+p.turnovers)*(p.team_minutes/5)/(p.minutes*den):null;
  }).filter(number);
  result['last'+n]={requested:n,observed:rs.length,complete_window:rs.length===n,
   minutes:rs.length?round(mins/rs.length,1):null,points:rs.length?round(pts/rs.length,1):null,
   points_per_minute:mins>0?round(pts/mins,3):null,
   ts_pct:fga+0.44*fta>0&&[pts,fga,fta].every(number)?round(100*pts/(2*(fga+0.44*fta))):null,
   efg_pct:fga>0&&[fgm,three].every(number)?round(100*(fgm+0.5*three)/fga):null,
   usage_pct_estimated:usg.length===rs.length?round(mean(usg)):null,
   sources:unique(rs.map(p=>p.source_url)),evidence_kind:'CALCULATED_FROM_VERIFIED_BOXSCORES'};
 }return result;
}
export function scheduleLoad(id,history,start){
 const tip=Date.parse(start),seen=new Map();
 for(const g of history??[])if(g?.id&&g.event_type==='REGULAR'&&String(g.status).includes('FINAL')&&
  Date.parse(g.start)<tip&&(String(g.home?.id)===String(id)||String(g.away?.id)===String(id)))seen.set(String(g.id),g);
 const games=[...seen.values()].sort((a,b)=>b.start.localeCompare(a.start));
 return {games_last4_days:games.filter(g=>tip-Date.parse(g.start)<4*86400000).length,
  games_last6_days:games.filter(g=>tip-Date.parse(g.start)<6*86400000).length,
  hours_since_last_tip:games.length?round((tip-Date.parse(games[0].start))/3600000,1):null,
  overtime_games_last6_days:games.filter(g=>tip-Date.parse(g.start)<6*86400000&&g.status==='STATUS_FINAL_OT').length,
  rest_effect_on_score:null,travel_effect_on_score:null,
  caveat:'Calendrier observé ; aucune pénalité de fatigue ni distance d’itinéraire non vérifiée.'};
}
const cdf=x=>{const z=Math.abs(x),t=1/(1+0.2316419*z),k=0.3989422804*Math.exp(-z*z/2);
 const p=1-k*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));return x>=0?p:1-p;};
export function injuryScenarios(game,rosters){
 const a=game.independent_analysis?.advanced,f=a?.forecast;
 if(f?.status!=='SIMULATED_UNCALIBRATED')return {status:'UNAVAILABLE',reason:'NO_USABLE_BASE_FORECAST',players:[]};
 const scenarios=[];
 for(const side of ['home','away']){
  const team=a.player_points?.[side],roster=rosters.get(String(game[side].id));
  const positions=new Map((roster?.players??[]).map(p=>[p.id,p.position]));
  const players=team?.players??[];
  const targets=players.filter(p=>p.official_for_game&&['OUT','QUESTIONABLE','DOUBTFUL','LIMITED'].includes(p.reported_status)&&
   p.projected_minutes_if_active>=12&&number(p.predicted_points_if_active)).slice(0,3);
  for(const p of targets){
   const replacement=players.filter(r=>r.id!==p.id&&r.availability!=='OFFICIAL_OUT'&&r.availability!=='OFFICIAL_UNCERTAIN'&&
    number(r.projected_minutes_if_active)&&r.projected_minutes_if_active<28&&r.recent_games>=3)
    .sort((x,y)=>Number(positions.get(y.id)===positions.get(p.id))-Number(positions.get(x.id)===positions.get(p.id))||
     y.projected_minutes_if_active-x.projected_minutes_if_active).slice(0,4);
   const ppm=p.predicted_points_if_active/p.projected_minutes_if_active;
   const variants={};
   for(const [name,fraction] of [['present',1],['limited',0.6],['absent',0]]){
    let missing=p.projected_minutes_if_active*(1-fraction),distributed=0,gained=0;
    const allocations=[];
    for(const r of replacement){const extra=Math.min(missing,8,Math.max(0,42-r.projected_minutes_if_active));
     if(extra<=0)continue;missing-=extra;distributed+=extra;
     const points=extra*r.predicted_points_if_active/r.projected_minutes_if_active;gained+=points;
     allocations.push({player_id:r.id,player:r.name,extra_minutes:round(extra,1),extra_points_hypothesis:round(points,1)});}
    const lost=p.projected_minutes_if_active*(1-fraction),delta=round(gained-ppm*lost,1);
    const score={...f.projected_score};score[side]=round(score[side]+delta,1);
    const sig=key=>{const r=f.interval_80?.[key];return Array.isArray(r)&&r.length===2?(r[1]-r[0])/2.564:null;};
    const h=sig('home'),away=sig('away'),sigma=number(h)&&number(away)?Math.sqrt(h*h+away*away):null;
    const usable=missing<0.1&&roster;
    variants[name]={player_minutes:round(p.projected_minutes_if_active*fraction,1),
     player_points_if_active:round(p.predicted_points_if_active*fraction,1),
     replacement_candidates:allocations,minutes_redistributed:round(distributed,1),unallocated_minutes:round(missing,1),
     team_points_delta_hypothesis:delta,projected_score_hypothesis:score,
     margin_home_hypothesis:round(score.home-score.away,1),
     home_win_probability_approximation:usable&&sigma>0?round(cdf((score.home-score.away)/sigma),4):null,
     probability_status:usable?'NORMAL_APPROXIMATION_UNCALIBRATED':'INSUFFICIENT_REPLACEMENT_COVERAGE'};
   }
   scenarios.push({team:side,team_id:game[side].id,player:p.name,player_id:p.id,
    official_status:p.reported_status,source_url:p.injury_source,variants,
    scenario_probabilities:null,effect_kind:'NON_CAUSAL_WHAT_IF',
    assumptions:['Base non ajustée causalement aux blessures ; risque de double comptage avec la forme récente',
     'Restriction hypothétique à 60 % des minutes ; plafond de +8 minutes par candidat, non appris',
     'Remplaçants possibles, non confirmés ; approximation normale sans calibration et corrélation non modélisée'],
    changes_primary_forecast:false});
  }
 }
 return {status:scenarios.length?'EXPLORATORY_SCENARIOS':'NO_DOCUMENTED_TARGET',calibrated:false,players:scenarios};
}
function modelSource(g){return 'Moteur Max '+(g.quantitative_version??'version documentée')+' ; entrée arrêtée avant '+g.start;}
export function composeReport(g,history,boxes,rosters,metrics,playerMetrics,nowISO){
 const a=g.independent_analysis??{},advanced=a.advanced??{},forecast=advanced.forecast??{};
 const pre=Date.parse(nowISO)<Date.parse(g.start)&&g.status==='STATUS_SCHEDULED';
 const cut=Math.min(Date.parse(nowISO),Date.parse(g.start));
 const stats={},load={},players={},rosterCoverage={};
 for(const side of ['home','away']){
  const id=String(g[side].id);stats[side]=teamWindows(id,boxes,cut);
  load[side]=scheduleLoad(id,history,g.start);rosterCoverage[side]=rosters.get(id)??null;
  players[side]=(advanced.player_points?.[side]?.players??[]).map(p=>({id:p.id,name:p.name,
   windows:p.recent_windows??playerWindows(p.id,id,boxes,cut),availability:p.availability,
   projected_minutes_if_active:p.projected_minutes_if_active,points_if_active:p.predicted_points_if_active}));
 }
 const medical=g.official_medical,officialCount=advanced.official_injuries_count??0;
 const sections=[];
 const add=(id,title,status,findings,missing=[],data=null,evidence_kind='OBSERVED')=>sections.push({section_id:id,title,status,
  findings:findings.filter(Boolean),missing:missing.filter(Boolean),data,evidence_kind});
 const recentTeam=Object.values(stats).every(x=>x.last5.observed>=5);
 const adequatePlayers=['home','away'].every(s=>players[s].filter(p=>number(p.points_if_active)).length>=5);
 const numeric=forecast.status==='SIMULATED_UNCALIBRATED';
 const submitted=medical&&['home','away'].every(s=>medical.teams[s]?.status==='SUBMITTED');
 add(1,'Rencontre et provenance','VERIFIED',[
  g.away.name+' @ '+g.home.name+' ; '+g.start+' ; ID ESPN '+g.id,
  'Dernière collecte : '+nowISO],[],{match_id:g.id,start:g.start,source:g.source});
 add(2,'Intégrité des données','CALCULATED',[
  'Observations, calculs et hypothèses séparés ; aucune prévision créée après le début du match.',
  'Modèle expérimental, non calibré.'],[],{pre_match:pre,calibrated:false},'RULE_CHECK');
 add(3,'Couverture des sources',recentTeam&&adequatePlayers?'PARTIAL':'UNAVAILABLE',[
  'Boxscores disponibles : '+boxes.length+' ; statuts officiels utilisés : '+officialCount+'.',
  'Effectifs actuels vérifiés : '+Object.values(rosterCoverage).filter(Boolean).length+'/2.'],
  ['Cinq majeurs définitifs non confirmés',...(!Object.values(rosterCoverage).every(Boolean)?['Effectif actuel incomplet']:[])],
  {rosters:rosterCoverage,research:g.research_diagnostics,medical},'SOURCE_AUDIT');
 add(4,'Statistiques des équipes',recentTeam?'CALCULATED':'PARTIAL',
  ['away','home'].map(side=>g[side].name+' : '+stats[side].last10.observed+' matchs observés ; OffRtg estimé '+
   value(stats[side].last10.off_rating_estimated)+' ; DefRtg estimé '+value(stats[side].last10.def_rating_estimated)+'.'),
  [...(!Object.values(stats).every(x=>x.last20.complete_window)?['Fenêtre de 20 matchs incomplète ; taille réelle affichée']:[]),
   'Ratings ajustés par adversaire et tracking des tirs non disponibles'],
  {windows:stats,form:{home:a.home,away:a.away}},'CALCULATED_FROM_BOXSCORES');
 add(5,'Joueurs, minutes et efficacité',adequatePlayers?'CALCULATED':'PARTIAL',
  ['away','home'].map(side=>g[side].name+' : '+players[side].filter(p=>number(p.points_if_active)).length+
   ' projections conditionnelles ; fenêtres individuelles 3/5/10 renseignées avec leur échantillon.'),
  ['Minutes futures estimées, non confirmées','Indicateurs propriétaires ou tracking non acquis',
   ...(!Object.values(rosterCoverage).every(Boolean)?['Appartenance actuelle à vérifier pour les effectifs absents']:[])],
  players,'CALCULATED_AND_CONDITIONAL');
 const scenarios=injuryScenarios(g,rosters);
 add(6,'Blessures et scénarios',submitted?'PARTIAL':medical?'WAITING':'UNAVAILABLE',[
  medical?'Bulletin officiel : '+medical.source_url+' ; publication '+medical.published_at+'.':
   'Aucun bulletin officiel récent rattaché automatiquement à cette rencontre.',
  officialCount+' statuts officiels utilisés ; '+scenarios.players.length+' scénarios individuels exploratoires.'],
  [...(['home','away'].filter(s=>medical?.teams[s]?.status!=='SUBMITTED').map(s=>g[s].name+' : déclaration non confirmée')),
   'Effet causal des absences et probabilité de participation non validés'],{medical,scenarios},'OFFICIAL_AND_HYPOTHETICAL');
 const editorial=id=>g.research?.sections?.find(x=>x.section_id===id);
 for(const [id,title] of [[7,'Tactique et confrontations'],[9,'Contexte sportif']]){
  const x=editorial(id);add(id,title,x?.findings?.length?'PARTIAL':'UNAVAILABLE',x?.findings??[],
   unique([...(x?.missing??[]),'Analyse qualitative limitée aux sources effectivement vérifiées']),
   {editorial_generated_at:g.research?.generated_at??null},'EDITORIAL_SOURCED');
 }
 add(8,'Repos, fatigue et calendrier','CALCULATED',
  ['away','home'].map(side=>g[side].name+' : '+value(load[side].hours_since_last_tip)+' heures depuis le précédent début de match ; '+
   load[side].games_last4_days+' matchs précédents sur quatre jours.'),
  ['Voyage réel, fatigue physiologique et effet causal sur le score non mesurés'],load,'CALCULATED_CALENDAR');
 add(10,'Projections réellement calculées',numeric?'CALCULATED':pre?'UNAVAILABLE':'NOT_APPLICABLE',numeric?[
  'Score moyen : '+g.away.name+' '+forecast.projected_score.away+' — '+g.home.name+' '+forecast.projected_score.home+'.',
  forecast.simulated_runs+' simulations réellement exécutées ; modèle '+forecast.model+'.',
  'Les résultats inchangés sont réutilisés. '+modelSource(g)]:['Aucune nouvelle projection pré-match disponible.'],
  ['Calibration non démontrée ; scénarios de blessure séparés du score principal'],
  {forecast,player_points:advanced.player_points},'MODEL_OUTPUT');
 const market=g.market_observation??null;
 if(market){market.expected_value_exploratory={home:numeric&&number(market.home_decimal)?
  round(forecast.probability_home*market.home_decimal-1,4):null,away:numeric&&number(market.away_decimal)?
  round(forecast.probability_away*market.away_decimal-1,4):null,
  probability_calibrated:false,drives_decision:false};}
 add(11,'Marchés et cotes',market?'PARTIAL':'UNAVAILABLE',market?[
  'Cote publique observée chez '+market.provider+' à '+market.observed_at+'.']:[],
  ['Sans historique d’ouverture et de clôture vérifié : pas de CLV','Aucun avantage de pari démontré'],market,'MARKET_OBSERVED');
 const risks=unique([...(g.coverage?.missing??[]),...(!Object.values(rosterCoverage).every(Boolean)?['CURRENT_ROSTER_UNVERIFIED']:[]),
  'MODEL_UNCALIBRATED',...(!submitted?['OFFICIAL_MEDICAL_INCOMPLETE']:[])]);
 add(12,'Analyse contradictoire','PARTIAL',[
  'Risques contrôlés : '+risks.join(', ')+'.',
  'Les résultats peuvent changer avec les effectifs, les minutes et les annonces médicales.'],
  ['Effets tactiques et qualité des remplacements à corroborer'],{risks},'AUTOMATIC_CRITIQUE');
 add(13,'Décision et incertitude','CALCULATED',[
  'ABSTENTION — prévisions expérimentales, précision et avantage de marché non démontrés.'],[],
  {decision:'ABSTAIN',betting_recommendations:[],calibrated:false},'RULE_CHECK');
 add(14,'Synthèse automatique','CALCULATED',[
  'Données et calculs actualisés à chaque passage groupé ; les lacunes restent explicites.',
  numeric?'Projection sportive disponible avec intervalles et hypothèses.':'Projection sportive non exploitable actuellement.'],
  ['Voir les rubriques partielles, en attente et indisponibles'],
  {numeric_forecast_available:numeric,critical_risks:risks},'AUTOMATIC_SYNTHESIS');
 add(15,'Validation et résultats',metrics?.games_evaluated?'PARTIAL':'WAITING',[
  (metrics?.games_evaluated??0)+' matchs évalués ; Brier '+value(metrics?.brier)+'.',
  (playerMetrics?.players_evaluated??0)+' projections joueurs évaluées ; MAE '+value(playerMetrics?.mae)+' points.',
  pre?'Le résultat de cette rencontre n’est pas encore applicable.':'Résultat confronté seulement aux captures réellement enregistrées avant le début.'],
  ['Validation hors échantillon et calibration à démontrer'],
  {global:{matches:metrics?.games_evaluated??0,brier:metrics?.brier??null,
   player_mae:playerMetrics?.mae??null,baseline:playerMetrics?.baseline_comparison??null},
   this_match_result_status:pre?'NOT_APPLICABLE_BEFORE_GAME':'EVALUATE_IMMUTABLE_SNAPSHOTS'},'PROSPECTIVE_EVALUATIONS');
 add(16,'Prochain passage et contrôles ciblés','CALCULATED',[
  'Collecte et recherche espacées de six heures ; priorité aux faits nouveaux et lacunes utiles.',
  'Aucun contrôle permanent H3/H1/H30 ; aucune couverture instantanée promise.'],[],
  {editorial_priority:g.research_priority??null},'SCHEDULE');
 sections.sort((x,y)=>x.section_id-y.section_id);
 const counts=sections.reduce((c,x)=>(c[x.status]=(c[x.status]??0)+1,c),{});
 const sources=unique([medical?.source_url,...Object.values(rosterCoverage).map(x=>x?.source_url),
  ...Object.values(stats).flatMap(x=>x.last10.sources),...(g.research?.sources??[]).map(x=>x.url)])
  .filter(url=>/^https:\/\//.test(url)).map(url=>({url,title:url.includes('Injury-Report')?'Bulletin NBA officiel':
   url.includes('roster')?'Effectif ESPN':'Statistiques ou recherche sourcée',checked_at:url===medical?.source_url?medical.checked_at:null}));
 return {version:REPORT_VERSION,schema_version:'max-automatic-report-v1',match_id:String(g.id),
  generated_at:nowISO,scope:pre?'PREMATCH_OBSERVATION':'POST_START_OBSERVATION',
  status:'PARTIAL_WITH_EXPLICIT_GAPS',section_counts:counts,sections,sources,
  editorial_generated_at:g.research?.generated_at??null,calibrated:false,
  summary:'Rapport de 16 rubriques alimenté par les observations, calculs et sources disponibles. Aucune complétude artificielle.',
  key_risks:risks};
}
