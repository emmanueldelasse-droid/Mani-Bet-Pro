import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const worker = await readFile(new URL('../worker.mjs',import.meta.url),'utf8');
const html = JSON.parse(worker.match(/^const MAX_APP_HTML=(.*);$/m)[1]);
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('load();setInterval(load,60000);','');
const listener={addEventListener(){}};
const render=runInNewContext(source+';labResults',{document:{getElementById:()=>listener,addEventListener(){}},window:listener,URL,Date,Intl});

test('une expérience montre le texte exact, la règle préenregistrée et les trois bras séparés',()=>{
 const exp={id:'alpha',status:'ACTIVE',created_at:'2026-11-23T09:00:00Z',problem:'Écart de minutes',diagnosis:'MISSING',
  hypothesis:'Une limite explicite est vérifiable.',prompt:'Vérifier <joueur>.\nGarder  deux espaces.',criterion:{min_gain:.5,min_games:30,min_dates:20},
  metric:'minutes_mae',targets:[{match_id:'401900001',tip:'2026-11-24T01:00:00Z'}],
  evidence:[{match_id:'401900002',version_id:7,observation:'Limite manquante.'}],
  score:{decision:'POURSUIVRE',evaluated_games:2,evaluated_cases:12,target_count:30,forecast_games:3,
   primary:7,control:5,variant:4,gain:1,interval_95:[-.1,1.2],reason:'Il manque des dates distinctes.'}};
 const out=render({experiments:[exp],reviews:[],active_id:'alpha'},'alpha');
 for(const label of ['Ce que MacFly a remarqué','La consigne qu’il s’est donnée','Ce que cela a changé','Décision : poursuivre',
  'Vérifier &lt;joueur&gt;.\nGarder  deux espaces.', '12 cas comparés après résultat', '2 matchs évalués','Moteur principal',
  'Même moteur sans la consigne','Avec la consigne','Réduction minimale attendue de 0,5 min','Il manque des dates distinctes.','version 7'])assert.ok(out.includes(label),label);
 assert.match(out,/Toutes les expériences/);
 assert.ok(!out.includes('<joueur>'));
});

test('un bilan vide, un examen sans consigne et un test sans rencontre terminée restent distinguables',()=>{
 assert.match(render({experiments:[],reviews:[]}),/Aucune consigne de recherche en test/);
 const review={id:'review-test',problem:'Transmission incomplète',diagnosis:'TRANSMISSION',reason:'Retard du reçu.'};
 const reviewed=render({experiments:[],reviews:[review]});
 assert.match(reviewed,/Examens sans nouvelle consigne/);assert.match(render({experiments:[],reviews:[review]},review.id),/Retard du reçu/);
 const reading=render({experiments:[{id:'exp-missing',problem:'Manque',metric:'total_mae',prompt:'ABC',score:{evaluated_cases:0,evaluated_games:0,forecast_games:1,target_count:30,decision:'POURSUIVRE',changed_games:1,extra_fact_count:1,matches:[{match_id:'401900001',player_changes:{examples:[{player_id:'1',name:'Joueur de test',before:{minutes:33,points:19,status:null},after:{minutes:0,points:0,status:'OUT'}}]}}]}}],reviews:[]},'exp-missing');
 assert.match(reading,/0 cas comparés après résultat/);assert.match(reading,/33 → 0 min/);assert.match(reading,/19 → 0 pts/);assert.match(reading,/erreurs seront calculées/);assert.doesNotMatch(reading,/Réduction de l’erreur avec la consigne/);
 assert.throws(()=>render({}),/LAB_RESPONSE_INVALID/);
});

test('la décision d’adoption reste une proposition et les éléments du journal ne génèrent aucun HTML actif',()=>{
 const view=render({experiments:[{id:'r',prompt:'<script>alert(1)</script>',problem:'<img>',metric:'brier',
  evidence:[{match_id:'"><img',source_url:'javascript:bad',observation:'<test>'}],score:{decision:'PROPOSER_ADOPTION',reason:'Seuil atteint.',evaluated_cases:30,evaluated_games:30}}],
  reviews:[]},'r');
 assert.match(view,/Décision : proposer l’adoption/);
 assert.match(view,/décision séparée/);
 assert.doesNotMatch(view,/<img|<script>|javascript:bad/);
});

test('les liens stables distinguent la vue d’index, la nouvelle consigne et la projection influencée',()=>{
 const helpers=runInNewContext(source+';({labRoute,labCardLinks,labPerfLink})',{document:{getElementById:()=>listener,addEventListener(){}},window:listener,URL,Date,Intl});
 assert.equal(helpers.labRoute('#experiences-macfly').id,null);
 assert.equal(helpers.labRoute('#experience-macfly-medical-v2').id,'medical-v2');
 assert.equal(helpers.labRoute('#experience-macfly-<bad>'),null);
 const links=helpers.labCardLinks([{id:'ex-test',changed:true,problem:'Confirmation de minutes'},{id:'ex-other',changed:false}]);
 assert.match(links,/href="#experience-macfly-ex-test"/);
 assert.doesNotMatch(links,/ex-other/);
 assert.match(helpers.labPerfLink({evaluated_matches:2,paired_matches:4}),/2 matchs évalués · 4 matchs appariés/);
 const ex={id:'ex-test',problem:'Limites de minutes',status:'ACTIVE',score:{evaluated_cases:0}};
 const index=render({experiments:[ex],reviews:[],active_id:ex.id});
 assert.match(index,/href="#experience-macfly-ex-test"/);
 assert.doesNotMatch(index,/La consigne qu’il s’est donnée/);
 assert.match(render({experiments:[],reviews:[]},ex.id),/introuvable/);
});

test('la fiche archivée garde ses liens internes et ses deux prévisions datées avant le match',()=>{
 const h=runInNewContext(source+';({archivedGameHtml,labMatch})',{document:{getElementById:()=>listener,addEventListener(){}},window:listener,location:{hash:'#match-401900001'},URL,Date,Intl,fetch:async()=>new Promise(()=>{})});
 const id='401900001',snap={at:'2026-11-21T20:00:00Z',forecast:{probability_home:.60,projected_score:{home:110,away:103}}};
 const d={start:'2026-11-22T00:00:00Z',teams:{home:'Miami',away:'Boston'},study:{pair:{primary:snap,variant:snap},prompt_experiments:[{id:'exp-test',changed:true}]}};
 assert.match(h.labMatch(id),/href="#match-401900001"/);
 const card=h.archivedGameHtml(id,d);
 for(const label of ['Boston – Miami','total 213 pts','Principal','Variante rotations','href="#experience-macfly-exp-test"'])assert.ok(card.includes(label),label);
 assert.doesNotMatch(card,/Aucun relevé/);
 d.start=snap.at;assert.doesNotMatch(h.archivedGameHtml(id,d),/213 pts/);
});

test('une paire montre les projections identiques, puis les chiffres réellement observés du joueur ciblé',()=>{
 const player={player_id:'test-id',name:'Nic Claxton',control:{minutes:23.5,points:10},variant:{minutes:23.5,points:10},actual:null};
 const m={match_id:'401900001',pair_id:12,captured_at:'2026-11-23T22:00:00Z',changed:false,player_comparisons:[player]};
 const ex={id:'exp-paired',targets:[{match_id:m.match_id,player_ids:[player.player_id]}],score:{matches:[m]}};
 const html=()=>render({experiments:[ex],reviews:[]},ex.id);
 assert.match(html(),/<caption>Nic Claxton<\/caption>/);
 for(const arm of ['Sans consigne','Avec consigne'])assert.ok(html().includes(arm+'</th><td>23,5</td><td>10</td>'));
 assert.match(html(),/Paire de prévisions · 12/);assert.match(html(),/Observé<\/th><td colspan="2">Résultat en attente/);
 m.result_observed_at='2026-11-24T06:00:00Z';
 assert.match(html(),/Observé<\/th><td colspan="2">Non documenté/);
 player.actual={minutes:0,points:0};
 assert.match(html(),/Observé<\/th><td>0<\/td><td>0<\/td>/);
 player.variant=null;assert.match(html(),/Avec consigne<\/th><td colspan="2">Indisponible/);
});

test('la traçabilité relie lecture, rapport et score vérifié aux bons horaires et ne transforme pas une insuffisance en gain',()=>{
 const at='2026-11-23T09:00:00.000Z',tip='2026-11-25T00:00:00.000Z';
 const exp={id:'exp-archive',status:'INCONCLUSIVE',version:2,parent_id:'exp-before',registered_at:at,
  problem:'Temps de jeu',targets:[{match_id:'401900001',tip}],trace:[{match_id:'401900001',state:'READ',
   read_at:at,read_id:'lecture-fixture',run_id:'passage-fixture',sources:[{title:'Source test',url:'https://www.nba.com/',checked_at:at}]}],
  score:{metric:'minutes_mae',decision:'NON_CONCLUANTE',conclusion:'INCONCLUSIVE',reason:'Échantillon insuffisant.',
   eligible_games:2,eligible_cases:17,forecast_games:2,evaluated_cases:4,evaluated_games:1,matches:[{match_id:'401900001',primary_at:at,control_at:at,variant_at:at,common_input_id:'entrées-fixture',evaluated_cases:4,result_observed_at:tip,
   result_source:'https://www.espn.com/nba/game/_/gameId/401900001',final_score:{away:104,home:107}}]},status_history:[{at,status:'ACTIVE',reason:'Premier passage.'}]};
 const out=render({experiments:[exp],reviews:[]},exp.id);
 for(const label of ['2 matchs éligibles','17 cas éligibles','4 cas comparés après résultat','Version 2','exp-before','Lecture','lecture-fixture','Source test','Consigne lue',
   'entrées-fixture','score final 104 – 107','Source du résultat','Décision : non concluante','Premier passage.'])assert.ok(out.includes(label),label);
 assert.doesNotMatch(out,/PROPOSER_ADOPTION/);
});
