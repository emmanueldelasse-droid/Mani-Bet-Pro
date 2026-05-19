# Merge Protocol · workflow PR · GO/NOGO · checklist · rollback

## Workflow PR obligatoire

1. ChatGPT propose tâche · scope · acceptance criteria
2. Créateur valide ou ajuste · GO explicite
3. Claude crée branche `claude/<topic>` depuis `origin/main`
4. Avant branche · `git fetch origin main && git merge origin/main`
5. Claude code · commit · push · ouvre PR GitHub
6. Claude fournit résumé · fichiers · impacts · risques · tests · `MEMORY FILES UPDATED`
7. ChatGPT review · GO/NOGO merge
8. Créateur merge (squash) ou demande corrections
9. Cloudflare auto-deploy sur `main` · GH Pages auto-deploy
10. SESSION.md update si impact critique

## Résumé PR obligatoire (post Claude)

Avant demande GO merge · Claude fournit ·
- Fichiers créés / modifiés / supprimés
- Impacts (front · worker · moteur · provider · paper · monitoring · stats)
- Risques identifiés
- Tests effectués (assertions · 0 fail régression)
- Sport impacté
- Zones incertaines (à vérifier · non confirmé)
- `MEMORY FILES UPDATED` exhaustif

## Critères NOGO ChatGPT

ChatGPT refuse merge si ·
- Docs désynchronisées
- Nouvelle route non documentée (`docs/monitoring/ROUTES_AUDIT.md`)
- Nouvelle règle non documentée (`docs/project/`)
- Known issue non tracée (`docs/monitoring/KNOWN_ISSUES.md`)
- SESSION.md incohérent
- Architecture changée sans update (`ARCHITECTURE.md`)
- Règles stats changées sans update (`STATS_RULES.md`)
- Règles prod changées sans update (`PROD_SAFETY_RULES.md`)
- Tests manquants ou régression > 0

## Checklist pré-merge

- [ ] `git diff --stat` reviewed · diff scope respecté
- [ ] Périmètre respecté (`AI_WORKFLOW.md` interdictions)
- [ ] Tests automatisés OK · régression 0 fail
- [ ] Docs synchronisées · `MEMORY FILES UPDATED` complet
- [ ] Manuel · curl route impactée · UI golden path si UI
- [ ] Si modification moteur · backtest logs existants
- [ ] Si modification provider · test fallback
- [ ] Pas de secret en clair (.env · credentials.json)
- [ ] Pas de skip hook (`--no-verify` · `--no-gpg-sign`)
- [ ] Rollback documenté (revert SHA cible)

## Validation créateur obligatoire

Le créateur valide AVANT merge pour ·
- Argent réel
- Désactivation sport (NBA · MLB · Tennis)
- Changement provider payant (api-tennis · Tank01 plan · etc)
- Architecture majeure (KV schema · worker split · DB SQL)
- Changement moteur principal (`_botEngineCompute` · `engine.*.js`)
- Changement calibration (poids · seuils edge/confidence/dq)
- Changement pipeline stats (`STATS_EXCLUDED_STATUSES` · `MONITORING_EXCLUDED_STATUSES`)
- Suppression historique/logs (TTL · KV cleanup)

## Anti-overengineering

- Une PR = un objectif principal clair
- Ne pas mélanger · moteur · calibration · infra · UX · monitoring · features
- Avant grosse PR · proposer minimal vs complet avec risques
- Priorité · stabilité · maintenabilité · auditabilité

## Pas de feature sans métrique

Toute nouvelle feature doit déclarer ·
- Quelle métrique elle améliore (hit rate · ROI · CLV · Brier · couverture · UX mesurable)
- Comment l'amélioration sera mesurée (sample · IC · forward validation)
- Risque faux edge · risque statistique
- Coût technique · effort
- Stratégie rollback

Si aucune amélioration mesurable → NOGO feature.

## Rollback

Procédure standard ·
- `git revert <merge-sha>` sur main
- `git push origin main`
- CF auto-deploy reverse en <5min
- GH Pages auto-deploy reverse

PR sensibles imposant rollback documenté ·
- Cron · stats · settlement · calibration · moteur · providers · monitoring · logs · storage

## Si urgence prod

- Hotfix sur `claude/hotfix-<topic>` depuis `main`
- ChatGPT validation a posteriori si nécessaire
- Mention `URGENT` dans commit + PR
- Rollback rapide possible · revert commit `main`

## Synchronisation mémoire (MEMORY FILES UPDATED)

Avant demande GO merge · Claude doit produire la section ·

```
MEMORY FILES UPDATED
- docs/project/ARCHITECTURE.md · ajouté section X · raison
- docs/monitoring/ROUTES_AUDIT.md · 2 routes ajoutées · raison
- docs/decisions/DECISION-XXX-NOM.md · créé · raison
- SESSION.md · TODO P1 ajouté · raison
- cohérence validée · pas de doublons · pas de trous
```
