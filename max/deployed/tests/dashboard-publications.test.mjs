import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const worker=await readFile(new URL('../worker.mjs',import.meta.url),'utf8');
const js=JSON.parse(worker.match(/^const MAX_APP_HTML=(.*);$/m)[1]).match(/<script>([\s\S]*?)<\/script>/)[1].replace('load();setInterval(load,60000);','');
const el={addEventListener(){}};
const ui=runInNewContext(js+';({gameCard,renderPlayers,matchReview,editionView,editionList,forecastRoute,learningPanel,dateView,oddsPanel})',{document:{getElementById:()=>el,addEventListener(){}},window:el,URL,URLSearchParams,Date,Intl});
const at='2026-11-10T18:00:00Z',tip='2026-11-11T02:00:00Z',id='401910045';
const g={id,start:tip,checked_at:at,publication:{id:17,published_at:at},status:'STATUS_SCHEDULED',
 home:{id:'1',name:'San Antonio'},away:{id:'2',name:'Visiteurs'},independent_analysis:{advanced:{
 forecast:{status:'SIMULATED_UNCALIBRATED',probability_home:.65,probability_away:.35,projected_score:{away:103,home:110}},
 player_points:{home:{players:[{id:'9',name:'Wemby',predicted_points_if_active:35.3,projected_minutes_if_active:33.1}]},away:{players:[]}}}},
 study:{pair:{primary:{at,forecast:{probability_home:.48,projected_score:{away:99,home:90}},player_points:{home:{players:[{name:'Wemby',predicted_points_if_active:33.9}]}}}}}};
test('une édition figée donne les mêmes projections sur la carte, les onglets et la fiche rouverte',()=>{
 const outputs=[ui.gameCard(g),ui.renderPlayers(g),ui.editionView({id,edition:'17'},{game:g,publication:g.publication})];
 for(const s of outputs){assert.match(s,/35[,.]3/);assert.doesNotMatch(s,/33[,.]9/);}
 assert.match(outputs[0],/213 pts/);assert.match(outputs[2],/10 nov/);
 const list=ui.editionList({id},{game:g,publications:[g.publication],next_before_publication:17});
 assert.match(list,/#match-401910045-edition-17/);assert.match(list,/data-publications-before="17"/);
});
test('retour par édition, réussite et compensation de minutes/production',()=>{
 const number={forecast:110,actual:113,error:-3};
 const data={game:g,publication:g.publication,review:{game:{home:number,winner:{correct:true,actual:'home',projected:'home',probability_home:.65,brier:.1225}},
  players:[{name:'Wemby',minutes:{forecast:33.1,actual:34,error:-.9},points:{forecast:35.3,actual:35,error:.3},minutes_points:-1,production_error:1.3,participation:'PLAYED',offsetting_errors:true}],
  findings:[{kind:'HYPOTHESIS',text:'Faute rapide à vérifier.'}],observed_at:'2026-11-11T07:00:00Z'}};
 const html=ui.matchReview({id},data);
 for(const label of ['Vainqueur bien prévu','Wemby','compensés','-1 pts','+1,3 pts','Hypothèse','Score de Brier','href="#match-401910045-edition-17"'])assert.ok(html.includes(label),label);
 assert.match(ui.matchReview({id},{game:g,publication:g.publication}),/Résultat en attente/);
 assert.match(ui.matchReview({id},{game:g}),/Aucune édition complète/);
});
test('navigation et enseignements sans observation et avec une preuve datée',()=>{
 assert.equal(ui.forecastRoute('#archives-nba-2026-11-11').day,'2026-11-11');
 assert.equal(ui.forecastRoute('#match-401910045-retour-17').edition,'17');
 assert.equal(ui.forecastRoute('#match-401910045-edition-<bad>'),null);
 assert.match(ui.learningPanel({counts:{audited_matches:0,pending_reviews:0,lessons:0},lessons:[]}),/Aucun enseignement/);
 assert.match(ui.dateView({day:'2026-11-11'},{games:[]}),/Aucun match archivé/);
 const s=ui.learningPanel({counts:{audited_matches:2,pending_reviews:0},lessons:[{title:'<point>',explanation:'Écart',match_count:2,evidence:[{match_id:id,edition_id:17}],experiment_id:'prompt-test'}]});
 assert.match(s,/&lt;point&gt;/);assert.match(s,/#match-401910045-retour-17/);assert.match(s,/#experience-macfly-prompt-test/);
});

test('la simulation distingue cote manquante, cote vérifiée et rendement par tranche',()=>{
 const q={bookmaker:'Opérateur de test',source:'LineSmart',market:'PLAYER_POINTS_OT',side:'OVER',line:34.5,decimal_odds:2.1,player_name:'Wemby',match_id:id,edition_id:17,observed_at:at,decided_at:at,source_url:'https://www.espn.com/',teams:{home:'San Antonio',away:'Visiteurs'}};
 const performance={selections:1,pending:0,wins:1,losses:0,pushes:0,voids:0,unsettleable:0,staked_units:1,settled_units:1,net_units:1.1,roi:1.1,roi_on_staked:1.1,max_drawdown_units:0};
 const d={...performance,analyzed_games:2,priced_games:1,source_checks:[{source:'Unibet.fr',checked_at:at,games_checked:4,games_with_observed_prices:0,lookups:[{status:'NO_VERIFIED_MARKET'}]}],rule:{stake_units:1},bookmakers:[q.bookmaker],markets:[q.market],quote_rows:[q],decision_rows:[{...q,status:'WON',selected:true,net_units:1.1}],bands:[{...performance,id:'2-3',label:'2 à 3'}],best_band:null};
 const s=ui.oddsPanel(d);
 for(const label of ['2 matchs analysés','Relevé direct sur Unibet.fr','4 matchs vérifiés, 0 avec les deux prix observés','1 avec cote exploitable','Cote Opérateur de test relevée sur LineSmart','Wemby','ligne 34,5','cote 2,1','110 %','Gagnée','2 à 3','une tranche'])assert.ok(s.includes(label),label);
 const unpriced=ui.oddsPanel({...d,coverage:{projected_players:3,priced_players:1},
  player_coverage:{listed_players:4,planned_players:4,attempted_players:2,observed_players:1,pending_players:2,unavailable_players:0,refused_players:1,windows:[{match_id:id,mode:'LISTED_POINTS',index_url:'https://www.linesmart.com/',attempted_players:2,observed_players:1,planned_players:4}]},unpriced_projections:[{player_name:'Sans cote',market:'PLAYER_POINTS_OT',forecast:20}],quote_rows:[],decision_rows:[]},{compact:true});
 const retry=ui.oddsPanel({...d,source_checks:[{...d.source_checks[0],games_with_observed_prices:3,games_with_saved_prices:1}],quote_rows:[{...q,market:'MONEYLINE_OT',side:'AWAY',teams:null,match_id:'401900000',player_id:null,player_name:null}]});
 assert.match(retry,/3 avec les deux prix observés. Paires de prix effectivement archivées pour 1 match/);assert.match(retry,/Équipe à l’extérieur/);assert.doesNotMatch(s,/Paires de prix effectivement archivées/);
 const failed=ui.oddsPanel({...d,source_checks:[{...d.source_checks[0],checked_at:'2026-11-11T01:00:00Z',lookups:[{status:'OBSERVED'},{status:'UNAVAILABLE',reason:'BOARD_FETCH_FAILED'}]},...d.source_checks]});
 assert.match(failed,/Dernière tentative sur Unibet.fr/);assert.match(failed,/4 matchs ciblés. Lecture de la page impossible/);assert.doesNotMatch(failed,/matchs vérifiés|Relevé direct sur Unibet/);
 assert.match(unpriced,/Rendement non évaluable/);assert.match(unpriced,/4 joueurs avec marché points repéré · 2 contrôlés · 1 avec prix mémorisés/);assert.match(unpriced,/2 à contrôler/);assert.match(unpriced,/Liste du match sur LineSmart/);assert.match(unpriced,/1 avec une cote points vérifiée, 2 sans cote/);
 assert.equal(ui.forecastRoute('#simulation-cotes?bookmaker=Test&market=PLAYER_POINTS_OT').market,'PLAYER_POINTS_OT');
});
