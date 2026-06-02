# PROJECT_RULES · Mani Bet Pro · règles projet racine

Fichier racine · règles opérationnelles. Détails dans `docs/project/`. Ne pas dupliquer · pointer.

## Workflow PR
- ChatGPT propose tâche · scope · acceptance → créateur GO → branche `claude/<topic>` depuis `origin/main`
- Claude code · commit · push · résumé (fichiers · impacts · risques · tests · `MEMORY FILES UPDATED`)
- ChatGPT review GO/NOGO → créateur merge (squash) → CF + GH Pages auto-deploy
- Une PR = un objectif principal · pas de mélange moteur/calibration/infra/UX/monitoring
- Détails · checklist pré-merge · critères NOGO · `docs/project/MERGE_PROTOCOL.md`

## Logs obligatoires
- Logs structurés JSON · `cron_run_id` traçable (format `cr_<base36>_<base36>`)
- Champs obligatoires · `[BOT-CRON-LOG]` référence NBA · détails `docs/project/PROD_SAFETY_RULES.md` § Logs structurés
- Jamais `err.message` brut au client · `SAFE_ERROR_MSG_*` (err.message côté serveur uniquement)
- Grep utilitaires CF · `[BOT-CRON-LOG]` · `[CATCHUP-SETTLE]` · `[CATCHUP-RECOVER]` · `[NIGHTLY SETTLE]`

## Données réelles vs estimées
- Backend = source canonique · jamais inventer data
- Toujours séparer · faits (chiffres vérifiés) · hypothèses · intuitions · extrapolations
- Toujours séparer · réel (logs settled) · simulation (fixtures) · recovery (rétroactif) · missed (trous cron)
- Source fiable vs moins fiable · `docs/engine/DATA_PIPELINE.md` · `docs/monitoring/PROVIDERS_MATRIX.md`
- Cote estimée / date estimée → marquer explicitement · jamais présenter comme observée

## États dégradés / INCONCLUSIVE
- Données fragiles → état dégradé explicite · jamais masquer
- NBA/Tennis · `data_quality < 0.55` → `confidence_level: INCONCLUSIVE` · reco non exploitable
- MLB · `data_quality === 'LOW'` → `recommendations: []` · `best: null` · `decision: INSUFFISANT`
- `INCONCLUSIVE` jamais affiché comme pari conseillé · jamais compté comme reco exploitable
- Catégorisation taille échantillon (INSUFFISANT → ROBUSTE) · `docs/project/STATS_RULES.md`
- Règles de blocage complètes · `docs/engine/BETTING_LOGIC.md` § Règles de blocage

## Tests
- Tests obligatoires routes critiques · suites `scripts/test-*.mjs` (Node ESM)
- Toute PR touchant cron · stats · settlement · calibration · moteur · providers · monitoring · logs · storage → tests + régression 0 fail
- Aucun test moteur requis si PR docs-only · vérifier markdown valide + cohérence docs
- Détails · `docs/project/PROD_SAFETY_RULES.md` § Régression

## Mémoire
- Avant GO merge · identifier fichiers mémoire impactés · mettre à jour · vérifier cohérence
- Section `MEMORY FILES UPDATED` obligatoire dans résumé PR (fichiers · raison · cohérence)
- `SESSION.md` update si impact critique
- Détails · `docs/project/AI_WORKFLOW.md` § Synchronisation mémoire · `docs/project/MERGE_PROTOCOL.md`

## Docs
- Nouvelle route → `docs/monitoring/ROUTES_AUDIT.md` · nouvelle règle → `docs/project/`
- Known issue → `docs/monitoring/KNOWN_ISSUES.md` · décision structurelle → ADR `docs/decisions/`
- Style · télégraphique FR · pas de prose · `·` séparateur · `→` cause/résultat · refs `file:line` · pas d'emoji
- Jamais dupliquer info stockée ailleurs (git log · ADR · README) · jamais supprimer doc existante
- Détails style · `docs/project/AI_WORKFLOW.md` § Style fichiers .md

## Aucune recommandation rétroactive
- Règle absolue · `motor_prob` · `betting_recommendations` · `variables_used` · `signals` · `motor_was_right` jamais créés après début match
- `missed_by_cron` = statut terminal · jamais transformé en `settled`
- Stats EXCLUENT · `missed_by_cron` · `recovery_failed` · `postponed` · `cancelled` · `invalid_match_mapping`
- Détails · `docs/monitoring/CATCHUP_SETTLE.md` · `docs/project/PROD_SAFETY_RULES.md` § Recovery
