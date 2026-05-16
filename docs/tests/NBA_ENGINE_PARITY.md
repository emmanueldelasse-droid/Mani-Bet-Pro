# Test parité moteur NBA · backend ↔ frontend

## Pourquoi ce test

Mani Bet Pro héberge 2 moteurs NBA distincts (audit MBP-A.2 CRIT-1) ·
- backend `_botEngineCompute` (worker.js:5211) · cron · logs · calibration
- frontend `EngineNBA.compute` (src/engine/engine.nba.js) · UI utilisateur

Ces 2 moteurs doivent rester équivalents · sans test automatique, une
correction d'un côté peut laisser l'autre divergent (régressions
MBP-FIX-A.2.1 confidence · MBP-FIX-A.2.2 home_away_split).

Ce script compare les sorties clés des 2 moteurs sur des fixtures
déterministes · échoue si une régression critique est détectée · signale
les divergences connues sans bloquer.

## Comment lancer

Depuis la racine du repo · Node 20+ requis (ESM natif · pas de
dépendance npm) ·

```
node scripts/test-nba-engine-parity.mjs
```

Exit code · 0 OK · 1 régression critique détectée.

## Architecture

- `scripts/test-nba-engine-parity.mjs` · entry point · orchestration tests
- `scripts/lib/backend-engine.mjs` · charge worker.js via `vm` (sandbox)
  et expose les fonctions pures `_bot*` · NE MODIFIE PAS worker.js
- `scripts/lib/fixtures.mjs` · 9 cas déterministes · pas de réseau · pas de KV

Aucun secret · aucune écriture KV · aucun appel provider · aucune
modification du moteur. Read-only intégral.

## Ce que ça couvre

Pour chaque fixture · les 2 phases (saison régulière + playoff)

- 11 variables NBA (`net_rating_diff`, `efg_diff`, `recent_form_ema`,
  `home_away_split`, `absences_impact`, `win_pct_diff`, `defensive_diff`,
  `back_to_back`, `rest_days_diff`, `b2b_cumul_diff`, `travel_load_diff`)
- normalisation par variable
- score pondéré (sans `star_absence_modifier` · sans cap · brut)
- `data_quality` (les 2 formules · simple binaire backend vs pondérée 8 niveaux frontend)
- confidence NBA réelle (avec dq respectif de chaque côté)
- confidence NBA "algo synced" · même score · même dq · doit donner même label

Fixtures couvrant ·
- baseline neutre
- back_to_back home seul / away seul / les deux (MED-1)
- match très favorable home (attendu HIGH confidence)
- match équilibré (attendu LOW/INCONCLUSIVE)
- home_away_split asymétrique (validation MBP-FIX-A.2.2)
- absences star home (validation absences_impact + star_absence_modifier)
- données critiques manquantes

## Ce que ça NE couvre PAS

- `star_absence_modifier` appliqué post-score · les 2 côtés ont la même
  formule mais leur application au score est testée ailleurs (audit MBP-A.2)
- `score_cap` par phase · trivial · pas testé explicitement
- `betting_recommendations` complet · marchés ML/SPREAD/O_U/PLAYER_POINTS ·
  hors scope de ce test (audit MBP-A.2 §7 a confirmé cohérence)
- `market_divergence` · cohérent (audit MBP-A.2 §7 même formule)
- `robustness` · n'existe pas backend (MED-2 connu)
- `_computeDecision` / `_checkImmediateRejection` · n'existent pas backend
- moteur MLB ou Tennis (hors scope MBP-A.2)
- pipeline upstream `data.orchestrator.js` · fixtures fournissent données
  pré-alignées · si l'orchestrateur réel diverge entre `*_b2b_last5` et
  `recent.matches`, l'écart est invisible ici (à auditer séparément)

## Divergences connues (non bloquantes)

| Champ | Backend | Frontend | Ticket | Impact |
|---|---|---|---|---|
| `var.back_to_back` (asymétrique) | -0.6 / +0.6 | -1 / +1 | MED-1 | contribution score ~0.004 saison · 0 playoff (poids 0.00) |
| `norm.back_to_back` (asymétrique) | -0.6 / +0.6 | -1 / +1 | MED-1 | hérite divergence raw |
| `data_quality.score` (toutes fixtures) | binaire 1-miss/total | moyenne pondérée 8 niveaux | structurel | Backend ~0.99 quand 1 var missing · frontend ~0.91 |
| `confidence.real` | utilise dq backend | utilise dq frontend | structurel | peut basculer label si dq sur le seuil 0.70 ou 0.50 |

Ces divergences sont **documentées** · ne font pas échouer le test.

## Divergences critiques détectées en cas de FAIL

Si le test échoue (exit 1) · un des cas suivants ·
- formule d'une variable diverge (`home_away_split`, `efg_diff`, etc.)
- normalisation diverge (clamp · pivot)
- score diverge > 0.005 (régression de poids · normalisation · formule)
- confidence algo divergent (`confidence.algo_synced`) · alignement
  MBP-FIX-A.2.1 cassé
- nouvelle variable backend pas répliquée frontend (ou inverse)

## Limites · maintenance

Le backend loader (`scripts/lib/backend-engine.mjs`) charge worker.js
comme texte et utilise `vm.runInContext` · si la structure du fichier
change (par ex. autre forme de `export default`) le loader doit être
adapté. Le test signale `backend loader · fonction X introuvable` plutôt
que de masquer.

La fonction `frontConfidenceNBA` du runner reproduit verbatim la branche
NBA de `engine.core.js:325-331`. Si cette branche change frontend sans
backend correspondant (ou inverse), le test `confidence.algo_synced` FAIL.

Si une formule est volontairement adaptée (par ex. nouvelle MBP-FIX-A.2.x)
· mettre à jour ce test + ce doc dans la même PR.

## Étendre le test

Ajouter un cas de fixture ·
1. ouvrir `scripts/lib/fixtures.mjs`
2. ajouter une entrée dans `FIXTURES` (id · label · data · expects)
3. si attendu détecte une divergence connue · documenter ici + ajouter
   un flag dans `expects` traité par le runner

Ajouter un champ comparé ·
1. ouvrir `scripts/test-nba-engine-parity.mjs` `runCaseForPhase`
2. extraire la valeur backend + frontend
3. appeler `record(caseLabel, 'field.name', bVal, fVal, { tol, known, note })`
