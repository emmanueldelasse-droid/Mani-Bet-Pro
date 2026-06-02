# Mani Bet Pro · règles Claude (pointeur)

Ce fichier est un pointeur. Gouvernance racine dans `GOVERNANCE.md` · `BOT_OBJECTIVE.md` · `PROJECT_RULES.md`. Règles détaillées dans `docs/project/`.

## Lecture obligatoire chaque session
1. `GOVERNANCE.md` · gouvernance racine · rôles · priorités · interdictions · fallback · philosophie
2. `BOT_OBJECTIVE.md` · objectif bot · scope · métriques cibles · statut paper trading
3. `PROJECT_RULES.md` · workflow · logs · données réelles vs estimées · états dégradés · tests · mémoire · docs
4. Selon tâche · fichiers spécialisés · `docs/project/` · `docs/engine/` · `docs/monitoring/` · `docs/decisions/`
5. `SESSION.md` · état courant · pointeurs

## Règles immédiates rappel
- Adresser ChatGPT (`Claude → ChatGPT`)
- Une réponse = un seul bloc markdown copier-collable
- Validation ChatGPT obligatoire avant merge important
- Validation créateur obligatoire changements majeurs
- Backend = source canonique · jamais inventer data · jamais recommandation rétroactive
- Stats EXCLUENT · `missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`
- Tests obligatoires routes critiques · rollback obligatoire PR sensibles
- `MEMORY FILES UPDATED` obligatoire avant GO merge
