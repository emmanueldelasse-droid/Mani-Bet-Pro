# Prod Safety Rules · sécurité runtime · auth · logs · rollback

## Référence sécurité historique
Audit complet MBP-A.4 · `docs/decisions/DECISION-001-SECURITY-AUDIT-MBP-A4.md` (6/6 critiques résolues).

## Auth · 3 systèmes en couches

| Système | Header / param | Routes protégées | Constante |
|---|---|---|---|
| Debug | query `?secret=...` | 5 routes NBA debug + `/debug/basketusa` + `/tennis/_espn_probe` + `/bot/settle` + `/bot/recover-missed` | `DEBUG_SECRET` |
| Paper | header `X-API-Key` | 4 routes `/paper/*` | `PAPER_API_KEY` |
| Bot run | header `X-Bot-Api-Key` | 8 routes POST quota provider | `BOT_RUN_API_KEY` |

Helpers · `_denyIfNoDebugAuth` worker.js:881 (fail-CLOSE) · `requirePaperApiKey` worker.js:898 · `requireBotRunApiKey` worker.js:914.

Règle absolue · toute route mutant état (POST/PUT/DELETE) doit requérir auth. Toute route consommant quota provider (Tank01 · Claude) doit requérir auth.

## Rate limit Claude · per-IP

Helper `_rateLimitIpHash(request)` worker.js:914 ·
- Hash SHA-256 tronqué (16 hex chars)
- Salt · `mbp-s4-salt-v1:`
- IP brute jamais stockée
- Cron Cloudflare exempté · namespace `'system'` (pas de header `CF-Connecting-IP`)

3 clés rate suffixées `_${ipHash}` · `ai_injuries_batch_rate_*` · `ai_player_props_rate_*` · `ai_injuries_rate_*`.

Spam d'un user n'épuise plus le quota des autres.

## Erreurs · règles

- Jamais retourner `err.message` brut au client
- Toujours `SAFE_ERROR_MSG_500` ou `SAFE_ERROR_MSG_UNAVAILABLE` (worker.js:233)
- Stack/err.message conservés dans `console.error` (logs Cloudflare owner only)

## Validation body POST/PUT

- `request.json()` toujours dans try/catch
- Enum valeur strictement whitelisted
- Check `content-length` avant parse si > 10KB

## CORS

- Whitelist origins · `ALLOWED_ORIGINS.includes(origin)` (worker.js:207)
- `===` strict equality · jamais `startsWith` (CRIT-C résolu)
- Allow-Headers étendu pour `X-API-Key` · `X-Bot-Api-Key`

## Logs structurés obligatoires

Format JSON · cron_run_id traçable.

Implémentation référence · `[BOT-CRON-LOG]` NBA worker.js:3287 (P2 · étendre MLB/Tennis).

Champs structurés obligatoires ·
- `cron` · `cron_run_id` (format `cr_<base36>_<base36>`)
- `cron_started` · `cron_finished` · `duration_ms`
- `espn_game_ids_seen` · `games_found` · `games_after_filters`
- `games_analyzed` · `games_skipped` · `skipped_game_ids` · `skipped_reason`
- `phase_detected`
- `pending_count` · `settled_count` · `missed_games_count`

Grep CF Dashboard utilitaires ·
- `[BOT-CRON-LOG]` · cron NBA structuré
- `[CATCHUP-SETTLE]` · catch-up settle
- `[CATCHUP-RECOVER]` · recovery missed
- `[NIGHTLY SETTLE]` · cron nightly

## Cron · règles

- Idempotence via KV `{sport}_bot_last_run` 30h TTL
- Cron NBA · `_runBotCron` worker.js:3287 · fenêtre 1h-2h avant 1er match
- Cron MLB · `_runMLBBotCron` worker.js:8261
- Cron Tennis · `_runTennisBotCron` worker.js:9762
- Nightly settle · `_runNightlySettle` worker.js:4347 · 10-11h UTC · idempotent `NIGHTLY_SETTLE_RUN_KEY` 48h
- Calibration · `_runCalibrationCron` worker.js:4502 · lundi 7h UTC · idempotent `calibration_run_YYYY-Www` 8j

## Catchup settle · règles

- Rate-limit `catchup_last_run_{sport}_{date}` · 5min gap minimum
- Rate-limit `recover_last_run_{sport}_{date}` · 5min gap minimum
- TTL 30h KV
- HTTP 429 si dernier run < 5min
- Détails complets · `docs/monitoring/CATCHUP_SETTLE.md`

## Recovery · règles absolues

- Aucune recommandation rétroactive
- `motor_prob` · `betting_recommendations` · `variables_used` · `signals` · `motor_was_right` jamais créés après début match
- `missed_by_cron` = statut terminal · jamais transformé en `settled`
- Stats EXCLUENT · `missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`

## Régression · obligation tests

Toute PR touchant ·
- Cron · stats · settlement · calibration · moteur · providers · monitoring · logs · storage

doit ·
- Tests automatisés Node ESM (`scripts/test-*.mjs`)
- Régression 0 fail sur les 6 suites existantes (parité NBA · gate dq · monitoring · classifier · tennis best bets · catchup)
- Total assertions actuelles · 750 (cf. SESSION.md)

## Rollback obligatoire

Procédure standard ·
```
git revert <merge-sha>
git push origin main
# CF auto-deploy reverse < 5min
```

PR sensibles imposant rollback documenté dans le body PR ·
- Cron · stats · settlement · calibration · moteur · providers · monitoring · logs · storage

## KV · règles

- Pas de modification schéma KV existant sans GO ChatGPT + créateur
- Pas de modification TTL existant sans justification documentée
- Nouvelles clés · documenter dans `docs/engine/DATA_PIPELINE.md` (section Caches KV)

## Secrets · règles

- Pas de secret en clair dans le code
- CF Dashboard secrets uniquement
- Pas de nouveau secret sans documentation (`SESSION.md` § Secrets Cloudflare)

## Observabilité

- CF Dashboard observability `enabled: true` (wrangler.jsonc)
- Logs Cloudflare préservés · err.message côté serveur uniquement
- Frontend `utils.logger.js` format console
- Routes publiques exposant logs · `/bot/logs` · `/mlb/bot/logs` · `/tennis/bot/logs`

## Front Paper (MBP-S.2.1)

- Si clé absente → settler skip · toast info au boot
- `PaperAuth` + `paperFetch` · UI Réglages
- Clé `localStorage` user uniquement · jamais transmise tierce
