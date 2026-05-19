# docs/project · règles & gouvernance

Règles transversales du projet · workflow IA · architecture · stats · prod safety · calibration.

| Fichier | Contenu |
|---|---|
| `PROJECT_VISION.md` | Mission · ce que c'est · ce que ce n'est pas · règles absolues |
| `ARCHITECTURE.md` | Stack · worker · KV · cron · routes high-level · zones sensibles |
| `AI_WORKFLOW.md` | Rôles ChatGPT/Claude/créateur · format réponses · communication |
| `MERGE_PROTOCOL.md` | Workflow PR · GO/NOGO · checklist pré-merge · rollback |
| `STATS_RULES.md` | IC 95% · ROI · CLV · Brier · validation edge · anti-overfit |
| `PROD_SAFETY_RULES.md` | Auth · logs structurés · CORS · rate-limit · validation body |
| `CALIBRATION_RULES.md` | Sample minimum · workflow recalibration · métriques obligatoires |
| `EXPERIMENTAL_FEATURES.md` | Features expérimentales · hypothèses · critères validation |

## Quoi mettre où
- Règle qui s'applique à tout sport · transversale → ici
- Règle moteur spécifique sport (poids · variables · formule) → `docs/engine/`
- Bug · dette technique · faux edge connu → `docs/monitoring/KNOWN_ISSUES.md`
- Décision structurante avec contexte/alternatives → `docs/decisions/`
