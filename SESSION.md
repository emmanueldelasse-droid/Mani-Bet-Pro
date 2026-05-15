# Mani Bet Pro

## Résumé projet
Moteur aide décision paris sportifs · NBA · MLB · Tennis · Cloudflare Worker + GitHub Pages.
Voir `BOT_OBJECTIVE.md` pour mission complète.

## Gouvernance (v6.97 · gouvernance)
- **ChatGPT pilote** · audit · architecture · priorités · validation
- **Claude exécutant** · code · tests · docs · PRs
- **User arbitre** · merge final
- Pas de merge sans GO ChatGPT explicite

## Lecture obligatoire chaque session
1. SESSION.md (ce fichier · point d'entrée court)
2. `BOT_OBJECTIVE.md` · mission · règles absolues
3. `PROJECT_RULES.md` · workflow · interdictions Claude
4. `CLAUDE.md` · règles session
5. Selon tâche · `ARCHITECTURE.md` · `DATA_PIPELINE.md` · `BETTING_LOGIC.md` · `PROVIDERS_MATRIX.md` · `KNOWN_ISSUES.md` · `CHECKLIST_MERGE.md` · `ROUTES_AUDIT.md`
6. `.claude/onboarding.md` uniquement pour deploy/setup/reprise compte
7. `.claude/agents/alon.md` pour analyse calibration

## Règles update
Début → "En cours" 1/N · Fin étape → +1 · Merge → vider · User future → TODO+prio
Update SESSION.md seulement si merge a impact critique.
Update docs gouvernance à chaque merge concerné.

## En cours
néant

## État
- Worker `manibetpro.emmanueldelasse.workers.dev` · auto-deploy push main
- Front GH Pages · auto-deploy push main
- KV `PAPER_TRADING` · id `17eb7ddc41a949dd99bd840142832cfd`
- Cron `0 * * * *` · idempotent par sport
- Dernière session · audit MBP-A.1 router/routes/flux/providers/KV (PR docs only)
- worker.js · **10533 lignes** (corrigé MBP-A.1 · pas ~8500L ni ~9600L)
- 54 routes HTTP · 7 cron handlers · 10/13 providers actifs · 50+ clés KV

## Routes majeures
- `/nba/*` `/mlb/*` `/tennis/*` `/bot/*` `/paper/*` `/health`
- Détail · `ARCHITECTURE.md` + `git grep` worker.js
- Cron · 10-11h UTC nightly-settle · 22h UTC AI props · lundi 7h UTC calibration

## Conventions
- Confidence : `HIGH/MEDIUM/LOW/INCONCLUSIVE` (jamais "Data quality" en UI)
- Cotes décimales européennes (jamais US)
- UI user-facing FR · helpers `_qualityFr` `_betTypeFr` `_fmtOdds` `_confidenceFr` `_interpretVariable` (ui.bot.js:1090-1215)
- Style .md · télégraphique FR · refs `file:line` · pas d'emoji
- Style chat user · vocabulaire simple · exemples concrets · pas de jargon brut

## TODO prioritaires
- [ ] P1 MBP-A.1 CRIT-1 · forcer 401 si `DEBUG_SECRET` absent · 5 routes NBA debug + `/debug/basketusa` actuellement publiques
- [ ] P1 MBP-A.1 CRIT-2 · auth HTTP routes `/paper/*` · actuellement aucune protection
- [ ] P1 MBP-A.1 CRIT-3 · sanitize `errorResponse` `Internal error: ${err.message}` (worker.js:438)
- [ ] P1 surveiller hit rate MLB v6.94 post 50 paris · si <52% désactiver bot (Option C)
- [ ] P1 surveiller hit rate tennis v6.93 post 50 paris · revert isolé si baisse
- [ ] P1 gate `confidence=INCONCLUSIVE` si `data_quality<0.55` (worker.js:5185)
- [ ] P2 NBA recheck calib à 80+ logs (actuel 53 hit 67.9% v6.79 valide) · `travel_load` inversé n=22 ignoré
- [ ] P2 `/bot/calibration/analyze?sport=tennis` après 30+ logs settlés v6.85+
- [ ] P2 MBP-A.1 MED-1 · investiguer `ai_player_props_{date}` lu jamais écrit
- [ ] P2 MBP-A.1 MED-4 · sync `/health` version (actuelle hardcodée `6.85.0`)
- [ ] P3 calibrer `-4.5` playoff par round après 100+ logs · Alon 50+ logs
- [ ] P3 réactiver paris contrarian après 200+ logs · cotes≥3
- [ ] P3 réactiver api-tennis fixtures si compte payé → `env.TENNIS_API_FIXTURES_ENABLED=1`
- [ ] P3 MBP-A.1 MED-5/6 · supprimer constantes mortes `MLB_PITCHER_KV_KEY` `NBA_INJURY_BASE`

Détail TODO + dette technique · `KNOWN_ISSUES.md`

## Stack
- `worker.js` 10533L · `wrangler.jsonc` (taille MBP-A.1 vérifiée)
- `src/ui/match-detail.{js,teamdetail,tennis,helpers}` · dashboard · bot · history
- `src/engine/engine.nba.{js,variables,score,betting}` · `engine.tennis.js` · `engine.robustness.js` · `engine.core.js`
- Pas de `engine.mlb.js` séparé · MLB inline worker.js
- `src/config/sports.config.js` · poids · seuils NBA/Tennis
- `src/utils/utils.odds.js` · conversions cotes
- `src/ai/` · client Claude · prompts · garde-fous
- `src/paper/` · place + settle paper trading
- Détail · `ARCHITECTURE.md`

## Pièges récurrents (résumé · détail dans docs dédiées)
- Tank01 · `team.Roster` R maj · `statsToGet=averages` · cache 6h · `?bust=1`
- TheOddsAPI · `player_points` sans `bookmakers=` → 422 (worker.js:2450)
- MLB · `IP X.Y` = X innings + Y outs · `_mlbSeason()` dynamique · v6.94 garde-fou edge [5, 10]
- Tennis · Sackmann CSV lag 2-3j · api-tennis désactivé (cod=1006 non payé)
- Tennis · 9 vars · poids par phase (worker.js:9099 sports.config.js:190)
- Timezone · `_botFormatDate` Intl · DST auto · nightly idempotent
- Sécu · `_denyIfNoDebugAuth()` · regex params · `escapeHtml` innerHTML

## Sécurité · debug
- Debug routes guard `_denyIfNoDebugAuth()` · secret `DEBUG_SECRET`
- Params user · regex avant clé KV
- innerHTML → `escapeHtml`

## Deploy
- `git push origin main` → CF auto-deploy worker · GH Pages auto-deploy front
- Pas de staging · prod direct

## Hors SESSION
- `.claude/onboarding.md` · deploy/setup/reprise compte
- `.claude/agents/alon.md` · analyste calibration bot
- `git log` · historique versions
- `ARCHITECTURE.md` · stack + modules + zones sensibles
- `DATA_PIPELINE.md` · flux data + caches KV + TTL
- `BETTING_LOGIC.md` · confidence + variables + calibration
- `PROVIDERS_MATRIX.md` · 12 providers + fallbacks
- `KNOWN_ISSUES.md` · bugs P1/P2/P3 + dette technique + écarts MBP-A.1
- `CHECKLIST_MERGE.md` · checklist pré-merge
- `PROJECT_RULES.md` · workflow ChatGPT/Claude/user
- `BOT_OBJECTIVE.md` · mission projet
- `ROUTES_AUDIT.md` · routes exhaustives + auth + provider + cache (MBP-A.1)
