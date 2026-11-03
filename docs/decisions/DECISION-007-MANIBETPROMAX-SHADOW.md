# DECISION-007 · ManiBetProMax · Shadow-first

## Statut
- ACCEPTÉ pour création du prototype isolé à la demande du créateur 2026-11-02.
- Migration du produit principal / activation IA payante / nouveau modèle prédictif : NON VALIDÉS.
- Projet : ManiBetProMax comme future interface pilotée par analyse IA ; garder les composants de calcul et d'historique utiles comme baseline technique.

## Motivation
- Collecte NBA automatique jour/nuit ; informations changent entre H6/H4/H2/H1.
- MacFly doit observer blessures, statut match, rythme, opportunités d'analyse.
- Interdire les probabilités générées par prose IA sans calcul / validation.
- Ne pas perdre l'historique ni perturber les sports MLB/Tennis ou le paper trading.

## Option retenue : Worker Max autonome
- Repo existant, sous-répertoire max/ · branche dédiée.
- Cloudflare Worker manibetpromax-shadow · Cron 15 min · cache KV propre MANIBETPROMAX_SHADOW.
- Lecture seule des APIs publiques existantes ESPN proxifiées par Worker historique.
- Dashboard autonome / · GET /api/slate /api/events /api/health.
- Captures horodatées, changement sans doublon, staleness explicite, abstention si manques.
- Module GPT optionnel sous clé secrète et budget ; texte critique seulement, drives_decision=false.
- Pas d’auto-bet, pas d’auto-merge, pas de modification calibration ni seuils.
- Aucun changement de main ou Worker manibetpro dans la PR initiale.

## Alternative rejetée
- Remplacer immédiatement le moteur historique par une sortie LLM numérique : pas de preuve d'amélioration hors échantillon, risque fort de fabrication et régressions.
- Collector 100 % via conversation ChatGPT : pas de garantie d'exécution toutes les 15 minutes ni d'accès natif aux secrets du Worker.
- Modifier directement le Worker historique : gros risque multi-sport / double déclenchement.

## Risques et contrôles
- Données blessures manquantes : INCONCLUSIVE, jamais interpréter absence de données comme aucune absence.
- Cloudflare Cron peut retarder : dernier succès + statut frais/périmé visibles.
- KV cohérence éventuelle : accepter pour shadow, D1 avant reporting historique/calibration.
- Coût IA : OFF par défaut ; plafond par cycle et jour, aucun coût automatique GPT sans configuration.
- API ESPN non contractuelle : fail closed si indisponible ; pas de remplacement silencieux.
- Doublons : comparer uniquement statut/état blessures (pas timestamps de collecte).
- Sécurité : routes publiques GET uniquement ; secret non exposé ; aucun write depuis la UI.

## Critères de passage à l'étape modèle
- Régression historique 0 échec ; collecte live validée sans incohérence de mapping.
- Provenance et fraîcheur sources démontrées sur une plage représentative.
- Historique avant tip immuable et horodaté.
- Évaluation out-of-sample, Brier, Log Loss, CLV par versions.
- Décision humaine explicite sur moteur principal, calibration, providers payants et bascule UI.

## Rollback
- Désactiver Cron et revenir au Worker manibetpromax-shadow précédent.
- Ne rien supprimer dans PAPER_TRADING ni dans manibetpro-history.
- Branche max indépendante ; suppression UI Max n'affecte pas ManiBetPro.

## Ajustement de sûreté du prototype
- Worker Max → Worker historique par Cloudflare service binding (pas d'appel workers.dev depuis Worker).
- Source ESPN `available=false` = état dégradé.
- Manque pace/net_rating explicite → `INCONCLUSIVE`; pas de pronostic par LLM non calculé.
- Écritures KV limitées pour les quotas ; consulter heartbeat pour confirmer le Cron réel.

## Révision 2026-11-02 · zéro abonnement / indépendance stricte
- Supersede la décision de lire les routes du Worker manibetpro : Legacy service binding SUPPRIMÉ du nouveau runtime et de wrangler.
- Sources ESPN direct + recherche publique gratuite MacFly par Automations ChatGPT ; aucune API IA facturée ; pas de fournisseur données payant.
- Les 16 sections sont un contrat de recherche et non une preuve d'accès aux données ; sources payantes indisponibles explicitement.
- MacFly écrit seulement max:research:<id> dans KV dédié, avec URLs HTTPS et timestamps pré-match ; relecture/validation par Worker Max.
- Les rapports MacFly ne modifient pas le moteur quantitatif ; Elo exploratoire non calibré, paris automatiques interdits.
- API ChatGPT limitée à un cycle horaire ; Worker collecte des flux structurés toutes les 15 min.
