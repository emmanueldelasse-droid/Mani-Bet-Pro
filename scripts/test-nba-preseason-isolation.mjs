#!/usr/bin/env node
/**
 * NBA preseason isolation.
 *
 * PRESEASON reste visible / settlable en shadow mode, mais ne doit jamais
 * polluer les métriques ou calibrations NBA regular/postseason.
 */

import { backend } from './lib/backend-engine.mjs';
import { summarizeSport } from './lib/monitoring-summary.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function check(label, condition) {
  if (condition) pass++;
  else { fail++; failures.push(label); console.error('  ✗', label); }
}
function eq(label, actual, expected) {
  check(`${label} · expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    JSON.stringify(actual) === JSON.stringify(expected));
}

const preByType = {
  match_id: 'PRE-TYPE',
  event_type: 'PRESEASON',
  season_type: 1,
  nba_phase: 'preseason',
  status: 'settled',
  motor_was_right: true,
};

const preBySeason = {
  match_id: 'PRE-SEASON',
  season_type: 1,
  status: 'settled',
  motor_was_right: true,
};

const preByPhase = {
  match_id: 'PRE-PHASE',
  nba_phase: 'preseason',
  status: 'settled',
  motor_was_right: true,
};

const regular = {
  match_id: 'REG',
  event_type: 'REGULAR',
  season_type: 2,
  nba_phase: 'regular',
  status: 'settled',
  motor_was_right: false,
  logged_at: '2026-10-20T23:00:00Z',
  confidence_level: 'MEDIUM',
  data_quality: 0.75,
  betting_recommendations: { recommendations: [], best: null },
};

const legacy = {
  match_id: 'LEGACY',
  status: 'settled',
  motor_was_right: true,
  logged_at: '2026-05-01T23:00:00Z',
  confidence_level: 'MEDIUM',
  data_quality: 0.75,
  betting_recommendations: { recommendations: [], best: null },
};

const missed = {
  match_id: 'MISSED',
  event_type: 'REGULAR',
  season_type: 2,
  status: 'missed_by_cron',
  motor_was_right: null,
};

// Détection robuste de la preseason.
eq('preseason · event_type', backend._isNBAPreseasonLog(preByType), true);
eq('preseason · season_type', backend._isNBAPreseasonLog(preBySeason), true);
eq('preseason · nba_phase fallback', backend._isNBAPreseasonLog(preByPhase), true);
eq('preseason · regular false', backend._isNBAPreseasonLog(regular), false);

// Eligibilité stats NBA.
eq('eligible · preseason false', backend._isNBAStatsEligibleLog(preByType), false);
eq('eligible · missed false', backend._isNBAStatsEligibleLog(missed), false);
eq('eligible · regular true', backend._isNBAStatsEligibleLog(regular), true);
eq('eligible · legacy true', backend._isNBAStatsEligibleLog(legacy), true);

// Monitoring : la victoire preseason ne doit PAS améliorer artificiellement le hit rate.
const preForMonitoring = {
  ...preByType,
  logged_at: '2026-10-03T23:00:00Z',
  confidence_level: 'HIGH',
  data_quality: 0.80,
  betting_recommendations: { recommendations: [], best: null },
};

const summary = summarizeSport([preForMonitoring, regular, legacy], 'NBA');
eq('monitoring · total_analyzed exclut preseason', summary.total_analyzed, 2);
eq('monitoring · total_settled exclut preseason', summary.total_settled, 2);
eq('monitoring · hit_rate regular+legacy = 50%', summary.hit_rate, 50);
eq('monitoring · preseason_excluded_count', summary.preseason_excluded_count, 1);
eq('monitoring · stats_excluded_count inclut preseason', summary.stats_excluded_count, 1);
eq('monitoring · status exclusions séparées', summary.status_excluded_count, 0);

// Si un log est à la fois preseason et statut exclu, il ne doit compter qu'une fois.
const preMissed = { ...preForMonitoring, status: 'missed_by_cron', motor_was_right: null };
const dedup = summarizeSport([preMissed, regular], 'NBA');
eq('monitoring · overlap exclu une seule fois', dedup.stats_excluded_count, 1);
eq('monitoring · overlap attribué au statut', dedup.status_excluded_count, 1);
eq('monitoring · overlap preseason additionnelle = 0', dedup.preseason_excluded_count, 0);

console.log('\nNBA preseason isolation');
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\nÉchecs :');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('  ✓ preseason visible mais exclue des métriques regular/postseason\n');
process.exit(0);
