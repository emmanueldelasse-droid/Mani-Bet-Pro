# ManiBetProMax · NBA independent, zéro abonnement fournisseur

## Architecture
- Worker Cloudflare manibetpromax-shadow autonome, KV EU MANIBETPROMAX_SHADOW séparé.
- Collecte directe ESPN scoreboard/injuries ; aucun service binding ni API du projet ManiBetPro historique.
- Moteur indépendant max/engine.mjs : historique 5/10/20, repos, domicile/extérieur, Elo exploratoire non calibré.
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
- Sections 1 à 16, sources exactes, heures, données manquantes, statut VERIFIED/PARTIAL/UNAVAILABLE/CONFLICT.
- Aucune prédiction rétrospective ; chiffres projetés uniquement depuis un vrai moteur calculé et validé.
- Elo exploratoire : calibrated=false, drives_bet=false ; pas de conseil de pari.
- Réponses JSON des rapports MacFly validées avec validateResearch ; sources HTTPS et match_id obligatoires.
- Interdiction de promettre toutes les statistiques indisponibles ou payantes.

## Routes & tests
- GET /, /api/slate, /api/events, /api/health et /api/methodology.
- node max/tests/test-core.mjs ; node max/build.mjs.
- npx wrangler deploy --config max/wrangler.jsonc ; IMPORTANT : ne jamais déployer sur le Worker manibetpro.
- Vérifier les sources effectives du Cron, absence de LEGACY_SERVICE, mode INDEPENDENT_SHADOW.
- Aucune source ou abonnement payant activé. Cloudflare et ChatGPT restent soumis aux limites du compte existant.
- Rollback : désactiver seulement le Cron/Worker Max. Historique ManiBetPro intact.

## Lacunes explicites
- Les 16 sections sont exigées par le prompt, mais toutes ne peuvent pas être calculées à partir de sources publiques.
- Aucune simulation Monte-Carlo vérifiée, aucune calibration EV/CLV et aucune validation hors échantillon encore achevée.
- Historique KV temporaire, D1 indépendante future pour audit append-only.

## MEMORY FILES UPDATED
- max/README.md, docs/decisions/DECISION-007-MANIBETPROMAX-SHADOW.md, SESSION.md et docs/project/ARCHITECTURE.md sur branche feature uniquement.
