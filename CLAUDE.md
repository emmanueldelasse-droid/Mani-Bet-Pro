# Mani Bet Pro · règles Claude (pointeur)

Ce fichier est un pointeur. Toutes les règles détaillées sont dans `docs/project/`.

## Lecture obligatoire chaque session
1. `SESSION.md` · état courant · pointeurs
2. `docs/project/AI_WORKFLOW.md` · rôles · format réponses · communication
3. `docs/project/MERGE_PROTOCOL.md` · workflow PR · GO/NOGO · checklist
4. Selon tâche · `docs/project/` · `docs/engine/` · `docs/monitoring/` · `docs/decisions/`

## Règles immédiates rappel
- Adresser ChatGPT (`Claude → ChatGPT`)
- Une réponse = un seul bloc markdown copier-collable
- Validation ChatGPT obligatoire avant merge important
- Validation créateur obligatoire changements majeurs
- Backend = source canonique · jamais inventer data · jamais recommandation rétroactive
- Stats EXCLUENT · `missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`
- Tests obligatoires routes critiques · rollback obligatoire PR sensibles
- `MEMORY FILES UPDATED` obligatoire avant GO merge
