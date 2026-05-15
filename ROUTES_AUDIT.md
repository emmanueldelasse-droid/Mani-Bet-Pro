# Audit routes Mani Bet Pro · MBP-A.1

Audit exhaustif `worker.js` (10533 lignes · pas ~9600 comme SESSION.md disait).
Routage = if/else chain linéaire · pas de switch · pas de table.
Export default `worker.js:234` · `fetch(request, env, ctx)` `worker.js:248` · `scheduled(event, env, ctx)` `worker.js:238`.

## Comptage global

| Catégorie | Nombre | Statut |
|---|---|---|
| NBA | 21 | Actif |
| MLB | 11 | Actif |
| Tennis | 9 | Actif |
| Bot cross-sport | 6 | Actif |
| Paper | 4 (+1 regex) | Actif · pas d'auth HTTP |
| Debug | 1 (+5 NBA debug guardées) | Guard optionnel |
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
| `/nba/player/test` | GET | `handleNBAPlayerTest` | 286 | 1936 | **debug guard optionnel** | Tank01 | — | debug |
| `/nba/roster-injuries` | GET | `handleNBARosterInjuries` | 289 | 1071 | public | Tank01 | `tank01_roster_injuries_v1` 90min | actif |
| `/nba/ai-injuries` | GET | `handleNBAAIInjuries` | 292 | 1657 | public | Claude | `ai_injuries_only_*` 8h + rate KV 25h | actif |
| `/nba/ai-injuries-batch` | POST | `handleNBAAIInjuriesBatch` | 295 | 1251 | public | Claude | `ai_injuries_batch_v2_*` 8h + rate 25h | actif |
| `/nba/ai-player-props` | GET | `handleNBAAIPlayerPropsGet` | 301 | 1392 | public | (cache only) | `ai_player_props_{date}` lu | actif |
| `/nba/ai-player-props-batch` | POST | `handleNBAAIPlayerPropsBatch` | 298 | 1458 | public | Claude | rate KV 25h | actif |
| `/nba/roster-debug` | GET | `handleNBARosterDebug` | 304 | 1972 | **debug guard optionnel** | Tank01 | — | debug |
| `/nba/boxscore-debug` | GET | `handleNBABoxscoreDebug` | 307 | 2486 | **debug guard optionnel** | Tank01 | `box_score_v1_*` 7j | debug |
| `/nba/schedule-debug` | GET | `handleNBAScheduleDebug` | 310 | 2544 | **debug guard optionnel** | Tank01 | — | debug |
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
| `/mlb/bot/run` | POST | bot trigger | 352 | public | (multi) | `mlb_bot_last_run` 30h | actif |
| `/mlb/bot/logs` | GET | logs MLB | 355 | public | — | `mlb_bot_log_*` 90j | actif |
| `/mlb/bot/settle-logs` | POST | settle MLB | 358 | public | ESPN | `mlb_bot_log_*` 90j | actif |

## Routes Tennis (9)

| Route | Méthode | Handler | Ligne route | Auth | Provider(s) | Cache KV | Statut |
|---|---|---|---|---|---|---|---|
| `/tennis/sports-list` | GET | tournois TheOddsAPI | 361 | public | TheOddsAPI | — | actif |
| `/tennis/csv-test` | GET | `handleTennisCSVTest` | 363 | public | Sackmann CSV | `tennis_csv_stats_v12_*` (TTL non trouvé) | debug · actif |
| `/tennis/tournaments` | GET | `handleTennisTournaments` | 365 | public | — | — | actif |
| `/tennis/odds` | GET | `handleTennisOdds` | 367 | public | TheOddsAPI · ESPN | `tennis_odds_cache_v2_*` | actif |
| `/tennis/stats` | GET | `handleTennisStats` | 369 | public | Sackmann CSV · api-tennis | `tennis_csv_stats_v12_*` · `espn_recent_v2_*` 2h/5min | actif |
| `/tennis/_espn_probe` | GET | diagnostic ESPN tennis | 372 | public | ESPN | `espn_recent_v2_*` | debug · actif |
| `/tennis/bot/run` | POST | trigger tennis bot | 374 | public | (multi) | `tennis_bot_last_run` 30h | actif |
| `/tennis/bot/logs` | GET | logs tennis | 376 | public | — | `tennis_bot_log_*` 90j | actif |
| `/tennis/bot/settle-logs` | POST | settle tennis | 378 | public | ESPN · Sackmann | `tennis_bot_log_*` 90j | actif |

## Routes Bot cross-sport (6)

| Route | Méthode | Handler | Ligne route | Auth | Sport | Cache KV | Statut |
|---|---|---|---|---|---|---|---|
| `/bot/logs` | GET | `handleBotLogs` | 382 | public | tous | `bot_log_*` · `mlb_bot_log_*` · `tennis_bot_log_*` | actif |
| `/bot/logs/export.csv` | GET | `handleBotLogsExportCSV` | 385 | public | tous | idem | actif |
| `/bot/odds-history` | GET | `handleOddsHistory` | 388 | public | NBA · MLB · Tennis | `odds_snap_*` · `tennis_odds_snap_*` 72h | actif |
| `/bot/settle-logs` | POST | `handleBotSettleLogs` | 391 | public | tous | logs 90j | legacy · actif |
| `/bot/calibration/analyze` | GET | `handleBotCalibration` | 394 | public | param `sport` | `calibration_run_*` 8j | actif |
| `/bot/run` | POST | `handleBotRun` | 397 | public | tous | `bot_last_run` 30h | actif |

## Routes Paper trading (4 + 1 regex)

| Route | Méthode | Handler | Ligne route | Auth | KV | Statut |
|---|---|---|---|---|---|---|
| `/paper/state` | GET | `handlePaperGet` | 401 | **aucune** | `paper_trading_state` lu | actif |
| `/paper/bet` | POST | `handlePaperPlaceBet` | 404 | **aucune** | `paper_trading_state` + `paper_bets_index` | actif · validation v6.32 |
| `/paper/bet/:id` (regex) | PUT | `handlePaperSettleBet` | 407 | **aucune** | idem | actif |
| `/paper/reset` | POST | `handlePaperReset` | 410 | **aucune** | reinit state | actif |

Regex pattern · `^\/paper\/bet\/[^/]+$` (worker.js:407)

## Health / OPTIONS

| Route | Méthode | Handler | Ligne | Notes |
|---|---|---|---|---|
| `OPTIONS *` | OPTIONS | inline 204 + CORS | 253-254 | hors try block (à vérifier impact corsHeaders) |
| `/health` | GET | inline JSON | 415 | **version hardcodée `6.85.0`** non sync changelog |

## Cron handlers (scheduled)

Trigger Cloudflare · `"0 * * * *"` (chaque heure) · lancement `ctx.waitUntil()` parallèle.

| Handler | Ligne implémentation | Condition horaire | Idempotence KV | Rôle |
|---|---|---|---|---|
| `_runBotCron` | 3204 | fenêtre dynamique (~1h avant 1er match) | `bot_last_run` 30h | Analyse NBA + recos + Telegram |
| `_runMLBBotCron` | 8066 | idem MLB | `mlb_bot_last_run` 30h | Analyse MLB |
| `_runTennisBotCron` | 9372 | idem tennis (tournois actifs) | `tennis_bot_last_run` 30h | Analyse tennis |
| `_runNightlySettle` | 4237 | **10-11h UTC** | `bot_nightly_settle_last_run` 48h | Settle J-1 J-2 (tennis J-10) |
| `_runOddsSnapshot` | 4298 | chaque heure | `odds_snap_*` 72h | Snapshot cotes NBA + MLB |
| `_runAIPlayerPropsCron` | 4350 | **22h UTC** | rate KV 25h | Claude batch props NBA |
| `_runCalibrationCron` | 4415 | **lundi 7h UTC** | `calibration_run_YYYY-Www` 8j | Résumé hebdo Telegram |

## Routes orphelines / dead code

Aucun handler orphelin · tous les 54 handlers HTTP appelés.
Aucune route commentée.
Pas de `startsWith()` route.
Fallback 404 · `worker.js:434` · puis `env.ASSETS.fetch` si binding présent.

## Variables d'environnement attendues (19)

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
| `DEBUG_SECRET` | guard debug routes | **critique sécu** | **routes publiques si absent** |
| `PAPER_TRADING` | KV binding | obligatoire | échec routes paper |
| `ASSETS` | static assets binding | obligatoire (fallback 404) | échec assets |

## Sécurité / risques routes

### Critique

- **Debug guards optionnels** (worker.js:1937, 1973, 2487, 2545, 2345)
  - 5 routes (`/nba/player/test`, `/nba/roster-debug`, `/nba/boxscore-debug`, `/nba/schedule-debug`, `/debug/basketusa`)
  - Si `env.DEBUG_SECRET` absent → routes **PUBLIQUES par fallback**
  - Note v6.33 "rétrocompatible" mais risque sécurité prod
- **Erreur globale fuite message brut** (worker.js:438)
  - `errorResponse(\`Internal error: ${err.message}\`, 500, origin)`
  - Stack traces · chemins internes potentiellement exposés
- **Routes Paper sans auth HTTP** (worker.js:401-410)
  - Aucun JWT · clé API · token
  - Guard = binding KV `PAPER_TRADING` existant
  - N'importe quel client peut placer / settle / reset bets

### Mineur

- `/health` version hardcodée `6.85.0` (worker.js:419) · non synced changelog (actuel v7.01 tennis)
- `OPTIONS` handler hors try block (worker.js:253-254) · `corsHeaders(env)` à confirmer
- Patterns regex tous anchored `^...$` · pas de wildcard dangereux

## À vérifier

- Liste exacte handlers MLB lignes implémentation (audit dit ~ approximatif)
- `OPTIONS` route comportement si origin = "*"
- TTL `tennis_csv_stats_v12_*` `tennis_odds_cache_v2_*` `mlb_team_recent_*` non trouvés par grep direct
- Si `corsHeaders(origin)` accepte `null` origin (curl test)
