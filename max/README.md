# ManiBetProMax · shadow 0.1

## État
- Nouveau Worker de pré-production indépendant : manibetpromax-shadow.
- Backend : max/worker.mjs · interface responsive : max/dashboard.html.
- Stockage autonome KV MANIBETPROMAX_SHADOW (EU), sans écriture vers PAPER_TRADING ni D1 historique.
- Données lues uniquement sur le Worker historique : /nba/matches pour trois dates UTC et /nba/injuries/espn.
- Collecte via Cron Cloudflare toutes les 15 minutes ; aucun accès supplémentaire à un fournisseur payant.
- Changements de statut et de blessures : événements datés, anti-doublons et snapshots sur 30 jours.
- Si la source tombe : dernier état conservé, erreur affichée, aucune recommandation fabriquée.
- IA OpenAI désactivée par défaut : MAX_AI_ENABLED=1, OPENAI_API_KEY et MAX_OPENAI_MODEL obligatoires.
- Limites IA quand activée : MAX_AI_CALLS_PER_CYCLE (défaut 1) et MAX_AI_DAILY_LIMIT (défaut 6), sans décision ni probabilités arbitraires.
- Aucun pari réel, aucun changement du moteur/calibration/logs de ManiBetPro.

## Tests et déploiement
- node max/tests/test-core.mjs
- node max/build.mjs
- npx wrangler deploy --config max/wrangler.jsonc
- Routes : GET / ; GET /api/slate ; GET /api/events ; GET /api/health.
- Monitoring : heartbeat, dernier succès, statut sources, anomalies.
- Rollback : désactiver seulement le cron Max, puis revenir à la version Worker Max précédente ; production ManiBetPro reste inchangée.

## Limites
- Max n'est pas encore un modèle de probabilité validé. Observation IA != pronostic.
- Le rapport ESPN peut être incomplet ; les blessures inconnues ne deviennent jamais zéro blessé confirmé.
- Pas de couverture complète des lineups officiels, tracking, minutes prévues, arbitres, matchups et tous les marchés.
- Pas de données sous licence sans approbation. Pas de double facturation providers via Max.
- Cloudflare KV n'est pas transactionnel ni archivage de référence définitif ; historique D1 dédié ultérieurement.
- OpenAI API est un service distinct de ChatGPT/MacFly ; clé, quota et budget doivent être configurés séparément.
- Le moteur ManiBetPro demeure le benchmark et continue ses activités sans modification.

## Phases ultérieures en PR séparées
1. Preuve de collecte réelle 48h et audit du coût.
2. Historique de version D1 append-only.
3. Données lineups/joueurs/blessures/statistiques avancées sourcées, avec gestion de l'incertitude.
4. GPT analyste via API configurable, déclenchement aux changements significatifs ; tests anti-hallucination.
5. Modèle probabiliste Max, backtest chronologique, comparaison Brier, Log Loss, ROI et CLV.
6. Migration progressive de l'interface principale seulement après validation du produit.

## Fichiers de mémoire
- ADR : docs/decisions/DECISION-007-MANIBETPROMAX-SHADOW.md.
- SESSION.md / ARCHITECTURE.md / ROUTES_AUDIT.md mis à jour sur la branche de fonctionnalité uniquement.
- Aucun secret dans GitHub ; aucune source de prédiction post-tip présentée comme pre-tip.

## Raccordement et précision des données (2026-11-02)
- `LEGACY_SERVICE` : liaison interne Cloudflare vers Worker `manibetpro` ; évite appels Worker-to-Worker via workers.dev.
- Rapport ESPN HTTP 200 avec `available=false` traité comme panne de données, jamais comme absence de blessé.
- Stats ESPN scoreboard : `net_rating` et `pace` non disponibles actuellement ; couverture `INCONCLUSIVE`, même si quelques scores d'équipe sont présents.
- Limiter les écritures : une carte match est enregistrée seulement si créée/modifiée ; source blessures max toutes 30 min si inchangée ; journal événements seulement en cas de changement ; état dernier succès actualisé à chaque run.
- Tests simulés : 37 assertions sans échec ; preuve de collecte réelle Cloudflare encore à établir.
