# MBP-CATCHUP-SETTLE · catch-up settlement + missed games recovery

## Objet
- Settlement automatique rapide des matchs terminés
- Détection des matchs ratés par le cron (trous · "missed by cron")
- Séparation stricte · matchs analysés avant match vs matchs ratés / recovery
- Protection des stats de performance contre pollution des logs

## Règles absolues
1. **Aucune recommandation rétroactive** · le recovery ne crée JAMAIS de `motor_prob`, `betting_recommendations`, `variables_used`, `signals`, `motor_was_right` après le début du match
2. **Un match raté reste raté** · `status='missed_by_cron'` · jamais transformé en `settled`
3. **Statistiques protégées** · winrate, ROI, Brier, calibration, drawdown EXCLUENT 5 statuts (`missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`)
4. **Settlement conditionnel** · ne settle JAMAIS un log sans `motor_prob` (i.e. sans analyse pré-match)

## Statuts unifiés `BOT_LOG_STATUS` (worker.js:137)

| Statut | Origine | Compté dans stats ? |
|---|---|---|
| `pending` | log créé par cron, en attente match | non (pas encore réglé) |
| `settled` | match joué, résultat appliqué, `motor_was_right` calculé | **OUI** |
| `missed_by_cron` | match joué jamais analysé · créé via recovery endpoint | NON · pollution exclue |
| `recovery_failed` | détection trou cron · résultat indispo | NON |
| `postponed` | ESPN STATUS_POSTPONED · match reporté · neutralisé | NON |
| `cancelled` | ESPN STATUS_CANCELED · match annulé · neutralisé | NON |
| `invalid_match_mapping` | tennis · `match_confidence='LOW'` · risque homonymes · pas settle | NON |

Mapping ESPN → statut · `_espnStatusToBotLogStatus()` (worker.js:181) ·
- `STATUS_FINAL` · `STATUS_FINAL_OT` · `STATUS_FINAL_PENALTY` → `settled`
- `STATUS_POSTPONED` · `STATUS_SUSPENDED` · `STATUS_DELAYED` → `postponed`
- `STATUS_CANCELED` · `STATUS_CANCELLED` · `STATUS_FORFEIT` → `cancelled`
- `STATUS_SCHEDULED` · `STATUS_IN_PROGRESS` → null (log reste `pending`)

Back-compat · logs pré-PR sans `status` → `_botLogStatus(log)` dérive via `motor_was_right` (null=pending sinon=settled).

## API interne

### `settlePendingBotLogs(sport, env, opts)` worker.js:10985
Clôture les logs pending d'un sport sur une fenêtre de dates.
- `sport` · `'NBA'` · `'MLB'` · `'TENNIS'`
- `opts.dates` · array YYYYMMDD (défaut · NBA/MLB J-1 + J-2 · Tennis J-1 à J-10)
- `opts.force` · re-settle même si déjà settled (rare · debug uniquement)
- `opts.cronRunId` · trace cron (auto-généré sinon)
- `opts.source` · `'cron_nightly'` · `'admin_endpoint'`

Retour · `{ sport · cron_run_id · source · games_found · settled_count · postponed_count · cancelled_count · invalid_mapping_count · pending_count · errors · by_date }`

### `recoverMissedGames(sport, dateStr, env)` worker.js:11085
Détecte les matchs joués absents des logs · crée log minimaliste `status='missed_by_cron'`.
- Fetch matchs joués via ESPN scoreboard (NBA · MLB) ou ESPN tennis + api-tennis (Tennis)
- Pour chaque match · check si `bot_log_{id}` (préfixe sport) existe en KV
- Si absent · crée log avec champs sentinelles · jamais de `motor_prob`/`betting_recommendations`/`variables_used`

Retour · `{ sport · date · cron_run_id · found_in_live · already_logged · missed_added · missed_match_ids · errors }`

## Endpoints admin (guard `DEBUG_SECRET`)

### `GET /bot/settle?sport=NBA|MLB|TENNIS&scope=yesterday|today|date=YYYYMMDD&force=0|1`
- Wrapper · appelle `settlePendingBotLogs`
- Rate-limit · `catchup_last_run_{sport}_{date}` · 5min minimum entre 2 runs (HTTP 429 sinon)
- Réponse · summary settlePendingBotLogs

### `GET /bot/recover-missed?sport=NBA|MLB|TENNIS&date=YYYYMMDD`
- Wrapper · appelle `recoverMissedGames`
- Rate-limit · `recover_last_run_{sport}_{date}` · 5min minimum
- Réponse · summary recoverMissedGames

Exemples ·
```
curl "$WORKER/bot/settle?sport=NBA&scope=yesterday&secret=$DEBUG_SECRET"
curl "$WORKER/bot/settle?sport=TENNIS&date=20260518&secret=$DEBUG_SECRET"
curl "$WORKER/bot/recover-missed?sport=NBA&date=20260518&secret=$DEBUG_SECRET"
```

## Tennis · match_confidence (PR spécifique)

Évite settle un mauvais match (homonymes, doubles, ATP/WTA mélange, noms inversés).

| `match_confidence` | Détection | Action |
|---|---|---|
| `HIGH` | `event_id` ESPN OU 2+ tokens identiques prénom+nom | settle normal |
| `MEDIUM` | surname + initiale (`M. Kostyuk` vs `Marta Kostyuk`) | settle normal |
| `LOW` | surname-only · risque homonymes · frères/sœurs | `status='invalid_match_mapping'` · **PAS settle** · log warn |

Champs persistés tennis post-settle · `match_confidence` · `matched_by` (`event_id`/`full_name`/`surname_initial`/`surname_only`/`fallback_csv`) · `source_matching_used` (`espn`/`api_tennis`/`sackmann`).

## Champs log enrichis (post-PR)

Tous logs settlés via cron/admin contiennent désormais ·
- `status` · BOT_LOG_STATUS
- `settlement_source` · `'cron_nightly'` · `'admin_endpoint'`
- `settlement_attempts` · compteur incrémental
- `settlement_latency_minutes` · délai depuis début match
- `result_fetch_latency` · ms du fetch ESPN/api-tennis
- `live_status` · ESPN status brut (`STATUS_FINAL`...)
- `match_status_source` · `'espn_scoreboard'` · `'espn_mlb_scoreboard'` · `'espn_tennis'` · `'api_tennis'` · `'sackmann'`
- `cron_run_id` · `cr_<base36>_<base36>` pour tracer le run
- `match_confidence` (tennis uniquement)
- `matched_by` (tennis uniquement)
- `source_matching_used` (tennis uniquement)

Logs `missed_by_cron` (recovery) contiennent en plus ·
- `missed_reason` · `'no_log_at_cron_time'`
- `recovery_detected_at` · ISO timestamp création
- `source_recovery` · `'recovery_endpoint'`
- Champs sentinelles `null` · `motor_prob` · `motor_was_right` · `betting_recommendations` · `variables_used` · `signals` · `best_edge` · `best_side`

## Logs structurés JSON `_runBotCron` (NBA)

Au démarrage et fin du cron NBA, un log JSON structuré est émis ·
```json
{
  "cron": "nba_bot",
  "cron_run_id": "cr_xxx_yyy",
  "cron_started": "2026-05-18T18:30:00.000Z",
  "cron_finished": "2026-05-18T18:30:42.000Z",
  "duration_ms": 42000,
  "date": "20260518",
  "force_run": false,
  "phase_detected": "playoff",
  "espn_game_ids_seen": [{ "id": "401715xxx", "home": "OKC", "away": "SAS", "status": "STATUS_SCHEDULED" }],
  "games_found": 4,
  "games_after_filters": 3,
  "games_analyzed": 3,
  "games_skipped": 1,
  "skipped_game_ids": [{ "id": "401715yyy", "reason": "already_final" }],
  "skipped_reason": [],
  "pending_count": 3,
  "settled_count": 0,
  "missed_games_count": 0,
  "edges_found": 1
}
```

Mots-clés grep CF Dashboard · `[BOT-CRON-LOG]` (NBA). Permet d'auditer rétroactivement pourquoi un match a été raté.

## Idempotence & rate-limit

- `catchup_last_run_{sport}_{date}` · 5 min gap minimum · TTL 30h
- `recover_last_run_{sport}_{date}` · idem (préfixe distinct)
- Settle dans le cron nightly (`_runNightlySettle` worker.js:4347) appelle `settlePendingBotLogs` pour 3 sports · idempotent via `NIGHTLY_SETTLE_RUN_KEY` 48h existant
- Sans `force=1`, un log déjà settled n'est jamais re-settled (`_botLogStatus !== PENDING`)

## Tests

`node scripts/test-catchup-settle.mjs` · 86 assertions ·
- Constants statuts
- Back-compat `_botLogStatus`
- Mapping ESPN
- Format `_botCronRunId`
- Pipeline filter stats
- `recoverMissedGames` · règle absolue (pas de motor_prob retro · idempotence)
- `_normalizeSportParam`
- Rate-limit
- `settlePendingBotLogs` skip si pas `motor_prob`
- `_defaultSettleDates` par sport

Tests existants 649 assertions · 0 régression (parité NBA · gate dq · monitoring · classifier · tennis best bets).

## Non-objectifs (hors scope cette PR)
- Pas de cron quotidien automatique de recovery (P3 · à activer après validation manuelle)
- Pas d'alerte Telegram missed games (P3)
- Pas de modification moteur · poids · seuils
- Pas de modification des sources data (ESPN/api-tennis/Sackmann ordre existant préservé)
