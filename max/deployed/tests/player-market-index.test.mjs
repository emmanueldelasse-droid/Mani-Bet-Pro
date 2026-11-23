import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPlayerMarketIndex,parsePlayerMarketIndex,playerMarketIndexUrl} from '../player-market-index.mjs';

const game={id:'9912345',status:'STATUS_SCHEDULED',start:'2026-11-24T00:30:00.000Z',
  away:{id:'17',name:'Brooklyn Nets',abbreviation:'BKN'},home:{id:'16',name:'Minnesota Timberwolves',abbreviation:'MIN'},
  study:{pair:{primary:{player_points:{away:{players:[{id:'1',name:"Day'Ron Sharpe"},{id:'2',name:'Joueur Deux'}]},
    home:{players:[{id:'3',name:'Joueur Trois'}]}}}}}};
const at='2026-11-23T22:30:00.000Z',url='https://linesmart.app/nba/games/brooklyn-nets-at-minnesota-timberwolves-2026-11-23/';
const schema={'@type':'ItemPage',url,temporalCoverage:'2026-11-23T19:30-05:00/2026-11-23T22:00-05:00',
  about:['Brooklyn Nets','Minnesota Timberwolves'].map(name=>({'@type':'SportsTeam',sport:'Basketball',name}))};
const row=(path,name,team,market,line)=>'<tr><td><a href="nba/props/'+path+'/">'+name+'</a> <span class="na">'+team+' F</span></td><td>'+market+'</td><td class="num">'+line+'</td></tr>';
const one=row('day-ron-sharpe','Day&#x27;Ron Sharpe','BKN','Points','O/U 8.5');
const two=row('joueur-deux','Joueur Deux','BKN','Assists','O/U 4.5');
const three=row('joueur-trois','Joueur Trois','MIN','Points','O/U 17');
const html=(rows=one+two+three,count=3)=>'<script type="application/ld+json">'+JSON.stringify(schema)+'</script>'+
  '<section id="props-s"><table class="books sx-props"><thead><tr><th>Player</th><th>Market</th><th>Line</th><th>Last 5 vs line</th><th>Over</th></tr></thead>'+
  '<tbody>'+rows+'</tbody></table><p>18 prop lines across '+count+' players; each player page has every line.</p></section>'+
  '<footer>'+row('joueur-deux','Joueur Deux','BKN','Points','O/U 10.5')+'</footer>';

test('la table du bon match fournit les profils avec ligne Points sans inventer de prix',()=>{
  assert.equal(playerMarketIndexUrl(game),url);
  const index=parsePlayerMarketIndex(html(),game,at);
  assert.equal(index.status,'INDEXED');
  assert.deepEqual(index.players.map(p=>[p.id,p.profile_url,p.index_line]),[
    ['1','https://linesmart.app/nba/props/day-ron-sharpe/',8.5],['3','https://linesmart.app/nba/props/joueur-trois/',17]
  ]);
  assert.equal(index.all_reported_players_scanned,true);
  assert.equal(index.all_reported_players_have_points_lines,false);
  assert.equal(index.examined_rows,3);
  assert.equal(index.rejected_rows,0);
  assert.ok(index.players.every(p=>!('decimal_odds' in p)));
  assert.equal(parsePlayerMarketIndex(html(one+three,3),game,at).all_reported_players_scanned,false);
});
test('les erreurs de match, d’équipe, d’homonymie et de seuil donnent une couverture limitée',()=>{
  assert.equal(parsePlayerMarketIndex(html(),{...game,start:'2026-11-24T00:45:00Z'},at).status,'UNAVAILABLE');
  assert.equal(parsePlayerMarketIndex(html(),game,game.start).status,'UNAVAILABLE');
  assert.equal(parsePlayerMarketIndex(html().replace('sx-props','other'),game,at).status,'UNAVAILABLE');
  const changed=structuredClone(game);
  changed.study.pair.primary.player_points.home.players.push({id:'8',name:"Day'Ron Sharpe"});
  assert.deepEqual(parsePlayerMarketIndex(html(),changed,at).players.map(p=>p.id),['3']);
  assert.deepEqual(parsePlayerMarketIndex(html(one+three.replace('MIN F','BKN F')),game,at).players.map(p=>p.id),['1']);
  assert.deepEqual(parsePlayerMarketIndex(html(one+three+one.replace('8.5','9.5')),game,at).players.map(p=>p.id),['3']);
});
test('une seule consultation bornée et lecture de Retry-After sans nouvel essai',async()=>{
  const calls=[],fetcher=async (source,opts)=>{calls.push([source,opts.redirect]);return new Response(html(),{headers:{'Content-Type':'text/html; charset=utf-8'}});};
  const result=await fetchPlayerMarketIndex(game,{fetcher,clock:()=>at});
  assert.equal(result.status,'INDEXED');
  assert.equal(result.bytes,Buffer.byteLength(html()));
  assert.deepEqual(calls,[[url,'manual']]);
  let n=0;
  const limited=await fetchPlayerMarketIndex(game,{fetcher:async()=>{n++;return new Response('',{status:429,headers:{'Retry-After':'60'}});},clock:()=>at});
  assert.equal(limited.http_status,429);assert.equal(limited.retry_after,'60');assert.equal(n,1);
  const big=await fetchPlayerMarketIndex(game,{fetcher:async()=>new Response('x'.repeat(135000),{headers:{'Content-Type':'text/html'}}),clock:()=>at});
  assert.equal(big.reason,'INDEX_TOO_LARGE');
});

test('un index redirigé en 302 ne fournit aucun profil',async()=>{
  let calls=0;
  const result=await fetchPlayerMarketIndex(game,{clock:()=>at,fetcher:async(source,opts)=>{
    calls++;assert.equal(source,url);assert.equal(opts.redirect,'manual');
    return new Response(html(),{status:302,headers:{Location:'https://example.com/autre','Content-Type':'text/html'}});
  }});
  assert.equal(calls,1);assert.equal(result.http_status,302);assert.deepEqual(result.players,[]);
});
