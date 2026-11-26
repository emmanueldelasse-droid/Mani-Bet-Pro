import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseOfficialPages,officialForGame,latestOfficialURL} from '../collectors.mjs';

// Text positions decoded from the real public NBA bulletin linked in the fixture.
const fixture=JSON.parse(readFileSync(new URL('./fixtures/official-not-yet-submitted-20261126.json',import.meta.url)));
const document={url:fixture.source_url,published_at:fixture.source_issued_at,checked_at:'2026-11-26T12:20:00.000Z'};
const parse=pages=>parseOfficialPages(pages??fixture.pages,document);
const game={id:'fixture-MIA-NYK',start:'2026-11-28T00:00:00.000Z',
 home:{id:'18',name:'New York Knicks',abbreviation:'NY'},
 away:{id:'14',name:'Miami Heat',abbreviation:'MIA'}};

test('the real all-pending NBA bulletin is valid with eleven games and no player claims',()=>{
 const table=parse();
 assert.equal(table.url,fixture.source_url);
 assert.equal(table.published_at,'2026-11-26T12:15:00.000Z');
 assert.equal(table.players,0);
 assert.equal(table.matches.length,11);
 const teams=table.matches.flatMap(match=>Object.values(match.teams));
 assert.equal(teams.length,22);
 assert.ok(teams.every(team=>team.status==='NOT_YET_SUBMITTED'&&team.players.length===0));
 // The second page continues GSW@POR, then lists LAL@SAS and NOP@LAC.
 assert.deepEqual(Object.keys(table.matches.find(match=>match.matchup==='GSW@POR').teams),
  ['Golden State Warriors','Portland Trail Blazers']);
 assert.deepEqual(Object.keys(table.matches.at(-1).teams),['New Orleans Pelicans','LA Clippers']);
});

test('fresh pending declarations stay unknown for the exact scheduled game',()=>{
 const medical=officialForGame(parse(),game,document.checked_at);
 assert.equal(medical.match_id,game.id);
 assert.equal(medical.event_start,game.start);
 assert.equal(medical.source_url,fixture.source_url);
 assert.equal(medical.checked_at,document.checked_at);
 for(const side of ['home','away']){
  assert.equal(medical.teams[side].status,'NOT_YET_SUBMITTED');
  assert.deepEqual(medical.teams[side].players,[]);
 }
 assert.equal(officialForGame(parse(),{...game,start:'2026-11-27T00:00:00.000Z'},document.checked_at),null);
 assert.equal(officialForGame(parse(),game,'2026-11-27T00:16:00.000Z'),null);
});

test('a table with no explicit player status or pending declaration still fails',()=>{
 const withoutDeclarations=structuredClone(fixture.pages);
 for(const page of withoutDeclarations)page.items=page.items.filter(item=>
  !['NOT','YET','SUBMITTED'].includes(item.text.trim()));
 assert.throws(()=>parse(withoutDeclarations),/OFFICIAL_NO_VERIFIED_ROWS/);
});

test('all-pending acceptance preserves the document identity and discovery safeguards',()=>{
 assert.throws(()=>parseOfficialPages(fixture.pages,{...document,
  url:fixture.source_url.replace('2026-11-26','2026-11-25')}),/OFFICIAL_HEADER_MISMATCH/);
 const future=fixture.source_url.replace('07_15AM','08_30AM');
 assert.deepEqual(latestOfficialURL(`<a href="${fixture.source_url}">Current</a><a href="${future}">Future</a>`,document.checked_at),
  {url:fixture.source_url,published_at:fixture.source_issued_at});
});
