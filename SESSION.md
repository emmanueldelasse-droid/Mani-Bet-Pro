# Mani Bet Pro · état courant

## Branche active
`main` · auto-deploy CF/GH Pages (build f9cd992)

## En cours
MBP-AUDIT-MLB-REAL-LOGS · outillage audit empirique 421 logs MLB
- branche · `claude/audit-mlb-real-logs`
- script · `scripts/audit-mlb-logs.mjs` + lib · `scripts/lib/audit-mlb-summary.mjs`
- tests · `scripts/test-audit-mlb-logs.mjs` · 123 assertions
- doc · `docs/monitoring/MLB_AUDIT_GUIDE.md`
- aucun changement moteur · aucune désactivation · uniquement outil read-only
- prochaine étape · créateur exécute audit sur dump réel · ChatGPT review formelle DECISION-003

## Derniers PR mergés
- #205 · MBP-CATCHUP-SETTLE · settlement + recovery + protection stats (commit efc8730)
- #198 · MBP-monitoring · rapport read-only
- #197 · MBP-P1 · gate data_quality
- #196 · NBA engine parity test (492 assertions)

## TODO prioritaire
- [ ] P1 · DECISION-003 MLB v6.94 · audit empirique 421 logs · validation créateur (proposed)
- [ ] P1 · validation prod endpoints catchup PR #205 · 4 curl tests documentés `docs/monitoring/CATCHUP_SETTLE.md`
- [ ] P1 · debug OKC vs SAS 18/05/2026 via `/bot/recover-missed?sport=NBA&date=20260518`
- [ ] P2 · NBA recheck calib à 80+ logs (actuel 53 v6.79)
- [ ] P2 · Tennis `/bot/calibration/analyze?sport=tennis` post 50+ logs v6.95+
- [ ] P2 · logger `pitcher_data_source` MLB · `engine_version` global · `closing_odds`
- [ ] P3 · supprimer code mort (5 vars NBA orphelines · `engine.mlb.betting.js` · `NBA_INJURY_BASE` · `MLB_PITCHER_KV_KEY`)

## Documentation
- Vision & règles · `docs/project/` (PROJECT_VISION · ARCHITECTURE · AI_WORKFLOW · MERGE_PROTOCOL · STATS_RULES · PROD_SAFETY_RULES · CALIBRATION_RULES · EXPERIMENTAL_FEATURES)
- Moteur · `docs/engine/` (BETTING_LOGIC · DATA_PIPELINE)
- Monitoring · `docs/monitoring/` (KNOWN_ISSUES · PROVIDERS_MATRIX · ROUTES_AUDIT · BOT_MONITORING · CATCHUP_SETTLE)
- Décisions ADR · `docs/decisions/` (001 sécu · 002 NBA parity · 003 MLB proposed · 004 catchup)
- Tests · `docs/tests/NBA_ENGINE_PARITY.md`

## Tests automatisés · 750 assertions · 0 fail
`scripts/test-{nba-engine-parity,data-quality-gate,bot-monitoring-summary,bot-bet-classifier,tennis-best-bets-summary,catchup-settle}.mjs`
