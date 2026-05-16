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
_botExtractVariables · _botEngineCompute (worker.js:5211)
  ↓
Reco → `_botComputeBettingRecs` (worker.js:5334)
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
- Impact calc `_botComputeAbsencesImpact` (worker.js:5104)

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

## Flux monitoring (MBP-monitoring · PR #198)
```
node scripts/report-bot-monitoring.mjs --url <worker_origin>
  ↓
fetch parallèle (read-only · pas de provider externe)
  - GET /bot/logs           (NBA · worker.js:3855)
  - GET /mlb/bot/logs       (MLB · worker.js:8924)
  - GET /tennis/bot/logs    (Tennis · worker.js:10558)
  ↓
summarize(logsBySport)  · pure function
  - matchs analysés · matchs avec reco exploitable · total_blocked (UNIQUE)
  - INCONCLUSIVE · MLB LOW · dq<0.55 · settlés vs non
  - hit rate global + 50 derniers · par confidence · par type
  - distribution data_quality (numérique buckets ou label LOW/MEDIUM/HIGH)
  - décisions auto · MLB LIMITER_OU_DESACTIVER · Tennis SURVEILLER_REVERT · NBA OK/SURVEILLER
  ↓
console output formaté (formatReport)
  - exit 0 si OK · exit 1 si rapport incomplet (≥1 fetch failed)
```
Doc · `docs/monitoring/BOT_MONITORING.md`.

## Effet MBP-P1 sur les logs (PR #197)

Le gate `data_quality` faible (worker.js:5888 NBA · :9458 Tennis · :8424 MLB engine · :8336 MLB strikeouts) modifie le contenu des logs persistés ·

Règle produit ferme · `confidence_level === 'INCONCLUSIVE'` ⇒ reco non exploitable · jamais affichée user · jamais comptée comme reco exploitable par le monitoring.

| Sport | Condition | Effet log |
|---|---|---|
| NBA | `data_quality < 0.55` (numérique) | `confidence_level: 'INCONCLUSIVE'` · reco non exploitable |
| Tennis | `data_quality < 0.55` (numérique) | idem NBA · `confidence_level: 'INCONCLUSIVE'` · reco non exploitable |
| MLB | `data_quality === 'LOW'` (label) | `recommendations: []` · `best: null` · strikeouts merge skip (worker.js:8424 · :8336) |

Notes ·
- NBA/Tennis · `_botEngineCompute` ne vide pas `betting_recommendations` (label `INCONCLUSIVE` suffit · règle produit bloque) · MLB · gate franc dans le moteur (vide recos)
- Anciens logs pré-MBP-P1 (avant gate) peuvent contenir `best`/`recommendations[]` non vides en INCONCLUSIVE · à interpréter prudemment · ne PAS présenter comme comportement normal exploitable post-gate
- Frontend · `EngineCore._computeConfidenceLevel` → `'INCONCLUSIVE'` si dq < 0.55 · UI affiche "INSUFFISANT" · pas de reco exposée

Conséquence calibration · les logs INCONCLUSIVE (NBA/Tennis) et LOW (MLB) ne génèrent plus de paris exploitables · hit rate post-MBP-P1 ne mélange plus les recos sur données fragiles. Attendre 50 nouveaux paris settlés post-gate avant toute recalibration (rule SESSION.md P1).

## Caches KV (TTL · MBP-A.1 vérifié)

### Persistants (sans TTL)
| Clé | Read | Write | Rôle |
|---|---|---|---|
| `paper_trading_state` | worker.js:5881,5910,5941 | 5923,5984,6004 | État bankroll + bets papier |
| `paper_bets_index` | 5927,5988 | 5930,5991,6007 | Index léger bets |

### Logs bot (90j · 7_776_000s)
| Préfixe | Read | Write | Rôle |
|---|---|---|---|
| `bot_log_{matchId}` | 3787,3863,4049,4320 | 3610,3956 | Log NBA + résultat |
| `mlb_bot_log_{matchId}` | 8829,8883 | 8144,8976 | Log MLB |
| `tennis_bot_log_{matchId}` | 10280 | 9478,10419 | Log tennis |

### Idempotence cron
| Clé | TTL | Rôle |
|---|---|---|
| `bot_last_run` | 30h (108_000s) | Cron NBA |
| `mlb_bot_last_run` | 30h | Cron MLB |
| `tennis_bot_last_run` | 30h | Cron tennis |
| `bot_nightly_settle_last_run` | 48h (172_800s) | Settle 10-11h UTC |
| `calibration_run_YYYY-Www` | 8j (691_200s) | Calib hebdo lundi 7h UTC |

### Snapshots cotes
| Préfixe | TTL | Rôle |
|---|---|---|
| `odds_snap_{matchId}` | 72h (259_200s) | Snapshots NBA/MLB |
| `tennis_odds_snap_{matchId}` | 7j / 3h | Snapshots tennis (2 TTL distincts worker.js:6558, 6565) |

### Caches providers
| Clé / préfixe | TTL | Rôle |
|---|---|---|
| `tank01_teams_stats` | 24h (86_400s) | Rosters NBA + stats (audit MBP-A.1 corrigé · doc disait 6h/8h) |
| `tank01_injuries_impact` | 90min (5_400s) | ESPN+Tank01 injuries merged |
| `tank01_roster_injuries_v1` | 90min (5_400s) | Status joueurs par équipe (audit MBP-A.1 corrigé · doc disait 24h) |
| `nba_rosters_teams_v3` | 6h (21_600s) | Rosters enrichis team-detail (audit corrigé · doc disait 24h) |
| `team_detail_v7_{away}_{home}` | 6h / 8h | Last10 stats team-detail (worker.js:460-549) |
| `box_score_v1_{gameID}` | 7j (604_800s) | Tank01 5 derniers matchs (worker.js:688-703) |
| `bdl_recent_{teamId}_{season}` | 6h (21_600s) | BallDontLie recent matches |
| `basketusa_best_v3_{home}_{away}` | 45min (2_700s) | BasketUSA scrape articles |
| `pinnacle_pp_{date}` | 6h (21_600s) | Pinnacle player points NBA |
| `pinnacle_mlb_so_{date}` | variable | Pinnacle MLB strikeouts |
| `mlb_odds_cache` | 2h (7_200s) | MLB odds TheOddsAPI |
| `mlb_team_stats_cache` | 6h (21_600s) | MLB team stats |
| `mlb_bullpen_stats_cache` | 6h (21_600s) | MLB bullpen stats |
| `mlb_weather_{venue}` | 1h (3_600s) | OpenWeather conditions match |
| `espn_recent_v2_{tour}_{player}` | 2h / 5min | ESPN recent matches tennis (worker.js:10060-10073) |
| `tennis_api_keymap_v1` | 7j (604_800s) | Map joueur → api-tennis key |
| `tennis_csv_stats_v12_{tour}_{surface}_{players}` | (TTL non trouvé) | Sackmann CSV par requête (préfixe dynamique) |
| `tennis_odds_cache_v2_{resolvedKey}` | (TTL non trouvé) | Tennis cotes par match |
| `odds_quota_state` | 35j (3_024_000s) | Quota TheOddsAPI |

### Rate limit Claude (MBP-S.4 · per-IP)
Suffixe `_{ipHash}` ajouté · hash SHA-256 tronqué (16 hex chars) ou `'system'` pour cron.
Helper · `_rateLimitIpHash(request)` worker.js:914.

| Clé | TTL | Rôle |
|---|---|---|
| `ai_injuries_batch_v2_{date}_{games}` | 8h (28_800s) | Cache batch injuries (clé inchangée) |
| `ai_injuries_batch_rate_{YYYYMMDD}_{ipHash}` | 25h (90_000s) | Rate limit batch (1/jour par IP) |
| `ai_injuries_only_{date}_{away}_{home}` | 8h | Cache single injuries (clé inchangée) |
| `ai_injuries_rate_{date}_{ipHash}` | 25h | Rate limit single par IP |
| `ai_player_props_{date}` | ~20h | Cache Claude props batch (**lu mais write non trouvée par grep · à vérifier**) |
| `ai_player_props_rate_{YYYYMMDD}_{ipHash}` | 25h | Rate limit props par IP |

Sécu MBP-S.4 ·
- IP brute jamais stockée (seulement le hash 16 hex)
- Cron Cloudflare exempté (namespace `'system'` automatique car pas de header IP)
- Spam d'un user n'affecte plus les autres utilisateurs

### Clés mortes / orphelines (audit MBP-A.1)
| Clé | Statut | Note |
|---|---|---|
| `MLB_PITCHER_KV_KEY = 'mlb_pitchers_cache'` (worker.js:7372) | constante définie · **jamais référencée** | suppression possible |
| `mlb_team_recent_{teamId}_{season}` (worker.js:7822) | lu · **write non trouvée** | à vérifier |
| `ai_player_props_{date}` | lu (worker.js:1401, 4362, 4656) · **write non trouvée** | à vérifier dans `src/` ou cron AI |

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

## Risques KV/cache (audit MBP-A.4)
- `paper_trading_state` exposé via `/paper/state` sans auth · lecture bankroll publique
- `bot_log_*` exposés via `/bot/logs` `/bot/logs/export.csv` · reverse-engineering moteur possible
- `ai_injuries_*` 8h · `ai_player_props_*` 20h cache stale · pas de warning dans réponse
- Pas d'isolation user · single-tenant
- Pas de lock RW sur `paper_trading_state` · corruption concurrent possible
- Clés `bot_log_{matchId}` prédictibles (matchId ESPN public) · énumération possible
- Détail · `SECURITY_AUDIT.md` section 7

## À vérifier (MBP-A.1)
- TTL exact `tennis_csv_stats_v12_*` · `tennis_odds_cache_v2_*` (patterns dynamiques · pas trouvé en grep direct)
- ✓ `_runMLBBotCron` worker.js:8066 (confirmé)
- ✓ `_runTennisBotCron` worker.js:9372 (confirmé)
- ✓ Liste routes debug → `ROUTES_AUDIT.md` (5 NBA + 1 BasketUSA)
- Écriture `ai_player_props_{date}` · semble manquer (lu mais pas écrit par worker.js)
- `mlb_team_recent_*` write inconnu
- `_todayParisKey()` timezone Paris vs UTC · risque drift rate limiters minuit
- Pas de locking sur `paper_trading_state` · risque corruption RW concurrent
