# Logique paris Mani Bet Pro

## Principe général
- Moteur calcule probabilité `motor_prob` victoire HOME [0, 1]
- Compare au marché (cote bookmaker → implied prob)
- Si `edge` (motor - market) > seuil → reco
- Garde-fous : sample minimum · cote plafond · data_quality minimum
- Confidence calculée → recommandation finale

## ⚠ Confidence · 2 algorithmes distincts coexistent (MBP-A.2 CRIT-2)

| Côté | Fichier | Algorithme |
|---|---|---|
| Backend (cron · logs · calibration) | `worker.js:5888` `_botComputeConfidence` | distance-based · `dist + dq + pen` |
| Frontend (UI utilisateur runtime) | `src/engine/engine.core.js:314` `_computeConfidenceLevel` | min-based · `min(robust_effective, dq)` |

Cas extrêmes possibles · labels opposés. Voir `NBA_ENGINE_AUDIT.md` §5 pour détail. Décision ChatGPT requise pour aligner.

## Confidence HIGH / MEDIUM / LOW / INCONCLUSIVE · backend actuel

Fonction `_botComputeConfidence` (worker.js:5888 · MBP-A.2 vérifié)

| Niveau | Conditions |
|---|---|
| `HIGH` | dist ≥ 0.20 ET data_quality ≥ 0.70 ET confidence_penalty < 0.08 |
| `MEDIUM` | dist ≥ 0.12 ET data_quality ≥ 0.50 ET confidence_penalty < 0.15 |
| `LOW` | dist ≥ 0.06 (toute qualité) |
| `INCONCLUSIVE` | dist < 0.06 OU score absent |

- `dist` = |score − 0.5| · distance au 50/50
- `data_quality` = (1 − missing_vars / total_vars) → [0, 1]
- `confidence_penalty` = pénalité divergence marché (worker.js:5188)

## Data quality
- NBA · numérique [0, 1] · 11 vars (worker.js:3537)
- MLB · enum `LOW`/`MEDIUM`/`HIGH` (worker.js:8425)
  - `LOW` si pitcher FIP/ERA manquant
  - `HIGH` si pitcher + team_ops + team_era + bullpen tous présents
- Tennis · `_botTennisDataQuality` · [0, 1] · INCONCLUSIVE si <0.30 (worker.js:9364)
- TODO P2 SESSION.md:17 · gate `confidence=INCONCLUSIVE` si `data_quality<0.55` (worker.js:5185)

## NBA · logique

### Variables (11) · poids saison v5 (sports.config.js:75-88)
```
net_rating_diff       0.22
efg_diff              0.18
recent_form_ema       0.16  (EMA λ=0.85)
absences_impact       0.20
home_away_split       0.10
defensive_diff        0.02
win_pct_diff          0.04
back_to_back          0.02
rest_days_diff        0.02
b2b_cumul_diff        0.02
travel_load_diff      0.02
```

### Poids playoff (sports.config.js:116) · v6.0
- EMA λ=0.92 · score cap 0.80 (vs 0.90 saison)
- `absences_impact:0.20` · `recent_form_ema:0.15` · `home_away_split:0.14`
- `defensive_diff:0.12` (joué fort) · `net_rating_diff:0.16`
- Pas de `back_to_back`/`b2b_cumul`/`efg` réduit

### Phase detection
`_botGetNBAPhase` (worker.js:4897) → `season` / `playin` / `playoff`

### Shrinkage marché
`_botEngineCompute` (worker.js:5128) applique `0.5 × motor + 0.5 × market` si :
- divergence ≥ 28 pts OU
- divergence ≥ 20 pts ET data_quality < 0.7

### Recos NBA (worker.js:5251)
- Marchés : MONEYLINE · SPREAD · OVER_UNDER · PLAYER_POINTS
- Kelly fractionné (frac=0.25 · max 5% bankroll)
- Edge minimum : 5% ML · 3% spread / O/U
- Cap probabilité [0.20, 0.80]

### Hit rate cible
- > 55% hit rate
- Brier < 0.25
- Upsets 20-25%
- CLV > 0 bps

### État NBA
- v6.79 · 53 logs hit 67.9% · calib valide
- `travel_load_diff` signe inversé n=22 · ignoré
- TODO P2 · recheck à 80+ logs

## MLB · logique

### Variables v6.94 (6) · recalibrage 315 logs (worker.js:8330)
```
pitcher_fip_diff      0.18  (↑ de 0.10)
last10_form           0.20  (↑ de 0.10 · #1 signal)
team_ops_diff         0.14
weather               0.03
park_factor           0  → conservé pour O/U seulement
home_away_split       0  (supprimé · signe inversé)
bullpen_era_diff      0  (supprimé · intenable)
run_diff_season       0  (supprimé · bruit)
babip_regression      0  (supprimé · signe douteux)
```

### Formule homeProb (worker.js:8421)
```
0.536 (home advantage baseline) + 
  pitcherAdv + restAdv + opsAdv + teamEraAdv + 
  formAdv + weatherAdv + parkAdv
→ clamp [0.20, 0.80]
```

### Garde-fou edge MLB v6.94
- Edge ∈ [5, 10] uniquement profitable (54.7% sur 64 paris)
- Hors zone → reco filtrée
- Hit rate global v6.94 49.8% post 315 logs · à surveiller

### TODO MLB
- P1 SESSION.md:14 · surveiller hit rate post 50 paris · si <52% désactiver bot (Option C)

## Tennis · logique

### Variables (9) · v6.95 data-driven 273 logs
```
ranking_elo_diff
surface_winrate_diff
recent_form_ema
pressure_dominance
h2h_surface
service_dominance
physical_load_diff   (14j window)
market_steam_diff    (steam < 3% = bruit)
fatigue_index
```

### Poids par phase (sports.config.js:191-210)

| Phase | elo | surf_wr | form | press | h2h | serv | phys | steam | fatigue |
|---|---|---|---|---|---|---|---|---|---|
| grand_slam | 0.10 | 0.07 | 0.18 | 0.06 | 0.18 | 0.05 | 0.13 | 0.10 | 0.13 |
| masters_1000 | 0.10 | 0.07 | 0.15 | 0.05 | 0.18 | 0.05 | 0.15 | 0.10 | 0.15 |
| tour_500 | 0.08 | 0.08 | 0.17 | 0.05 | 0.16 | 0.07 | 0.15 | 0.10 | 0.14 |
| challenger | 0.22 | 0.19 | 0.17 | 0.12 | 0.06 | 0.08 | 0.06 | 0.05 | 0.05 |

### Phase detection (worker.js:9080)
- Slam : australian/french/wimbledon/us open
- Masters : 1000/indian wells/miami/madrid/rome/cincinnati/paris/shanghai/atp finals
- 500 : atp 500 / wta 500
- Challenger : challenger
- Default : `regular`

### Elo
- K=32 · log 90j · surface + overall
- Recalcul Elo incrémental v7.00 depuis ESPN (worker.js:8f640e9 commit)
- Garde-fou Elo opp inconnu v7.01 · strip baseline avant JSON

### H2H pondéré récence (v6.85)
- ≤12 mois × 1.0
- ≤24 mois × 0.5
- ≤36 mois × 0.25
- > 36 mois × 0.1
- Fallback global si surface_weight < 1.5

### Garde-fous tennis
- Edge > 18% drop (suspect)
- Cote ≥ 5 ET edge > 15% drop
- Matchs sample < 15 drop
- Steam < 3% = bruit ignoré

### Dates estimées round offset (v6.87 · worker.js:7080)
- R128 +1j ... F +7j
- Slam ×2 (durée double)
- `opponent_rank` last5 (v6.92)

### TODO Tennis
- P1 SESSION.md:15 · surveiller hit rate v6.93 post 50 paris · revert si baisse
- P2 SESSION.md:18 · `/bot/calibration/analyze?sport=tennis` après 30+ logs settlés
- P3 SESSION.md:21 · réactiver api-tennis fixtures si compte payé

## Rôle des odds
- Source primaire reco · TheOddsAPI · cotes décimales européennes
- Pinnacle (gratuit guest) · référence marché juste
- Snapshots horaires KV `odds_snap_*` 72h
- CLV (Closing Line Value) calculé après match settled
- Conversion cotes via `utils.odds.js`
- UI user-facing toujours décimal européen · jamais US

## Rôle des blessures
- ESPN officiel · base
- Tank01 roster + status · enrichissement
- Claude AI · non-officiel · web search
- NBA injury report PDF · source autorisée
- `_botComputeAbsencesImpact` (worker.js:5021) · pondère par PPG joueur absent
- Poids `absences_impact` 0.20 (saison) · idem playoff

## Rôle de la calibration
- Logs settlés (motor_was_right ≠ null) → input
- Métriques · hit_rate · Brier · upsets · CLV
- Calibration par bucket motor_prob (0-40 · 40-55 · 55-70 · 70-100)
- Biais détection · home/away · favori/outsider · phase · confidence · data_quality
- Alon agent · rapport actionable · propositions poids
- ChatGPT valide · Claude code · merge

## Règles de blocage
- INCONCLUSIVE → pas de reco affichée user
- data_quality LOW (MLB) → pas de reco
- Edge sous seuil → pas de reco
- Sample insuffisant (NBA <10 games · tennis <15 matchs) → pas de reco
- Cote ≥ 5 + edge < 15% → drop (tennis)
- TODO Confidence forcée INCONCLUSIVE si dq < 0.55 (worker.js:5185)

## Zones encore dangereuses / incertaines
- MLB hit rate 49.8% sous cible · v6.94 surveillé
- NBA petit échantillon · 53 logs · prudence calibration playoff
- Tennis 273 logs OK mais effect_size Elo signe douteux (0.15)
- Cotes plafond contrarian désactivé · TODO P3 réactiver après 200+ logs · cotes≥3
- Travel load NBA n=22 ignoré · signe inversé

## Notation reco
- `confidence` : HIGH/MEDIUM/LOW/INCONCLUSIVE
- `motor_prob` : probabilité moteur (%)
- `market_prob` : probabilité marché implicite
- `edge` : motor_prob - market_prob (%)
- `kelly` : fraction bankroll suggérée (Kelly × 0.25)
- `signals` : top variables contributrices avec valeurs

## Helpers UI FR
- `_qualityFr` · `_betTypeFr` · `_fmtOdds` · `_confidenceFr` · `_interpretVariable`
- (ui.bot.js:1090-1215)
- Vocabulaire imposé · pas "Data quality" en UI
