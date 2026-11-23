import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseObservedEspnOdds,quotesFromResearch} from '../observed-odds.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/draftkings-espn-pregame.json',import.meta.url)));
const parse=scoreboard=>parseObservedEspnOdds(scoreboard,fixture.source_url);
const getOffer=r=>r.events[0].competitions[0].odds[0];
test('published ESPN pregame response distinguishes book, source, two-sided prices and missing props',()=>{
  const {quotes,coverage}=parse(fixture.scoreboard);
  assert.equal(quotes.length,6);
  assert.deepEqual(quotes.map(q=>q.american_odds),[282,-352,-104,-116,-107,-113]);
  assert.deepEqual(quotes.map(q=>q.line),[null,null,8.5,-8.5,242.5,242.5]);
  assert.equal(quotes[0].observed_at,fixture.captured_at);
  assert.equal(quotes[5].source_url,fixture.source_url);
  assert.equal(quotes[0].bookmaker,'DraftKings');
  assert.equal(quotes[0].decimal_odds,3.82);
  assert.equal(quotes[1].decimal_odds,1+100/352);
  assert.equal(quotes[2].group_key,quotes[3].group_key);
  assert.equal(coverage[0].markets.PLAYER_POINTS_OT,'UNAVAILABLE');
});
test('ignores live, late, wrong book/team, split lines, open-only or conflicting prices',()=>{
  for(const alter of [
    r=>{r.events[0].status.type.state='in';},r=>{r._fetched_at=r.events[0].date;},
    r=>{getOffer(r).provider.name='Consensus';},r=>{getOffer(r).homeTeamOdds.team.id='39';}
  ]){const s=structuredClone(fixture.scoreboard);alter(s);assert.equal(parse(s).quotes.length,0);}
  const s=structuredClone(fixture.scoreboard),o=getOffer(s);
  delete o.moneyline.away.close;
  o.total.under.close.line='u241.5';
  const other=structuredClone(o);other.pointSpread.away.close.odds='-170';
  s.events[0].competitions[0].odds.push(other);
  assert.equal(parse(s).quotes.length,0);
});
const g={id:'401910041',start:'2026-11-24T01:00:00Z',status:'STATUS_SCHEDULED',home:{id:'4'},away:{id:'5'}};
const observed='2026-11-23T22:40:00Z',received='2026-11-23T22:42:00Z';
const book='https://www.winamax.fr/paris-sportifs/match/12345';
const data={schema_version:'max-research-v1',match_id:g.id,generated_at:'2026-11-23T22:41:00Z',
  sources:[{kind:'MARKET',url:book,checked_at:observed}],
  verified_sportsbook_quotes:[{bookmaker:'Winamax',market:'PLAYER_POINTS_OT',period:'FULL_GAME_OT',match_id:g.id,
    home_team_id:'4',away_team_id:'5',event_start:g.start,observed_at:observed,source_url:book,verified:true,
    team_id:'4',player_id:'4278067',player_name:'Nic Claxton',
    sides:[{side:'OVER',line:10.5,decimal_odds:1.88},{side:'UNDER',line:10.5,decimal_odds:1.92}]}]};
const rosters=new Map([['4',{players:[{id:'4278067',name:'Nic Claxton'}]}]]);
test('manual support ties a simultaneous two-sided market to the exact scheduled match, player and source',()=>{
  const r=structuredClone(data);
  r.verified_sportsbook_quotes.push(structuredClone(r.verified_sportsbook_quotes[0]));
  const out=quotesFromResearch(r,g,received,rosters);
  assert.deepEqual(out.map(q=>[q.side,q.player_id,q.decimal_odds]),[['OVER','4278067',1.88],['UNDER','4278067',1.92]]);
  assert.equal(out[0].dnp_rule,undefined);
  assert.equal(quotesFromResearch(r,g,g.start,rosters).length,0);
  assert.equal(quotesFromResearch(r,g,received,[]).length,0);
  assert.equal(quotesFromResearch({...r,experiment_id:'pilot'},g,received,rosters).length,0);
  r.verified_sportsbook_quotes[1].sides[1].decimal_odds=2.01;
  assert.equal(quotesFromResearch(r,g,received,rosters).length,0);
});
test('manual book requires corroborated URL, same verification time/line/identity, correct period and real prices',()=>{
  for(const alter of [
    q=>{q.source_url='https://winamax.fr.example.com/paris-sportifs/match/12345';},q=>{q.period='FIRST_HALF';},
    q=>{q.sides[0].line=9.5;},q=>{q.sides[0].decimal_odds=1;},q=>{q.team_id='5';},q=>{q.match_id='401910045';},
    q=>{q.observed_at='2026-11-23T22:30:00Z';},q=>{q.sides.pop();},q=>{q.player_name='Nicolas Batum';}
  ]){
    const r=structuredClone(data);alter(r.verified_sportsbook_quotes[0]);assert.equal(quotesFromResearch(r,g,received,rosters).length,0);
  }
});
test('a player void condition travels only with the actual terms observation',()=>{
  const r=structuredClone(data),q=r.verified_sportsbook_quotes[0];
  q.dnp_rule='VOID';
  q.rules_source_url='https://operator-front-static-cdn.winamax.fr/img/content/betting/2024/20240722_cgu/reglement_des_paris_sportifs.pdf';
  assert.equal(quotesFromResearch(r,g,received,rosters)[0].dnp_rule,undefined);
  r.sources.push({kind:'OFFICIAL',url:q.rules_source_url,checked_at:observed});
  assert.equal(quotesFromResearch(r,g,received,rosters)[0].dnp_rule,'VOID');
});
