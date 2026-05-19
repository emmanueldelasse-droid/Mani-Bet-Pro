# DECISION-003 · MLB v6.94 calibration · zone edge [5,10] cherry-picking

## Statut
**proposed · validation créateur requise**

Aucune désactivation MLB actée à ce stade. Cette ADR documente une recommandation issue d'un audit structurel + IC 95% recalculé sur chiffres v6.94 cités dans le code. Audit empirique sur dump 421 logs réels reste à exécuter avant décision finale.

## Contexte

### Données empiriques disponibles
- Commentaires worker.js:8497-8498 cités · 315 logs settled v6.94 · hit rate 49.8%
- Sample utilisateur déclaré · 421 logs au total (mai 2026 · non vérifié par mesure live)
- IC 95% Wilson recalculé · [44.2%, 55.3%] sur 315 logs · borne basse < 50% · indistinguable random

### Zone "profitable" annoncée
worker.js:8619-8623 commentaires ·
- `edge_10+` · 215 paris · 49.3% (piège)
- `edge_7-10` · 64 paris · 54.7% (zone profitable annoncée)
- `edge_5-7` · 21 paris · 52.4%
- `edge_0-5` · 15 paris · 33.3%

IC 95% recalculé `edge_7-10` · [42.6%, 66.3%] sur 64 paris. La borne basse 42.6% ne dépasse PAS le breakeven juice 5% (52.4%). La zone n'est statistiquement PAS distinguable du random sur ce sample.

### Garde-fou existant
- Backend `worker.js:8629` · `if (edge >= 5 && edge <= 10)` · filtre recos
- Frontend `data.orchestrator.js:1408` · `if (edge >= 5)` SANS cap supérieur · divergence non patchée

### Limites structurelles moteur
- 4 variables actives (`pitcher_fip_diff` 0.18 · `last10_form_pct` 0.20 · `ops_adv_pct` 0.14 · `weather_adv_pct` 0.03)
- 7 variables MORTES extraites pour rien
- Formule simpliste · `homeProb = 0.536 + Σ(adv × tanh(diff/scale))` clamp [0.20, 0.80]
- Aucune intégration lineups confirmés · handedness · bullpen fatigue · phase playoff

## Options envisagées

### Option A · monitoring seulement (status quo)
- Continuer logger sans changer
- Risque · paris paper structurellement perdants · pollution confiance globale
- Rejet · IC 95% confirme NON edge

### Option B · MLB moneyline désactivé temporairement
- Implémentation · forcer `recommendations=[]` et `best=null` pour `type === 'MONEYLINE'` dans `_mlbEngineCompute`
- O/U et strikeouts conservés (data différente · à auditer séparément)
- Réversible · pas de perte data
- Bannière UI · "Moteur MLB moneyline désactivé · revalidation en cours"

### Option C · refonte complète moteur MLB
- Ajouter sources data manquantes (lineups · handedness · bullpen fatigue · phase playoff)
- Ré-écrire `_mlbEngineCompute` avec ces inputs
- Effort estimé · 4-8 semaines
- Validation · 300+ logs forward post-refonte · IC borne basse > 52.4%

### Option D · sous-zone exploitable précise
- Sous-segmenter encore zone edge_7-10 (par DQ · pitcher confirmé · bucket motor_prob)
- Refus · sample n=10-20 par sous-segment · IC trop large pour conclusion

## Recommandation Claude (non validée)

Combinaison B + C ·
- B immédiat · neutralise paris perdants
- C en parallèle · scope formel via ADR ultérieure si validé créateur

Cette recommandation N'EST PAS une décision actée. Elle attend ·
1. Audit empirique réel sur dump 421 logs (curl `/mlb/bot/logs` ou agent `alon`)
2. Review ChatGPT formelle
3. Validation créateur (changement majeur · cf MERGE_PROTOCOL.md)

## Alternatives rejetées
- Option A · IC 95% indique NON edge
- Option D · sous-sample insuffisant statistique

## Conséquences si décision Option B retenue

### Positives
- Pas de pollution stats user pendant refonte
- Refonte parallèle possible
- Logs continuent · settlement reste fonctionnel (MBP-CATCHUP-SETTLE)

### Négatives
- Réduction couverture sport pendant durée refonte (~ 4-8 semaines)
- Apparence "perte de feature" même si feature non profitable

### Risques résiduels
- O/U et strikeouts MLB pas audités séparément · IC inconnu
- Re-déclaration profitabilité prématurée si refonte mal calibrée

## Métriques validation refonte (si Option C engagée)
- 300+ logs forward post-déploiement
- IC 95% borne basse > 52.4%
- CLV moyen ≥ 0 (pré-requis · logger `closing_odds`)
- Brier < 0.245
- Calibration plot acceptable (motor_prob 60% → hit 58-62%)

## Prochaine étape recommandée
1. Curl `/mlb/bot/logs` → dump JSON 421 logs
2. Exécuter agent `alon` ou script analyse · recalcul IC réel par bucket
3. ChatGPT review formelle DECISION-003 avec données réelles
4. Validation créateur GO/NOGO Option B + scope C

## Validation
- ChatGPT review · à venir (cette ADR)
- Créateur GO · NON · attente audit empirique réel + review formelle

## Références code
- `worker.js:8421` · `_mlbEngineCompute`
- `worker.js:8585` · formule `homeProb = 0.536 + Σ(adv × tanh)`
- `worker.js:8629` · garde-fou edge [5,10] backend
- `data.orchestrator.js:1408` · divergence frontend (cap manquant)
- `worker.js:8497-8498` · commentaire 49.8% / 315 logs
- `worker.js:8619-8623` · commentaire buckets edge cités
