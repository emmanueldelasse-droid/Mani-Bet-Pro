# DECISION-004 · MBP-CATCHUP-SETTLE · settlement + recovery + protection stats

## Statut
**accepted · mergé PR #205 · commit `efc8730` · build `f9cd992`**

Validation prod manuelle des endpoints en cours (responsabilité créateur).

## Contexte

### Problèmes constatés
- Matchs joués ratés par le cron (ex hypothèse OKC vs SAS 18/05/2026) jamais settlés ni détectés
- Stats `hit_rate` polluées potentiellement par matchs non analysés (logs absents = pas comptés mais aucune visibilité)
- Aucun statut explicite des logs (pending / settled / postponed / cancelled / invalid)
- Aucune route admin pour relancer settle ou détecter trous

### Règles à préserver
- Aucune recommandation rétroactive (jamais créer `motor_prob` après début match)
- Backend = source canonique
- Stats `hit_rate` / ROI / Brier / calibration ne doivent JAMAIS inclure les logs créés rétroactivement

## Décision

Système unifié avec ·

### 7 statuts de log (`BOT_LOG_STATUS` worker.js:137)
- `pending` · log créé par cron · en attente match
- `settled` · résultat appliqué · `motor_was_right` calculé
- `missed_by_cron` · match joué jamais analysé · créé via recovery (minimaliste)
- `recovery_failed` · détection trou cron · résultat indispo
- `postponed` · ESPN STATUS_POSTPONED · neutralisé
- `cancelled` · ESPN STATUS_CANCELED · neutralisé
- `invalid_match_mapping` · tennis · `match_confidence='LOW'` · risque homonymes

### 5 statuts EXCLUS des stats (`STATS_EXCLUDED_STATUSES`)
- `missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`
- Appliqué dans · `handleBotLogs` · `handleMLBBotLogs` · `handleTennisBotLogs` · `handleBotCalibration` · `scripts/lib/monitoring-summary.mjs`
- Alignement strict `MONITORING_EXCLUDED_STATUSES` requis (divergence = bug critique)

### Tennis · match_confidence HIGH/MEDIUM/LOW
- HIGH · `event_id` ESPN OU 2+ tokens prénom+nom identiques
- MEDIUM · surname + initiale
- LOW · surname-only → `status='invalid_match_mapping'` + `missed_reason='event_id_missing'` · PAS settle

### Nouvelles fonctions
- `settlePendingBotLogs(sport, env, opts)` · wrapper sport-agnostic
- `recoverMissedGames(sport, dateStr, env)` · création log `missed_by_cron` minimaliste · sentinelles `null` (motor_prob · betting_recommendations · variables_used · signals)

### 2 routes admin (guard DEBUG_SECRET · rate-limit 5min)
- `GET /bot/settle?sport=...&scope=yesterday|today|date=...`
- `GET /bot/recover-missed?sport=...&date=...`

### Cron NBA · logs JSON structurés
`[BOT-CRON-LOG]` JSON · cron_run_id · espn_game_ids_seen · skipped_game_ids · phase_detected · pending/settled/missed_count.

## Alternatives rejetées

### Settle automatique avec recalcul moteur
Rejet · viole règle absolue "jamais de recommandation rétroactive". Un match recalculé après début match aurait accès à des informations post-coup (résultat lineups · score partiel · etc).

### Statuts simples (juste pending/settled)
Rejet · pas de granularité postponed/cancelled/invalid · empêche audit traçable et pollue stats.

### Suppression totale logs missed
Rejet · perte information sur trous cron · pas d'auditabilité.

## Conséquences

### Positives
- Stats protégées · 5 statuts exclus partout
- Audit logs structurés (cron_run_id traçable)
- Détection trous cron via endpoint dédié
- Tennis · protection contre faux match (homonymes frères/sœurs)

### Négatives
- Complexité accrue · 7 statuts à maintenir
- ~755 lignes worker.js ajoutées
- 2 surfaces stats à aligner (worker.js + monitoring-summary.mjs)

### Risques résiduels
- Race condition KV settle+recover concurrent · mitigé par check `_botLogStatus !== PENDING` avant write (idempotent mais pas lock vrai)
- Coût quota ESPN/api-tennis sur recover · mitigé rate-limit 5min KV
- Faux missed possibles si ESPN retourne `STATUS_SCHEDULED` (reste pending OK)
- Vieux logs >90j TTL · recoverMissedGames inutile

## Métriques validation
- 750 assertions tests (101 catch-up + 649 régression) · 0 fail
- Validation prod manuelle endpoints · responsabilité créateur post-déploiement
- 1 semaine sans bug observable CF Dashboard
- OKC vs SAS détecté comme `missed_by_cron` si absent KV

## Validation
- ChatGPT review · GO formel (review logique pré-merge)
- Créateur GO merge · accepted (squash-merge PR #205 commit `efc8730`)
- Validation prod endpoints réels · en cours (NOGO formel jusqu'aux tests OK)

## Références code
- worker.js:137-194 · constantes `BOT_LOG_STATUS` · `STATS_EXCLUDED_STATUSES` · helpers
- worker.js:3978-4083 · `_botSettleDate` enrichi (NBA · postponed/cancelled)
- worker.js:9221-9282 · `_mlbBotSettleDate` enrichi (MLB · postponed/cancelled)
- worker.js:10571-10720 · `_tennisBotSettleDate` enrichi (tennis · `match_confidence`)
- worker.js:10985+ · `settlePendingBotLogs` · `recoverMissedGames` · `handleBotCatchupSettle` · `handleBotRecoverMissed`
- scripts/test-catchup-settle.mjs · 101 assertions
- scripts/lib/monitoring-summary.mjs · `MONITORING_EXCLUDED_STATUSES` filter

## Documentation associée
- `docs/monitoring/CATCHUP_SETTLE.md` · spec utilisateur · règles API · tests
- `docs/monitoring/ROUTES_AUDIT.md` · 2 routes ajoutées
- `docs/engine/BETTING_LOGIC.md` · §"Logs missed_by_cron jamais comptés"
- PR GitHub · https://github.com/emmanueldelasse-droid/Mani-Bet-Pro/pull/205
