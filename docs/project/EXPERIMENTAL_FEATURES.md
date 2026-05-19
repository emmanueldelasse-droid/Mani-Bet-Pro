# Experimental Features · hypothèses · statuts · critères validation

Convention · toute feature non validée stat = expérimentale. Doit déclarer · hypothèse · métrique cible · sample requis · critère validation · critère suppression.

Audits détaillés · `docs/decisions/`. Bugs et dette · `docs/monitoring/KNOWN_ISSUES.md`.

## Features actuellement expérimentales

### MLB · garde-fou edge [5,10] (v6.94)
- Hypothèse · zone `edge_7-10` profitable (54.7% sur 64 paris cités)
- Métrique cible · hit rate ≥ 55% IC 95% borne basse > 52.4%
- Statut · IC 95% [42.6%, 66.3%] · indistinguable random · cherry-picking suspect
- Critère validation · 200+ paris zone edge_7-10 · IC borne basse > 52.4%
- Critère suppression · IC borne haute < 52.4% OU décision créateur via DECISION-003
- Référence · `docs/decisions/DECISION-003-MLB-V694-CALIBRATION-EDGE-510.md`

### Tennis · contrarian désactivé
- Hypothèse · contrarian peu fiable < 200 logs
- Statut · `recs.find(r => !r.is_contrarian)` worker.js:9522
- Critère réactivation · 200+ logs settled · cotes ≥ 3 · IC stable

### Tennis · phase Challenger poids Elo 0.22
- Hypothèse · Elo plus prédictif en Challenger qu'en Slam/Masters
- Statut · `effect_size` Elo 0.15 · signe douteux v6.95
- Critère validation · 100+ logs Challenger · effect size > 0.30

### NBA · variables backend orphelines
- Statut · code mort
- Liste · `home_back_to_back` · `away_back_to_back` · `home_last5_avg_pts` · `away_last5_avg_pts` · `confidence_penalty.score`
- Action · suppression P3 (`docs/monitoring/KNOWN_ISSUES.md`)

### MBP-CATCHUP-SETTLE · système recovery
- Hypothèse · détecter trous cron + protéger stats sans pollution
- Statut · livré PR #205 · validation prod manuelle en cours
- Critère validation · 1 semaine sans bug · stats cohérentes · OKC vs SAS détecté
- Référence · `docs/decisions/DECISION-004-MBP-CATCHUP-SETTLE-PR205.md`

### NBA · confidence_penalty.score
- Statut · toujours `null` worker.js:5317 · gates HIGH/MEDIUM penalty < 0.08/0.15 inertes
- Action · activer OU supprimer (MED-3 KNOWN_ISSUES) · décision pendante

### MLB · spread/O/U vs ML
- O/U conservé · strikeouts conservés
- ML cherry-picking suspect zone [5,10]
- Décision pendante · DECISION-003

## Features supprimées (historique)

### MLB v6.94 recalibration · suppression vars
Supprimées via worker.js:8330 ·
- `run_diff_season` · poids 0 · jugé bruit
- `babip_regression` · poids 0 · signe douteux
- `bullpen_era_diff` · poids 0 · intenable
- `home_away_split` · poids 0 · signe inversé
- `team_era_diff` · poids 0
- `park_factor` · poids 0 (recos ML · conservé O/U)

Base · 315 logs settled · v6.94. Voir `docs/engine/BETTING_LOGIC.md` MLB section.

## Hypothèses à tester (TODO P2/P3)

### Logger `pitcher_data_source` MLB
- Objectif · différencier perf quand FIP confirmé vs ERA fallback vs 4.20 ligue
- Statut · non implémenté · à ajouter dans `_mlbAnalyzeMatch`

### Logger `engine_version` dans logs
- Objectif · isoler perf par version moteur pour éviter mélange
- Statut · non implémenté

### Logger `closing_odds` au coup d'envoi
- Objectif · CLV vrai (pas seulement post-match)
- Statut · `odds_snap_*` collecté mais jamais associé au log final
- Lien · `STATS_RULES.md` § CLV

### NBA · réactivation paris contrarian
- Hypothèse · viable après 200+ logs · cotes ≥ 3
- Statut · désactivé actuellement
- Critère · 200+ logs settled · IC stable

### Tennis · alerte tournoi inconnu
- Aujourd'hui · tournoi non listé dans `TENNIS_TOURNAMENTS` worker.js:6411 → fallback silencieux `phase=masters_1000`
- Action · ajouter log warn explicite · TODO P3
