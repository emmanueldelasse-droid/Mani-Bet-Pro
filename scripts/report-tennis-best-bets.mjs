#!/usr/bin/env node
/**
 * MBP · rapport tennis best bets · CLI read-only.
 *
 * Mesure UNIQUEMENT les vrais best bets tennis (best_side OU best non null).
 * Exclut value ideas et no_bet du hit rate.
 *
 * Aucun moteur · backend · cron · provider externe · KV touché.
 *
 * Source ·
 *   --url <worker_origin>  · GET /tennis/bot/logs[?date=YYYYMMDD]
 *   --fixture <path.json>  · lecture locale { logs: [...] } OU array direct
 *   --demo                 · fixtures embarquées (mini-démo)
 *
 * Filtrage optionnel ·
 *   --date YYYYMMDD        · filtre logs par date
 *
 * Lancement ·
 *   node scripts/report-tennis-best-bets.mjs --demo
 *   node scripts/report-tennis-best-bets.mjs --url https://manibetpro.emmanueldelasse.workers.dev
 *   node scripts/report-tennis-best-bets.mjs --url https://... --date 20260517
 *   node scripts/report-tennis-best-bets.mjs --fixture ./tennis-logs.json
 *
 * Exit · 0 OK · 1 erreur fetch ou rapport incomplet.
 */

import { readFileSync } from 'node:fs';
import { resolve }      from 'node:path';
import {
  summarizeTennisBestBets,
  formatTennisBestBetsReport,
} from './lib/tennis-best-bets-summary.mjs';

// ── Fixtures démo minimales · juste pour valider la chaîne sans réseau ────
const DEMO_LOGS = [
  // Best bet HOME settled win
  { match_id: 'DEMO-1', date: '20260517', p1: 'Diane Parry', p2: 'Emma Raducanu',
    tournament: 'Internationaux de Strasbourg', surface: 'Clay',
    motor_prob: 62, confidence_level: 'MEDIUM', data_quality: 0.78,
    best_side: 'HOME', best_edge: 8,
    betting_recommendations: {
      best: { type: 'MONEYLINE', side: 'HOME', edge: 8, odds_decimal: 1.95, motor_prob: 62, kelly_stake: 0.012, is_contrarian: false },
      recommendations: [{ type: 'MONEYLINE', side: 'HOME', edge: 8, odds_decimal: 1.95, motor_prob: 62, is_contrarian: false }],
    },
    result_winner: 'HOME', motor_was_right: true, settled_at: '2026-05-17T20:00:00Z' },
  // Best bet AWAY settled loss
  { match_id: 'DEMO-2', date: '20260517', p1: 'Miomir Kecmanovic', p2: 'Karen Khachanov',
    tournament: 'Bitpanda Hamburg Open', surface: 'Clay',
    motor_prob: 42, confidence_level: 'MEDIUM', data_quality: 0.72,
    best_side: 'AWAY', best_edge: 7,
    betting_recommendations: {
      best: { type: 'MONEYLINE', side: 'AWAY', edge: 7, odds_decimal: 2.10, motor_prob: 58, kelly_stake: 0.008, is_contrarian: false },
      recommendations: [{ type: 'MONEYLINE', side: 'AWAY', edge: 7, odds_decimal: 2.10, motor_prob: 58, is_contrarian: false }],
    },
    result_winner: 'HOME', motor_was_right: true, settled_at: '2026-05-17T20:00:00Z' },
  // Value idea contrarian · NON comptée dans hit rate
  { match_id: 'DEMO-3', date: '20260517', p1: 'Madison Keys', p2: 'Cristina Bucsa',
    tournament: 'Internationaux de Strasbourg', surface: 'Clay',
    motor_prob: 72, confidence_level: 'LOW', data_quality: 0.62,
    best_side: null, best_edge: null,
    betting_recommendations: {
      best: null,
      recommendations: [{ type: 'MONEYLINE', side: 'AWAY', edge: 6, odds_decimal: 4.50, motor_prob: 28, is_contrarian: true }],
    },
    result_winner: 'HOME', motor_was_right: true, settled_at: '2026-05-17T20:00:00Z' },
  // No bet · INCONCLUSIVE
  { match_id: 'DEMO-4', date: '20260517', p1: 'Player A', p2: 'Player B',
    tournament: 'Bitpanda Hamburg Open', surface: 'Clay',
    motor_prob: 50, confidence_level: 'INCONCLUSIVE', data_quality: 0.45,
    best_side: null, best_edge: null,
    betting_recommendations: null,
    result_winner: null, motor_was_right: null, settled_at: null },
];

function parseArgs(argv) {
  const opts = { mode: 'demo', url: null, fixture: null, date: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo')             opts.mode = 'demo';
    else if (a === '--url')         { opts.mode = 'url';     opts.url     = argv[++i]; }
    else if (a === '--fixture')     { opts.mode = 'fixture'; opts.fixture = argv[++i]; }
    else if (a === '--date')        opts.date = argv[++i];
    else if (a === '--help' || a === '-h') opts.mode = 'help';
  }
  return opts;
}

function printHelp() {
  console.log('Usage · node scripts/report-tennis-best-bets.mjs [options]');
  console.log('');
  console.log('Options ·');
  console.log('  --demo                    Fixtures embarquées (par défaut)');
  console.log('  --url <worker_origin>     Fetch GET /tennis/bot/logs');
  console.log('  --fixture <path.json>     Lit logs depuis { logs: [...] } ou array direct');
  console.log('  --date YYYYMMDD           Filtre par date (optionnel)');
  console.log('  --help                    Cette aide');
}

async function loadFromUrl(origin, dateFilter) {
  const qs = dateFilter ? `?date=${encodeURIComponent(dateFilter)}` : '';
  const url = `${origin}/tennis/bot/logs${qs}`;
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!resp.ok) {
      return { logs: [], error: `HTTP ${resp.status} sur ${url}` };
    }
    const data = await resp.json();
    if (!Array.isArray(data?.logs)) {
      return { logs: [], error: 'payload sans logs[] · format inattendu' };
    }
    return { logs: data.logs, error: null };
  } catch (err) {
    return { logs: [], error: `fetch error · ${err.message}` };
  }
}

function loadFromFixture(path) {
  const abs  = resolve(process.cwd(), path);
  const raw  = readFileSync(abs, 'utf8');
  const data = JSON.parse(raw);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.logs)) return data.logs;
  return [];
}

function filterByDate(logs, dateFilter) {
  if (!dateFilter) return logs;
  return logs.filter(l => {
    const d = String(l?.date ?? '').replace(/-/g, '');
    return d.startsWith(dateFilter.replace(/-/g, ''));
  });
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.mode === 'help') { printHelp(); process.exit(0); }

  let logs = [];
  let fetchError = null;
  try {
    if (opts.mode === 'demo') {
      console.log('[INFO] Mode demo · fixtures embarquées');
      console.log('');
      logs = DEMO_LOGS;
    } else if (opts.mode === 'url') {
      if (!opts.url) { console.error('[ERROR] --url manquant'); process.exit(1); }
      console.log(`[INFO] Mode url · fetch ${opts.url}/tennis/bot/logs${opts.date ? '?date=' + opts.date : ''}`);
      console.log('');
      const r = await loadFromUrl(opts.url, opts.date);
      logs = r.logs;
      fetchError = r.error;
    } else if (opts.mode === 'fixture') {
      if (!opts.fixture) { console.error('[ERROR] --fixture manquant'); process.exit(1); }
      console.log(`[INFO] Mode fixture · lecture ${opts.fixture}`);
      console.log('');
      logs = loadFromFixture(opts.fixture);
    }
  } catch (err) {
    console.error(`[ERROR] chargement · ${err.message}`);
    process.exit(1);
  }

  if (fetchError) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error(`[ERROR] RAPPORT INCOMPLET · /tennis/bot/logs en échec`);
    console.error(`  · ${fetchError}`);
    console.error('[ERROR] Ne pas baser de décision tennis sur ce rapport');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('');
  }

  logs = filterByDate(logs, opts.date);
  const summary = summarizeTennisBestBets(logs);
  console.log(formatTennisBestBetsReport(summary));
  process.exit(fetchError ? 1 : 0);
}

main();
