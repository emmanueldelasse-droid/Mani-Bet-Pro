import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../worker.mjs',import.meta.url),'utf8');
const literal = source.match(/^const MAX_APP_HTML=(.*);$/m)?.[1];
assert.ok(literal,'HTML du Worker');
const html = JSON.parse(literal);
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const listener = { addEventListener(){} };
const context = { document:{getElementById:()=>listener,addEventListener(){}},window:listener,URL,Date,Intl };
const ui = runInNewContext(script.replace('load();setInterval(load,60000);','')+';({gameCard,sportStudy,marketStudy})',context);

test('une projection publiée avant match reste identifiable en direct et après la finale',()=>{
 const now=Date.now(),iso=m=>new Date(now+m*60000).toISOString();
 const game={id:'900000001',start:iso(-60),checked_at:iso(-120),status:'STATUS_FINAL',
   away:{name:'Extérieur',abbreviation:'EXT',score:125},home:{name:'Domicile',abbreviation:'DOM',score:120}};
 const captured={at:iso(-70),forecast:{probability_home:.51,projected_score:{home:106,away:104}},
   player_points:{away:{players:[]},home:{players:[]}}};
 let card=ui.gameCard({...game,study:{pair:{primary:captured}}});
 assert.match(card,/Match très ouvert/);
 assert.match(card,/210 pts/);
 assert.match(card,/Score final · EXT 125 – 120 DOM/);
 assert.doesNotMatch(card,/245 pts/);
 card=ui.gameCard({...game,study:{pair:{primary:{...captured,at:iso(-10)}}}});
 assert.match(card,/Prévision figée indisponible/);
 assert.doesNotMatch(card,/210 pts/);
});

test('une absence déjà intégrée est signalée avec la chronologie et un lien HTTPS contrôlé',()=>{
 const now=new Date().toISOString();
 const game={id:'900000002',start:now,status:'STATUS_FINAL',away:{name:'Extérieur'},home:{name:'Domicile'},
  study:{revision:{integrated_at:now,changes:[{kind:'INJURY',player:'<nom>',status:'OUT',effect:'ALREADY_KNOWN',
   source_url:'javascript:alert(1)',checked_at:now,integrated_at:now}]},decision:{label:'Rendement non évaluable',quote:null}}};
 const card=ui.gameCard(game);
 assert.match(card,/Information déjà connue/);
 assert.match(card,/Publication inconnue/);
 assert.match(card,/Rendement non évaluable/);
 assert.match(card,/&lt;nom&gt;/);
 assert.doesNotMatch(card,/javascript:|<nom>/);
});

test('une décision sans cote conserve le verdict sportif dans le registre',()=>{
 const output=ui.marketStudy({rows:[{gameId:'900000003',awayTeamName:'Extérieur',homeTeamName:'Domicile',
  label:'Rendement non évaluable',prediction:'home',sportHit:true,decisionAt:'2026-11-23T10:00:00Z'}], analyzedGames:1,pricedGames:0});
 assert.match(output,/Extérieur – Domicile/);
 assert.match(output,/Pronostic juste/);
 assert.match(output,/Rendement non évaluable/);
});
