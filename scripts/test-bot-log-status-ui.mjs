#!/usr/bin/env node
/**
 * MBP-PLAYOFF-GATE-FIX (Fix #3 · mapping statuts logs · affichage) · tests
 * de `_frontLogStatus`, `_filterLogs`, `_renderLogCard` (src/ui/ui.bot.js).
 *
 * Bug corrigé : un log `missed_by_cron` (motor_prob=null, motor_was_right=null,
 * pas de confidence_level) était rendu « INCONCLUSIVE · En attente » car
 * `_renderLogCard` ignorait `log.status`. Désormais : badge dédié + exclu du
 * filtre pending. Aucun impact scoring / gate / calibration / backend.
 *
 * Cas couverts :
 *   - _frontLogStatus : status explicite, fallback pending/settled
 *   - _filterLogs pending : exclut missed_by_cron, garde un vrai pending
 *   - _renderLogCard(missed) : badge « Match raté (cron) », PAS « En attente »,
 *     PAS de badge INCONCLUSIVE
 *   - _renderLogCard(pending réel) : « En attente » présent
 *   - _renderLogCard(settled) : « Correct »
 *
 * Strictement read-only sur la stack métier · pas de réseau · pas de secret.
 * Lancement · `node scripts/test-bot-log-status-ui.mjs`  · Exit 0 OK · 1 sinon.
 */

import './lib/dom-stub.mjs';
import { _frontLogStatus, _filterLogs, _renderLogCard } from '../src/ui/ui.bot.js';

let pass = 0, fail = 0;
const failures = [];
const check = (label, cond) => { if (cond) pass++; else { fail++; failures.push(label); } };

// ── Fixtures ────────────────────────────────────────────────────────────────
const MISSED = {
  match_id: '401873197', status: 'missed_by_cron',
  home: 'Oklahoma City Thunder', away: 'San Antonio Spurs', date: '20260518',
  motor_prob: null, motor_was_right: null, best_edge: null, best_side: null,
  betting_recommendations: null, variables_used: null, signals: null,
};
const PENDING = {
  match_id: '999', home: 'Boston Celtics', away: 'Miami Heat', date: '20260520',
  nba_phase: 'playoff', confidence_level: 'HIGH', motor_prob: 64,
  motor_was_right: null, signals: [], betting_recommendations: null,
};
const SETTLED = {
  match_id: '998', home: 'Denver Nuggets', away: 'LA Lakers', date: '20260515',
  confidence_level: 'MEDIUM', motor_prob: 58, motor_was_right: true,
  signals: [], betting_recommendations: null,
  result_home_score: 110, result_away_score: 100, result_winner: 'HOME',
};
const POSTPONED = { match_id: '997', status: 'postponed', home: 'A', away: 'B', date: '20260519', motor_was_right: null };
const LEGACY_SETTLED = { match_id: '996', home: 'C', away: 'D', date: '20260510', motor_was_right: false }; // pas de status

// ── _frontLogStatus ───────────────────────────────────────────────────────
check('frontLogStatus · status explicite missed_by_cron', _frontLogStatus(MISSED) === 'missed_by_cron');
check('frontLogStatus · fallback pending (motor_was_right null, pas de status)', _frontLogStatus(PENDING) === 'pending');
check('frontLogStatus · fallback settled (motor_was_right défini, pas de status)', _frontLogStatus(LEGACY_SETTLED) === 'settled');
check('frontLogStatus · null safe', _frontLogStatus(null) === null);

// ── _filterLogs ─────────────────────────────────────────────────────────────
const ALL = [MISSED, PENDING, SETTLED, POSTPONED];
{
  const pend = _filterLogs(ALL, 'pending');
  check('filterLogs pending · exclut missed_by_cron', !pend.includes(MISSED));
  check('filterLogs pending · exclut postponed', !pend.includes(POSTPONED));
  check('filterLogs pending · garde le vrai pending', pend.includes(PENDING));
  check('filterLogs pending · n\'inclut pas settled', !pend.includes(SETTLED));
}
{
  const all = _filterLogs(ALL, 'all');
  check('filterLogs all · inclut TOUT (missed compris)', all.length === ALL.length && all.includes(MISSED));
}

// ── _renderLogCard ──────────────────────────────────────────────────────────
{
  const html = _renderLogCard(MISSED);
  check('renderLogCard missed · badge dédié présent', html.includes('Match raté (cron)'));
  check('renderLogCard missed · classe bot-badge--excluded', html.includes('bot-badge--excluded'));
  check('renderLogCard missed · PAS de « En attente »', !html.includes('En attente'));
  check('renderLogCard missed · PAS de badge INCONCLUSIVE', !html.includes('bot-badge--inconc'));
  check('renderLogCard missed · matchup affiché', html.includes('San Antonio Spurs') && html.includes('Oklahoma City Thunder'));
}
{
  const html = _renderLogCard(PENDING);
  check('renderLogCard pending réel · « En attente » présent', html.includes('En attente'));
  check('renderLogCard pending réel · pas de badge excluded', !html.includes('bot-badge--excluded'));
}
{
  const html = _renderLogCard(SETTLED);
  check('renderLogCard settled · « Correct » présent', html.includes('Correct'));
  check('renderLogCard settled · pas de badge excluded', !html.includes('bot-badge--excluded'));
}
{
  const html = _renderLogCard(POSTPONED);
  check('renderLogCard postponed · badge « Reporté »', html.includes('Reporté'));
  check('renderLogCard postponed · PAS « En attente »', !html.includes('En attente'));
}

// ── Bilan ─────────────────────────────────────────────────────────────────
console.log(`\nui.bot.js · Fix #3 mapping statuts logs`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail > 0) {
  console.log('\n  Échecs :');
  failures.forEach(f => console.log(`   ✗ ${f}`));
  process.exit(1);
}
console.log('  ✓ tous les cas OK\n');
process.exit(0);
