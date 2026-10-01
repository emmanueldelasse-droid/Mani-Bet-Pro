# Mani Bet Pro · état courant

## Branche active
`main` · auto-deploy CF/GH Pages (build `646846f`)

## En cours
[P1] Pré-saison NBA 2026-27 · validation runtime PR #241 · DRAFT
- branche · `fix/nba-prime-time-slate-date-clean-20261001`
- objectif · découvrir les matchs ESPN classés date US veille alors que Paris est déjà au lendemain
- correction isolée · fetch date Paris + date calendrier précédente · fusion · dédup ESPN `match_id`
- aucun changement scoring · gate · calibration · confidence · odds · injuries
- CI 01/10 · 36 suites régression · 0 fail · test prime-time 12 assertions · health 46 assertions
- merge BLOQUÉ jusqu'à preuve runtime réelle
- cible prioritaire · Miami Heat vs Toronto Raptors · 03/10/2026 23:00 UTC = 04/10 01:00 Paris
- preuve forte · run horaire 22:00 UTC doit exécuter H1 alors que date Paris=20261004 et slate ESPN=20261003
- vérifier · `fetch_dates` 20261004+20261003 · PRESEASON · season_type=1 · datetime exact · un seul H1 · heartbeat frais · aucune contamination stats regular

[P1] Observabilité NBA 2026-27 · MERGÉE
- PR #242 · `engine_version=nba-2026.10.01-baseline` + `analysis_schema_version=nba-analysis-v1`
- PR #243 · `recent_form_ema` legacy vs decay-lambda en shadow · `drives_decision=false`
- PR #244 · échelle B2B backend ±0.6 vs frontend ±1 en shadow · `drives_decision=false`
- PR #245 · Data Quality pondérée appliquée au gate/confidence en shadow · seuil prod 0.55 inchangé · `drives_decision=false`
- historique shadow persisté KV/CSV · migrations D1 0005→0008 prêtes
- D1 `MANI_HISTORY_DB` reste optionnel et non déclaré dans `wrangler.jsonc` tant que DB réelle non provisionnée

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
- #245 · weighted Data Quality decision shadow · non décisionnel
- #244 · back-to-back scale shadow · non décisionnel
- #243 · recent-form EMA decay shadow · non décisionnel
- #242 · versionnage moteur/analyse NBA
- #240 · D1 outcomes canoniques par match
- #239 · spread shadow parity backend
- #238 · meilleur prix exécution spread/total même ligne
- #237 · meilleur prix exécution moneyline
- #236 · health opérationnel NBA
- #235 · closing line pré-tip vérifiée · CLV
- #234 · checkpoints NBA H6/H4/H2/H1 par match
- #233 · historique NBA D1 append-only optionnel
- #232 · `season_id` canonique NBA
- #231 · Data Quality pondérée observabilité
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
- [ ] P1 · 03/10 pré-saison · preuve runtime PR #241 sur H1 Miami–Toronto · aucun merge avant preuve
- [ ] P1 · après preuve #241 · review finale ChatGPT · merge squash uniquement si runtime conforme + MEMORY FILES UPDATED
- [ ] P1 · provisionner D1 `MANI_HISTORY_DB` séparément seulement avec UUID Cloudflare réel · appliquer migrations 0001→0008 · valider KV↔D1 sur pré-saison
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

## Tests automatisés
- workflow `.github/workflows/regression-tests.yml` · auto-découverte `scripts/test-*.mjs`
- validation PR #241 · 01/10/2026 · **36 suites · 0 fail**
- couvre notamment · parité moteur NBA · checkpoints · closing line · D1 · season/event classification · pré-saison · prime-time dual-slate · shadows EMA/B2B/DQ/spread · settlement · health · sécurité marchés props/parlay
