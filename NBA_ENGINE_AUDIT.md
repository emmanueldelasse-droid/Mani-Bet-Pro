# NBA engine audit · MBP-A.2

Audit documentaire pur · aucun code modifié. Méthode · 3 agents Explore en parallèle (backend · frontend modules · UI rendering) + vérifications directes des appels.

## 0. Découverte structurelle majeure

**Mani Bet Pro héberge 2 moteurs NBA distincts qui coexistent** ·

| Moteur | Localisation | Quand exécuté | Sortie | Consommateur |
|---|---|---|---|---|
| **Backend** | `worker.js:5211` `_botEngineCompute` | Cron horaire NBA `_runBotCron` (worker.js:3528) | Logs KV `bot_log_{matchId}` | Calibration Alon · `/bot/logs` · `/bot/calibration/analyze` |
| **Frontend** | `src/engine/engine.core.js` + `src/engine/engine.nba.*` | À chaque chargement page dashboard/match-detail (`data.orchestrator.js:857`) | `AnalysisOutput` dans store | UI utilisateur · `src/ui/match-detail.js` · `src/ui/ui.dashboard.js` |

**Aucune route HTTP `/nba/analyze`** · l'UI ne consomme jamais le moteur backend. Les 2 moteurs ne se synchronisent pas. Ils sont supposés être équivalents mais l'audit a identifié plusieurs divergences (voir §6).

**Implication métier critique** ·
- L'utilisateur voit les recos calculées par le **frontend**
- L'historique de paris settlés (`bot_log_*`) est calculé par le **backend**
- La calibration Alon analyse les logs **backend** uniquement
- Une optimisation calibration backend (poids · seuils) ne change rien à ce que voit l'utilisateur tant que le frontend n'est pas resynchronisé

## 1. Pipeline complet NBA

### 1.1 Pipeline UI (live · utilisateur)

```
Utilisateur ouvre dashboard NBA
  → src/ui/ui.dashboard.js render
  → src/orchestration/data.orchestrator.js loadAndAnalyze
    → Promise.all parallèle ·
       fetch /nba/matches               (ESPN scoreboard)
       fetch /nba/team-detail           (Tank01 + ESPN + injuries)
       fetch /nba/injuries              (ESPN + Tank01 + Claude)
       fetch /nba/team/:abv/recent      (BallDontLie)
       fetch /nba/odds/comparison       (TheOddsAPI + Pinnacle)
    → buildRawData(matches, advancedStats, injuries, recentForms, odds)
    → EngineCore.compute('NBA', rawData)
      → EngineNBA.compute(matchData)
        → engine.nba.variables.js · extractVariables
        → engine.nba.score.js · computeScore
        → engine.nba.betting.js · computeBettingRecommendations
      → EngineRobustness.compute  (perturbation ±10% ±20%)
      → _computeConfidenceLevel    (min(robust_eff, dq))
      → _computeDecision           (ANALYSER/EXPLORER/INSUFFISANT/REJETÉ)
    → store.set({ analyses, matches, ... })
  → ui.match-detail.js render · transformations cosmétiques
```

### 1.2 Pipeline Bot (cron · logs)

```
Cloudflare scheduled() 0 * * * *
  → _runBotCron(env) worker.js:3204
    → fetch ESPN scoreboard
    → fetch Tank01 rosters + stats
    → fetch BDL recent forms
    → fetch TheOddsAPI odds
    → handleNBAAIInjuriesBatch (Claude AI optionnel)
    → pour chaque match ·
       _botAnalyzeMatch(match, ...) worker.js:3384
         → _botExtractVariables                 (worker.js:5014)
         → _botEngineCompute                    (worker.js:5211)
           → _botGetWeights (regular/playoff)
           → _botNormalizeVariables
           → _botComputeScore                    (worker.js:5166)
           → star_absence_modifier
           → score_cap
           → _botComputeMarketDivergence + shrinkage
           → _botComputeBettingRecs              (worker.js:5334)
           → _botPredictNBATotal                 (worker.js:5398)
           → _botPredictPlayerPoints             (worker.js:5592)
         → _botComputeConfidence(analysis, dataQuality)  (worker.js:5888)
         → _botSaveLog                           (worker.js:3606)
  → KV bot_log_{matchId} 90j
  → Telegram notification edges du jour
```

## 2. Variables · backend vs frontend

11 variables NBA · sources data identiques mais quelques transformations divergent.

| Variable | Source | Backend (worker.js) | Frontend (src/engine) | Statut |
|---|---|---|---|---|
| `net_rating_diff` | Tank01 | clamp [-10,10] | clamp [-10,10] | ✓ identique |
| `efg_diff` | ESPN guard | clamp [-0.07,0.07] | clamp [-0.07,0.07] | ✓ identique |
| `recent_form_ema` | BDL | EMA λ=0.85/0.92 | EMA λ=0.85/0.92 | ✓ identique |
| `home_away_split` | ESPN | `(h_home - h_away) - (a_away - a_home)` clamp [-0.5, 0.5] | `(home_pct - away_pct) × 2` clamp [-1, 1] | ⚠ **DIVERGENT** (à vérifier · formules différentes) |
| `absences_impact` | ESPN+Tank01+Claude | weight + status_factor + glFactor · norm 5.0/1.0 | weight + status_factor · norm factor | ✓ proche · à vérifier détail |
| `win_pct_diff` | ESPN | guard [0.01, 0.99] · brut | guard [0.01, 0.99] · brut | ✓ identique |
| `defensive_diff` | Tank01 oppg (inversé) | clamp [-5, 5] | clamp [-5, 5] | ✓ identique |
| `back_to_back` | ESPN schedule | valeur -0.6 / 0 / +0.6 | valeur -1 / 0 / +1 | ⚠ **DIVERGENT** (contribution 67% différente) |
| `rest_days_diff` | BDL | clamp [-3, 3] | clamp [-3, 3] | ✓ identique |
| `b2b_cumul_diff` | BDL last 5 | clamp [-3, 3] | clamp [-3, 3] | ✓ identique |
| `travel_load_diff` | BDL last 5 | clamp [-5, 5] | clamp [-5, 5] | ✓ identique |

### Variables documentées mais mortes

| Variable | Backend | Frontend | Cause |
|---|---|---|---|
| `ts_diff` | poids 0 (mort v5) | poids 0 (mort v5) | Désactivé v5 calibration data-driven |
| `avg_pts_diff` | poids 0 (mort v5) | poids 0 (mort v5) | idem |
| `pace_diff` | contexte O/U uniquement | contexte O/U uniquement | Pas utilisé pour score ML |

### Variables backend orphelines

| Variable | Ligne | Statut |
|---|---|---|
| `home_back_to_back` | worker.js:3517 | Toujours `false` · jamais consommé hors `_botExtractVariables` |
| `away_back_to_back` | worker.js:3518 | Idem · code mort |
| `home_last5_avg_pts` | worker.js:3521 | Toujours `null` · à supprimer |
| `away_last5_avg_pts` | worker.js:3522 | Idem |
| `confidence_penalty.score` | worker.js:5312 | Toujours `null` · seuils backend `pen < 0.08` jamais déclenchés |

## 3. Poids · sports.config.js + backend

### Saison régulière (somme = 1.00)

```
net_rating_diff:   0.22
efg_diff:          0.18
recent_form_ema:   0.16
absences_impact:   0.20
home_away_split:   0.10
defensive_diff:    0.02
win_pct_diff:      0.04
back_to_back:      0.02   (mort · valeur toujours 0)
rest_days_diff:    0.02
b2b_cumul_diff:    0.02
travel_load_diff:  0.02
```

Backend `_botGetWeights` (worker.js:4992-5012) · frontend `sports.config.js:75-88`. Cohérents.

### Playoff (somme = 0.91 · normalisé par `totalWeight`)

```
absences_impact:   0.20
net_rating_diff:   0.16
recent_form_ema:   0.15
home_away_split:   0.14
defensive_diff:    0.12
rest_days_diff:    0.06
efg_diff:          0.04
travel_load_diff:  0.02
win_pct_diff:      0.02
back_to_back:      0.00
b2b_cumul_diff:    0.00
```

**À vérifier** · pourquoi somme = 0.91 et pas 1.00. Possiblement intentionnel (normalisé downstream par `totalWeight` dans `_botComputeScore`). Pas de bug visible · juste fragilité.

### EMA λ + score cap

| Phase | EMA λ | Score cap | Score floor (1-cap) |
|---|---|---|---|
| Saison | 0.85 | 0.90 | 0.10 |
| Playoff | 0.92 | 0.80 | 0.20 |

## 4. Calcul score · formules

### Formule commune

```
weightedSum  = Σ (normalizedVar[i] × effectiveWeight[i])
totalWeight  = Σ effectiveWeight[i]
raw          = (weightedSum / totalWeight + 1) / 2
score        = clamp(raw, floor, cap)
```

### Ajustement poids si absences sévères

| Seuil `|absences_impact|` | net_rating × | efg × | home_away_split × |
|---|---|---|---|
| < 0.18 | 1.00 | 1.00 | 1.00 |
| ≥ 0.18 | 0.82 | 0.85 | 0.85 |
| ≥ 0.28 | 0.75 | 0.80 | 0.80 |

Implémenté backend (worker.js:5172-5177) · frontend (`engine.nba.score.js` `buildEffectiveWeights`). Cohérent.

### Star absence modifier (multiplicatif)

Cible · joueurs PPG ≥ 18 avec statut Out/Doubtful/DTD/GTD.

```
totalRed = Σ (ppg / teamPpg) × STATUS_W[status] × starFactor
reduction = min(totalRed × multiplier, maxReduction)
starAbsenceModifier = clamp((1 - hRed) / (1 - aRed), 0.70, 1.30)
score *= starAbsenceModifier
```

| Paramètre | Saison | Playoff |
|---|---|---|
| `starFactor` | 1.55 | 2.00 |
| `maxReduction` | 0.45 | 0.55 |
| `STAR_PPG_THRESHOLD` | 18 | 18 |

| Out count | multiplier |
|---|---|
| ≥ 3 | 3.00 |
| ≥ 2 | 2.10 |
| ≥ 1 | 1.35 |
| 0 + major ≥ 3 | 1.40 |
| 0 + major ≥ 2 | 1.20 |

Implémenté backend (worker.js:5221-5262) + frontend (`engine.nba.variables.js:154`). Cohérent.

## 5. Confidence · divergence critique backend ↔ frontend

### Backend · `_botComputeConfidence(analysis, dataQuality)` worker.js:5888

Algorithme **distance-based** ·
```
dist = |score - 0.5|
pen  = analysis.confidence_penalty?.score ?? 0   ← TOUJOURS null actuellement

HIGH         · dist ≥ 0.20 ET dataQuality ≥ 0.70 ET pen < 0.08
MEDIUM       · dist ≥ 0.12 ET dataQuality ≥ 0.50 ET pen < 0.15
LOW          · dist ≥ 0.06
INCONCLUSIVE · sinon
```

### Frontend · `_computeConfidenceLevel` engine.core.js:314

Algorithme **robustness+dq min-based** ·
```
effectiveRobustness = max(0, robustness - penaltyScore)
minScore = min(effectiveRobustness, dataQuality)

HIGH    · minScore ≥ 0.75
MEDIUM  · minScore ≥ 0.50
LOW     · sinon
INCONCLUSIVE · si score/robust/dq null
```

### Impact concret de la divergence

| Scénario | Backend confidence | Frontend confidence | Affichage user |
|---|---|---|---|
| Score 0.95 · robustness 0.40 · dq 0.85 | **HIGH** (dist=0.45 · dq>0.7 · pen=0) | **LOW** (min(0.40, 0.85)=0.40) | LOW |
| Score 0.55 · robustness 0.95 · dq 0.95 | **LOW** (dist=0.05) | **HIGH** (min(0.95, 0.95)=0.95) | HIGH |
| Score 0.80 · robustness 0.75 · dq 0.80 | **HIGH** | **HIGH** | HIGH (concordance) |
| Score 0.65 · robustness 0.50 · dq 0.50 | **MEDIUM** | **MEDIUM** | MEDIUM (concordance) |

**Conclusion** · les 2 algorithmes peuvent donner des labels opposés dans les cas extrêmes. L'utilisateur voit toujours le frontend · la calibration Alon analyse toujours le backend.

**Priorité fix** · P1 critique. Décision ChatGPT requise · aligner frontend sur backend (distance-based plus robuste) OU l'inverse.

## 6. Decision · rejet

### Backend
- **Pas de champ explicite** `decision` ni `rejection_reason` dans le log
- Rejets implicites · `score = null` (vars critiques absentes) · `absEdge < 0.05` (pas de reco) · `divergence critical` (best=null)

### Frontend · `_computeDecision` engine.core.js:215

| Décision | Conditions |
|---|---|
| `ANALYSER` | edge ≥ 7% ET dataQuality ≥ 75% ET confidence = HIGH |
| `EXPLORER` | confidence ≠ INCONCLUSIVE ET edge ≥ 5% |
| `INSUFFISANT` | confidence = INCONCLUSIVE OU edge < 5% |
| `REJETÉ` | `rejection_reason` défini |

### Reject reasons frontend · `_checkImmediateRejection` engine.core.js:237

| Reason | Condition | Seuil |
|---|---|---|
| `WEIGHTS_NOT_CALIBRATED` | `score_method === 'UNCALIBRATED'` | - |
| `MISSING_CRITICAL_DATA` | `missing_critical.length > 0` | - |
| `ABSENCES_NOT_CONFIRMED` | playoff + injuries non confirmées | - |
| `DATA_QUALITY_BELOW_THRESHOLD` | `dataQuality < min_data_quality` | currently `null` (skip) |
| `ROBUSTNESS_BELOW_THRESHOLD` | `robustness < min_robustness` | currently `null` (skip) |

**Note** · `min_data_quality` et `min_robustness` à `null` dans `sports.config.js` · donc ces 2 rejets ne s'appliquent jamais en pratique. TODO P2 SESSION.md mentionne `confidence=INCONCLUSIVE si data_quality<0.55`.

## 7. Recommendations

### Marchés couverts

| Marché | Backend `_botComputeBettingRecs` | Frontend `engine.nba.betting.js` |
|---|---|---|
| MONEYLINE | ✓ edge ≥ 5% · Kelly 0.25 cap 5% | ✓ idem |
| SPREAD | ✓ ajustement motorisé · CDF σ=12 · edge 3% | ✓ idem |
| OVER_UNDER | ✓ projection + playoffAdj -4.5 · edge 5% | ✓ idem |
| PLAYER_POINTS | ✓ `_botPredictPlayerPoints` (worker.js:5592) | partiel (lecture cache `ai_player_props_*`) |

### Garde-fous edge

| Garde-fou | Seuil | Effet |
|---|---|---|
| Edge minimum ML | 5% | Filtre reco |
| Edge max ML | 18% | Suppression (pré-MBP) |
| Cote ≥ 5 longshot | edge > 15% | Suppression |
| Divergence critical | div ≥ 28 pts | `best = null` · shrinkage 50/50 |
| Divergence high + lowQ | div ≥ 20 + dq < 0.7 | Shrinkage 50/50 |
| Edge minimum parlay | 7% | Filtre parlay |
| Kelly stake | 0.25 × Kelly | Quarter Kelly |
| Kelly cap | 5% bankroll | Max bet size |

Cohérent backend/frontend.

## 8. Robustness · exploitability · AI modifiers

### Robustness · frontend uniquement

`EngineRobustness.compute` (`src/engine/engine.robustness.js:31`) · **n'existe pas côté backend**.
- Perturbation systématique ±10% ±20% sur chaque variable
- Calcule `max_delta` du score
- Sortie · `robustness_score = 1 - max_delta` · `critical_variables[]` · `reversal_threshold`
- Consommée par `_computeConfidenceLevel` frontend

**Implication** · le backend n'a aucune notion de robustness · sa confidence n'utilise que `data_quality`. Différence structurelle avec le frontend.

### Exploitability · n'existe pas

Grep `exploitability` worker.js · 0 résultat. Mentionné dans la mission audit mais pas dans le code · concept abandonné ou jamais implémenté.

### AI modifiers · pas de modification post-score

| Source | Usage backend | Usage frontend |
|---|---|---|
| `_callClaudeWithWebSearch` · injuries non-officielles | Merge dans `injuryReport` avant `_botExtractVariables` · injecté dans `absences_impact` | Merge front via `_loadAIInjuries` · injecté dans `absences_impact` |
| `_callClaudeJSONOnly` · player projections | Cache KV `ai_player_props_{date}` · lu par `_botPredictPlayerPoints` | Cache lu côté UI · affiché en sidebar match-detail |

**Confirmation** · Claude n'inverse ni ne pondère la décision · il enrichit uniquement la liste de blessures. Le moteur applique le `star_absence_modifier` sur les données enrichies. Sécu OK (audit MBP-A.4 HAUT-1 reste valide · `ai.guard.js` non appelé · pas de validation des réponses Claude).

## 9. UI rendering · ce que l'utilisateur voit

### Champs source-of-truth backend (frontend recalcule)

| Champ | Source réelle | Affichage UI | Recalculé UI ? |
|---|---|---|---|
| `predictive_score` | `EngineCore.compute` frontend | 0-100% brut | Non |
| `confidence_level` | `_computeConfidenceLevel` frontend | label + emoji | Non · enum fermé |
| `robustness_score` | `EngineRobustness` frontend | bloc "Stabilité" | Non |
| `data_quality_score` | `EngineCore` frontend | % affiché | Non |
| `key_signals[]` | Frontend | top 3 + labels FR | Slice(0,3) côté UI |
| `betting_recommendations.best.edge` | Frontend | % | Non |
| **`edge affiché user`** | **UI recalcule** = `motor_prob - implied_prob` | % | **OUI · critique** |
| `kelly_stake` | Frontend (fraction) | EUR | UI multiplie × bankroll local 500€ |
| `implied_prob` | UI recalcule via `1/odds` ou devig | % | UI · `utils.odds.js` |
| `market_divergence_flag` | Frontend | bandeau alerte | Non |
| `decision` | `_computeDecision` frontend | badge "Analyser/Explorer/Insuffisant/Rejeté" | Non |

### Champs inventés par l'UI (sans équivalent backend)

| Élément UI | Source | Risque |
|---|---|---|
| Emojis confidence (🟢🟡🟠⚪) | Mapping `_confidenceFr` | Décoratif |
| Labels FR variables (SIGNAL_LABELS) | `ui.match-detail.helpers.js:17-46` | Critique pour compréhension user · valider FR |
| Étoiles ⭐ blessures si ppg ≥ 20 | UI seuil hardcodé | Décoratif · seuil différent backend (18) |
| Couleurs pill recommendation | UI seuils `edge ≥ 7% ET quality ≥ 0.80 ET !contrarian` | **Critique** · seuil `quality ≥ 0.80` n'existe **pas** côté moteur |
| Win/Loss tiles V/D vert/rouge | Couleurs UI | Décoratif |
| Kelly EUR (kelly × bankroll) | UI multiplie | Cosmétique · bankroll hardcodé 500€ |
| Couleurs blessures statuts | UI hardcodé Out=rouge etc. | Décoratif |
| Strikethrough edge fantôme | UI détecte garde-fou backend | Cosmétique · message clair |

### Recalculs UI à risque

| Calcul | Ligne | Risque |
|---|---|---|
| `edge = motor_prob - implied_prob` | ui.match-detail.js:1265 | NaN si oddsDec invalide · pas de check explicite |
| `implied_prob_devigged` (brut si une cote manque) | ui.match-detail.js:1244-1250 | Label "(brut)" affiché mais en petit · user peut louper |
| `kelly_euros = kelly_stake × 500€` | ui.match-detail.js:1266 | Bankroll hardcodé · si user change valeur dans paper trading · pas synchro |
| Pill couleur conseillé (vert) | ui.match-detail.js:1218-1222 | Seuils UI (`edge ≥ 7%`, `quality ≥ 0.80`) ≠ seuils moteur (`edge ≥ 5%`) |

### Matchs cachés / rejetés

- ❌ **Aucun match caché silencieusement** · tous les matchs du jour affichés
- Si `rejection_reason` défini · badge rouge "REJETÉ" + raison · pas masqué
- Filtres dashboard (Décision chips) · choix user · pas automatique

## 10. Source-of-truth map

| Champ | Source canonique runtime (UI) | Source canonique historique (calibration) |
|---|---|---|
| `score` | Frontend `engine.nba.score.js` | Backend `_botComputeScore` |
| `confidence_level` | Frontend `_computeConfidenceLevel` | Backend `_botComputeConfidence` |
| `robustness` | Frontend `EngineRobustness` | **N'existe pas backend** |
| `data_quality` | Frontend `engine.core.js` | Backend `_botExtractVariables` |
| `decision` | Frontend `_computeDecision` | **N'existe pas backend** |
| `rejection_reason` | Frontend `_checkImmediateRejection` | **N'existe pas backend** |
| `betting_recommendations` | Frontend `engine.nba.betting.js` | Backend `_botComputeBettingRecs` |
| `market_divergence` | Identique (formule cohérente) | Identique |
| `motor_prob` log historique | N/A | Backend score × 100 |
| `motor_was_right` | N/A | Backend `handleBotSettleLogs` (worker.js:4022) |

## 11. Diagramme · 2 moteurs · 1 utilisateur

```
                    ┌─────────────────────┐
                    │  Données externes   │
                    │  ESPN · Tank01 · BDL│
                    │  Claude · TheOddsAPI│
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                                  │
         RUNTIME UI                        CRON HORAIRE
       (chaque page load)              (Cloudflare scheduled)
              │                                  │
              ▼                                  ▼
   ┌──────────────────┐              ┌──────────────────┐
   │ data.orchestrator│              │  _runBotCron     │
   │   .loadAndAnalyze│              │  worker.js:3204  │
   └─────────┬────────┘              └─────────┬────────┘
             │                                  │
             ▼                                  ▼
   ┌──────────────────┐              ┌──────────────────┐
   │  EngineCore      │              │  _botEngineCompute
   │  EngineNBA       │              │  worker.js:5211  │
   │  EngineRobustness│              │  (pas de robust.)│
   │  src/engine/*    │              │                  │
   └─────────┬────────┘              └─────────┬────────┘
             │                                  │
             ▼                                  ▼
   ┌──────────────────┐              ┌──────────────────┐
   │ store.set        │              │  KV bot_log_*    │
   │ AnalysisOutput   │              │  (90j TTL)       │
   └─────────┬────────┘              └─────────┬────────┘
             │                                  │
             ▼                                  ▼
   ┌──────────────────┐              ┌──────────────────┐
   │ UI render        │              │ Calibration Alon │
   │ ui.match-detail  │              │ /bot/logs        │
   │ ui.dashboard     │              │ /bot/calibration │
   └──────────────────┘              └──────────────────┘
   USER VOIT CECI                    JAMAIS AFFICHÉ UTILISATEUR
```

## 12. Divergences détectées · classification

### Critiques

#### MBP-A.2 · CRIT-1 · 2 moteurs distincts coexistent
- Backend `_botEngineCompute` + frontend `EngineNBA.compute`
- Pas de garantie de synchronisation
- Calibration backend = transparente pour l'UI
- L'utilisateur voit potentiellement un score différent du score historique de paris
- Fix possible · supprimer le backend (UI calcule tout) ou aligner strictement les 2 implémentations

#### MBP-A.2 · CRIT-2 · Algorithme confidence backend ≠ frontend
- Backend · distance-based + dq + penalty (pen toujours null) (worker.js:5888)
- Frontend · `min(robust_effective, dq)` (engine.core.js:314)
- Cas extrêmes · labels opposés possibles
- Fix · décision ChatGPT (aligner sur backend distance-based ou frontend min-based)

#### MBP-A.2 · CRIT-3 · `home_away_split` formule divergente
- Backend · `(h_home - h_away) - (a_away - a_home)` clamp [-0.5, 0.5]
- Frontend · `(home_pct - away_pct) × 2` clamp [-1, 1]
- Amplification ×2 frontend · contribution différente au score
- Fix · décision ChatGPT · valider la formule correcte avant alignement

### Moyennes

#### MBP-A.2 · MED-1 · `back_to_back` numérique différent
- Backend · valeur fixe -0.6 / 0 / +0.6
- Frontend · booléen converti -1 / 0 / +1
- Contribution 67% plus forte côté frontend
- Note · poids `0.02` saison · `0.00` playoff · impact final faible

#### MBP-A.2 · MED-2 · Robustness inexistant backend
- Frontend calcule `robustness_score` par perturbation
- Backend ignore cette dimension · ne pénalise pas la confidence
- Logs backend ne contiennent pas `robustness_score`
- Impact · calibration Alon ne peut pas analyser la robustesse

#### MBP-A.2 · MED-3 · `confidence_penalty.score` toujours `null`
- Champ défini backend (worker.js:5312) jamais peuplé
- Seuils backend `pen < 0.08` (HIGH), `pen < 0.15` (MEDIUM) jamais déclenchés
- Code mort · à supprimer ou implémenter

#### MBP-A.2 · MED-4 · Pill couleur UI utilise seuil `quality ≥ 0.80`
- Seuil n'existe pas côté moteur (`min_data_quality = null`)
- Pill verte conseillée requiert quality ≥ 0.80 (ui.match-detail.js:1218)
- Reco backend "ANALYSER" peut afficher pill grise si quality 0.75
- Confusion possible utilisateur

#### MBP-A.2 · MED-5 · `playoff weights` somme = 0.91 ≠ 1.00
- 11 variables · somme 0.91
- Normalisé downstream par `totalWeight` → score reste cohérent
- Mais fragile · risque de bug si refactor oublie la normalisation
- À documenter explicitement

#### MBP-A.2 · MED-6 · Kelly EUR recalculé bankroll hardcodé 500
- ui.match-detail.js:1207 · bankroll par défaut 500€
- Paper trading user peut avoir bankroll différent
- Affichage Kelly stake EUR peut être incohérent avec bankroll réel

### Faibles

#### MBP-A.2 · FAI-1 · Variables backend orphelines (5)
- `home_back_to_back` `away_back_to_back` (toujours `false`)
- `home_last5_avg_pts` `away_last5_avg_pts` (toujours `null`)
- `confidence_penalty.score` (toujours `null`)
- Code mort · gaspille performance · perturbe lisibilité

#### MBP-A.2 · FAI-2 · `ts_diff` `avg_pts_diff` extraites mais poids = 0
- Mort calibré v5 (data-driven decision)
- Code extraction reste · pourrait être nettoyé

#### MBP-A.2 · FAI-3 · Quality statuts plus détaillés côté frontend
- Frontend · `VERIFIED` / `WEIGHTED` / `PARTIAL` / `ESTIMATED` / `LOW_SAMPLE` / `MISSING`
- Backend · `OK` / `MISSING`
- Frontend meilleur · ne pas dégrader

#### MBP-A.2 · FAI-4 · Strikethrough edge fantôme · pas affiché par décision UI
- UI sait que backend a supprimé la reco · affiche edge barré
- Texte "non joué · garde-fou" en petit
- User peut louper · pas critique

#### MBP-A.2 · FAI-5 · `__ema_lambda` injecté en magic field
- `data.orchestrator` ajoute `matchData.__ema_lambda` (engine.nba.js:56)
- Fragile · si orchestrateur oublie · EMA tombe sur valeur par défaut
- Pas de guard/warning

#### MBP-A.2 · FAI-6 · Couleurs/labels FR potentiellement obsolètes
- SIGNAL_LABELS hardcodé dans `ui.match-detail.helpers.js`
- Pas de synchronisation avec sports.config.js
- Si variable renommée backend · UI affiche label générique

## 13. Risques métier majeurs

1. **Désync calibration ↔ affichage** · l'optimisation des poids backend ne change rien à ce que l'utilisateur voit · 2 moteurs faut harmoniser ou en supprimer un (CRIT-1)
2. **Confidence label peut être opposé** entre ce que le bot log historique calcule et ce que l'utilisateur voit · érode la confiance dans le système (CRIT-2)
3. **Penalty backend inutile** · code design conçu mais jamais activé · explique potentiellement pourquoi le bot accorde des HIGH sur des matchs fragiles (MED-3)
4. **`home_away_split` 2× plus pondéré côté UI** · biais domicile sur-évalué côté affichage (CRIT-3)
5. **Pill verte UI requiert un seuil quality moteur inexistant** · l'utilisateur peut louper des recos "Analyser" si quality 0.75-0.80 (MED-4)
6. **Calibration Alon ne voit pas la robustesse** · biais d'analyse · ne peut pas détecter "haute confidence mais variable sensible" (MED-2)

## 14. Dette technique

| Item | Priorité fix | Effort |
|---|---|---|
| Supprimer ou aligner les 2 moteurs (CRIT-1) | P1 critique | 8-16h selon stratégie |
| Aligner algorithme confidence (CRIT-2) | P1 critique | 2-3h après décision algo |
| Valider/aligner formule home_away_split (CRIT-3) | P1 | 1h |
| Aligner back_to_back numérique (MED-1) | P2 | 30 min |
| Backend · implémenter robustness OU supprimer du frontend (MED-2) | P2 | 4-6h ou 1h |
| Supprimer `confidence_penalty.score` mort (MED-3) | P2 | 30 min |
| Aligner seuil pill UI avec moteur (MED-4) | P2 | 30 min |
| Documenter playoff sum 0.91 normalisée (MED-5) | P3 | 15 min |
| Kelly EUR sync bankroll user (MED-6) | P3 | 1h |
| Nettoyer variables backend orphelines (FAI-1) | P3 | 30 min |
| Supprimer `ts_diff`/`avg_pts_diff` morts (FAI-2) | P3 | 15 min |
| Guard `__ema_lambda` magic field (FAI-5) | P3 | 15 min |

## 15. Synthèse · réponses aux questions audit

| # | Question | Réponse |
|---|---|---|
| 1 | Le frontend recalcule-t-il des scores ? | **OUI complet** · `EngineCore.compute` à chaque chargement |
| 2 | Le frontend transforme-t-il des décisions backend ? | Indirectement · son propre `_computeDecision` distinct |
| 3 | Les labels UI correspondent aux seuils backend ? | **NON** · seuils confidence frontend ≠ backend (CRIT-2) |
| 4 | UI peut-il afficher "HIGH" alors que backend dit "MEDIUM" ? | **OUI possible** · cas score 0.55 / robust 0.95 / dq 0.95 |
| 5 | Le frontend utilise-t-il des champs legacy ? | Quasi-non · 2 variables mortes héritées v5 mais extraction reste |
| 6 | Existe-t-il plusieurs moteurs NBA différents ? | **OUI · 2 distincts** (CRIT-1) |
| 7 | Variables calculées mais jamais utilisées ? | OUI · 5 variables backend orphelines (FAI-1) + `ts_diff`/`avg_pts_diff` morts (FAI-2) |
| 8 | Variables UI inventées côté front ? | OUI décoratifs · 1 critique (seuil pill quality ≥ 0.80) |
| 9 | Mappings contradictoires ? | OUI · 3 critiques (confidence · home_away_split · back_to_back) |
| 10 | Les odds impactent réellement les décisions ? | OUI · `_botComputeMarketDivergence` + shrinkage 50/50 si div ≥ 28 |
| 11 | Les injuries impactent réellement confidence ? | Indirectement via `absences_impact` (poids 0.20) + `star_absence_modifier` |
| 12 | AI modifiers peuvent inverser une décision ? | NON · Claude enrichit la liste blessures uniquement (audit MBP-A.4 HAUT-1 garde validité · pas de validation réponse) |
| 13 | Branches mortes ? | OUI · 5 variables backend + 2 poids 0 + penalty.score |
| 14 | Champs source-of-truth ? | Score · confidence · decision · recos = **frontend** (runtime user) · logs historiques = backend |
| 15 | Champs purement décoratifs ? | Emojis · couleurs · labels FR · étoiles blessures · Win/Loss tiles |
| 16 | Champs critiques pour qualité réelle ? | `motor_prob` · `confidence_level` · `edge` · `kelly_stake` · `market_divergence_flag` |

## 16. Prochaines priorités recommandées (mis à jour post-MBP-FIX-A.2.x + PR #196 #197)

### P1 · résolu ou anti-régression
1. ✓ **MBP-A.2 CRIT-1** · décision ChatGPT · garder les 2 moteurs + anti-régression via test parité automatisé (PR #196 · `scripts/test-nba-engine-parity.mjs` · 492 assertions · 2 phases · 11 vars + score + dq + confidence)
2. ✓ **MBP-A.2 CRIT-2** · MBP-FIX-A.2.1 · `EngineCore._computeConfidenceLevel` branche NBA distance-based identique backend `_botComputeConfidence`
3. ✓ **MBP-A.2 CRIT-3** · MBP-FIX-A.2.2 · `computeHomeSplit` formule 4 vars clamp [-0.50, 0.50] identique backend
4. ✓ **MBP-P1** · Gate `data_quality < 0.55` → INCONCLUSIVE backend + frontend NBA (PR #197 · couvre aussi Tennis numérique + MLB label-based)

### P2 · cohérence cosmétique
5. MED-1 · `back_to_back` numérique (-0.6/+0.6 backend vs -1/+1 frontend) · reporté KNOWN-DIVERGENCE par le test parité · à aligner quand bandwidth
6. MED-3 · supprimer `confidence_penalty.score` mort
7. MED-4 · seuil pill UI ↔ moteur

### P3 · nettoyage dette
8. FAI-1/2 · supprimer 5 variables backend orphelines + 2 morts
9. FAI-5 · guard `__ema_lambda`
10. Supprimer dead code `src/engine/engine.mlb.betting.js` (`computeMLB` jamais importé · note KNOWN_ISSUES P1-3)

### P3 hors périmètre MBP-A.2 (déjà ailleurs)
- MBP-A.4 HAUT-1 · intégrer `ai.guard.js` (validation réponses Claude)
- Calibration Alon · audit hit rate avec backend actuel · attendre 50 logs post-MBP-P1 (rule SESSION.md)
- Monitoring · `scripts/report-bot-monitoring.mjs` · suit hit rate par confidence · par type · par sport (PR #198)

## 17. À vérifier (post-audit)

- Numéros de ligne précis · les 3 agents ont remonté des numéros qui shiftent selon merges récents · refaire un grep avant fix
- Formule `home_away_split` backend · re-lire `_botExtractVariables` complet · l'agent a peut-être mal interprété
- `playoff_weights` somme 0.91 · vérifier si normalisation downstream est documentée explicitement
- Quel chemin de code consomme réellement les logs backend · confirmer que c'est `/bot/logs` + `/bot/calibration/analyze` + Alon agent

## 18. Périmètre audit · hors scope

Cet audit ne couvre **pas** ·
- Moteur MLB (MBP-A.2 NBA uniquement)
- Moteur Tennis (MBP-A.2 NBA uniquement · MBP-A.X possible)
- Performance · pas de profiling
- A11y · pas d'audit accessibilité
- Calibration logs réels par sport (réservé à MBP-A.3 · partiellement adressé par monitoring PR #198)

## 19. Évolution post-audit (PRs mergées)

### Tests automatisés ajoutés (vs note initiale "pas de suite Jest/Vitest")
- Pas de framework lourd · 3 scripts Node ESM purs sans dépendance npm ·
  - `scripts/test-nba-engine-parity.mjs` · 492 assertions (PR #196)
  - `scripts/test-data-quality-gate.mjs` · 44 assertions (PR #197)
  - `scripts/test-bot-monitoring-summary.mjs` · 50 assertions (PR #198)
- Lib partagée · `scripts/lib/dom-stub.mjs` (stub `window` pour Logger) · `scripts/lib/backend-engine.mjs` (vm sandbox worker.js)

### Tooling monitoring
- `scripts/report-bot-monitoring.mjs` (PR #198) · CLI read-only · suit l'impact des garde-fous sur les logs production · décisions auto MLB/Tennis sur 50 derniers settlés
- Doc · `docs/monitoring/BOT_MONITORING.md`
