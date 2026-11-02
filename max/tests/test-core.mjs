import assert from 'node:assert/strict';
import {slateDates,detectChange,collect,validateResearch} from '../worker.mjs';
import {parseESPNScoreboards,parseESPNInjuries,injuriesForTeam,verifiedFinalGames,teamProfile,estimateElo,analyzeNBA} from '../engine.mjs';
let n=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};
const ok=(x,m)=>{assert.ok(x,m);n++};
const now=new Date('2026-11-02T21:40:00.000Z');
const fixture=(id,date,status,homeID='1',awayID='2',scoreH=null,scoreA=null)=>{
 const club=id=>({1:['Denver Nuggets','DEN'],2:['Los Angeles Lakers','LAL'],3:['Utah Jazz','UTA'],4:['Phoenix Suns','PHX']}[id]);
 const competitor=(teamID,side,score)=>({homeAway:side,team:{id:String(teamID),displayName:club(teamID)[0],abbreviation:club(teamID)[1]},score});
 return {id,date,status:{type:{name:status}},season:{type:2},
 competitions:[{seasonType:2,competitors:[competitor(homeID,'home',scoreH),competitor(awayID,'away',scoreA)]}]};
};
function mockKV(){
 const state=new Map(),writes=[];
 return {state,writes,async get(key,opt){const v=state.get(key);return opt?.type==='json'?v===undefined?null:JSON.parse(v):v??null;},
 async put(key,v){state.set(key,v);writes.push(key);}};
}
const contest=fixture('401999999','2026-11-03T02:00:00Z','STATUS_SCHEDULED');
const finals=[
 fixture('401000001','2026-10-26T02:00:00Z','STATUS_FINAL','1','3',120,100),
 fixture('401000002','2026-10-27T02:00:00Z','STATUS_FINAL','4','2',104,112),
 fixture('401000003','2026-10-28T02:00:00Z','STATUS_FINAL','1','4',111,109),
 fixture('401000004','2026-10-29T02:00:00Z','STATUS_FINAL','3','2',105,113),
 fixture('401000005','2026-10-30T02:00:00Z','STATUS_FINAL','1','3',119,108),
 fixture('401000006','2026-10-31T02:00:00Z','STATUS_FINAL','4','2',103,109),
 fixture('401000007','2026-11-01T02:00:00Z','STATUS_FINAL','1','4',127,122)
];
const sample={events:[contest,finals[0]]};
eq(slateDates(now),['20261101','20261102','20261103'],'jours alentours');
const parsed=parseESPNScoreboards([sample,sample]);
eq(parsed.length,2,'dedup source ESPN');
eq(parsed.find(x=>x.id===contest.id).home.name,'Denver Nuggets','équipe ESPN');
eq(parseESPNScoreboards([{events:[fixture('bad','wrong','STATUS_FINAL')]}]).length,0,'événements invalides ignorés');
const r={injuries:[
 {displayName:'Denver Nuggets',injuries:[{athlete:{displayName:'Joueur X'},status:'Questionable',shortComment:'ankle'}]},
 {displayName:'Los Angeles Lakers',injuries:[]}
]};
const report=parseESPNInjuries(r);
eq(injuriesForTeam(report,{name:'Denver Nuggets'})[0].status,'Questionable','informations blessure');
eq(injuriesForTeam(report,{name:'Los Angeles Lakers'}),[],'équipe explicitement présente sans blessé');
eq(injuriesForTeam(report,{name:'Utah Jazz'}),null,'équipe absente du rapport est inconnue');
eq(parseESPNInjuries({other:[]}),null,'feed incorrect');
const finalGames=verifiedFinalGames(parseESPNScoreboards([{events:finals}]),'2026-11-03T02:00:00Z');
eq(finalGames.length,7,'uniquement finales avant tip');
eq(teamProfile('1',finalGames,contest.date).played,4,'échantillon Denver');
eq(teamProfile('2',finalGames,contest.date).played,3,'échantillon Lakers');
const g=parsed.find(x=>x.id===contest.id);
const projected=estimateElo(g,finalGames);
ok(projected.probability_home>0&&projected.probability_home<1,'Elo borné');
eq(Number((projected.probability_home+projected.probability_away).toFixed(3)),1,'probabilités complémentaires');
eq(projected.calibrated,false,'pas de fausse calibration');
eq(projected.drives_bet,false,'pas de paris');
const conditional=analyzeNBA(g,finalGames,report,'2026-11-02T21:40:00Z');
eq(conditional.pregame,true,'pré-match');
eq(conditional.elo,null,'échantillon insuffisant => pas de chiffre');
eq(conditional.betting_recommendations,[],'pas de pari');
eq(analyzeNBA(g,finalGames,report,'2026-11-04T00:00:00Z').elo,null,'aucune prédiction rétroactive');
eq(detectChange(null,{status:'A',injuries:{}}),null,'pas de faux événement au premier snapshot');
eq(detectChange({status:'A',injuries:{home:[],away:[]}},
 {status:'B',injuries:{home:[],away:[]}}),['STATUT_MATCH'],'changement status détecté');
const data=new Map();
const kv=mockKV();let injuryStatus='Questionable',injuryDown=false,allDown=false;
const calls=[];
const sourceFetch=async (url)=>{
 calls.push(url);
 if(!url.startsWith('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'))
  throw new Error('UNAUTHORIZED_SOURCE '+url);
 if(allDown)throw new Error('PROVIDER_DOWN');
 if(url.endsWith('/injuries')){
  return {ok:true,json:async()=>injuryDown?{error:'unavailable'}:
   {injuries:[
    {displayName:'Denver Nuggets',injuries:[{athlete:{displayName:'Joueur X'},status:injuryStatus,shortComment:'ankle'}]},
    {displayName:'Los Angeles Lakers',injuries:[]}
   ]}};
 }
 const d=url.match(/dates=(\d{8})/)?.[1];
 const current=d==='20261102'||d==='20261103';
 return {ok:true,json:async()=>({events:current?[contest]:
   finals.filter(e=>e.date.slice(0,10).replace(/-/g,'')===d)})};
};
const first=await collect({MAX_STATE:kv},sourceFetch,now);
ok(first.updated,'collecte initiale');
ok(calls.length>=4,'appels ESPN direct');
ok(calls.every(u=>!u.includes('manibetpro.emmanueldelasse')),'aucune dépendance ManiBetPro');
ok(![...kv.state.keys()].some(k=>k.startsWith('bot_log_')),'pas de logs historiques touchés');
const slate=JSON.parse(kv.state.get('max:slate:latest'));
eq(slate.mode,'INDEPENDENT_SHADOW','mode indépendant');
eq(slate.games.find(x=>x.id===contest.id).injuries.home[0].status,'Questionable','injury direct');
eq(slate.games.find(x=>x.id===contest.id).independent_analysis.source_type,'REAL','état source');
ok(kv.state.has('max:pre:'+contest.id+':H6'),'pré-match enregistré à checkpoint H6');
let after=await collect({MAX_STATE:kv},sourceFetch,new Date(now.getTime()+15*60000));
eq(JSON.parse(kv.state.get('max:events:latest')??'[]').length,0,'pas de changement fictif');
injuryStatus='Out';
after=await collect({MAX_STATE:kv},sourceFetch,new Date(now.getTime()+30*60000));
const events=JSON.parse(kv.state.get('max:events:latest'));
ok(events.some(x=>x.changes.includes('RAPPORT_BLESSURES')),'changement blessure réel historisé');
injuryDown=true;
after=await collect({MAX_STATE:kv},sourceFetch,new Date(now.getTime()+45*60000));
eq(after.sources.injuries.state,'ERROR','rapport blessure indisponible');
allDown=true;
const priorSlate=kv.state.get('max:slate:latest');
after=await collect({MAX_STATE:kv},sourceFetch,new Date(now.getTime()+60*60000));
eq(after.updated,false,'source dates indisponible => fail closed');
eq(kv.state.get('max:slate:latest'),priorSlate,'dernier état conservé');
const verificationAt='2026-11-02T21:55:00.000Z';
const validResearch={schema_version:'max-research-v1',match_id:contest.id,
 generated_at:'2026-11-02T21:50:00.000Z',
 summary:'Données ESPN confirmées. Les projections restent exploratoires ; prudence sur les blessures.',
 key_risks:['Cinq majeur non confirmé'],recheck:['Rapport NBA officiel avant match'],
 sources:[{url:'https://official.nba.com/nba-injury-report-2026-27-season/',title:'NBA Injury Report',
 checked_at:'2026-11-02T21:45:00.000Z',kind:'OFFICIAL'}],
 sections:Array.from({length:16},(_,i)=>({section_id:i+1,title:'Rubrique '+(i+1),
 status:'UNAVAILABLE',findings:[],missing:['Données non disponibles gratuitement']}))};
const parsedResearch=validateResearch(validResearch,g,verificationAt);
ok(parsedResearch,'rapport sourcé valide');
eq(parsedResearch.coverage_sections,16,'16 sections présentes');
eq(parsedResearch.status,'RESEARCH_PARTIAL','16 sections ne signifient pas analyse complète');
eq(validateResearch({...validResearch,match_id:'OTHER'},g,verificationAt),null,'mauvais match rejeté');
eq(validateResearch({...validResearch,sources:[]},g,verificationAt),null,'rapport sans source rejeté');
eq(validateResearch({...validResearch,generated_at:'2026-11-03T02:00:00Z'},g,'2026-11-03T02:20:00Z'),null,'publication après coup d’envoi rejetée');
eq(validateResearch({...validResearch,sources:[{url:'javascript:alert(1)',title:'invalid',checked_at:'2026-11-02T21:45:00Z'}]},g,verificationAt),null,'URL non https rejetée');
allDown=false;injuryDown=false;
await kv.put('max:research:'+contest.id,JSON.stringify(validResearch));
const enriched=await collect({MAX_STATE:kv},sourceFetch,new Date('2026-11-02T22:10:00Z'));
ok(enriched.updated,'collecte avec recherche MacFly valide');
const matched=JSON.parse(kv.state.get('max:slate:latest')).games.find(x=>x.id===contest.id);
eq(matched.research.coverage_sections,16,'recherche présente dans le dashboard');
eq(matched.ai_review.model,'MacFly · ChatGPT','source MacFly explicite');
ok(JSON.parse(kv.state.get('max:events:latest')).some(e=>e.changes.includes('RECHERCHE_MACFLY')),'nouvelle recherche historisée');
ok(!calls.some(u=>u.includes('api.openai.com')||u.includes('rapidapi.com')||u.includes('the-odds-api.com')),'aucune API payante appelée');
console.log('ManiBetProMax independent:',n,'assertions OK');
