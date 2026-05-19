#!/usr/bin/env node
/**
 * MBP-AUDIT-MLB · CLI audit empirique MLB sur dump JSON logs
 *
 * Usage ·
 *   curl "$WORKER/mlb/bot/logs" > mlb-dump.json
 *   node scripts/audit-mlb-logs.mjs mlb-dump.json
 *   node scripts/audit-mlb-logs.mjs mlb-dump.json --json     # output JSON brut
 *   node scripts/audit-mlb-logs.mjs --stdin < mlb-dump.json
 *
 * Pure offline · aucun appel réseau · aucune dépendance externe.
 * Exclusions strictes · STATS_EXCLUDED_STATUSES (5 statuts) jamais comptés.
 * Conclusion auto selon STATS_RULES borne basse > 52.4% (juice 5%).
 *
 * Référence · docs/monitoring/MLB_AUDIT_GUIDE.md
 */

import { readFileSync } from 'node:fs';
import { argv, exit, stdin } from 'node:process';
import { auditMlbLogs, formatReport } from './lib/audit-mlb-summary.mjs';

function usage() {
  console.log(`Usage ·
  node scripts/audit-mlb-logs.mjs <path-to-mlb-dump.json>
  node scripts/audit-mlb-logs.mjs <path> --json
  node scripts/audit-mlb-logs.mjs --stdin
  node scripts/audit-mlb-logs.mjs --stdin --json

Input attendu (any of) ·
  - Array brut de logs · [{ status, motor_was_right, ... }, ...]
  - Objet wrapper · { logs: [...] }
  - Réponse complète /mlb/bot/logs · { available, logs, stats }

Voir docs/monitoring/MLB_AUDIT_GUIDE.md pour détails.`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage();
    exit(args.length === 0 ? 1 : 0);
  }

  const wantJson = args.includes('--json');
  const useStdin = args.includes('--stdin');
  const pathArg = args.find(a => !a.startsWith('--')) ?? null;

  let raw;
  try {
    if (useStdin) {
      raw = await readStdin();
    } else if (pathArg) {
      raw = readFileSync(pathArg, 'utf8');
    } else {
      console.error('Erreur · ni --stdin ni chemin fourni');
      usage();
      exit(1);
    }
  } catch (err) {
    console.error(`Erreur lecture · ${err.message}`);
    exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Erreur parse JSON · ${err.message}`);
    exit(3);
  }

  let summary;
  try {
    summary = auditMlbLogs(parsed);
  } catch (err) {
    console.error(`Erreur audit · ${err.message}`);
    console.error(err.stack);
    exit(4);
  }

  if (wantJson) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatReport(summary));
  }

  // Exit code reflète la conclusion (utile pour CI / scripts)
  const v = summary.conclusion?.verdict;
  if (v === 'DESACTIVATION_RECOMMANDEE') exit(10);
  if (v === 'SAMPLE_INSUFFISANT')        exit(11);
  if (v === 'EDGE_NON_DEMONTRE')         exit(12);
  if (v === 'MONITORING_RECOMMANDE')     exit(13);
  if (v === 'EDGE_DEMONTRE')             exit(0);
  exit(0);
}

main().catch(err => {
  console.error(`Fatal · ${err.message}`);
  exit(99);
});
