# docs/monitoring · runtime · debug · observabilité

État runtime · bugs connus · providers · routes · rapports monitoring.

| Fichier | Contenu |
|---|---|
| `KNOWN_ISSUES.md` | Bugs · dette · dead code · faux edges connus · limitations |
| `PROVIDERS_MATRIX.md` | Providers · fallback · TTL · stabilité · usage exact |
| `ROUTES_AUDIT.md` | 54 routes HTTP + 7 cron handlers · exhaustif |
| `BOT_MONITORING.md` | Rapport CLI monitoring read-only · scripts/report-bot-monitoring.mjs |
| `CATCHUP_SETTLE.md` | Système settlement + recovery · MBP-CATCHUP-SETTLE PR #205 |

## Quoi mettre où
- Bug détecté · workaround temporaire → `KNOWN_ISSUES.md`
- Nouveau provider · fallback documenté → `PROVIDERS_MATRIX.md`
- Nouvelle route HTTP/cron → `ROUTES_AUDIT.md` (ajout ligne tableau)
- Process monitoring/recovery → `BOT_MONITORING.md` ou `CATCHUP_SETTLE.md`
- Décision structurante (alternatives + contexte) → `docs/decisions/`
