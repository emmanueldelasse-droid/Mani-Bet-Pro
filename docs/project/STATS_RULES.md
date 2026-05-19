# Stats Rules · validation statistique edge

Règles transversales applicables à tous sports. Spec moteur par sport · `docs/engine/BETTING_LOGIC.md`.

## Principe fondamental

- ROI ≠ hit rate · gagner 51% sur cotes 1.80 = perte nette
- Une cible 55%+ ne fait pas un edge sans IC 95%
- Sophistication technique ≠ edge réel
- Backend = source canonique · jamais inventer data
- Pas de conclusion sans validation statistique
- Pas de recalibration sans sample suffisant

## IC 95% binomial Wilson · obligatoire

Tout hit rate exposé doit être accompagné de son IC 95% explicite.

Formule Wilson ·
- centre · `(p + z²/2n) / (1 + z²/n)` avec z=1.96
- demi-largeur · `z × √((p(1-p) + z²/4n) / n) / (1 + z²/n)`
- borne basse `IC_low` · centre − demi-largeur

Validation edge ·
- `IC_low > 52.4%` (juice 5% standard) requis pour déclarer edge réel
- Sinon · pas d'edge prouvé · interprétation seulement exploratoire

Tailles d'échantillon · ordre de grandeur IC ·
- n=50  · ±14 points
- n=100 · ±10 points
- n=200 · ±7 points
- n=500 · ±4.4 points
- n=1000 · ±3 points

## ROI flat-stake · formule obligatoire

- `profit = Σ(odds-1 si gagné · -1 si perdu)`
- `ROI = profit / nb_paris`
- Si `odds_at_analysis` indisponible · DIRE "ROI non calculable" · jamais extrapoler
- Mise unitaire = 1 unité par pari (flat) · ne pas mélanger avec Kelly réel

## CLV · Closing Line Value

- Définition · `(motor_prob/100 − implied_closing) × 10000` (basis points)
- Importance · prédicteur long-terme plus robuste que hit_rate sur petits samples
- À logger en P2 · `closing_odds` au coup d'envoi (TODO `EXPERIMENTAL_FEATURES.md`)
- Actuellement · `clv_post_match` calculé par log mais jamais agrégé en rapport

## Brier score · obligatoire par bucket motor_prob

- Définition · `Σ(motor_prob/100 − actual)² / n` · actual=1 si HOME gagne, sinon 0
- Random baseline · 0.250
- Bot calibré · 0.220-0.230 typique
- Buckets recommandés · [50-55%, 55-60%, 60-65%, 65-70%, 70-80%]
- Détection · overconfidence (Brier élevé sur bucket 70%) · underconfidence (Brier élevé bucket 55%)

## Calibration plot · obligatoire avant claim edge

- Pour chaque bucket motor_prob · compute hit_rate observé
- Plot motor_prob moyen (X) vs hit_rate réel (Y) · droite y=x = parfaite calibration
- Si bucket "60%" hit à 50% · overconfidence · ré-calibrer poids
- Si bucket "60%" hit à 70% · underconfidence · investiguer pourquoi

## Anti-overfit

- Pas de sous-segmentation post-hoc si `n_segment < 50` paris (sinon IC énorme)
- Cherry-picking edge zone = NON edge réel (ex: zone [5,10] sur 64 paris à 54.7% IC [42.6%, 66.3%])
- Recalibrage = valider sur fenêtre **forward** · pas in-sample
- Backtest in-sample ≠ validation forward

## Validation edge minimum (avant déclaration sport profitable)

Conditions cumulatives ·
- 100+ logs sport-spécifique settled
- IC 95% borne basse > 52.4% (juice 5%)
- CLV moyen ≥ 0 sur même sample (post-implémentation `closing_odds`)
- Brier score < 0.245 (random = 0.250)

Tant que une condition manque · sport reste en mode exploratoire.

## Catégorisation taille échantillon

| n logs | Catégorie | Usage |
|---|---|---|
| < 30 | INSUFFISANT | Pas de conclusion · debug seulement |
| 30-50 | TRÈS FAIBLE | Exploratoire · jamais publier |
| 50-100 | FAIBLE | Indicatif · pas de décision finale |
| 100-200 | ACCEPTABLE | Décisions cosmétiques (UX · seuils mineurs) |
| 200-500 | SOLIDE | Décisions calibration (poids · seuils) |
| 500+ | ROBUSTE | Refonte modèle · décisions structurelles |

## Distinction stricte

Toujours séparer dans les analyses ·
- Faits (chiffres vérifiés)
- Hypothèses (raisonnement basé sur faits)
- Intuitions (sans preuve directe)
- Extrapolations (projection · à valider)

Et ·
- Réel · logs settled · résultats observés
- Simulation · scripts test · fixtures
- Recovery · matchs détectés rétroactivement (jamais comptés en perf)
- Missed · trous cron · jamais comptés

## Paper trading ≠ preuve rentabilité

Le paper trading donne des stats opérationnelles mais ·
- Pas de slippage réel
- Pas de limite bookmaker
- Pas de tax/rake selon juridiction
- Pas de pression psychologique

Validation rentabilité réelle nécessite · CLV positif + paper >100 paris + analyse forward + décision créateur.

## Surfaces protégées (pas de pollution stats)

Le set `STATS_EXCLUDED_STATUSES` est défini dans le code (`worker.js:147`) et appliqué partout dans · `handleBotLogs` · `handleMLBBotLogs` · `handleTennisBotLogs` · `handleBotCalibration` · `scripts/lib/monitoring-summary.mjs`.

5 statuts exclus · `missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`.

Toute divergence entre `STATS_EXCLUDED_STATUSES` worker.js et `MONITORING_EXCLUDED_STATUSES` monitoring-summary.mjs = bug critique. Voir `docs/monitoring/CATCHUP_SETTLE.md`.
