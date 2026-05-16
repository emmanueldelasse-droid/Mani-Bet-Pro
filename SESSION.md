# Mani Bet Pro

## Résumé projet
Moteur aide décision paris sportifs · NBA · MLB · Tennis · Cloudflare Worker + GitHub Pages.
Voir `BOT_OBJECTIVE.md` pour mission complète.

## Gouvernance
- **ChatGPT pilote** · audit · architecture · priorités · validation · stratégie
- **Claude exécutant** · code · tests · docs · PRs
- **User arbitre** · merge final · pas de merge sans GO ChatGPT explicite

## Lecture obligatoire chaque session
1. `SESSION.md` (ce fichier · point d'entrée)
2. `BOT_OBJECTIVE.md` · mission · règles absolues
3. `PROJECT_RULES.md` · workflow · interdictions Claude
4. `CLAUDE.md` · règles session
5. Selon tâche · `ARCHITECTURE.md` · `DATA_PIPELINE.md` · `BETTING_LOGIC.md` · `PROVIDERS_MATRIX.md` · `KNOWN_ISSUES.md` · `CHECKLIST_MERGE.md` · `ROUTES_AUDIT.md` · `SECURITY_AUDIT.md` · `NBA_ENGINE_AUDIT.md`
6. `.claude/onboarding.md` uniquement pour deploy/setup/reprise compte
7. `.claude/agents/alon.md` pour analyse calibration

## Règles update
Début → "En cours" 1/N · Fin étape → +1 · Merge → vider "En cours" · User future → TODO+prio.
Update SESSION.md seulement si impact critique. Update docs dédiées à chaque merge concerné.

## En cours
- MBP-P1 · gate `data_quality` faible · v2 post-review ChatGPT · 6 surfaces · backend NBA/Tennis (< 0.55 numérique) + backend MLB `_mlbEngineCompute` + `_mlbAnalyzeMatch` strikeouts (`=== 'LOW'`) + frontend EngineCore (NBA + legacy) + frontend MLB `_analyzeMLBMatch` (`=== 'LOW'`) · 44 assertions · parité NBA toujours OK · PR à valider

## État actuel
- Worker · `manibetpro.emmanueldelasse.workers.dev` · auto-deploy push main
- Front · GH Pages auto-deploy push main
- KV `PAPER_TRADING` · id `17eb7ddc41a949dd99bd840142832cfd`
- Cron `0 * * * *` · idempotent par sport · 10-11h UTC nightly-settle · 22h UTC AI props · lundi 7h UTC calibration
- worker.js · ~10600 lignes (vérifié MBP-A.1)
- 54 routes HTTP · 7 cron handlers · 10/13 providers actifs · 50+ clés KV
- `/health` version hardcodée `6.85.0` · à sync changelog (TODO P2)

### Sécurité (chantier MBP-A.4 clos)
- **6/6 critiques résolues** (CRIT-A à F) via MBP-S.1 · S.2 · S.2.1 · S.3 · S.4
- 3 systèmes auth en couches ·
  - `DEBUG_SECRET` query (5 routes NBA debug + `/debug/basketusa` + `/tennis/_espn_probe`)
  - `PAPER_API_KEY` header `X-API-Key` (4 routes `/paper/*`)
  - `BOT_RUN_API_KEY` header `X-Bot-Api-Key` (8 routes POST quota)
- Rate limit Claude per-IP (hash SHA-256 tronqué · cron exempté `'system'`)
- 14+ fuites `err.message` sanitisées via `SAFE_ERROR_MSG_*`
- CORS strict equality `includes` (plus de bug `startsWith`)
- Front Paper adapté · `PaperAuth` + `paperFetch` · UI Réglages
- Restent · HAUT-1 à 9 + MOY + FAI (P2/P3)

### Moteur NBA (chantier MBP-A.2)
- 2 moteurs distincts · backend cron logs + frontend runtime UI
- **CRIT-2 confidence aligné** · MBP-FIX-A.2.1 · frontend NBA distance-based identique backend
- **CRIT-3 home_away_split aligné** · MBP-FIX-A.2.2 · formule 4 vars clamp [-0.50, 0.50] identique backend
- CRIT-1 (2 moteurs) · structurel · stratégie validée garder + aligner progressivement
- MED-1 à 6 · pendant · `back_to_back` numérique · robustness backend · etc.
- FAI-1 à 6 · pendant · variables backend orphelines · nettoyage `ts_diff` `avg_pts_diff` morts

## Conventions
- Confidence · `HIGH/MEDIUM/LOW/INCONCLUSIVE` (jamais "Data quality" en UI)
- Cotes décimales européennes (jamais US)
- UI user-facing FR · helpers `_qualityFr` `_betTypeFr` `_fmtOdds` `_confidenceFr` `_interpretVariable` (ui.bot.js:1090-1215)
- Style .md · télégraphique FR · refs `file:line` · pas d'emoji
- Style chat user · vocabulaire simple · exemples concrets · pas de jargon brut

## TODO prioritaires

### P1 · critique
- [x] **MBP-A.2 CRIT-1** · test parité backend/frontend NBA en place (PR #196) · `node scripts/test-nba-engine-parity.mjs` · 492 assertions · doc `docs/tests/NBA_ENGINE_PARITY.md` · stratégie "garder les 2 moteurs" validée par ChatGPT · MED-1 b2b numérique signalé KNOWN
- [ ] Surveiller hit rate MLB v6.94 post 50 paris · si <52% désactiver bot (Option C)
- [ ] Surveiller hit rate tennis v6.93 post 50 paris · revert isolé si baisse
- [x] **MBP-P1** · Gate `data_quality` faible (PR #197 v2) · 6 surfaces ·
  - NBA/Tennis numérique `< 0.55` → INCONCLUSIVE (`_botComputeConfidence`, `_botTennisConfidence`, `EngineCore._computeConfidenceLevel`)
  - MLB label-based `=== 'LOW'` → `recommendations: []` + `best: null` (`_mlbEngineCompute`, `_mlbAnalyzeMatch` strikeouts, `_analyzeMLBMatch` orchestrator)
  - Tests · `node scripts/test-data-quality-gate.mjs` 44/44 · parité NBA 492/0 préservée

### P2 · important
- [ ] MBP-A.4 HAUT-1 · intégrer `ai.guard.js` jamais appelé (validation réponses Claude)
- [ ] MBP-A.4 HAUT-2 à 9 · validations body · CSP headers · race condition KV rate · `DEBUG_SECRET` URL→header · hallucinations Claude
- [ ] MBP-A.2 MED-1 · `back_to_back` numérique aligné backend
- [ ] MBP-A.2 MED-2 à 6 · robustness backend · pill UI seuil · penalty mort · Kelly EUR bankroll
- [ ] NBA recheck calib à 80+ logs (actuel 53 hit 67.9% v6.79 valide) · `travel_load` inversé n=22 ignoré
- [ ] `/bot/calibration/analyze?sport=tennis` après 30+ logs settlés v6.85+
- [ ] MBP-A.1 MED-1 · investiguer `ai_player_props_{date}` lu jamais écrit
- [ ] MBP-A.1 MED-4 · sync `/health` version (hardcodée `6.85.0` vs v7.01 actuel)

### P3 · long terme
- [ ] MBP-A.2 FAI-1 à 6 · supprimer 5 variables backend orphelines + 2 morts (`ts_diff` · `avg_pts_diff`)
- [ ] Calibrer `-4.5` playoff par round après 100+ logs · Alon 50+ logs
- [ ] Réactiver paris contrarian après 200+ logs · cotes≥3
- [ ] Réactiver api-tennis fixtures si compte payé · `env.TENNIS_API_FIXTURES_ENABLED=1`
- [ ] MBP-A.1 MED-5/6 · supprimer constantes mortes `MLB_PITCHER_KV_KEY` `NBA_INJURY_BASE`
- [ ] Option B · script test de parité backend ↔ frontend automatisé (anti-régression)

Détail dette technique · `KNOWN_ISSUES.md`

## Stack
- `worker.js` ~10600L · `wrangler.jsonc`
- `src/ui/match-detail.{js,teamdetail,tennis,helpers}` · dashboard · bot · history · settings
- `src/engine/engine.nba.{js,variables,score,betting}` · `engine.tennis.js` · `engine.robustness.js` · `engine.core.js`
- Pas de `engine.mlb.js` séparé · MLB inline worker.js
- `src/config/sports.config.js` · poids · seuils NBA/Tennis
- `src/utils/utils.odds.js` conversions cotes · `utils.paper-auth.js` clé Paper front
- `src/ai/` · client Claude · prompts · garde-fous (`ai.guard.js` non appelé · TODO P2)
- `src/paper/paper.engine.js` `paper.settler.js` · place + settle paper trading
- Détail · `ARCHITECTURE.md`

## Pièges récurrents (détail dans docs dédiées)
- Tank01 · `team.Roster` R maj · `statsToGet=averages` · cache 6-24h · `?bust=1`
- TheOddsAPI · `player_points` sans `bookmakers=` → 422 (worker.js:2450)
- MLB · `IP X.Y` = X innings + Y outs · `_mlbSeason()` dynamique · v6.94 garde-fou edge [5, 10]
- Tennis · Sackmann CSV lag 2-3j · api-tennis désactivé (cod=1006 non payé)
- Tennis · 9 vars · poids par phase (worker.js:9099 · sports.config.js:190)
- Timezone · `_botFormatDate` Intl · DST auto · nightly idempotent
- Sécu · `_denyIfNoDebugAuth()` fail-CLOSE (vérifié MBP-A.4) · regex params · `escapeHtml` innerHTML
- Front Paper · si clé absente → settler skip · toast info au boot
- Front Bot Run · pas d'UI · trigger uniquement cron ou outil admin avec `X-Bot-Api-Key`

## Secrets Cloudflare configurés
- `DEBUG_SECRET` · routes debug
- `PAPER_API_KEY` · routes `/paper/*` (MBP-S.2)
- `BOT_RUN_API_KEY` · routes bot run (MBP-S.3)
- `TANK01_API_KEY1..3,KEY` · rotation 4 clés
- `CLAUDE_API_KEY` · AI injuries + props
- `ODDS_API_KEY_1/2` · TheOddsAPI rotation
- `BALLDONTLIE_API_KEY` · recent form
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` · notifications
- `WEATHER_API_KEY` · météo MLB (optionnel)
- Gates · `PLAYER_PROPS_ENABLED` · `AI_PLAYER_PROPS_ENABLED` · `PINNACLE_DISABLED` · `TENNIS_API_FIXTURES_ENABLED`

## Deploy
- `git push origin main` → CF auto-deploy worker · GH Pages auto-deploy front
- Pas de staging · prod direct
- Surveillance · CF Dashboard observability + dashboard Mani Bet Pro

## Hors SESSION (docs dédiées)
- `BOT_OBJECTIVE.md` · mission · ce que le projet est · n'est pas · règles absolues
- `PROJECT_RULES.md` · workflow ChatGPT/Claude/user · interdictions · règles auth
- `CLAUDE.md` · règles session Claude · périmètre · style
- `ARCHITECTURE.md` · stack · modules · zones sensibles · 2 moteurs NBA
- `DATA_PIPELINE.md` · flux NBA/MLB/Tennis · caches KV · TTL · rate limits per-IP
- `BETTING_LOGIC.md` · confidence backend-canonique · variables · calibration
- `PROVIDERS_MATRIX.md` · 12 providers · clés · fallbacks · quotas
- `KNOWN_ISSUES.md` · bugs P1/P2/P3 · dette technique · écarts MBP-A.1 + A.2 + A.4
- `CHECKLIST_MERGE.md` · checklist pré-merge
- `ROUTES_AUDIT.md` · 54 routes HTTP + 7 cron exhaustif (MBP-A.1)
- `SECURITY_AUDIT.md` · 6 CRIT résolus · 9 HAUT + 6 MOY + 5 FAI restent (MBP-A.4)
- `NBA_ENGINE_AUDIT.md` · pipeline NBA backend ↔ frontend · 2 moteurs (MBP-A.2)
- `.claude/onboarding.md` · deploy/setup/reprise compte
- `.claude/agents/alon.md` · analyste calibration bot
- `git log` · historique PRs et versions
