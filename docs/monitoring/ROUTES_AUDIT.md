# Audit routes Mani Bet Pro · MBP-A.1

Audit MBP-A.1 historique · auth/scheduler réconciliés avec le code vivant le 01/10/2026.
Routage = if/else chain linéaire · pas de switch · pas de table.
Les numéros de lignes ci-dessous sont historiques et peuvent dériver · **le code vivant prime**.

## Comptage global

| Catégorie | Nombre | Statut |
|---|---|---|
| NBA | 21 | Actif |
| MLB | 11 | Actif |
| Tennis | 9 | Actif |
| Bot cross-sport | 6 | Actif |
| Paper | 4 (+1 regex) | Actif · `X-API-Key` fail-close |
| Debug | 1 (+5 NBA debug guardées) | `DEBUG_SECRET` fail-close |
| Health · OPTIONS | 2 | Actif |
| **TOTAL HTTP** | **54** | — |
| Cron handlers (scheduled) | 7 | Actif |

## Routes NBA (21)

| Route | Méthode | Handler | Ligne route | Ligne handler | Auth | Provider(s) | Cache KV | Statut |
|---|---|---|---|---|---|---|---|---|
| `/nba/matches` | GET | `handleNBAMatches` | 259 | 853 | public | ESPN | — | actif |
| `/nba/injuries/espn` | GET | `handleNBAInjuriesESPN` | 268 | 3099 | public | ESPN | — | actif |
| `/nba/injuries/impact` | GET | `handleNBAInjuriesImpact` | 271 | 927 | public | ESPN + Tank01 | `tank01_injuries_impact` 90min | actif |
| `/nba/injuries` | GET | `handleNBAInjuries` | 274 | 3140 | public | ESPN + Claude | — | actif |
| `/nba/standings` | GET | `handleNBAStandings` | 277 | 3176 | public | ESPN | — | actif |
| `/nba/results` | GET | `handleNBAResults` | 280 | 2959 | public | ESPN | — | actif |
| `/nba/teams/stats` | GET | `handleNBATeamsStats` | 283 | 2602 | public | Tank01 | `tank01_teams_stats` 24h | actif |
| `/nba/player/test` | GET | `handleNBAPlayerTest` | 286 | 1936 | **DEBUG_SECRET** | Tank01 | — | debug |
| `/nba/roster-injuries` | GET | `handleNBARosterInjuries` | 289 | 1071 | public | Tank01 | `tank01_roster_injuries_v1` 90min | actif |
| `/nba/ai-injuries` | GET | `handleNBAAIInjuries` | 292 | 1657 | public | Claude | `ai_injuries_only_*` 8h + rate KV 25h | actif |
| `/nba/ai-injuries-batch` | POST | `handleNBAAIInjuriesBatch` | 295 | 1251 | **X-Bot-Api-Key** | Claude | `ai_injuries_batch_v2_*` 8h + rate 25h | actif |
| `/nba/ai-player-props` | GET | `handleNBAAIPlayerPropsGet` | 301 | 1392 | public | (cache only) | `ai_player_props_{date}` lu | actif |
| `/nba/ai-player-props-batch` | POST | `handleNBAAIPlayerPropsBatch` | 298 | 1458 | **X-Bot-Api-Key** | Claude | rate KV 25h | actif |
| `/nba/roster-debug` | GET | `handleNBARosterDebug` | 304 | 1972 | **DEBUG_SECRET** | Tank01 | — | debug |
| `/nba/boxscore-debug` | GET | `handleNBABoxscoreDebug` | 307 | 2486 | **DEBUG_SECRET** | Tank01 | `box_score_v1_*` 7j | debug |
| `/nba/schedule-debug` | GET | `handleNBAScheduleDebug` | 310 | 2544 | **DEBUG_SECRET** | Tank01 | — | debug |
| `/debug/basketusa` | GET | `handleDebugBasketUSA` | 313 | 2344 | debug guard | BasketUSA scraper | `basketusa_best_v3_*` 45min | debug |
| `/nba/odds/comparison` | GET | `handleOddsComparison` | 316 | 2673 | public | TheOddsAPI · Pinnacle | `odds_quota_state` 35j | actif |
| `/nba/player-points` | GET | `handleNBAPlayerPointsOdds` | 319 | 2950 | public | TheOddsAPI · Pinnacle | `pinnacle_pp_*` 6h | actif |
| `/nba/team-detail` | GET | `handleNBATeamDetail` | 323 | 449 | public | Tank01 · BDL · BasketUSA | `team_detail_v7_*` 6h/8h | actif |
| `/nba/team/:abv/stats` (regex) | GET | `handleNBATeamStats` | 262 | 3012 | public | ESPN | — | actif |
| `/nba/team/:abv/recent` (regex) | GET | `handleNBARecentForm` | 265 | 3023 | public | BallDontLie | `bdl_recent_*` 6h | actif |

Note · `/nba/team/:abv/{stats,recent}` matchés par regex `^\/nba\/team\/[^/]+\/(stats|recent)$` (worker.js:262, 265).

## Routes MLB (11)

| Route | Méthode | Handler | Ligne route | Auth | Provider(s) | Cache KV | Statut |
|---|---|---|---|---|---|---|---|
| `/mlb/matches` | GET | `handleMLBMatches` (à vérifier) | 328 | public | ESPN | — | actif |
| `/mlb/odds/comparison` | GET | `handleMLBOddsComparison` | 331 | public | TheOddsAPI | `mlb_odds_cache` 2h | actif |
| `/mlb/pitchers` | GET | `handleMLBPitchers` | 334 | public | MLB Stats API | — | actif |
| `/mlb/standings` | GET | `handleMLBStandings` | 337 | public | MLB Stats API | — | actif |
| `/mlb/team-stats` | GET | `handleMLBTeamStats` | 340 | public | MLB Stats API | `mlb_team_stats_cache` 6h | actif |
| `/mlb/team-recent` | GET | `handleMLBTeamRecent` | 343 | public | MLB Stats API | `mlb_team_recent_*` (TTL non trouvé) | actif |
| `/mlb/bullpen-stats` | GET | `handleMLBBullpenStats` | 346 | public | MLB Stats API | `mlb_bullpen_stats_cache` 6h | actif |
| `/mlb/weather` | GET | inline handler | 350 | public | OpenWeather | `mlb_weather_*` 1h | actif |
| `/mlb/bot/run` | POST | bot trigger | 352 | **X-Bot-Api-Key** | (multi) | `mlb_bot_last_run` 30h | actif |
| `/mlb/bot/logs` | GET | logs MLB | 355 | public | — | `mlb_bot_log_*` 90j | actif |
| `/mlb/bot/settle-logs` | POST | settle MLB | 358 | **X-Bot-Api-Key** | ESPN | `mlb_bot_log_*` 90j | actif |

## Routes Tennis (10)

| Route | Méthode | Handler | Ligne route | Auth | Provider(s) | Cache KV | Statut |
|---|---|---|---|---|---|---|---|
| `/tennis/sports-list` | GET | `handleTennisSportsList` | 365 | public | TheOddsAPI | — | actif · liste sports tennis simple |
| `/tennis/provider/sports-debug` | GET | `handleTennisProviderSportsDebug` | 370 | **DEBUG_SECRET** | TheOddsAPI | — | debug · audit registre interne vs provider |
| `/tennis/csv-test` | GET | `handleTennisCSVTest` | 367 | public | Sackmann CSV | `tennis_csv_stats_v12_*` (TTL non trouvé) | debug · actif |
| `/tennis/tournaments` | GET | `handleTennisTournaments` | 369 | public | — | — | actif |
| `/tennis/odds` | GET | `handleTennisOdds` | 371 | public | TheOddsAPI · ESPN | `tennis_odds_cache_v2_*` | actif |
| `/tennis/stats` | GET | `handleTennisStats` | 373 | public | Sackmann CSV · api-tennis | `tennis_csv_stats_v12_*` · `espn_recent_v2_*` 2h/5min | actif |
| `/tennis/_espn_probe` | GET | diagnostic ESPN tennis | 376 | **DEBUG_SECRET** (MBP-S.1) | ESPN | `espn_recent_v2_*` | debug · actif |
| `/tennis/bot/run` | POST | trigger tennis bot | 378 | **X-Bot-Api-Key** | (multi) | `tennis_bot_last_run` 30h | actif |
| `/tennis/bot/logs` | GET | logs tennis | 380 | public | — | `tennis_bot_log_*` 90j | actif |
| `/tennis/bot/settle-logs` | POST | settle tennis | 382 | **X-Bot-Api-Key** | ESPN · Sackmann | `tennis_bot_log_*` 90j | actif |

## Routes Bot cross-sport (6)

| Route | Méthode | Handler | Ligne route | Auth | Sport | Cache KV | Statut |
|---|---|---|---|---|---|---|---|
| `/bot/logs` | GET | `handleBotLogs` | 382 | public | tous | `bot_log_*` · `mlb_bot_log_*` · `tennis_bot_log_*` | actif |
| `/bot/logs/export.csv` | GET | `handleBotLogsExportCSV` | 385 | public | tous | idem | actif |
| `/bot/odds-history` | GET | `handleOddsHistory` | 388 | public | NBA · MLB · Tennis | `odds_snap_*` · `tennis_odds_snap_*` 72h | actif |
| `/bot/settle-logs` | POST | `handleBotSettleLogs` | 391 | **X-Bot-Api-Key** | tous | logs 90j | legacy · actif |
| `/bot/calibration/analyze` | GET | `handleBotCalibration` | 394 | public | param `sport` | `calibration_run_*` 8j | actif |
| `/bot/run` | POST | `handleBotRun` | 397 | **X-Bot-Api-Key** | tous | `bot_last_run` 30h | actif |
| `/bot/settle` | GET | `handleBotCatchupSettle` | 411 | DEBUG_SECRET | param `sport` · `scope` · `date` | `catchup_last_run_*` 30h · logs 90j | MBP-CATCHUP-SETTLE · actif |
| `/bot/recover-missed` | GET | `handleBotRecoverMissed` | 414 | DEBUG_SECRET | param `sport` · `date` | `recover_last_run_*` 30h · logs 90j (missed_by_cron) | MBP-CATCHUP-SETTLE · actif |

## Routes Paper trading (4 + 1 regex)

| Route | Méthode | Handler | Ligne route | Auth | KV | Statut |
|---|---|---|---|---|---|---|
| `/paper/state` | GET | `handlePaperGet` | 401 | **X-API-Key** | `paper_trading_state` lu | actif |
| `/paper/bet` | POST | `handlePaperPlaceBet` | 404 | **X-API-Key** | `paper_trading_state` + `paper_bets_index` | actif · validation v6.32 |
| `/paper/bet/:id` (regex) | PUT | `handlePaperSettleBet` | 407 | **X-API-Key** | idem | actif |
| `/paper/reset` | POST | `handlePaperReset` | 410 | **X-API-Key** | reinit state | actif |

Regex pattern · `^\/paper\/bet\/[^/]+$` (worker.js:407)

## Health / OPTIONS

| Route | Méthode | Handler | Notes |
|---|---|---|---|
| `OPTIONS *` | OPTIONS | inline 204 + CORS | preflight CORS |
| `/health` | GET | `handleOperationalHealth` | read-only KV/runtime metadata · aucun appel provider externe · scheduler/checkpoints/settlement/provider-cache/D1/version Cloudflare |

## Cron handlers (scheduled)

Triggers Cloudflare :
- `0 * * * *` · pipeline principal horaire ;
- `*/15 * * * *` · snapshots de cotes uniquement, distingué via `event.cron`.

| Handler | Cadence / condition | Idempotence KV | Rôle |
|---|---|---|---|
| `_runBotCron` | horaire · checkpoints NBA H6/H4/H2/H1 par match | `nba_checkpoint_{matchId}_{checkpoint}` 72h | Analyse NBA · Telegram H1 seulement · heartbeat `nba_cron_heartbeat_v1` |
| `_runMLBBotCron` | horaire · fenêtre MLB historique | `mlb_bot_last_run` 30h | Analyse MLB |
| `_runTennisBotCron` | horaire · fenêtre tournois actifs | `tennis_bot_last_run` 30h | Analyse tennis |
| `_runNightlySettle` | horaire · actif 10-11h UTC | `bot_nightly_settle_last_run` 48h | settlement + recovery |
| `_runOddsSnapshot` | **toutes les 15 min** | `odds_snap_*` 72h | snapshots ESPN NBA/MLB + heartbeat `odds_snapshot_heartbeat_v1` |
| `_runAIPlayerPropsCron` | horaire · actif 22h UTC | rate KV 25h | Claude batch props NBA |
| `_runCalibrationCron` | horaire · lundi 7h UTC | `calibration_run_YYYY-Www` 8j | résumé hebdo Telegram |

## Routes orphelines / dead code

Aucun handler orphelin · tous les 54 handlers HTTP appelés.
Aucune route commentée.
Pas de `startsWith()` route.
Fallback 404 · `worker.js:434` · puis `env.ASSETS.fetch` si binding présent.

## Variables d'environnement / bindings attendus

| Variable | Provider / rôle | Requis | Fallback |
|---|---|---|---|
| `TANK01_API_KEY1` | Tank01 RapidAPI primary | recommandé | KEY2/3/legacy |
| `TANK01_API_KEY2` | fallback #1 | non | KEY3/legacy |
| `TANK01_API_KEY3` | fallback #2 | non | legacy |
| `TANK01_API_KEY` | legacy fallback | non | — |
| `ODDS_API_KEY_1` | TheOddsAPI primary | recommandé | KEY_2 |
| `ODDS_API_KEY_2` | TheOddsAPI fallback | non | — |
| `CLAUDE_API_KEY` | Anthropic | optionnel | skip features AI |
| `TENNIS_API_KEY` | api-tennis | non | Sackmann CSV |
| `TENNIS_API_FIXTURES_ENABLED` | gate live fixtures | non · `'0'` | skip |
| `BALLDONTLIE_API_KEY` | BDL recent form | non | dégrade `recent_form_ema` |
| `TELEGRAM_BOT_TOKEN` | Telegram | non | skip notifs |
| `TELEGRAM_CHAT_ID` | Telegram destination | non | skip notifs |
| `WEATHER_API_KEY` | OpenWeather | non | skip météo |
| `PLAYER_PROPS_ENABLED` | feature gate | non · `'0'` | skip |
| `AI_PLAYER_PROPS_ENABLED` | gate cron props | non · `'0'` | skip |
| `PINNACLE_DISABLED` | gate Pinnacle | non · `'0'` | actif |
| `DEBUG_SECRET` | guard debug routes | **critique sécu** | fail-close 401 si absent/incorrect |
| `PAPER_API_KEY` | auth routes `/paper/*` | requis pour usage Paper HTTP | fail-close 401 |
| `BOT_RUN_API_KEY` | auth routes bot manuelles/quota | requis pour POST concernés | fail-close 401 |
| `PAPER_TRADING` | KV binding | obligatoire | échec routes state/logs |
| `MANI_HISTORY_DB` | D1 historique NBA | optionnel tant que rollout non validé | KV continue seul |
| `CF_VERSION_METADATA` | version Worker déployée | binding Wrangler | `/health` version déployée |
| `ASSETS` | static assets binding | obligatoire (fallback 404) | échec assets |

## Sécurité / risques routes

### Critique

Écarts critiques historiques réconciliés avec le code vivant :
- debug · `_denyIfNoDebugAuth` fail-close si `DEBUG_SECRET` absent ou incorrect ;
- erreurs client · message générique `SAFE_ERROR_MSG_500` · détail réservé logs serveur ;
- Paper · 4 routes protégées par `requirePaperApiKey` / `X-API-Key` ;
- Bot/quota · 8 routes POST protégées par `requireBotRunApiKey` / `X-Bot-Api-Key` ;
- référence sécurité détaillée · `docs/project/PROD_SAFETY_RULES.md` + `docs/decisions/DECISION-001-SECURITY-AUDIT-MBP-A4.md`.

### Mineur

- `/health` utilise `CF_VERSION_METADATA` · plus de version hardcodée
- `OPTIONS` handler hors try block · CORS via `corsHeaders(origin)`
- Patterns regex tous anchored `^...$` · pas de wildcard dangereux

## À vérifier

- Liste exacte handlers MLB lignes implémentation (audit dit ~ approximatif)
- `OPTIONS` route comportement si origin = "*"
- TTL `tennis_csv_stats_v12_*` `tennis_odds_cache_v2_*` `mlb_team_recent_*` non trouvés par grep direct
- CORS null origin · vérifier uniquement lors d'un audit sécurité dédié si comportement navigateur évolue
