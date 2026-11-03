# ManiBetProMax · NBA independent, zéro abonnement fournisseur

## Architecture
- Worker Cloudflare manibetpromax-shadow autonome, KV EU MANIBETPROMAX_SHADOW séparé.
- Collecte ESPN scoreboard/injuries + ESPN game summary?event=id (feuilles finales vérifiées, 2 nouvelles maximum par Cron) ; aucun service binding ni API du projet ManiBetPro historique.
- Deux moteurs indépendants : max/engine.mjs (formes 5/10/20, repos, Elo exploratoire) et max/advanced.mjs (minutes/statistiques des joueurs ESPN, quatre facteurs, possessions/ratings, simulations de 50 000 tirages effectifs, évaluation post-match Brier/Log Loss).
- Référentiel intégral des 16 domaines dans max/analyst-prompt.md.
- MacFly ChatGPT : enquête publique et gratuite horaire, puis écriture de rapports sourcés max:research:<match_id> dans le KV Max.
- Le Cron Cloudflare 15 min lit les rapports MacFly, valide sources HTTPS, dates, cohérence des IDs et pre-tip puis les expose dans la nouvelle interface.
- AUCUN appel OpenAI API / Anthropic / RapidAPI payant / TheOddsAPI payant par Max ; aucune souscription supplémentaire commandée.

## Hiérarchie des données
- 1 : rapport blessures NBA et annonces officielles des franchises.
- 2 : NBA.com/stats en consultation publique ; pas de contournement des restrictions de téléchargement.
- 3 : ESPN public (données structurées non contractuelles).
- 4 : PBP Stats / GameFlowPBP accessibles gratuitement sous réserve de leurs conditions de réutilisation.
- 5 : médias sérieux corroborés par sources officielles ; hypothèses IA séparées des faits.
- Métriques propriétaires EPM/DPM/tracking sous licence : non disponibles sans accès autorisé.

## Méthode
- Collecte toutes les 15 minutes par Cloudflare. Analyse journalistique MacFly une fois par heure via Automations ChatGPT existantes.
- Sections 1 à 16, sources exactes, heures, données manquantes, statut VERIFIED/PARTIAL/UNAVAILABLE/CONFLICT. Les domaines non observés restent indisponibles.
- Aucune prédiction rétrospective ; chiffres projetés uniquement depuis un vrai moteur calculé et validé.
- Elo et Monte-Carlo exploratoires : calibrated=false, aucun edge prétendu. Monte-Carlo uniquement si au moins 5 rencontres par équipe et 30 de ligue, régression vers moyenne observée, hypothèses documentées. Le score prévu et les probabilités restent non calibrés.
- Les rapports blessures sont croisés avec les minutes historiques ; un proxy de remplacement est explicitement NON causal et n'ajuste jamais automatiquement les probabilités.
- Snapshots immuables pré-tip `max:pre:<game_id>:EARLIEST/H24/H6/H3/H1`. Après un score final ESPN, évaluer uniquement un snapshot antérieur au tip, une fois par rencontre : `max:eval:<id>`. Brier/Log Loss et total des observations dans `max:metrics:predictions`. Pas de backtest fabriqué.
- Réponses JSON des rapports MacFly validées avec validateResearch ; sources HTTPS et match_id obligatoires.
- Interdiction de promettre toutes les statistiques indisponibles ou payantes.

## Routes & tests
- GET /, /api/slate, /api/events, /api/health, /api/metrics et /api/methodology.
- `node max/tests/test-core.mjs` ; `node max/tests/test-advanced.mjs` (27 assertions) ; `node max/tests/test-no-paid-sources.mjs` ; `node max/build.mjs`.
- npx wrangler deploy --config max/wrangler.jsonc ; IMPORTANT : ne jamais déployer sur le Worker manibetpro.
- Vérifier les sources effectives du Cron, absence de LEGACY_SERVICE, mode INDEPENDENT_SHADOW.
- Aucune source ou abonnement payant activé. Cloudflare et ChatGPT restent soumis aux limites du compte existant.
- Rollback : désactiver seulement le Cron/Worker Max. Historique ManiBetPro intact.

## Lacunes explicites
- Les 16 sections sont exigées par le prompt, mais toutes ne peuvent pas être calculées à partir de sources publiques.
- Les simulations 50 000 tirages sont implémentées et exercées par les tests, mais leur calibration, leur performance hors échantillon et la fiabilité des scores restent À DÉMONTRER. Les métadonnées Brier/Log Loss ne commenceront qu'après le résultat de matchs futurs ayant réellement un snapshot pré-tip.
- Collecte structurée ESPN final boxscore progressive; ne fournit pas encore EPM/DPM propriétaires, véritable tracking spatial, toutes les possessions ni une estimation causale d'absence.
- Pas de diffusion de cotes artificielles, EV/CLV/ROI : champs volontairement null. La collecte de cotes gratuites n'est pas active.
- Historique saisonnier initial des 45 jours, non encore trois saisons complètes. MacFly conserve une cadence horaire; ne peut pas garantir une veille manuelle instantanée.
- Historique KV temporaire, D1 indépendante future pour audit append-only.

## MEMORY FILES UPDATED
- max/README.md, docs/decisions/DECISION-007-MANIBETPROMAX-SHADOW.md, SESSION.md et docs/project/ARCHITECTURE.md sur branche feature uniquement.
