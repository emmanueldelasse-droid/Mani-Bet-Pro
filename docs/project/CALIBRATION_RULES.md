# Calibration Rules · workflow recalibration · sample · métriques

Règles process. Détails statistiques · `docs/project/STATS_RULES.md`. Spec moteur par sport · `docs/engine/BETTING_LOGIC.md`.

## Cadre général

- Input · logs settled (`motor_was_right ≠ null`)
- Statuts EXCLUS · `missed_by_cron` · `postponed` · `cancelled` · `invalid_match_mapping` · `recovery_failed`
- Pas de recalibration sauvage sans GO ChatGPT
- Calibration = ajustement poids/seuils basé sur données · pas redesign moteur

## Datasets minimum par sport

| Sport | Cible | Actuel (mai 2026) | Statut |
|---|---|---|---|
| NBA | 80+ logs settled | 53 (v6.79) | INSUFFISANT · TODO P2 |
| MLB | 200+ logs settled | 421 (v6.94) | ATTEINT mais IC indistinguable random |
| Tennis | 100+ logs / phase | 273 mélangé 4 phases | INSUFFISANT par phase |

Tennis · risque sous-segmentation · 273 logs / (9 vars × 4 phases) ≈ 7-8 obs par couple variable×phase · insuffisant pour calibrer par phase.

## Critères déclenchement recalibration

Recalibration considérée seulement si ·
- Sample minimum sport-spécifique atteint
- Aucune recalibration précédente dans les 50 derniers logs (éviter pollution version mélangées)
- Métriques actuelles documentées + IC 95% calculé
- Effect size par variable + IC disponible

## Métriques obligatoires avant validation calibration

Avant proposer ajustement poids · calculer pour la fenêtre cible ·
- Hit rate global + IC 95% Wilson
- Hit rate par bucket edge + IC par bucket
- Hit rate par bucket motor_prob + IC par bucket (calibration plot)
- Hit rate par confidence (HIGH/MEDIUM/LOW/INCONCLUSIVE) + IC
- Brier score décomposé par bucket motor_prob
- ROI flat-stake (si `odds_at_analysis` disponible · sinon DIRE non calculable)
- CLV moyen (si `closing_odds` disponible · TODO P2 logger)
- Effect size par variable + IC

## Workflow ajustement poids

1. Alon agent (`.claude/agents/alon.md`) · rapport sur 50+ logs settled
2. ChatGPT review · effect size + IC par variable · validité statistique
3. Proposition ajustement poids documentée dans une ADR
4. Validation créateur (changement majeur calibration · cf `MERGE_PROTOCOL.md`)
5. PR avec tests régression
6. Forward validation 100+ logs post-déploiement avant déclarer succès

## Anti-overfit (rappel · détails `STATS_RULES.md`)

- Pas de poids ajusté sur < 50 obs/variable
- Pas de zone "profitable" déclarée sans IC 95% borne basse > 52.4%
- Backtest in-sample ≠ validation forward
- Recalibrage doit montrer effet stable sur fenêtre suivante · sinon revert

## Rollback calibration

- Toute calibration nouvelle = revertable via `git revert`
- Préserver historique version moteur dans les logs · TODO P2 ajouter champ `engine_version` à chaque log généré par cron

## Sport status flags (état mai 2026)

Mis à jour dans `docs/project/EXPERIMENTAL_FEATURES.md` · `docs/decisions/`.

| Sport | Maturité | Décision en attente |
|---|---|---|
| NBA | Prototype avancé (53 logs) | Recheck 80+ logs (TODO P2) |
| MLB | Expérimental (421 logs · random) | DECISION-003 · validation créateur requise |
| Tennis | Pré-production fragile (273 logs) | Validation post 50 logs v6.95+ · sous-phase IC trop large |

## Refonte vs ajustement

Refonte (changement formule · ajout vars · suppression vars structurelle) ·
- Nécessite ADR (`docs/decisions/`)
- Validation créateur obligatoire
- 300+ logs forward post-refonte avant validation

Ajustement (poids ±10% sur var existante) ·
- ChatGPT review suffit
- 100+ logs forward avant validation

## Sources empiriques cron

- `_runCalibrationCron` worker.js:4502 · lundi 7h UTC · Telegram résumé hebdo
- `/bot/calibration/analyze?sport=nba|mlb|tennis` · effect size par variable · buckets edge
- Limites actuelles · pas d'IC · pas de p-value · pas de Brier per bucket · TODO P2 enrichir
