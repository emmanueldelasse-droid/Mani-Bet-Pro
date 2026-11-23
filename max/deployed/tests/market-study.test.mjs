import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_RULE, validateMarketQuote, makeMarketDecision, summarizeMarket } from "../market-study.mjs";

// Synthetic times and prices are confined to tests; none are ingested as real Winamax quotes.
const tip = Date.UTC(2027, 0, 2, 2);
const at = n => new Date(tip + n * 60_000).toISOString();
function setup(id = "test-1", overrides = {}) {
  const quote = {
    gameId: id, homeTeamId: "A", awayTeamId: "B", verified: true, bookmaker: "Winamax", market: "MONEYLINE_OT",
    observedAt: at(-99), integratedAt: at(-98), sourceUrl: "https://www.winamax.fr/paris-sportifs/match/12345",
    homeOdds: 2.2, awayOdds: 1.7
  };
  return {
    gameId: id, tipAt: at(0), decidedAt: at(-95), forecastAt: at(-95), homeWinProbability: 0.6,
    homeTeamId: "A", awayTeamId: "B", quotes: [quote], ...overrides
  };
}
const final = (gameId, winner, settled) => ({
  gameId, homeScore: winner === "home" ? 100 : 90, awayScore: winner === "away" ? 100 : 90,
  finalAt: at(settled)
});
test("registers the frozen prospective rule and allows exactly the window before tip", () => {
  assert.ok(Object.isFrozen(MARKET_RULE));
  assert.equal(makeMarketDecision(setup("k", { decidedAt: at(-360), forecastAt: at(-360) })).selected, false);
  for (const overrides of [{ status: "STATUS_IN_PROGRESS" }, { status: "STATUS_FINAL" }, { forecastAt: at(-361) }, { decidedAt: at(0) },
    { decidedAt: at(-100), forecastAt: at(-90) }, { tipAt: "2027-01-01" }, { homeWinProbability: 61 }])
    assert.equal(makeMarketDecision(setup("k", overrides)), null);
});
test("hides retroactive, incomplete, mismatched and unverified odds but keeps the prediction", () => {
  const game = setup();
  const valid = game.quotes[0];
  for (const bad of [
    { integratedAt: at(-94) }, { observedAt: at(-94) }, { observedAt: at(-156) }, { observedAt: at(1) },
    { market: "REGULATION" }, { bookmaker: "ESPN" }, { sourceUrl: "https://www.espn.com/nba/game/_/gameId/1" },
    { sourceUrl: "https://winamax.fr.example.com/paris-sportifs/match/12345" }, { sourceUrl: "https://www.winamax.fr/paris-sportifs/" },
    { sourceUrl: "https://www.winamax.fr@foreign.test/paris-sportifs/match/12345" }, { sourceUrl: "http://www.winamax.fr/paris-sportifs/match/12345" },
    { verified: false }, { awayOdds: null }, { homeOdds: 1 }, { gameId: "wrong" }, { homeTeamId:"B", awayTeamId:"A" }
  ]) {
    const decision = makeMarketDecision({ ...game, quotes: [{ ...valid, ...bad }] });
    assert.equal(decision.label, "Rendement non évaluable", JSON.stringify(bad));
    assert.equal(decision.prediction, "home");
    assert.equal(decision.stakeUnits, 0);
    assert.equal(decision.quote, null);
  }
  assert.equal(validateMarketQuote(valid, game, at(1)), null);
  assert.equal(validateMarketQuote({...valid, integratedAt: at(-200)}, game, at(-90)).integratedAt, at(-90));
});
test("price selection uses most recent eligible observation, rejects conflicts and preserves the two quoted sides", () => {
  const game = setup();
  const q = game.quotes[0];
  const newest = {...q, observedAt: at(-97), integratedAt: at(-96), homeOdds: 1.51};
  const d = makeMarketDecision({...game, quotes: [newest, q]});
  assert.equal(d.quote.homeOdds, 1.51);
  assert.equal(d.quote.awayOdds, 1.7);
  assert.equal(d.selected, false);
  assert.equal(d.label, "Abstention");
  assert.equal(makeMarketDecision({...game, quotes: [q, {...newest, homeOdds: 2.9}, newest]}).reason, "CONFLICTING_PRICES");
  const edge = makeMarketDecision({...game, homeWinProbability: 0.6, quotes:[{...q, homeOdds:1.75}]});
  assert.equal(edge.selected, true);
  const draw = makeMarketDecision({...game, homeWinProbability: 0.5});
  assert.equal(draw.reason, "NO_UNIQUE_WINNER");
  assert.equal(draw.stakeUnits, 0);
});
test("settles in observation order, calculates drawdown and compares the market on the same games", () => {
  const ids = ["a","b","c","d","e","f","g"];
  const games = ids.map(id => setup(id));
  games[3].quotes = [];
  games[4].quotes[0].homeOdds = 1.4; // priced abstention included in paired sporting comparison
  games[5].quotes[0].homeOdds = games[5].quotes[0].awayOdds = 2.5; // no unique market favorite
  const decisions = games.map(makeMarketDecision);
  const finals = [final("c","away",180),final("a","home",140),final("b","away",160),
    final("d","home",200),final("e","away",210),final("f","home",220)];
  const s = summarizeMarket([...decisions, decisions[0]], finals);
  assert.equal(s.analyzedGames,7);
  assert.equal(s.pricedGames,6);
  assert.equal(s.selections,5);
  assert.equal(s.settledSelections,4);
  assert.equal(s.pendingSelections,1);
  assert.equal(s.stakedUnits,5);
  assert.equal(s.settledUnits,4);
  assert.equal(s.netUnits,0.7);
  assert.equal(s.roi,0.175);
  assert.equal(s.roiOnStaked,Number((s.netUnits/s.stakedUnits).toFixed(10)));
  assert.equal(s.maxDrawdownUnits,2);
  assert.deepEqual(s.comparedWithFavorite,{games:4,maxCorrect:1,favoriteCorrect:2,maxAccuracy:0.25,favoriteAccuracy:0.5});
  assert.deepEqual(s.sport,{games:6,correct:3,accuracy:0.5});
  assert.deepEqual(summarizeMarket(decisions.reverse(),finals.reverse()).netUnits,s.netUnits);
});
test("unpriced and pending results have no calculable return; conflicting freezes and finals do not count twice", () => {
  const d = makeMarketDecision(setup("x",{quotes:[]}));
  const only = summarizeMarket([d],[final("x","home",10)]);
  assert.equal(only.sport.accuracy,1);
  assert.equal(only.roi,null);
  assert.equal(only.netUnits,null);
  assert.equal(only.rows[0].label,"Rendement non évaluable");
  assert.deepEqual(summarizeMarket([d, {...d,forecastAt:at(-94)}], []).conflictingDecisionIds,["x"]);
  const valid = makeMarketDecision(setup("y"));
  const conflicting = summarizeMarket([valid],[final("y","home",10),final("y","away",12)]);
  assert.deepEqual(conflicting.conflictingFinalIds,["y"]);
  assert.equal(conflicting.roi,null);
  const duplicateFinals = [final("y","home",50), final("y","home",30)];
  assert.equal(summarizeMarket([valid],duplicateFinals).rows[0].resultAt,at(30));
  assert.equal(summarizeMarket([valid],duplicateFinals.reverse()).rows[0].resultAt,at(30));
  for(const wrongFinal of [final("y","home",-1),{...final("y","home",30),homeScore:0,awayScore:0},
    {...final("y","home",30),homeTeamId:"B"}, {...final("y","home",30),finalAt:null}]) {
    assert.equal(summarizeMarket([valid],[wrongFinal]).settledSelections,0);
  }
});

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { recordMarket, recordFinalMarket, readMarket, readDecisions } from "../market-study.mjs";

function marketDatabase() {
  const sqlite=new DatabaseSync(":memory:");
  let now=Date.UTC(2027,2,10,20);
  const stamp=n=>new Date(n).toISOString();
  // Real SQLite statements and constraints, deterministic D1 clock.
  sqlite.function("strftime",{deterministic:true,varargs:true},(format,input)=>stamp(input==="now"?now:Date.parse(input)));
  for(const file of ["research-journal.sql","market-study.sql"])
    sqlite.exec(readFileSync(new URL("../"+file,import.meta.url),"utf8"));
  const db={
    withSession(){return this;},
    prepare(sql){return {bind(...args){return {
      all:()=>({results:sqlite.prepare(sql).all(...args)}), first:()=>sqlite.prepare(sql).get(...args)??null
    };}};},
    batch(statements){sqlite.exec("BEGIN");try{
      const result=statements.map(s=>s.all());sqlite.exec("COMMIT");return result;
    }catch(e){sqlite.exec("ROLLBACK");throw e;}}
  };
  return {db,sqlite,stamp:()=>stamp(now),at:minutes=>stamp(now+minutes*60_000),advance(minutes){now+=minutes*60_000;}};
}

test("D1 journal to priced freeze to immutable settlement; retries, stale and corrected finals",async()=>{
  const h=marketDatabase(), game={id:"401911111",home:{id:"A"},away:{id:"B"},start:h.at(120),status:"STATUS_SCHEDULED"};
  h.advance(1);
  const q={...setup(game.id).quotes[0],observedAt:h.stamp(),integratedAt:"spoofed"};
  const report={schema_version:"max-research-v1",match_id:game.id,generated_at:h.stamp(),
    sources:[{url:q.sourceUrl,checked_at:h.stamp()}],verified_winamax_quotes:[q]};
  const receipt=Number(h.sqlite.prepare("INSERT INTO macfly_inbox(report_json) VALUES(?)").run(JSON.stringify(report)).lastInsertRowid);
  h.advance(1);
  function freeze(p) {
    const payload={receipts:[{id:receipt}],pair:{primary:{game_id:game.id,forecast:{probability_home:p}}}};
    const id=Number(h.sqlite.prepare("INSERT INTO max_forecast_versions(match_id,as_of,tip,payload) VALUES(?,?,?,?)")
      .run(game.id,h.stamp(),game.start,JSON.stringify(payload)).lastInsertRowid);
    return {match_id:game.id,id};
  }
  const v1=freeze(0.6);
  h.advance(1);
  const v2=freeze(0.2); // emulate a transient failure between journal and decision
  const d=await recordMarket(h.db,game,v2,h.stamp());
  assert.equal(d.quote.receiptId,receipt);
  assert.equal(d.quote.integratedAt,report.generated_at);
  assert.equal(d.quote.checkedAt,report.generated_at);
  assert.equal(d.decidedAt,h.stamp());
  assert.equal(d.forecastVersionId,v1.id);
  assert.equal(d.stakeUnits,1);
  assert.equal(d.homeWinProbability,0.6);
  h.advance(2);
  assert.deepEqual(await recordMarket(h.db,game,v1,h.stamp()),d);
  assert.deepEqual((await readDecisions(h.db,[game.id])).get(game.id),d);
  assert.equal((await readMarket(h.db)).pendingSelections,1);
  h.advance(400);
  assert.equal(await recordMarket(h.db,game,v1,h.stamp()),null);
  game.status="STATUS_FINAL";game.home.score=104;game.away.score=92;game.fetched_at=h.stamp();
  const first=await recordFinalMarket(h.db,game,h.stamp());
  assert.deepEqual(await recordFinalMarket(h.db,game,h.stamp()),first);
  let summary=await readMarket(h.db);
  assert.equal(summary.netUnits,1.2);
  assert.equal(summary.roi,1.2);
  assert.equal(summary.comparedWithFavorite.maxCorrect,1);
  h.advance(2);game.fetched_at=h.stamp();game.home.score=90;
  await recordFinalMarket(h.db,game,h.stamp());
  game.fetched_at=first.observed_at;game.home.score=104;
  await recordFinalMarket(h.db,game,h.stamp());
  summary=await readMarket(h.db);
  assert.equal(summary.netUnits,-1);
  assert.equal(summary.rows[0].resultAt,first.settled_at);
  assert.equal(h.sqlite.prepare("SELECT count(*) AS n FROM market_study_finals").get().n,2);
  assert.throws(()=>h.sqlite.exec("UPDATE market_study_decisions SET tip='2099'"),/IMMUTABLE/);
});

test("first issued unpriced forecast survives a later verified quote and later replays",async()=>{
  const h=marketDatabase(), game={id:"401911112",home:{id:"A"},away:{id:"B"},start:h.at(60),status:"STATUS_SCHEDULED"};
  function createVersion(receipts) {
    const payload={receipts,pair:{primary:{game_id:game.id,forecast:{probability_home:0.7}}}};
    return {match_id:game.id,id:Number(h.sqlite.prepare("INSERT INTO max_forecast_versions(match_id,as_of,tip,payload) VALUES(?,?,?,?)")
      .run(game.id,h.stamp(),game.start,JSON.stringify(payload)).lastInsertRowid)};
  }
  h.advance(1); const v1=createVersion([]);
  const d=await recordMarket(h.db,game,v1,h.stamp());
  assert.equal(d.label,"Rendement non évaluable");
  h.advance(1);
  const q={...setup(game.id).quotes[0],observedAt:h.at(-5)};
  const r={schema_version:"max-research-v1",match_id:game.id,generated_at:h.stamp(),
    sources:[{url:q.sourceUrl,checked_at:h.stamp()}],verified_winamax_quotes:[q]};
  const id=Number(h.sqlite.prepare("INSERT INTO macfly_inbox(report_json) VALUES(?)").run(JSON.stringify(r)).lastInsertRowid);
  const v2=createVersion([{id}]);
  assert.deepEqual(await recordMarket(h.db,game,v2,h.stamp()),d);
  assert.equal((await readMarket(h.db)).pricedGames,0);
});
