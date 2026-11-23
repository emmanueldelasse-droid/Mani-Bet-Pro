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
 const out=render({experiments:[exp],reviews:[],active_id:'alpha'});
 for(const label of ['Ce que MacFly a remarqué','La consigne qu’il s’est donnée','Ce que cela a changé','Décision : poursuivre',
  'Vérifier &lt;joueur&gt;.\nGarder  deux espaces.', '12 cas évalués', '2 matchs évalués','Moteur principal',
  'Même moteur sans la consigne','Avec la consigne','Réduction minimale attendue de 0,5 min','Il manque des dates distinctes.','version 7'])assert.ok(out.includes(label),label);
 assert.ok(out.includes('class="lab-card" open'));
 assert.ok(!out.includes('<joueur>'));
});

test('un bilan vide, un examen sans consigne et un test sans rencontre terminée restent distinguables',()=>{
 assert.match(render({experiments:[],reviews:[]}),/Aucune consigne de recherche en test/);
 const review={problem:'Transmission incomplète',diagnosis:'TRANSMISSION',reason:'Retard du reçu.'};
 const reviewed=render({experiments:[],reviews:[review]});
 assert.match(reviewed,/Examens conclus sans nouvelle consigne/);assert.match(reviewed,/Retard du reçu/);
 const reading=render({experiments:[{id:'e',problem:'Manque',metric:'total_mae',prompt:'ABC',score:{evaluated_cases:0,evaluated_games:0,forecast_games:1,target_count:30,decision:'POURSUIVRE',changed_games:1,extra_fact_count:1,matches:[{match_id:'401900001',player_changes:{examples:[{player_id:'1',name:'Joueur de test',before:{minutes:33,points:19,status:null},after:{minutes:0,points:0,status:'OUT'}}]}}]}}],reviews:[]});
 assert.match(reading,/0 cas évalués/);assert.match(reading,/33 → 0 min/);assert.match(reading,/19 → 0 pts/);assert.match(reading,/erreurs seront calculées/);assert.doesNotMatch(reading,/Réduction de l’erreur avec la consigne/);
 assert.throws(()=>render({}),/LAB_RESPONSE_INVALID/);
});

test('la décision d’adoption reste une proposition et les éléments du journal ne génèrent aucun HTML actif',()=>{
 const view=render({experiments:[{id:'r',prompt:'<script>alert(1)</script>',problem:'<img>',metric:'brier',
  evidence:[{match_id:'"><img',source_url:'javascript:bad',observation:'<test>'}],score:{decision:'PROPOSER_ADOPTION',reason:'Seuil atteint.',evaluated_cases:30,evaluated_games:30}}],
  reviews:[]});
 assert.match(view,/Décision : proposer l’adoption/);
 assert.match(view,/décision séparée/);
 assert.doesNotMatch(view,/<img|<script>|javascript:bad/);
});
