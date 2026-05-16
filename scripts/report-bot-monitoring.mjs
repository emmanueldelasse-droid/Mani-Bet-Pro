#!/usr/bin/env node
/**
 * MBP monitoring · rapport CLI read-only.
 *
 * Aucun moteur · aucune calibration · aucun provider externe (Tank01 ·
 * ESPN · TheOddsAPI · Claude · Telegram non touchés). Aucune écriture KV.
 *
 * Source de données · au choix ·
 *   --url <worker_origin>  · récupère via les 3 routes publiques GET ·
 *                            /bot/logs · /mlb/bot/logs · /tennis/bot/logs
 *   --fixture <path.json>  · lit un dump JSON local au format
 *                            { NBA: [...], MLB: [...], TENNIS: [...] }
 *   --demo                 · utilise les fixtures embarquées (testing/présentation)
 *
 * Par défaut · si aucune option · `--demo`.
 *
 * Lancement ·
 *   node scripts/report-bot-monitoring.mjs --demo
 *   node scripts/report-bot-monitoring.mjs --url https://manibetpro.emmanueldelasse.workers.dev
 *   node scripts/report-bot-monitoring.mjs --fixture ./bot-logs-export.json
 *
 * Exit · 0 OK · 1 erreur fetch/lecture.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { summarize, formatReport } from './lib/monitoring-summary.mjs';
import { DEMO_LOGS_BY_SPORT } from './lib/monitoring-fixtures.mjs';

function parseArgs(argv) {
  const opts = { mode: 'demo', url: null, fixture: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo')        opts.mode = 'demo';
    else if (a === '--url')    { opts.mode = 'url';     opts.url     = argv[++i]; }
    else if (a === '--fixture'){ opts.mode = 'fixture'; opts.fixture = argv[++i]; }
    else if (a === '--help' || a === '-h') { opts.mode = 'help'; }
  }
  return opts;
}

function printHelp() {
  console.log('Usage · node scripts/report-bot-monitoring.mjs [option]');
  console.log('');
  console.log('Options ·');
  console.log('  --demo                  Utilise les fixtures embarquées (par défaut)');
  console.log('  --url <worker_origin>   Récupère les logs via les 3 routes publiques GET');
  console.log('  --fixture <path.json>   Lit un dump JSON local { NBA, MLB, TENNIS }');
  console.log('  --help                  Affiche cette aide');
}

async function loadFromUrl(origin) {
  // 3 fetches parallèles · timeout 30s par défaut · pas de retry exotique.
  const endpoints = {
    NBA:    `${origin}/bot/logs`,
    MLB:    `${origin}/mlb/bot/logs`,
    TENNIS: `${origin}/tennis/bot/logs`,
  };
  const out = {};
  await Promise.all(Object.entries(endpoints).map(async ([sport, url]) => {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!resp.ok) {
        console.warn(`[WARN] ${sport} · HTTP ${resp.status} sur ${url}`);
        out[sport] = [];
        return;
      }
      const data = await resp.json();
      out[sport] = Array.isArray(data?.logs) ? data.logs : [];
    } catch (err) {
      console.warn(`[WARN] ${sport} · fetch error · ${err.message}`);
      out[sport] = [];
    }
  }));
  return out;
}

function loadFromFixture(path) {
  const abs  = resolve(process.cwd(), path);
  const raw  = readFileSync(abs, 'utf8');
  const data = JSON.parse(raw);
  return {
    NBA:    Array.isArray(data?.NBA)    ? data.NBA    : [],
    MLB:    Array.isArray(data?.MLB)    ? data.MLB    : [],
    TENNIS: Array.isArray(data?.TENNIS) ? data.TENNIS : [],
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.mode === 'help') { printHelp(); process.exit(0); }

  let logsBySport;
  try {
    if (opts.mode === 'demo') {
      console.log('[INFO] Mode demo · fixtures embarquées (scripts/lib/monitoring-fixtures.mjs)');
      console.log('');
      logsBySport = DEMO_LOGS_BY_SPORT;
    } else if (opts.mode === 'url') {
      if (!opts.url) { console.error('[ERROR] --url manquant'); process.exit(1); }
      console.log(`[INFO] Mode url · fetch depuis ${opts.url}`);
      console.log('');
      logsBySport = await loadFromUrl(opts.url);
    } else if (opts.mode === 'fixture') {
      if (!opts.fixture) { console.error('[ERROR] --fixture manquant'); process.exit(1); }
      console.log(`[INFO] Mode fixture · lecture ${opts.fixture}`);
      console.log('');
      logsBySport = loadFromFixture(opts.fixture);
    }
  } catch (err) {
    console.error(`[ERROR] chargement données · ${err.message}`);
    process.exit(1);
  }

  const summary = summarize(logsBySport);
  console.log(formatReport(summary));
  process.exit(0);
}

main();
