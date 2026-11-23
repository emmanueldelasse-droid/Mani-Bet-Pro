import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parsePlayerPointQuotes,fetchPlayerPointQuotes} from '../player-odds.mjs';

const html=readFileSync(new URL('./fixtures/observed-player-point-markup.html',import.meta.url),'utf8');
const at='2026-11-23T22:40:14.000Z',start='2026-11-24T03:00:00.000Z',id='401910045';
const player={id:'5104157',team_id:'24',name:'Victor Wembanyama',predicted_points_if_active:30};
const game={id,start,status:'STATUS_SCHEDULED',away:{id:'24',name:'San Antonio Spurs'},home:{id:'23',name:'Sacramento Kings'},
  study:{pair:{primary:{player_points:{away:{players:[player]},home:{players:[]}}}}}};
test('lecture standard du tableau public LineSmart, opérateur, seuil et côtés de la même ligne',()=>{
  const q=parsePlayerPointQuotes(html,game,player,at);
  assert.deepEqual(q.map(x=>[x.source,x.bookmaker,x.player_id,x.market,x.side,x.line,x.american_odds]),[
    ['LineSmart','DraftKings','5104157','PLAYER_POINTS_OT','OVER',29.5,-110],
    ['LineSmart','DraftKings','5104157','PLAYER_POINTS_OT','UNDER',29.5,-116]]);
  assert.equal(q[0].observed_at,at);assert.equal(q[1].provider_updated_at,'2026-11-23T22:15:00.000Z');
  assert.equal(q[0].decimal_odds,1+100/110);assert.equal(q[1].decimal_odds,1+100/116);
  assert.deepEqual(parsePlayerPointQuotes(html.replace('-116','-122'),game,player,at).map(x=>x.american_odds),[-110,-122]);
});
test('un autre match, quart-temps, date périmée, mauvaise équipe ou joueur ambigu ne créent aucun prix',()=>{
  const sameLastName={...player,id:'999',team_id:'23'};
  const ambiguous={...game,study:{pair:{primary:{player_points:{home:{players:[sameLastName]},away:{players:[player]}}}}}};
  for(const [page,match,observed] of [
    [html.replaceAll('sacramento-kings','denver-nuggets'),game,at],[html.replace('10:00 PM ET','9:00 PM ET'),game,at],
    [html.replace('<b>Points</b>','<b>Points + assists</b>'),game,at],[html.replace('<b>Points</b>','<b>1st quarter Points</b>'),game,at],
    [html.replace('<th>Over</th><th>Under</th>','<th>Under</th><th>Over</th>'),game,at],[html.replace('-116','—'),game,at],
    [html,game,'2026-11-23T23:16:00Z'],[html,game,'2026-11-23T22:14:00Z'],[html,game,start],[html,ambiguous,at],
    [html,{...game,status:'STATUS_IN_PROGRESS'},at],[html.replace('"name": "San Antonio Spurs"','"name": "Boston Celtics"'),game,at]
  ])assert.deepEqual(parsePlayerPointQuotes(page,match,player,observed),[]);
});
test('une requête publique bornée par joueur : réponse refusée conservée comme indisponibilité',async()=>{
  let calls=0;
  const fetcher=async url=>{calls++;assert.match(url,/^https:\/\/linesmart\.app\/nba\/props\//);return new Response(html,{headers:{'Content-Type':'text/html'}});};
  const read=await fetchPlayerPointQuotes([game,game,game],{limit:1,clock:()=>Date.parse(at),fetcher});
  assert.equal(calls,1);assert.equal(read.lookups[0].status,'OBSERVED');assert.equal(read.quotes.length,2);
  const blocked=await fetchPlayerPointQuotes([game],{limit:4,clock:()=>Date.parse(at),fetcher:async()=>new Response('',{status:403})});
  assert.deepEqual(blocked.quotes,[]);assert.equal(blocked.lookups[0].status,'HTTP_403');
  const late=await fetchPlayerPointQuotes([game],{clock:()=>Date.parse(start),fetcher});assert.equal(late.lookups.length,0);
});

test('le profil joueur refuse aussi un corps de prix accompagné d’une redirection',async()=>{
  let calls=0;
  const result=await fetchPlayerPointQuotes([game],{clock:()=>Date.parse(at),fetcher:async(source,opts)=>{
    calls++;assert.equal(opts.redirect,'manual');
    return new Response(html,{status:302,headers:{Location:'https://example.com/autre','Content-Type':'text/html'}});
  }});
  assert.equal(calls,1);assert.equal(result.lookups[0].status,'HTTP_302');assert.deepEqual(result.quotes,[]);
});
