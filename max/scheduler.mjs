/**
 * ManiBetProMax · planification intelligente.
 * Aucune API, aucune écriture, aucun coût supplémentaire. Fonctions déterministes.
 * Les jalons H24/H6/H3/H1/H30 sont des fenêtres et NON une promesse de disponibilité
 * de ChatGPT toutes les 15 minutes (automatisation horaire).
 */
export const SCHEDULER_VERSION='max-scheduler-0.1.0';
export const WINDOWS=[
 {name:'H30',start_hours:0.5,kind:'DELTA',rank:0},
 {name:'H1',start_hours:1.25,kind:'DELTA',rank:1},
 {name:'H3',start_hours:3.25,kind:'DELTA',rank:2},
 {name:'H6',start_hours:6.25,kind:'DELTA',rank:3},
 {name:'H24',start_hours:24.25,kind:'DEEP',rank:4},
 {name:'PREP',start_hours:48,kind:'PREP',rank:5}
];
const hour=3600000;
export function checkpointPhase(game,nowISO){
 const tip=Date.parse(game?.start),now=Date.parse(nowISO);
 if(!Number.isFinite(tip)||!Number.isFinite(now))return null;
 const hours=(tip-now)/hour;
 if(hours<=0||!String(game.status).startsWith('STATUS_SCHEDULED'))return null;
 const win=WINDOWS.find(w=>hours<=w.start_hours);
 if(!win)return null;
 return {name:win.name,kind:win.kind,rank:win.rank,hours_to_tip:Math.round(hours*100)/100,
  entered_at:new Date(tip-win.start_hours*hour).toISOString(),
  tip:game.start};
}
export function researchPriority(game,research,nowISO,sourceChanged=[]){
 const p=checkpointPhase(game,nowISO);
 if(!p)return {match_id:String(game?.id??''),due:false,action:'SKIP',reason:'OUT_OF_WINDOW_OR_STARTED'};
 const generated=Date.parse(research?.generated_at);
 const valid=research?.match_id===String(game.id)&&Number.isFinite(generated)&&
  generated<Date.parse(game.start)&&generated<=Date.parse(nowISO);
 const phaseCovered=valid&&generated>=Date.parse(p.entered_at);
 const changed=sourceChanged.includes('RAPPORT_BLESSURES')||
  sourceChanged.includes('STATUT_MATCH');
 const age=valid?Math.round((Date.parse(nowISO)-generated)/60000):null;
 if(changed)return {match_id:String(game.id),due:true,action:'RECHECK',
  reason:'CHANGEMENT_SOURCE_A_RECOUPER',phase:p.name,hours_to_tip:p.hours_to_tip,
  last_report_minutes:age,priority:p.rank-1};
 if(!phaseCovered)return {match_id:String(game.id),due:true,action:p.kind,
  reason:valid?'NOUVELLE_FENETRE':'ABSENCE_RAPPORT_DANS_CETTE_FENETRE',
  phase:p.name,hours_to_tip:p.hours_to_tip,last_report_minutes:age,priority:p.rank};
 return {match_id:String(game.id),due:false,action:'SKIP',
  reason:'FENETRE_DEJA_COUVERTE',phase:p.name,hours_to_tip:p.hours_to_tip,
  last_report_minutes:age,priority:99};
}
/**
 * Signature d'entrée du moteur de score (pas des blessures ni d'un texte MacFly).
 * Inclut les scores finaux et tous les boxscores d'équipe applicables.
 * Une correction de score/boxscore invalide automatiquement le cache.
 */
export function forecastInputSignature(game,historical,boxes,version){
 let hash=2166136261>>>0,characters=0;
 const update=text=>{
  const s=String(text);characters+=s.length;
  for(let i=0;i<s.length;i++)hash=Math.imul(hash^s.charCodeAt(i),16777619)>>>0;
 };
 const tip=Date.parse(game?.start),ids=new Set([String(game?.home?.id),String(game?.away?.id)]);
 update([version,game.id,game.start,game.home.id,game.away.id].join(':'));
 const finals=(historical??[]).filter(x=>x.event_type==='REGULAR'&&String(x.status).includes('FINAL')&&
  Number.isFinite(Date.parse(x.start))&&Date.parse(x.start)<tip&&
  Number.isFinite(x.home?.score)&&Number.isFinite(x.away?.score)).sort((a,b)=>a.id.localeCompare(b.id));
 for(const x of finals)update([x.id,x.start,x.home.id,x.away.id,x.home.score,x.away.score].join(','));
 const matching=(boxes??[]).filter(b=>Date.parse(b?.start)<tip&&
  (ids.has(String(b.home_id))||ids.has(String(b.away_id)))).sort((a,b)=>a.game_id.localeCompare(b.game_id));
 for(const b of matching){
  update(b.game_id);
  for(const id of [String(b.home_id),String(b.away_id)]){
   const team=b.teams?.[id];
   const totals=team?.totals??{};
   update([id,totals.points,totals.off_rating,totals.possessions,totals.efg_pct].join(','));
  }
 }
 return [hash.toString(16).padStart(8,'0'),finals.length,matching.length,characters].join('-');
}
export function canReuseForecast(prior,signature,game,nowISO){
 const old=prior?.independent_analysis?.advanced;
 return Boolean(old?.forecast&&old.forecast_signature===signature&&
  old.forecast?.status==='SIMULATED_UNCALIBRATED'&&
  Number.isFinite(Date.parse(game.start))&&Date.parse(nowISO)<Date.parse(game.start)&&
  String(game.status).startsWith('STATUS_SCHEDULED'));
}
export function agendaFromGames(games,nowISO){
 const plans=(games??[]).filter(x=>checkpointPhase(x,nowISO)!==null)
  .map(x=>({...researchPriority(x,x.research,nowISO,x.source_changes??[]),
   match:x.away?.name+' @ '+x.home?.name,start:x.start}));
 plans.sort((a,b)=>(a.due?0:1)-(b.due?0:1)||
  (a.priority??99)-(b.priority??99)||a.start.localeCompare(b.start));
 return {generated_at:nowISO,eligible:plans.length,due_count:plans.filter(x=>x.due).length,
  due:plans.filter(x=>x.due).slice(0,25),all:plans.slice(0,40),
  cadence_note:'MacFly horaire: exécute les jalons disponibles, sans promettre H30 exact'};
}
