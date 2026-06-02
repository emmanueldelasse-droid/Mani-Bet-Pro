# Mani Bet Pro · état courant

## Branche active
`main` · auto-deploy CF/GH Pages (build f9cd992)

## En cours
[P2] Fix #5 (optionnel) · cause amont du raté pré-match NBA · NON démarré
- symptôme · `bot_last_run` absente du KV (cron NBA pré-match `_runBotCron` n'écrit plus depuis >30h) alors que le nightly est vivant
- pistes · date Paris vs slate US (`_botFormatDate` Paris vs `?dates=` ESPN US) · fenêtre 2h + run unique/jour (`BOT_RUN_KEY`) · filtre `already_final`
- à arbitrer APRÈS observation d'1-2 nightly post-Fix#4 (les finales doivent réapparaître en `missed_by_cron`)
- décision Fix #5 seulement si on veut l'analyse pré-match réelle des finales (pas juste le rattrapage)

## Validation post-Fix#4 (à faire · prochain nightly ~10-11h UTC)
- vérifier que les matchs playoffs manquants réapparaissent en `missed_by_cron` dans `/bot/logs`
- `curl /bot/logs | jq '.stats.status_breakdown'` → `missed_by_cron` doit augmenter
- `[NIGHTLY SETTLE]` doit contenir `nba_recover: [...]` avec `missed_added > 0`

## Incident Playoff Gate · CLÔTURÉ (2026-06-02)
Cause #3 confirmée via curl prod · `401873197` = `missed_by_cron` (motor_prob null · motor_was_right null · pas de confidence_level). Hypothèse cause #3 validée · aucun audit data-quality nécessaire.

Quatre causes traitées et mergées :
- **Fix #4** · recovery auto dans `_runNightlySettle` (`recoverMissedGames` NBA J-1..J-3) · MERGÉ PR #215 (c221c28) · cron vivant confirmé KV `bot_nightly_settle_last_run=20260602`

Trois causes traitées et mergées :
- **Fix #1** · ESPN-null dans `_mergeInjuryReports` · MERGÉ PR #211 (094ad5b)
- **Fix #2** · `absences_confirmed` aligné front↔backend par équipe · MERGÉ PR #212 (c593e69)
- **Fix #3** · mapping statuts logs UI (`missed_by_cron`…) badge dédié · MERGÉ PR #213 (5e3673b)

Synthèse cause #3 · le Bot tab lit `/bot/logs` en direct (pas `mbp_store` · clé réelle `mbp_state`) · `_renderLogCard` ignorait `log.status` → un log `missed_by_cron` s'affichait « INCONCLUSIVE · En attente ». Désormais badge « Match raté (cron) · exclu stats » + exclusion du filtre pending (`src/ui/ui.bot.js`). Aucun impact scoring/gate/calibration/backend.

Validation prod post-déploiement (créateur · non exécutable en session · réseau bloqué) ·
- purge cache navigateur + reload
- `401873197` ne doit plus afficher « INCONCLUSIVE · EN ATTENTE »
- doit afficher le badge « Match raté (cron) · Exclu stats »

[P1] Fix Playoff Gate absences_confirmed front/back · MBP-PLAYOFF-GATE-FIX #2 · MERGÉ PR #212 (c593e69)
- alignement frontend/backend de `absences_confirmed` (`src/orchestration/data.orchestrator.js` · `buildRawData`)
- définition par équipe : `homeInjuries || awayInjuries` (au lieu du booléen global `injuryReport !== null`)
- Playoff Gate / scoring / calibration inchangés · test `scripts/test-absences-confirmed-front.mjs` · 9 assertions

[P1] Fix Playoff Gate ESPN-null · MBP-PLAYOFF-GATE-FIX #1 · MERGÉ PR #211 (094ad5b)
- correction `_mergeInjuryReports` · données IA utilisées lorsque ESPN absent
- Playoff Gate / scoring / calibration inchangés · test `scripts/test-merge-injury-reports.mjs` · 17 assertions

MBP-AUDIT-MLB-REAL-LOGS · outillage audit empirique 421 logs MLB
- branche · `claude/audit-mlb-real-logs`
- script · `scripts/audit-mlb-logs.mjs` + lib · `scripts/lib/audit-mlb-summary.mjs`
- tests · `scripts/test-audit-mlb-logs.mjs` · 123 assertions
- doc · `docs/monitoring/MLB_AUDIT_GUIDE.md`
- aucun changement moteur · aucune désactivation · uniquement outil read-only
- prochaine étape · créateur exécute audit sur dump réel · ChatGPT review formelle DECISION-003

MBP-NBA-PLAYOFF-GATE-LOG · Option A · observabilité pure
- branche · `claude/manibetpro-nba-audit-ks7cN`
- ADR · `docs/decisions/DECISION-005-NBA-PLAYOFF-GATE.md`
- 6 patches non-comportementaux · 0 changement métier · 0 changement calibration
- fichiers · `src/engine/engine.nba.js` · `src/orchestration/data.orchestrator.js` · `src/ui/ui.match-detail.helpers.js` · `worker.js`
- tests · `scripts/test-nba-playoff-gate.mjs` · 21 assertions · 0 fail
- parité backend↔frontend · `test-nba-engine-parity.mjs` · 492 passed · 0 régression
- 6 autres suites · 0 régression · cumul 902 assertions / 0 fail
- grep prod après merge · `NBA_PLAYOFF_GATE_BLOCKED` · `NBA_MATCH_REJECTED_FOR_HISTORY` · `INJURIES_EMPTY_BOTH_SOURCES` · `playoff_gate_blocked` dans `[BOT-CRON-LOG]`
- prochaine étape · ChatGPT review formelle PR · validation créateur · monitoring prod 24h sur cas OKC vs SAS 18/05/2026

## Derniers PR mergés
- #215 · Playoff Gate Fix #4 · recovery auto NBA dans nightly settle (c221c28)
- #214 · docs · clôture incident Playoff Gate Fix #1/#2/#3 (e41ce43)
- #213 · Playoff Gate Fix #3 · badge statuts logs recovery UI (5e3673b)
- #212 · Playoff Gate Fix #2 · absences_confirmed front↔backend par équipe (c593e69)
- #211 · Playoff Gate Fix #1 · `_mergeInjuryReports` ESPN-null utilise l'IA (094ad5b)
- #205 · MBP-CATCHUP-SETTLE · settlement + recovery + protection stats (commit efc8730)
- #198 · MBP-monitoring · rapport read-only
- #197 · MBP-P1 · gate data_quality
- #196 · NBA engine parity test (492 assertions)

## TODO prioritaire
- [ ] P1 · DECISION-003 MLB v6.94 · audit empirique 421 logs · validation créateur (proposed)
- [ ] P1 · validation prod endpoints catchup PR #205 · 4 curl tests documentés `docs/monitoring/CATCHUP_SETTLE.md`
- [ ] P1 · debug OKC vs SAS 18/05/2026 via `/bot/recover-missed?sport=NBA&date=20260518` (post-Option A · grep CF `NBA_PLAYOFF_GATE_BLOCKED`)
- [ ] P1 · ChatGPT review + merge PR DECISION-005 NBA playoff gate observabilité
- [x] P1 · gouvernance projet · `GOVERNANCE.md` créé
- [x] P1 · gouvernance projet · `BOT_OBJECTIVE.md` créé
- [x] P1 · gouvernance projet · `PROJECT_RULES.md` créé
- [x] P1 · `CLAUDE.md` réordonné
- [x] P1 · ordre lecture officiel ·
  - `GOVERNANCE.md`
  - `BOT_OBJECTIVE.md`
  - `PROJECT_RULES.md`
  - fichiers spécialisés nécessaires
  - `SESSION.md`
- [ ] P2 · NBA recheck calib à 80+ logs (actuel 53 v6.79)
- [ ] P2 · Tennis `/bot/calibration/analyze?sport=tennis` post 50+ logs v6.95+
- [ ] P2 · logger `pitcher_data_source` MLB · `engine_version` global · `closing_odds`
- [ ] P2 · Option B NBA playoff gate · état dégradé visible UI (badge "Données blessures non confirmées") · ADR séparée requise · à arbitrer ChatGPT post-Option A
- [ ] P2 · Option C NBA playoff gate · alignement architectural front/back (MBP-A.2 CRIT-1 toujours ouvert) · ADR séparée requise
- [ ] P3 · supprimer code mort (5 vars NBA orphelines · `engine.mlb.betting.js` · `NBA_INJURY_BASE` · `MLB_PITCHER_KV_KEY`)

## Documentation
- Gouvernance racine · `GOVERNANCE.md` · `BOT_OBJECTIVE.md` · `PROJECT_RULES.md` (pointeurs · ordre lecture officiel via `CLAUDE.md`)
- Vision & règles · `docs/project/` (PROJECT_VISION · ARCHITECTURE · AI_WORKFLOW · MERGE_PROTOCOL · STATS_RULES · PROD_SAFETY_RULES · CALIBRATION_RULES · EXPERIMENTAL_FEATURES)
- Moteur · `docs/engine/` (BETTING_LOGIC · DATA_PIPELINE)
- Monitoring · `docs/monitoring/` (KNOWN_ISSUES · PROVIDERS_MATRIX · ROUTES_AUDIT · BOT_MONITORING · CATCHUP_SETTLE)
- Décisions ADR · `docs/decisions/` (001 sécu · 002 NBA parity · 003 MLB proposed · 004 catchup · 005 NBA playoff gate observabilité)
- Tests · `docs/tests/NBA_ENGINE_PARITY.md`

## Tests automatisés · 958 assertions · 0 fail
`scripts/test-{nba-engine-parity,nba-playoff-gate,data-quality-gate,bot-monitoring-summary,bot-bet-classifier,tennis-best-bets-summary,catchup-settle,audit-mlb-logs,merge-injury-reports,absences-confirmed-front,bot-log-status-ui,nightly-recover}.mjs`
