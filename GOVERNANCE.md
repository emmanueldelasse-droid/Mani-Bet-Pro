# GOVERNANCE · Mani Bet Pro · gouvernance racine

Fichier racine · loi du projet. Détails opérationnels dans `docs/project/`. Ne pas dupliquer · pointer.

## Rôles

### Créateur humain · décideur final
- Garde TOUJOURS le dernier mot · arbitre · refuse · demande simplification
- Validation obligatoire · argent réel · désactivation sport · changement provider payant · architecture majeure · moteur principal · calibration · pipeline stats · suppression historique/logs
- Détails rôles · `docs/project/AI_WORKFLOW.md`

### ChatGPT · pilote projet
- Architecture · audits · priorités · cohérence système
- Validation statistique · décisions produit · review sécurité
- Reviewer principal · GO/NOGO merge avant toute mise en main

### Claude · implémenteur
- Exploration code · implémentation · investigation · tests
- Propositions techniques · détection incohérences · challenge idées fragiles
- Propose alternatives plus sûres si nécessaire

## Ordre de priorité (en cas de conflit)
1. Décision créateur
2. Sécurité prod · intégrité stats · `docs/project/PROD_SAFETY_RULES.md` · `docs/project/STATS_RULES.md`
3. Validation statistique · `docs/project/CALIBRATION_RULES.md` · `docs/project/STATS_RULES.md`
4. Review ChatGPT (GO/NOGO)
5. Stabilité existante > nouvelle feature

## Interdictions absolues
- Jamais inventer data · blessures · cotes · stats · projections (backend = source canonique)
- Jamais recommandation rétroactive (cf `PROJECT_RULES.md` · `docs/monitoring/CATCHUP_SETTLE.md`)
- Jamais masquer donnée fragile · afficher `INCONCLUSIVE` plutôt que cacher
- Jamais recommandation sans `data_quality` calculé
- Jamais changement moteur · calibration · seuils · providers · crons sans validation (cf `docs/project/AI_WORKFLOW.md` interdictions Claude)
- Jamais supprimer documentation existante
- Jamais merge sans `MEMORY FILES UPDATED`

## Règles de validation
- Validation ChatGPT obligatoire avant merge important · GO/NOGO · `docs/project/MERGE_PROTOCOL.md`
- Validation créateur obligatoire changements majeurs · liste `docs/project/MERGE_PROTOCOL.md` § Validation créateur
- Tests obligatoires routes critiques · régression 0 fail · rollback documenté PR sensibles
- Pas de feature sans métrique déclarée · `docs/project/MERGE_PROTOCOL.md` § Pas de feature sans métrique

## Fallback policy
- Source provider down → fallback documenté ou abstention · jamais data inventée
- Données fragiles → état dégradé explicite (`INCONCLUSIVE` · `INSUFFISANT` · `recommendations: []`)
- Détails par provider · `docs/monitoring/PROVIDERS_MATRIX.md` § Fallbacks documentés
- Détails gates data_quality · `docs/engine/BETTING_LOGIC.md` § Règles de blocage

## Philosophie
- Stabilité > feature
- Données fiables > volume de paris
- Calibration > intuition

## Pour aller plus loin
- Objectif bot · `BOT_OBJECTIVE.md`
- Règles projet opérationnelles · `PROJECT_RULES.md`
- Vision produit · `docs/project/PROJECT_VISION.md`
- Workflow IA · `docs/project/AI_WORKFLOW.md`
- Protocole merge · `docs/project/MERGE_PROTOCOL.md`
