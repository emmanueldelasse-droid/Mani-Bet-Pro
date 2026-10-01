# Calibration Rules · workflow recalibration · sample · métriques

Règles process. Détails statistiques · `docs/project/STATS_RULES.md`. Spec moteur par sport · `docs/engine/BETTING_LOGIC.md`.

## Cadre général

- Input · logs settled (`motor_was_right ≠ null`)
- Statuts EXCLUS · `missed_by_cron` · `postponed` · `cancelled` · `invalid_match_mapping` · `recovery_failed`
- Pas de recalibration sauvage sans GO ChatGPT
- Calibration = ajustement poids/seuils basé sur données · pas redesign moteur

## Datasets minimum par sport

| Sport | Cible recalibration | État exploitable | Statut |
|---|---|---|---|
| NBA | 80+ logs settled **même engine_version** | historique v6.79 non assimilable silencieusement à `nba-2026.10.01-baseline` | nouvelle baseline · forward validation requise |
| MLB | 200+ logs settled | audit 421 logs v6.94 à finaliser | sample atteint · edge non prouvé |
| Tennis | 100+ logs / phase | historique mélangé plusieurs phases | insuffisant par phase |

Edge réel · règle plus stricte `BOT_OBJECTIVE.md` · 100+ logs sport-spécifiques + Wilson `IC_low > 52.4%` + CLV ≥ 0 + Brier < 0.245.

Pré-saison NBA · pipeline/qualité uniquement · ne pas mélanger aux métriques regular/postseason.

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
- CLV moyen · NBA : closing line pré-tip capturée quand snapshot éligible · autres sports : dire non calculable si absente
- Effect size par variable + IC

## Workflow ajustement poids

1. Alon agent (`.claude/agents/alon.md`) · rapport segmenté sport + version + phase + checkpoint
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
- Chaque analyse NBA porte désormais `engine_version` et `analysis_schema_version`.
- Calibration/backtest : **ne jamais mélanger plusieurs `engine_version` dans un même échantillon principal** sans breakdown explicite.
- Baseline actuelle : `nba-2026.10.01-baseline` · schéma `nba-analysis-v1`.
- Règle de bump : changement prédictif (formule/poids/seuil/variable/gate décisionnel) ⇒ nouvelle `engine_version`. Changement incompatible de structure/sémantique de payload ⇒ nouvelle `analysis_schema_version`.

## Sport status flags · 01/10/2026

Mis à jour dans `docs/project/EXPERIMENTAL_FEATURES.md` · `docs/decisions/`.

| Sport | Maturité | Décision en attente |
|---|---|---|
| NBA | nouvelle baseline versionnée · pré-saison observation | accumuler forward regular-season sur même `engine_version` |
| MLB | expérimental · audit empirique disponible | DECISION-003 · validation créateur requise |
| Tennis | pré-production fragile · phases séparées | forward par phase + IC |

## Refonte vs ajustement

Refonte (changement formule · ajout vars · suppression vars structurelle) ·
- Nécessite ADR (`docs/decisions/`)
- Validation créateur obligatoire
- 300+ logs forward post-refonte avant validation

Ajustement (poids sur var existante) ·
- Validation créateur obligatoire · `MERGE_PROTOCOL.md` classe calibration comme changement majeur
- 100+ logs forward avant validation

## Sources empiriques cron

- `_runCalibrationCron` worker.js:4502 · lundi 7h UTC · Telegram résumé hebdo
- `/bot/calibration/analyze?sport=nba|mlb|tennis` · effect size par variable · buckets edge
- Limites actuelles · pas d'IC · pas de p-value · pas de Brier per bucket · TODO P2 enrichir
