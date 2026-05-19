# MLB Audit Guide · audit empirique réel logs MLB

Script `scripts/audit-mlb-logs.mjs` · audit empirique 100% offline sur dump JSON des logs MLB.

Décision ChatGPT · **GO EMPIRIQUE D'ABORD** avant toute désactivation moteur MLB. Ce script outille l'audit `DECISION-003` proposed.

## Quoi mesurer · pourquoi

Le diagnostic structurel (`docs/decisions/DECISION-003-MLB-V694-CALIBRATION-EDGE-510.md`) repose sur les commentaires `worker.js:8497-8623` cités · 315 logs · 49.8% · IC `[44.2%, 55.3%]`. **Ce sont des chiffres v6.94 historiques · pas les 421 logs réels actuels.**

Ce script permet de vérifier · sur les 421 logs réels post-v6.94 ·
- Le hit rate global a-t-il évolué ?
- La zone edge_7-10 (54.7% sur 64 paris cités) tient-elle sur sample élargi ?
- Le ROI flat-stake est-il calculable et négatif ?
- Le moteur est-il calibré (motor_prob 60% → hit ~60% ?) ?
- Y a-t-il un biais home/away · favorite/underdog ?
- Quelles variables sont réellement présentes vs missing ?

## Exécution

### Depuis ta machine (créateur · avec accès worker prod)

```bash
# 1. Dump des logs MLB depuis le worker prod
curl "https://manibetpro.emmanueldelasse.workers.dev/mlb/bot/logs" > mlb-dump.json

# 2. Audit empirique
node scripts/audit-mlb-logs.mjs mlb-dump.json

# 3. Output JSON brut (pour archiver ou re-analyser)
node scripts/audit-mlb-logs.mjs mlb-dump.json --json > mlb-audit-result.json
```

### Depuis stdin (pipe)

```bash
curl "$WORKER/mlb/bot/logs" | node scripts/audit-mlb-logs.mjs --stdin
```

### Tests locaux (fixture synthétique)

```bash
node scripts/test-audit-mlb-logs.mjs   # 123 assertions
```

## Format input accepté

Le script accepte 3 formats (auto-détection) ·

1. **Array brut** · `[{ status, motor_was_right, ... }, ...]`
2. **Wrapper logs** · `{ logs: [...] }`
3. **Réponse complète /mlb/bot/logs** · `{ available: true, logs: [...], stats: {...} }`

## Sections du rapport (21)

| § | Section | Calcul |
|---|---|---|
| 1-7 | Totaux + status_breakdown | total_logs_kv · total_eligible · settled · pending · excluded |
| 7-8 | Hit rate global + IC 95% Wilson | borne basse 52.4% = juice 5% |
| 9-10 | Rolling window + trend quartiles | last_25 · last_50 · last_100 + 4 quartiles temporels |
| 11 | Edge buckets | [0-5] [5-7] [7-10] [10+] · IC par bucket |
| 12 | Motor_prob buckets + Brier per bucket | [50-55] [55-60] [60-65] [65-70] [70-80] · calibration plot |
| 13 | Favorite vs Underdog | best_side vs implied_prob > 0.5 |
| 14 | Home vs Away | best_side breakdown |
| 15 | Data quality | HIGH · MEDIUM · LOW breakdown |
| 16 | ROI flat-stake | profit = Σ(odds_dec - 1 si win sinon -1) |
| 17 | Brier global | random=0.250 · calibré 0.220-0.230 |
| 18 | Drawdown + streaks | flat-stake equity curve · max DD · streaks |
| 19 | Variables présence | counts par variable extraite |
| 20 | Pitcher data source | breakdown fip / era / fallback (si loggé) |
| 21 | Conclusion automatique | 5 verdicts (cf ci-dessous) |

## Exclusions strictes (`STATS_EXCLUDED_STATUSES`)

5 statuts JAMAIS comptés dans les calculs (aligné `worker.js` + `monitoring-summary.mjs`) ·
- `missed_by_cron`
- `recovery_failed`
- `postponed`
- `cancelled`
- `invalid_match_mapping`

## Conclusion automatique · 5 verdicts possibles

| Verdict | Condition | Exit code | Action recommandée |
|---|---|---|---|
| `EDGE_DEMONTRE` | IC 95% borne basse > 52.4% | 0 | Conserver · monitoring continu · valider CLV |
| `EDGE_NON_DEMONTRE` | IC borne basse < 52.4% mais borne haute ≥ 50% | 12 | Continuer logger · pas de décision désactivation |
| `MONITORING_RECOMMANDE` | ROI ∈ [-5%, 0%] sur n ≥ 100 | 13 | Surveiller · pas de désactivation · attendre +200 logs |
| `DESACTIVATION_RECOMMANDEE` | IC borne haute < 50% OU ROI < -5% sur n ≥ 100 | 10 | Désactivation moneyline + investigation |
| `SAMPLE_INSUFFISANT` | n_settled < 100 | 11 | Continuer logger · re-auditer à 100+ logs |

Le code de sortie reflète le verdict · utile pour intégration script/CI.

## Limites connues

### Données potentiellement manquantes dans les logs
- `odds_at_analysis` · présent worker.js:8475 · format American odds (`{ home_ml: -150, away_ml: +130 }`)
- `pitcher_data_source` · **TODO P2** · pas encore loggé · le script affiche "non disponible"
- `closing_odds` · **TODO P2** · CLV non calculable tant que pas loggé
- `engine_version` · **TODO P2** · permettra séparer v6.94 vs versions précédentes/futures

### Sample size requirements (STATS_RULES.md)
- < 30 paris dans un bucket · `SAMPLE INSUFFISANT` (signalé dans le rapport)
- < 100 paris dans un bucket · `fragile` (signalé)
- < 100 settled total · verdict global `SAMPLE_INSUFFISANT`

### Format odds
- Le script suppose `odds_at_analysis.home_ml` et `away_ml` en **American odds** (cf `worker.js:8475`).
- Conversion American → decimal automatique pour ROI flat-stake.

### Hit rate vs ROI peuvent diverger
- Un hit_rate 53% peut donner ROI négatif si moyenne des odds < 1.91 (juice 5%)
- Toujours regarder ROI + IC + Brier ensemble · pas un seul indicateur

## Cas d'usage typique post-DECISION-003

1. Dump · `curl "$WORKER/mlb/bot/logs" > mlb-dump.json`
2. Audit · `node scripts/audit-mlb-logs.mjs mlb-dump.json > mlb-audit-2026-05-19.txt`
3. Commit dans `docs/decisions/` un sous-fichier `DECISION-003-AUDIT-EMPIRIQUE-2026-05-19.md` avec ·
   - Le verdict
   - Les chiffres clés (IC global · edge_7-10 IC · ROI · Brier)
   - La recommandation Claude
4. ChatGPT review formelle avec les vrais chiffres
5. Validation créateur · GO/NOGO option B (désactivation moneyline) OU option C (refonte data)

## Structure code

```
scripts/lib/audit-mlb-summary.mjs   · fonctions pures · testable
scripts/audit-mlb-logs.mjs           · CLI entrypoint
scripts/test-audit-mlb-logs.mjs      · 123 assertions
```

## Non-objectifs

- Pas de modification moteur MLB
- Pas de désactivation
- Pas de changement poids/gates
- Pas de changement frontend
- Pas d'écriture KV
- Pas d'appel réseau
- Pas de modification cron

Le script est strictement **lecture + calcul · zéro effet de bord prod**.

## Référence règles
- `docs/project/STATS_RULES.md` · IC Wilson · ROI · Brier · sample size
- `docs/project/CALIBRATION_RULES.md` · workflow validation calibration
- `docs/decisions/DECISION-003-MLB-V694-CALIBRATION-EDGE-510.md` · contexte décision
- `docs/engine/BETTING_LOGIC.md` MLB section · variables · formule
