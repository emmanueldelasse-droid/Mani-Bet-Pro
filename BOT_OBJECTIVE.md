# BOT_OBJECTIVE · Mani Bet Pro · objectif racine

Fichier racine · objectif réel du bot. Vision produit détaillée · `docs/project/PROJECT_VISION.md`. Spec moteur · `docs/engine/BETTING_LOGIC.md`.

## Objectif réel
- Moteur d'aide à la décision paris sportifs · analyser · détecter edge vs marché · expliquer · loguer · apprendre
- Système d'apprentissage · logs settlés → recalibration poids variables par sport
- But final · prouver statistiquement un edge réel AVANT tout engagement argent réel

## Scope
- NBA · MLB · Tennis (3 sports actuellement)

## Hors périmètre
- Argent réel automatique · placeur automatique de paris réels (paper trading uniquement)
- Live betting · in-game · cash-out (pré-match seulement)
- Tipster commercial · bookmaker · chatbot conversationnel
- Sports non documentés · trading financier · comptes utilisateurs multi-tenant
- Détails exhaustifs · `docs/project/PROJECT_VISION.md` § Hors périmètre

## Métriques cibles
- Hit rate · cible > 55% · toujours accompagné IC 95% Wilson (`IC_low > 52.4%` pour edge réel)
- ROI flat-stake · `Σ(odds-1 si gagné · -1 si perdu) / nb_paris` · si cote indispo → "ROI non calculable"
- CLV · Closing Line Value · `(motor_prob/100 − implied_closing) × 10000` bps · cible ≥ 0
- Brier score · cible < 0.245 (random = 0.250) · décomposé par bucket motor_prob
- IC Wilson · borne basse obligatoire sur tout hit rate exposé
- Définitions complètes · `docs/project/STATS_RULES.md`

## Statut
- Paper trading uniquement tant que edge non prouvé statistiquement
- Validation edge minimum (cumulatif) · 100+ logs sport-spécifique · `IC_low > 52.4%` · CLV ≥ 0 · Brier < 0.245
- Tant qu'une condition manque → sport reste exploratoire
- État maturité par sport · `docs/project/CALIBRATION_RULES.md` § Sport status flags
