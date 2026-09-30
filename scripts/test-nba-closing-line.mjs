#!/usr/bin/env node
/**
 * NBA verified closing-line semantics.
 *
 * Verifies:
 * - closing snapshot must be strictly pre-tip;
 * - latest eligible snapshot is selected;
 * - <=20 min old is AVAILABLE, older is stale;
 * - post-tip snapshots are ignored;
 * - CLV is price-vs-price on MONEYLINE only;
 * - unsupported markets remain unavailable;
 * - 15-minute cron is isolated to odds snapshots.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { backend } from './lib/backend-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const workerSource = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
const wranglerSource = readFileSync(resolve(ROOT, 'wrangler.jsonc'), 'utf8');

let assertions = 0;
let failures = 0;
const assert = (cond, msg) => {
  assertions++;
  if (!cond) {
    failures++;
    console.error('  ✗', msg);
  }
};
const eq = (a, e, msg) =>
  assert(JSON.stringify(a) === JSON.stringify(e),
    `${msg} · expected=${JSON.stringify(e)} actual=${JSON.stringify(a)}`);

const tip = '2026-10-20T23:30:00.000Z';
const snapshots = [
  {
    t: '2026-10-20T22:45:00.000Z',
    home_ml: -105,
    away_ml: -105,
    source: 'espn_scoreboard',
    provider_name: 'DraftKings',
  },
  {
    t: '2026-10-20T23:15:00.000Z',
    home_ml: -120,
    away_ml: 105,
    source: 'espn_scoreboard',
    provider_name: 'DraftKings',
  },
  {
    // Must never be selected: post-tip.
    t: '2026-10-20T23:35:00.000Z',
    home_ml: -140,
    away_ml: 120,
    source: 'espn_scoreboard',
    provider_name: 'DraftKings',
  },
];

const selected = backend._botSelectClosingSnapshot(snapshots, tip);
eq(selected.status, 'AVAILABLE',
  '15-minute pre-tip snapshot is verified');
eq(selected.snapshot?.t, '2026-10-20T23:15:00.000Z',
  'latest pre-tip snapshot selected');
eq(selected.age_minutes, 15,
  'closing snapshot age measured from tip');
eq(selected.snapshot?.home_ml, -120,
  'post-tip quote ignored');

// Boundary: exactly 20 min is valid.
eq(
  backend._botSelectClosingSnapshot([
    { t: '2026-10-20T23:10:00.000Z', home_ml: -115, away_ml: 100 }
  ], tip).status,
  'AVAILABLE',
  '20-minute boundary is valid'
);

// Older snapshot is NOT labeled closing.
const stale = backend._botSelectClosingSnapshot([
  { t: '2026-10-20T22:59:00.000Z', home_ml: -110, away_ml: 100 }
], tip);
eq(stale.status, 'UNAVAILABLE_CLOSING_SNAPSHOT_STALE',
  '31-minute snapshot is stale');
eq(stale.age_minutes, 31,
  'stale age remains observable');

eq(
  backend._botSelectClosingSnapshot([
    { t: '2026-10-20T23:31:00.000Z', home_ml: -125, away_ml: 110 }
  ], tip).status,
  'UNAVAILABLE_NO_PRETIP_SNAPSHOT',
  'post-tip-only history cannot become closing line'
);

eq(
  backend._botSelectClosingSnapshot([], tip).status,
  'UNAVAILABLE_NO_PRETIP_SNAPSHOT',
  'empty history unavailable'
);
eq(
  backend._botSelectClosingSnapshot(snapshots, 'not-a-date').status,
  'UNAVAILABLE_INVALID_GAME_DATETIME',
  'invalid game datetime fails closed'
);

// HOME moneyline CLV.
const homeLog = {
  best_market: 'MONEYLINE',
  best_side: 'HOME',
  betting_recommendations: {
    recommendations: [{
      type: 'MONEYLINE',
      side: 'HOME',
      has_value: true,
      odds_line: -110,
    }],
  },
};
const expectedHome = backend._computePriceCLV(-110, -120);
const homeClv = backend._botAttachClosingCLV(homeLog, selected);
eq(homeLog.clv_status, 'AVAILABLE',
  'verified HOME moneyline CLV becomes available');
eq(homeLog.clv_method, 'TAKEN_PRICE_VS_CLOSING_PRICE',
  'canonical CLV method retained');
eq(homeLog.clv_post_match, expectedHome.price_ratio_pct,
  'log CLV equals price-vs-price result');
eq(homeClv.implied_prob_change_pts, expectedHome.implied_prob_change_pts,
  'returned CLV has implied probability change');
eq(homeLog.closing_snapshot_at, '2026-10-20T23:15:00.000Z',
  'closing timestamp retained');
eq(homeLog.closing_snapshot_age_minutes, 15,
  'closing age retained');
eq(homeLog.closing_source, 'espn_scoreboard',
  'closing source retained');
eq(homeLog.closing_provider_name, 'DraftKings',
  'closing provider retained');
eq(homeLog.betting_recommendations.recommendations[0].closing_odds_american, -120,
  'recommendation enriched with closing quote');

// AWAY side uses away quote.
const awayLog = {
  best_market: 'MONEYLINE',
  best_side: 'AWAY',
  betting_recommendations: {
    recommendations: [{
      type: 'MONEYLINE',
      side: 'AWAY',
      has_value: true,
      odds_line: 115,
    }],
  },
};
const expectedAway = backend._computePriceCLV(115, 105);
backend._botAttachClosingCLV(awayLog, selected);
eq(awayLog.clv_post_match, expectedAway.price_ratio_pct,
  'AWAY CLV uses away closing quote');

// Stale snapshot can never surface as CLV.
const staleLog = structuredClone(homeLog);
backend._botAttachClosingCLV(staleLog, stale);
eq(staleLog.clv_status, 'UNAVAILABLE_CLOSING_SNAPSHOT_STALE',
  'stale snapshot never presented as CLV');
eq(staleLog.clv_post_match, null,
  'stale snapshot clears CLV value');

// Current capture only validates moneyline price CLV.
const spreadLog = {
  best_market: 'SPREAD',
  best_side: 'HOME',
  betting_recommendations: {
    recommendations: [{ type: 'SPREAD', side: 'HOME', has_value: true, odds_line: -110 }],
  },
};
backend._botAttachClosingCLV(spreadLog, selected);
eq(spreadLog.clv_status, 'UNAVAILABLE_MARKET_NOT_CAPTURED',
  'spread is not mislabeled as price CLV');
eq(spreadLog.clv_post_match, null,
  'unsupported market CLV stays null');

// Cron separation guards.
assert(
  wranglerSource.includes('"0 * * * *", "*/15 * * * *"'),
  'wrangler declares hourly + 15-minute cron'
);

const scheduledStart = workerSource.indexOf('async scheduled(event, env, ctx)');
const fetchStart = workerSource.indexOf('async fetch(request, env)', scheduledStart);
const scheduled = workerSource.slice(scheduledStart, fetchStart);
assert(
  scheduled.includes("if (cronSpec === '*/15 * * * *')"),
  'scheduled handler detects snapshot cadence'
);
assert(
  scheduled.includes('ctx.waitUntil(_runOddsSnapshot(env));') &&
  scheduled.includes('return;'),
  '15-minute trigger returns after odds snapshot'
);

const quarterHourBlockStart = scheduled.indexOf("if (cronSpec === '*/15 * * * *')");
const quarterHourBlockEnd = scheduled.indexOf('}', quarterHourBlockStart);
const quarterHourBlock = scheduled.slice(quarterHourBlockStart, quarterHourBlockEnd + 1);
assert(!quarterHourBlock.includes('_runBotCron'),
  '15-minute trigger does not run NBA engine');
assert(!quarterHourBlock.includes('_runMLBBotCron'),
  '15-minute trigger does not run MLB engine');
assert(!quarterHourBlock.includes('_runTennisBotCron'),
  '15-minute trigger does not run Tennis engine');

assert(workerSource.includes('const ODDS_SNAP_MAX_PTS = 192;'),
  'snapshot capacity expanded to 48h at 15-minute cadence');
assert(workerSource.includes("source:        'espn_scoreboard'"),
  'snapshot records explicit source');
assert(workerSource.includes('_botAttachClosingCLV(log, closingInfo);'),
  'NBA settlement attaches verified closing CLV');

console.log('\nNBA verified closing line');
console.log(`  assertions: ${assertions}`);
console.log(`  fail: ${failures}`);
if (failures > 0) process.exit(1);
console.log('  ✓ pre-tip closing quote and CLV semantics verified\n');
