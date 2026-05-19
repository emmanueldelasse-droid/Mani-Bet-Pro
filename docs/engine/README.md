# docs/engine · spec moteur & pipeline data

Documentation moteur de décision · flux data · spécifique par sport.

| Fichier | Contenu |
|---|---|
| `BETTING_LOGIC.md` | Spec moteur NBA/MLB/Tennis · variables · poids · formules · garde-fous |
| `DATA_PIPELINE.md` | Flux data NBA/MLB/Tennis · caches KV · TTL · rate limits |

## Quoi mettre où
- Variable moteur · poids · formule sport-spécifique → `BETTING_LOGIC.md`
- Source data · cache KV · TTL · provider → `DATA_PIPELINE.md`
- Règle stats transversale (IC · ROI · Brier) → `docs/project/STATS_RULES.md`
- Provider · fallback · stabilité → `docs/monitoring/PROVIDERS_MATRIX.md`
