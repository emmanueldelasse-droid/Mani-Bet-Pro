import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUnibetBoard,fetchUnibetBoard,UNIBET_BOARD} from '../unibet-public.mjs';

// Layout and field names of the public league page on 23 Nov 2026. Prices are synthetic test values.
const now='2026-11-23T23:01:00.000Z';
const game={id:'99123999',status:'STATUS_SCHEDULED',start:'2026-11-24T01:00:00.000Z',
  home:{id:'4',name:'Chicago Bulls',abbreviation:'CHI'},away:{id:'5',name:'Cleveland Cavaliers',abbreviation:'CLE'}};
const href='/paris-basketball/usa/nba/3399088/chi-bulls-vs-cle-cavaliers';
const url='https://www.unibet.fr'+href;
const schema={'@type':'SportsEvent','@id':url+'#event',sport:'Basketball',superEvent:{url:UNIBET_BOARD,name:'NBA'},
  url,startDate:'2026-11-24T02:00:00',homeTeam:{'@type':'SportsTeam',name:'CHI Bulls'},awayTeam:{'@type':'SportsTeam',name:'CLE Cavaliers'}};
const li='<li>Le <b>Vainqueur du match (Face-à-face)</b> comprend les prolongations éventuelles (Overtime) incluses.</li>';
const button=(team,decimal)=>'<button type="button" class="psel-outcome psel-outcome--rating" aria-disabled="false"><span class="psel-outcome__label">'+team+'</span><span class="psel-outcome__data">'+decimal+'</span></button>';
const block='<psel-event-main><a class="psel-event__link" href="'+href+'"><time>Demain à 02h00</time>'+
  '<span class="psel-opponent__name">CHI Bulls</span><span class="psel-opponent__name">CLE Cavaliers</span>'+
  '<p class="psel-bet-option"> Face à Face - Match </p></a><table>'+button('CLE Cavaliers','1,65')+button('CHI Bulls','2,31')+'</table></psel-event-main>';
const html=(cards=block,event=schema)=>li+'<script type="application/ld+json">'+JSON.stringify([event])+'</script>'+cards;
test('lecture directe Unibet France du vainqueur avec prolongations, équipes nommées et rendez-vous parisien absolu',()=>{
  const result=parseUnibetBoard(html(),[game],now);
  assert.deepEqual(result.map(r=>[r.bookmaker,r.side,r.decimal_odds,r.market,r.bookmaker_event_id]),[
    ['Unibet','HOME',2.31,'MONEYLINE_OT','3399088'],['Unibet','AWAY',1.65,'MONEYLINE_OT','3399088']
  ]);
  assert.equal(result[0].source_url,UNIBET_BOARD);
  assert.equal(result[0].event_url,url);
  assert.equal(result[1].observed_at,now);
  // "Demain" is yesterday's cached UI copy because Paris just crossed midnight; the structured date is fixed.
  assert.deepEqual(parseUnibetBoard(html().replace('Demain à 02h00','Aujourd’hui à 02h00'),[game],now),result);
  assert.deepEqual(parseUnibetBoard(html(),[{...game,start:'2026-11-24T02:00:00Z'}],now),[]);
  assert.deepEqual(parseUnibetBoard(html(),[{...game,home:game.away,away:game.home}],now),[]);
});
test('la règle, les deux boutons actifs, une carte unique et le bon marché sont indispensables',()=>{
  for(const invalid of [html().replace(li,''),html().replace('Face à Face - Match','1N2 - Temps réglementaire'),
    html().replace('aria-disabled="false"','aria-disabled="true"'),html().replace('2,31','–'),
    html().replace(button('CHI Bulls','2,31'),button('CLE Cavaliers','2,31')),html(block+block),
    html(block,{...schema,superEvent:{url:UNIBET_BOARD,name:'WNBA'}})]){
    assert.deepEqual(parseUnibetBoard(invalid,[game],now),[]);
  }
  assert.deepEqual(parseUnibetBoard(html(),[game],game.start),[]);
  const ambiguous={...game,start:'2026-10-25T00:30:00Z'};
  assert.deepEqual(parseUnibetBoard(html(block,{...schema,startDate:'2026-10-25T02:30:00'}),[ambiguous],'2026-10-24T23:30:00Z'),[]);
});
test('une requête publique par passage ; 429, cache périmé, contenu trop lourd et échéance respectés',async()=>{
  let requests=0;
  const fetcher=async (url,opts)=>{requests++;assert.equal(url,UNIBET_BOARD);assert.equal(opts.redirect,'error');
    return new Response(html(),{headers:{'Content-Type':'text/html; charset=utf-8','Date':new Date(now).toUTCString()}});};
  const res=await fetchUnibetBoard([game],{clock:()=>now,fetcher});
  assert.equal(res.quotes.length,2);assert.equal(res.lookups[0].matched_games,1);assert.equal(requests,1);
  const limited=await fetchUnibetBoard([game],{clock:()=>now,fetcher:async()=>new Response('',{status:429,headers:{'Retry-After':'90'}})});
  assert.equal(limited.lookups[0].retry_after,'90');assert.equal(limited.quotes.length,0);
  const stale=await fetchUnibetBoard([game],{clock:()=>now,fetcher:async()=>new Response(html(),{headers:{'Content-Type':'text/html','Age':'301'}})});
  assert.equal(stale.lookups[0].reason,'STALE_DOCUMENT');
  const tooBig=await fetchUnibetBoard([game],{clock:()=>now,fetcher:async()=>new Response('x'.repeat(400000),{headers:{'Content-Type':'text/html'}})});
  assert.equal(tooBig.lookups[0].reason,'BOARD_TOO_LARGE');
  assert.deepEqual(await fetchUnibetBoard([game],{clock:()=>game.start,fetcher}),{quotes:[],lookups:[]});
  assert.equal(requests,1);
});
