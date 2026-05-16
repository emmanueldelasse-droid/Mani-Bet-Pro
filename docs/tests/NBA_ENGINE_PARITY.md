# Test parité moteur NBA · backend ↔ frontend

## Pourquoi ce test

Mani Bet Pro héberge 2 moteurs NBA distincts (audit MBP-A.2 CRIT-1) ·
- backend `_botEngineCompute` (worker.js:5211) · cron · logs · calibration
- frontend `EngineNBA.compute` (src/engine/engine.nba.js) · UI utilisateur

Sans test automatique, une correction d'un côté peut laisser l'autre
divergent (régressions historiques MBP-FIX-A.2.1 confidence · MBP-FIX-A.2.2
home_away_split).

Ce script compare les sorties clés des 2 moteurs sur des fixtures
déterministes · échoue si une régression critique est détectée · signale
les divergences connues sans bloquer.

## Comment lancer

Depuis n'importe quel cwd · Node 20+ requis (ESM natif · pas de dépendance npm) ·

```
node scripts/test-nba-engine-parity.mjs
```

Exit code · 0 OK · 1 régression critique détectée.

## Architecture

- `scripts/test-nba-engine-parity.mjs` · entry point · orchestration tests
- `scripts/lib/dom-stub.mjs` · stub minimal `window` + `localStorage` ·
  permet l'import en Node de `engine.core.js` (transite par `Logger`)
- `scripts/lib/backend-engine.mjs` · charge worker.js via `vm` (sandbox)
  et expose les fonctions pures `_bot*` · NE MODIFIE PAS worker.js ·
  fournit `getWeightsForPhase(phase)` qui monkey-patche temporairement
  `_botGetNBAPhase` pour lire les poids des 2 phases sans toucher au code
- `scripts/lib/fixtures.mjs` · 9 cas déterministes · pas de réseau · pas de KV

Aucun secret · aucune écriture KV · aucun appel provider · aucune
modification du moteur. Read-only intégral.

## Ce que ça couvre

### Parité des poids (regular + playoff)

Lecture directe des poids des 2 sources · **aucune valeur hardcodée dans
le test** ·
- backend · `_botGetWeights()` avec `_botGetNBAPhase()` monkey-patché
- frontend · `getNBAWeights(date)` avec date forcée (15 jan = regular ·
  15 mai = playoff)

Compare pour chaque phase ·
- 11 poids de variables (`net_rating_diff` · `efg_diff` · `recent_form_ema` ·
  `home_away_split` · `absences_impact` · `win_pct_diff` · `defensive_diff` ·
  `back_to_back` · `rest_days_diff` · `b2b_cumul_diff` · `travel_load_diff`)
- `score_cap` · `ema_lambda`
- nom de phase

Si une table de poids change dans worker.js OU sports.config.js sans
l'autre, ce test FAIL immédiatement.

### Engine outputs (chaque fixture × 2 phases)

- 11 variables NBA (raw + normalisée)
- score pondéré (sans `star_absence_modifier` post-score · sans cap final)
- `data_quality` (les 2 formules · binaire backend vs pondérée 8 niveaux
  frontend · divergence structurelle documentée)
- confidence NBA "real" (chaque côté avec son propre dq · informatif)
- confidence NBA "algo_synced" (même score + même dq → doit donner même
  label · utilise la **VRAIE fonction frontend**
  `EngineCore._computeConfidenceLevel('NBA', ...)` importée de
  `src/engine/engine.core.js` · validation MBP-FIX-A.2.1)

### Expects par fixture (assertions explicites)

3 clés `expects` reconnues par le runner ·
- `confidence` (string · label exact attendu)
- `confidence_in` (array · labels acceptables)
- `back_to_back_known_divergence` (boolean · marque MED-1 attendu)

Toute autre clé est ignorée · ne pas ajouter (la convention est
documentée en tête de `scripts/lib/fixtures.mjs`).

### Fixtures incluses

| ID | Couverture |
|---|---|
| `neutral_baseline` | sanity check · stats moyennes · pas de divergence |
| `b2b_home_only` | MED-1 · home en b2b · attendu KNOWN |
| `b2b_away_only` | MED-1 · away en b2b · attendu KNOWN |
| `b2b_both` | b2b neutralisé · 0 des 2 côtés |
| `high_signal_home` | confidence HIGH (assert via expects) |
| `balanced_match` | confidence LOW/MEDIUM/INCONCLUSIVE (assert via expects) |
| `home_away_split_asymmetric` | valide MBP-FIX-A.2.2 |
| `absences_impact_home_star` | valide absences_impact aligné |
| `missing_critical_data` | dégradation symétrique des 2 moteurs |

## Ce que ça NE couvre PAS

- **`star_absence_modifier` post-score** · les 2 côtés ont la même formule
  (audit MBP-A.2 §4) mais leur application au score final via cap +
  shrinkage marché n'est pas testée ici
- **`betting_recommendations` complet** · 4 marchés (MONEYLINE · SPREAD ·
  OVER_UNDER · PLAYER_POINTS) · audit MBP-A.2 §7 a confirmé la cohérence
  des formules · pas re-testé ici
- **`market_divergence` + shrinkage** · audit §7 valide même formule ·
  pas re-testé ici
- **`robustness_score`** · n'existe pas backend (MED-2 connu)
- **`_computeDecision` / `_checkImmediateRejection`** · concepts frontend
  uniquement (pas d'équivalent backend)
- **`EngineNBA.compute` end-to-end** · ce test compare les briques
  (variables · score · confidence) mais ne reconstruit pas le pipeline
  complet de la classe `EngineNBA` (qui inclut `assessMissing` ·
  `computeStarAbsenceModifier` · `score_cap` · `betting_recommendations`).
  Un test end-to-end est plus complexe et reste à concevoir si besoin.
- **Pipeline upstream `data.orchestrator.js`** · les fixtures fournissent
  des données déjà cohérentes entre `*_b2b_last5` / `*_away_games_last5`
  et `recent.matches`. Si l'orchestrateur réel produit des incohérences
  upstream, l'écart est invisible ici (audit séparé requis · MBP-A.5
  potentiel)
- **Moteur MLB ou Tennis** · hors scope MBP-A.2

## Divergences connues (non bloquantes)

| Champ | Backend | Frontend | Ticket | Impact |
|---|---|---|---|---|
| `var.back_to_back` (asymétrique) | -0.6 / +0.6 | -1 / +1 | MED-1 | contribution score ~0.004 saison · 0 playoff (poids 0.00) |
| `norm.back_to_back` (asymétrique) | -0.6 / +0.6 | -1 / +1 | MED-1 | hérite divergence raw |
| `data_quality.score` (toutes fixtures) | binaire 1-miss/total | moyenne pondérée 8 niveaux | structurel | Backend ~1.0 quand 0 var missing · frontend ~0.85-0.93 |
| `confidence.real` | utilise dq backend | utilise dq frontend | structurel | peut basculer label si dq sur le seuil 0.70 ou 0.50 |

Ces divergences sont **documentées** · ne font pas échouer le test.

## Garanties du test

Test FAIL si ·
- table de poids backend/frontend désynchronisée (regular OU playoff)
- formule d'une variable diverge (`home_away_split` · `efg_diff` · etc.)
- normalisation diverge (clamp · pivot)
- score diverge > 0.005 (régression poids · normalisation · formule)
- algo confidence NBA diverge entre `_botComputeConfidence` (worker.js)
  et `EngineCore._computeConfidenceLevel` (engine.core.js) ·
  **utilise la vraie fonction frontend importée · pas de copie**
- expects `confidence` / `confidence_in` ne matche pas le label calculé
- nouvelle variable backend pas répliquée frontend (ou inverse)

## Limites · maintenance

Le backend loader (`scripts/lib/backend-engine.mjs`) charge worker.js
comme texte et utilise `vm.runInContext` · si la structure du fichier
change (par ex. autre forme de `export default`) le loader signale
`backend loader · fonction X introuvable` (fail loud · pas de masque).

`dom-stub.mjs` stub `window.location.hostname` et `localStorage` pour
permettre l'import en Node de `utils.logger.js`. Si Logger évolue et
référence d'autres globals navigateur, étendre le stub.

Le test importe `EngineCore._computeConfidenceLevel` directement depuis
`src/engine/engine.core.js` · pas de duplication de logique. Toute
évolution future de la branche NBA dans cette fonction est captée
automatiquement (vs backend `_botComputeConfidence`).

Si une formule est volontairement adaptée (par ex. nouvelle MBP-FIX-A.2.x)
· mettre à jour ce test (fixtures ou tolérance) + ce doc dans la même PR.

## Étendre le test

Ajouter un cas de fixture ·
1. ouvrir `scripts/lib/fixtures.mjs`
2. ajouter une entrée dans `FIXTURES` (`id`, `label`, `data`, `expects?`)
3. respecter la convention `expects` documentée en tête du fichier · ne
   pas ajouter de clés non gérées par le runner

Ajouter un champ comparé ·
1. ouvrir `scripts/test-nba-engine-parity.mjs` `runCaseForPhase`
2. extraire la valeur backend + frontend
3. appeler `record(caseLabel, 'field.name', bVal, fVal, { tol, known, note })`
