# Data pipeline Mani Bet Pro

## Vue d'ensemble
- Worker stateless · pas de DB SQL
- Cache · état · logs → KV `PAPER_TRADING` unique namespace
- Sources externes fetched on-demand · cachées dans KV avec TTL
- Logs settlés conservés 90j

## Flux NBA
```
Cron horaire
  ↓
_runBotCron (worker.js:3204)
  ↓
ESPN /scoreboard → matches jour (handleNBAMatches worker.js:853)
  ↓
Tank01 → rosters + stats équipe (cache `tank01_teams_stats` 6h)
ESPN /injuries → blessures officielles
Claude API → blessures non-officielles (rate-limited 1/25h)
BallDontLie → 10-20 derniers matchs (recent_form_ema)
TheOddsAPI → cotes décimales bookmakers
Pinnacle (gratuit guest) → cotes justes
  ↓
_botExtractVariables · _botEngineCompute (worker.js:5128)
  ↓
Reco → `_botComputeBettingRecs` (worker.js:5251)
  ↓
KV `bot_log_{matchId}` 90j (worker.js:3606)
  ↓
Telegram notification (worker.js:3684)
```

## Flux MLB
```
Cron horaire
  ↓
_runMLBBotCron (worker.js:8066)
  ↓
ESPN MLB /scoreboard → matches jour
  ↓
MLB Stats API → pitchers FIP/ERA · team stats · bullpen
OpenWeather → météo venue (si `WEATHER_API_KEY`)
TheOddsAPI → cotes
Pinnacle → player strikeouts props
  ↓
Calcul homeProb (worker.js:8421) · 6 vars v6.94
  ↓
KV `mlb_bot_log_{matchId}` 90j
  ↓
Telegram
```

## Flux Tennis
```
Cron horaire (fenêtre dynamique tournois actifs)
  ↓
_runTennisBotCron (worker.js:9372)
  ↓
Sackmann CSV (atp_matches_YYYY.csv + wta_) → matchs hist · lag 2-3j
  ↓ cache KV `tennis_csv_stats_v12`
api-tennis (si TENNIS_API_FIXTURES_ENABLED=1) → fixtures live · DÉSACTIVÉ par défaut
ESPN tennis events → enrichissement Elo overall + surface (v7.00+)
TheOddsAPI tennis → cotes (cache `tennis_odds_cache_v2`)
  ↓
9 vars · poids par phase (worker.js:9099 sports.config.js:191)
  ↓
KV `tennis_bot_log_{matchId}` 90j
  ↓
Telegram
```

## Flux odds (snapshot)
```
_runOddsSnapshot (worker.js:4298) · chaque heure
  ↓
TheOddsAPI NBA + MLB
  ↓
KV `odds_snap_{matchId}` 72h · array snapshots [48 pts max]
KV `tennis_odds_snap_{matchId}` 72h
  ↓
/bot/odds-history (worker.js:4686) · expose mouvement cotes UI
```

## Flux injuries
- NBA officiel · ESPN `/injuries`
- NBA Tank01 · roster + status (cache `tank01_roster_injuries_v1` 24h)
- NBA non-officiel · Claude web search (`_callClaudeWithWebSearch` worker.js:1847)
- NBA injury report PDF (nba.com) · parsing `parseInjuryPDF` (worker.js:6214)
- Merge dans `_botMergeInjuries` (worker.js:5836)
- Impact calc `_botComputeAbsencesImpact` (worker.js:5021)

## Flux rosters
- Tank01 `/getNBATeams` · cache `tank01_teams_stats` 6h read / 8h write
- Cache enrichi `nba_rosters_teams_v3` 24h pour team-detail
- Helpers normalisation `_normalizeName` (worker.js:179) · v6.34 fix matching ESPN ↔ Tank01

## Flux paper betting
```
User → POST /paper/bet (worker.js:5887)
  ↓
Validation stake · odds · market
  ↓
KV `paper_trading_state` update · bankroll - stake
KV `paper_bets_index` update
  ↓
[ATTENTE résultat match]
  ↓
User → PUT /paper/bet/{id} (worker.js:5937)
  ↓
Calc PnL · CLV
KV `paper_trading_state` update · bankroll + stake + pnl
  ↓
GET /paper/state → UI affichage
```

## Flux calibration logs
```
Logs settlés (motor_was_right ≠ null)
  ↓
/bot/calibration/analyze?sport=X (worker.js:4034)
  ↓
Stats par bucket motor_prob · hit rate · Brier · biais
  ↓
Alon agent (.claude/agents/alon.md) · proposition ajustements poids
  ↓
[Validation ChatGPT]
  ↓
Edit sports.config.js · commit · merge
```

## Caches KV (TTL)

| Clé / pattern | TTL | Rôle |
|---|---|---|
| `paper_trading_state` | persistant | État bankroll + bets |
| `paper_bets_index` | persistant | Index léger bets |
| `bot_log_{matchId}` | 90j | Log NBA analyse + résultat |
| `mlb_bot_log_{matchId}` | 90j | Log MLB |
| `tennis_bot_log_{matchId}` | 90j | Log tennis |
| `bot_last_run` | 30h | Idempotence cron NBA |
| `mlb_bot_last_run` | 30h | Idempotence MLB |
| `tennis_bot_last_run` | 30h | Idempotence tennis |
| `bot_nightly_settle_last_run` | 48h | Idempotence settle 10-11h UTC |
| `calibration_run_YYYY-Www` | 8j | Idempotence calib hebdo |
| `odds_snap_{matchId}` | 72h | Snapshots cotes NBA/MLB |
| `tennis_odds_snap_{matchId}` | 72h | Snapshots cotes tennis |
| `tank01_teams_stats` | 6h read / 8h write | Rosters + stats Tank01 |
| `tank01_injuries_impact` | cache | ESPN+Tank01 injuries merged |
| `tank01_roster_injuries_v1` | 24h | Roster + status |
| `tennis_csv_stats_v12` | (à vérifier) | Sackmann CSV |
| `tennis_odds_cache_v2` | (à vérifier) | Tennis cotes |
| `tennis_api_keymap_v1` | (à vérifier) | Map joueur → player_key api-tennis |
| `odds_quota_state` | 35j | Quota TheOddsAPI |
| `ai_player_props_{date}` | 20h | Cache Claude props batch |
| `nba_rosters_teams_v3` | 24h | Rosters enrichis team-detail |
| `pinnacle_pp_{date}` | 6h | Pinnacle player points |

## Idempotence cron
- Chaque bot trackée par `{sport}_bot_last_run` KV
- Skip si déjà tourné même jour
- `nightly-settle` 48h TTL → 1 fois par jour 10-11h UTC max
- Calibration lundi 7h UTC · 8j TTL → 1 fois par semaine

## Données fiables
- ESPN scoreboard · matches officiels · scores temps réel (~1-2h délai post-match)
- Tank01 stats season · rosters · taux d'update élevé
- Pinnacle · cotes les plus justes (référence marché)
- MLB Stats API · pitchers stats officiels
- BallDontLie · derniers matchs NBA exact

## Données moins fiables
- Sackmann CSV tennis · lag 2-3j connu · CSV qual hors tour (SESSION.md:47)
- api-tennis · cod=1006 si compte non payé · désactivé par défaut
- Claude AI injuries · qualité variable · rate-limited 1/25h
- BasketUSA scraper · HTML parsing fragile
- Weather venue · OpenWeather facultatif

## Risques divergence
- Tank01 ↔ ESPN noms joueurs · fix v6.34 (`_normalizeName`)
- Tank01 abv ↔ ESPN abv · `normalizeTank01TeamAbv` (worker.js:2470)
- ESPN dates `YYYYMMDD` vs CSV dates · alignement MLB OK · tennis offsets calculés
- Tennis date estimée round offset (worker.js:7080) · R128+1j ... F+7j · slam ×2
- Sackmann CSV qual hors tour vs ATP officiel · décalage rare mais possible

## Timezone
- `_botFormatDate` (worker.js:5863) · Intl API · DST auto
- Nightly settle idempotent même si bord 24h
- Tout heure UTC dans logs · UI convertit local user

## À vérifier
- TTL exact `tennis_csv_stats_v12` · `tennis_odds_cache_v2` · `tennis_api_keymap_v1`
- Exact ligne `_runMLBBotCron` (audit dit 8066)
- Exact ligne `_runTennisBotCron` (audit dit 9372)
- Liste exhaustive routes débugage et leur guard
