# Providers Mani Bet Pro

## Vue d'ensemble

| Provider | Sport(s) | Coût | Clé secret | Critique ? |
|---|---|---|---|---|
| Tank01 (RapidAPI) | NBA | Quota plan | `TANK01_API_KEY` (+ KEY1/2/3) | OUI |
| ESPN | NBA · MLB · Tennis | Gratuit | Aucune | OUI |
| TheOddsAPI | NBA · MLB · Tennis | Quota plan | `ODDS_API_KEY_1` (+ _KEY_2) | OUI |
| api-tennis | Tennis | Payant | `TENNIS_API_KEY` | NON (désactivé) |
| Sackmann CSV | Tennis | Gratuit | Aucune | OUI |
| Anthropic Claude | NBA | Pay-per-use | `CLAUDE_API_KEY` | OUI (props · injuries) |
| Telegram | Tous | Gratuit | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` | NON (notifications) |
| Pinnacle (guest) | NBA · MLB | Gratuit | Aucune (clé publique) | NON (référence) |
| BasketUSA | NBA | Gratuit (scraping) | Aucune | NON |
| BallDontLie | NBA | Gratuit/payant | `BALLDONTLIE_API_KEY` | OUI (recent form) |
| MLB Stats API | MLB | Gratuit | Aucune | OUI |
| OpenWeather | MLB | Gratuit/quota | `WEATHER_API_KEY` | NON (facultatif) |

---

## Tank01 (RapidAPI)
- Base · `https://tank01-fantasy-stats.p.rapidapi.com`
- Rôle · stats saison NBA (PPG · eFG% · net_rating) · rosters · injuries status
- Routes worker · `/nba/matches` `/nba/roster-injuries` `/nba/ai-injuries`
- Cache KV · `tank01_teams_stats` 6h read / 8h write · `tank01_roster_injuries_v1` 24h
- Rate limit · 1000/jour plan actuel · tracking `odds_quota_state` (à confirmer)
- Fallback · rotation `_KEY1` → `_KEY2` → `_KEY3` → `_KEY` (worker.js:872-876)
- Pièges · `team.Roster` clé R majuscule · `statsToGet=averages` · `teamAbv.trim().toUpperCase()` · cache 6h · `?bust=1` pour bypass

## ESPN
- Bases ·
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard`
  - `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries`
  - `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard`
  - ESPN tennis endpoints (à compléter)
- Rôle · matches officiels temps réel · scores · standings · blessures · results
- Routes worker · `/nba/matches` `/nba/injuries/espn` `/nba/standings` `/nba/results` · `/mlb/matches` `/mlb/standings`
- Coût · gratuit · pas d'auth
- Limites · pas de docs officielles · format peut changer sans préavis
- Pièges · noms joueurs format `J. Smith` vs `John Smith` · normalisation v6.34 (`_normalizeName` worker.js:179)
- ESPN tennis · matching surname uniquement v6.99 (commit 99fe5b7)

## TheOddsAPI
- Base · `https://api.the-odds-api.com/v4`
- Endpoints · `/sports/{sportKey}/odds/` · `/sports/?all=true` · `/sports/{sportKey}/events/{eventId}/odds`
- Rôle · cotes décimales européennes · bookmakers multiples (Pinnacle · DraftKings · FanDuel · BetMGM)
- Routes worker · `/nba/odds/comparison` `/nba/player-points` `/mlb/odds/comparison` `/tennis/odds`
- Clés · `ODDS_API_KEY_1` (+ `_KEY_2` fallback)
- Quota tracking KV `odds_quota_state` 35j TTL
- Pièges · `player_points` sans param `bookmakers=` → liste books dispo · filtre 422 si absent (worker.js:2450)
- Cache KV · `tennis_odds_cache_v2` par match

## api-tennis.com
- Base · `https://api.api-tennis.com/tennis`
- Endpoints · `?method=get_standings` · `?method=get_fixtures`
- Rôle · fixtures live ATP/WTA (comble lag Sackmann 2-3j) · standings temps réel
- Clé · `TENNIS_API_KEY`
- Statut · **DÉSACTIVÉ par défaut** · gate `TENNIS_API_FIXTURES_ENABLED=1`
- Raison · cod=1006 si compte non payé · abonnement requis
- TODO P3 SESSION.md:21 · réactiver si paiement
- Cache KV · `tennis_api_keymap_v1` (player_key map)

## Sackmann CSV (Jeff Sackmann · GitHub)
- URLs ·
  - `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_YYYY.csv`
  - `https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_YYYY.csv`
- Rôle · stats matchs historiques · Elo surface/overall · H2H pondéré
- Coût · gratuit · GitHub raw
- Limites · **lag 2-3j connu** · CSV qual hors tour
- Cache KV · `tennis_csv_stats_v12` · invalide anciens caches pollués (v6.98)
- Pièges · format CSV peut évoluer · parsing fragile

## Anthropic Claude API
- Base · `https://api.anthropic.com/v1/messages`
- Model · `claude-sonnet-4-20250514` (à mettre à jour vers haiku-4.5 ou sonnet-4-6 selon coût)
- Rôle ·
  - Injuries non-officielles · web search (`_callClaudeWithWebSearch` worker.js:1847)
  - Player props projections (`_callClaudeJSONOnly` worker.js:1808)
- Routes worker · `/nba/ai-injuries` `/nba/ai-player-props` (batch)
- Clé · `CLAUDE_API_KEY`
- Rate limit · 1 call/25h via KV counter + exponential backoff (v6.32 fix race condition)
- Max tokens · 1500 batch · 1200 single
- Coût · pay-per-token Anthropic
- Garde-fous · `ai.guard.js` · prompts dans `ai.prompts.js`
- Gates env · `PLAYER_PROPS_ENABLED=1` · `AI_PLAYER_PROPS_ENABLED=1`

## Telegram
- Base · `https://api.telegram.org/bot{token}/sendMessage`
- Rôle · notifications user temps réel
- Clés · `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
- Usages ·
  - `_botSendTelegram` (worker.js:3684) · edges du jour
  - `_runCalibrationCron` (worker.js:4415) · résumé hebdo lundi 7h UTC
  - `_runTennisBotCron` · résumé tennis
- Coût · gratuit
- Limites · 30 msgs/sec max bot · taille msg 4096 chars
- Fallback · skip si secrets absents · pas d'erreur fatale

## Pinnacle (guest API)
- Base · `https://guest.api.arcadia.pinnacle.com/0.1`
- Clé publique · `CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R` (worker.js:4523)
- Liga NBA · 487
- Rôle · cotes les plus justes (référence marché) · props individuels (player_points · strikeouts)
- Routes · utilisé internement dans `/nba/odds/comparison` `/nba/player-points` `/mlb/bot/run`
- Coût · gratuit (clé invité frontend public)
- Limites · changement clé invité possible sans préavis · risque blocage
- Gate · `PINNACLE_DISABLED=1` pour skip
- Cache · `pinnacle_pp_{date}` 6h

## BasketUSA (scraper)
- Rôle · à vérifier précisément
- Route debug `/debug/basketusa` (guard `DEBUG_SECRET`)
- Helpers · `_buNormalizeText` `_buExtractCandidatesFromHtml` `_buScoreCandidate` `_findBestBasketUSAArticle` (worker.js:2053-2204)
- Limites · HTML parsing fragile · dépend structure site
- Statut · usage actuel à confirmer

## BallDontLie
- Base · `https://api.balldontlie.io/v1`
- Endpoint · `/games?team_ids[]=X&seasons[]=Y&per_page=100`
- Rôle · derniers 10-20 matchs exact scores · W/L pour `recent_form_ema`
- Clé · `BALLDONTLIE_API_KEY` (plan gratuit limité · payant pour plus)
- Helper · `bdlFetchWithRetry` (worker.js:6027) · 3 tentatives
- Limites · plan free très limité · pagination requise
- Si absent → `recent_form_ema` unavailable · downgrade qualité

## MLB Stats API
- Base · `https://statsapi.mlb.com/api/v1`
- Endpoints · pitchers · team stats · bullpen · standings
- Rôle · stats officielles MLB · FIP · ERA · OPS
- Coût · gratuit · pas d'auth
- Routes worker · `/mlb/pitchers` `/mlb/team-stats` `/mlb/bullpen-stats`
- Pièges · `IP` format `X.Y` = X innings + Y outs · `_mlbSeason()` dynamique · ESPN `YYYYMMDD` aligné logs

## OpenWeather
- Base · `https://api.openweathermap.org`
- Rôle · météo venue MLB (wind · temp · humidity)
- Clé · `WEATHER_API_KEY`
- Route worker · `/mlb/weather` (si présent)
- Coût · gratuit jusqu'à 60 calls/min · payant au-delà
- Statut · facultatif · skip weather si absent

---

## Quotas / coûts à surveiller
- Tank01 · quota plan RapidAPI (1000/j typique)
- TheOddsAPI · plan mensuel · quota tracké KV `odds_quota_state`
- Claude · pay-per-token · rate-limited 1/25h dans worker
- BallDontLie · plan free très restrictif
- api-tennis · payant · désactivé par défaut

## Fallbacks documentés
- Tank01 : rotation `_KEY1/2/3/`
- ESPN : pas de fallback · si down → matches indispo
- TheOddsAPI : rotation `_KEY_1/2`
- Claude : rate-limited · skip si quota épuisé
- api-tennis : désactivé · Sackmann seul fallback
- Telegram : skip si secrets absents (pas fatal)
- Weather : skip si absent (pas fatal)
- Pinnacle : skip si `PINNACLE_DISABLED=1`

## Garde-fous
- Tous les fetches dans `try/catch` · échec n'arrête pas le moteur
- Cache KV protège contre indispo temporaire
- Logs Cloudflare observability tracent erreurs provider

## À vérifier
- Coût exact plan Tank01 actuel
- Quota TheOddsAPI restant
- Clé Claude model à jour (sonnet-4 mai 2025 mentionné · vérifier mise à jour vers 4.6 ou 4.7)
- BasketUSA · usage actuel actif ou dead code
