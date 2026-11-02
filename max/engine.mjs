/**
 * ManiBetProMax · NBA data + prediction core (indépendant de ManiBetPro).
 * Version exploratoire, aucune calibration de pari revendiquée.
 * Aucun accès à une API, stockage ou algorithme du projet historique.
 */
const ELO_HOME = 55;
const ELO_K = 18;
const ELO_BASE = 1500;
export const ENGINE_VERSION = 'max-independent-0.1.0';
const FINAL = new Set(['STATUS_FINAL', 'STATUS_FINAL_OT', 'STATUS_FINAL_PENALTY']);
function finite(v) { if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null; }
function clean(v,n=150) {return typeof v==='string'?v.slice(0,n).trim():'';}
function compact(v) {return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function asTime(v) {const n=Date.parse(v);return Number.isFinite(n)?new Date(n).toISOString():null;}
function parseESPNTeam(v){
 const t=v?.team??{};
 return {id:String(t.id??''),name:clean(t.displayName??t.name),abbreviation:clean(t.abbreviation,6),
  record:clean(v?.records?.find(r=>r.type==='total')?.summary??'',30),score:finite(v?.score)};
}
export function parseESPNScoreboards(payloads){
 const games=new Map();
 for(const p of payloads){
  if(!Array.isArray(p?.events))continue;
  for(const event of p.events){
   const contestants=event?.competitions?.[0]?.competitors??[];
   const home=contestants.find(c=>c?.homeAway==='home'),away=contestants.find(c=>c?.homeAway==='away');
   const id=String(event?.id??'');const start=asTime(event?.date);
   const a=parseESPNTeam(away),h=parseESPNTeam(home);
   if(!/^\d{5,15}$/.test(id)||!start||!h.name||!a.name||!h.id||!a.id)continue;
   const seasonType=Number(event?.competitions?.[0]?.seasonType??event?.season?.type);
   const stage=seasonType===1?'PRESEASON':seasonType===2?'REGULAR':seasonType===3?'POSTSEASON':'UNKNOWN';
   const status=clean(event?.status?.type?.name,50);
   games.set(id,{id,start,status,event_type:stage,season_type:Number.isFinite(seasonType)?seasonType:null,
    home:h,away:a,source:'ESPN scoreboard',fetched_at:p._fetched_at??null});
  }
 }
 return [...games.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
export function parseESPNInjuries(data){
 if(!data||!Array.isArray(data.injuries))return null;
 const by_team={};
 for(const team of data.injuries){
  const teamName=clean(team?.displayName);if(!teamName)continue;
  const list=[];
  for(const injury of team.injuries??[]){
   const player=clean(injury?.athlete?.displayName,100);if(!player)continue;
   list.push({player,status:clean(injury.status,50),detail:clean(injury.shortComment??injury.longComment,200),
    source:'ESPN injury feed'});
  }
  by_team[teamName]=list.sort((a,b)=>a.player.localeCompare(b.player));
 }
 return {available:true,by_team,source:'ESPN injury feed',fetched_at:data._fetched_at??null};
}
export function injuriesForTeam(report,team) {
 if(!report?.available||!report.by_team)return null;
 const key=compact(team.name);
 for(const [name,rows] of Object.entries(report.by_team)){
  if(compact(name)===key&&Array.isArray(rows))return rows;
 }
 return null; // absence de ligne ≠ absence de blessure, source incomplète
}
export function verifiedFinalGames(games, before) {
 const cutoff=Date.parse(before),seen=new Map();
 for(const game of games){
  if(!game?.id||!FINAL.has(game.status)||game.event_type!=='REGULAR')continue;
  const ms=Date.parse(game.start);
  if(!Number.isFinite(ms)||ms>=cutoff||!Number.isFinite(game.home?.score)||!Number.isFinite(game.away?.score))continue;
  seen.set(game.id,game);
 }
 return [...seen.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
function sample(rows,n){
 const subset=rows.slice(-n);
 if(!subset.length)return {n:0,win_pct:null,avg_for:null,avg_against:null,avg_margin:null};
 const agg=subset.reduce((a,r)=>{
   a.wins+=Number(r.won);a.for+=r.points_for;a.against+=r.points_against;a.margin+=r.margin;
   return a;},{wins:0,for:0,against:0,margin:0});
 const round=(v)=>Math.round(v*10)/10;
 return {n:subset.length,win_pct:round(agg.wins/subset.length*100),
  avg_for:round(agg.for/subset.length),avg_against:round(agg.against/subset.length),
  avg_margin:round(agg.margin/subset.length)};
}
export function teamProfile(teamId,games,targetStart){
 const time=Date.parse(targetStart),matches=[];
 for(const game of games){
  if(Date.parse(game.start)>=time)continue;
  const home=game.home.id===String(teamId),away=game.away.id===String(teamId);
  if(!home&&!away)continue;
  const pointsFor=home?game.home.score:game.away.score;
  const pointsAgainst=home?game.away.score:game.home.score;
  matches.push({id:game.id,start:game.start,at_home:home,
    opponent:home?game.away.name:game.home.name,won:pointsFor>pointsAgainst,
    points_for:pointsFor,points_against:pointsAgainst,margin:pointsFor-pointsAgainst});
 }
 const last=matches.at(-1)??null;
 const hours=last?Math.round((time-Date.parse(last.start))/3600000):null;
 return {played:matches.length,last5:sample(matches,5),last10:sample(matches,10),
  last20:sample(matches,20),home:sample(matches.filter(x=>x.at_home),10),
  away:sample(matches.filter(x=>!x.at_home),10),
  last_game_at:last?.start??null,hours_since_last_tip:hours,
  back_to_back:hours!==null&&hours>0&&hours<36,
  rest_days_approx:hours!==null&&hours>=0?Math.max(0,Math.floor(hours/24)-1):null,
  last_opponents:matches.slice(-5).map(x=>x.opponent)};
}
export function estimateElo(game,games){
 const homeId=String(game.home.id),awayId=String(game.away.id);
 const elo=new Map(),played=new Map();
 const rating=id=>elo.get(id)??ELO_BASE;
 for(const g of games){
  const h=String(g.home.id),a=String(g.away.id);
  const oldHome=rating(h),oldAway=rating(a);
  const p=1/(1+10**(-(oldHome+ELO_HOME-oldAway)/400));
  const y=g.home.score>g.away.score?1:0;
  const diff=ELO_K*(y-p);
  elo.set(h,oldHome+diff);elo.set(a,oldAway-diff);
  played.set(h,(played.get(h)??0)+1);played.set(a,(played.get(a)??0)+1);
 }
 const homeRating=rating(homeId),awayRating=rating(awayId);
 const p=1/(1+10**(-(homeRating+ELO_HOME-awayRating)/400));
 return {method:'Elo experimental',version:ENGINE_VERSION,
  probability_home:Math.round(p*1000)/1000,
  probability_away:Math.round((1-p)*1000)/1000,
  elo_home:Math.round(homeRating),elo_away:Math.round(awayRating),
  games_home:played.get(homeId)??0,games_away:played.get(awayId)??0,
  calibrated:false,drives_bet:false,market_edge:null,
  warning:'Probabilité indicative non calibrée : aucun avantage de pari établi.'};
}
export function analyzeNBA(game,allHistorical,injuryReport,now) {
 const finals=verifiedFinalGames(allHistorical,game.start);
 const home=teamProfile(game.home.id,finals,game.start);
 const away=teamProfile(game.away.id,finals,game.start);
 const injuries={home:injuriesForTeam(injuryReport,game.home),away:injuriesForTeam(injuryReport,game.away)};
 const issues=[];
 if(injuries.home===null||injuries.away===null)issues.push('BLESSURES_NON_CONFIRMEES');
 if(home.played<5||away.played<5)issues.push('ECHANTILLON_FORME_INSUFFISANT');
 if(home.played<10||away.played<10)issues.push('HISTORIQUE_10_MATCHS_INCOMPLET');
 issues.push('FIVE_STARTERS_NON_CONFIRMES');
 issues.push('OFF_DEF_RATING_PACE_NON_COLLECTES');
 issues.push('MATCHUP_TACTIQUE_NON_VERIFIE');
 const tip=Date.parse(game.start),t=Date.parse(now),isPregame=Number.isFinite(tip)&&Number.isFinite(t)&&t<tip&&String(game.status).startsWith('STATUS_SCHEDULED');
 const model=home.played>=5&&away.played>=5&&isPregame?estimateElo(game,finals):null;
 return {schema_version:'max-analysis-v1',engine_version:ENGINE_VERSION,match_id:game.id,
  captured_at:now,cutoff_at:game.start,pregame:isPregame,status:issues.length?'INCONCLUSIVE':'OBSERVATION',
  home,away,injuries,elo:model,
  inputs:{historical_games:finals.length,historical_source:'ESPN independent scoreboard',injury_source:injuryReport?.source??null},
  missing:issues,betting_recommendations:[],confidence_level:'INCONCLUSIVE',
  source_type:'REAL' };
}
