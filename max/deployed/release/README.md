# Publier le Worker Max

La livraison des rapports MacFly dispose d’un [protocole exécutable de reprise](macfly-delivery.md). Ce correctif côté émetteur ne nécessite pas de republier le Worker.

Le correctif du 26 novembre ajoute aussi la prise en charge des bulletins NBA entièrement `NOT_YET_SUBMITTED`. Cette partie est livrée par le Worker `max-independent-0.12.3`, avec les mêmes moteurs et liaisons. Les consignes privées embarquent leur utilitaire ; la publication GitHub seule ne rétablit pas un droit d’archivage de la tâche.

Le commit `16b22188e924bb9b46dfad8f0a4c2981dd01a683` archive les treize modules Cloudflare servis par la version 20 (`18e2067c-e2bc-4790-b89a-7a2ce3d299fa`). Le code à publier se trouve dans `max/deployed/`. La configuration de la PR prototype, `max/wrangler.jsonc`, référence encore une cadence de quinze minutes.

## Vérifier le paquet

Depuis la racine du dépôt, avec Node 22.13 ou supérieur, lancer `node --test max/deployed/tests/*.test.mjs`. Le point d’entrée est `quality-worker.mjs`. Le module `pdf-driver.mjs` contient le parseur du bulletin médical. Son empreinte SHA-256 dans la version 20 est `ad3b5a2ef2f9967e719bdf6c1e80dd9fd6403fb2abfcb101b62acae37909941a`.

La commande suivante produit un programme compatible avec l’action Cloudflare `execute`. Il reconstitue le multipart, lit le parseur PDF déjà déployé et vérifie tous les octets par SHA-256, sans publier de version.

```sh
python3 max/deployed/release/cloudflare-upload.py max/deployed > /tmp/verify-max.js
```

## Publier une version

Utiliser la base `manibetpromax-journal`. Y appliquer dans l’ordre les schémas `research-journal.sql`, `market-study.sql`, `study-runtime.sql`, puis `prompt-lab.sql`, `prompt-lab-score.sql`, `prompt-lab-supplements.sql`, `published-forecasts.sql`, `published-assessment.sql`, `odds-study.sql`, `learning.sql`, `player-odds-coverage.sql` et `odds-intake.sql` du même commit. Le binding D1 porte le nom `MAX_JOURNAL`. Les données préexistantes restent dans le KV `MAX_STATE`. La configuration du Worker est dans `max/deployed/wrangler.json`.

La commande suivante génère le programme d’envoi pour le connecteur. Remplacer `COMMIT_SHA` par le commit de la copie de travail propre.

```sh
python3 max/deployed/release/cloudflare-upload.py max/deployed --commit COMMIT_SHA --upload > /tmp/upload-max.js
```

Exécuter le programme sur le compte indiqué dans `wrangler.json`. Il appelle `POST /accounts/{account_id}/workers/scripts/manibetpromax-shadow/versions` et retourne l’identifiant de version. Vérifier ses liaisons et ses handlers. Pour lui affecter le trafic, appeler `POST /accounts/{account_id}/workers/scripts/manibetpromax-shadow/deployments` avec le corps ci-dessous en remplaçant `VERSION_ID`.

```json
{"strategy":"percentage","versions":[{"version_id":"VERSION_ID","percentage":100}]}
```

Vérifier le déploiement actif par relecture. L’observabilité et le cron existants sont des réglages distincts des versions. La cadence attendue est `0 */6 * * *` UTC, avec collecte MacFly à la minute 20. Le Worker publie ses lectures des marchés joueurs avec le binding producteur `MAX_RESEARCH_QUEUE`. Rattacher le Worker en tant que consommateur de la file `manibetpromax-research-ready` et relire la liste de ses consommateurs. La file livre les notifications de reçus D1 entre deux collectes. Le contrôle quotidien reste en lecture seule.

## Amorcer les éditions d’avant-match

Après activation du Worker, lire les rencontres à venir dans `/api/slate`. Pour chacune, envoyer une notification privée `{"type":"publish_forecast","match_id":"IDENTIFIANT_ESPN"}` dans la file existante. Vérifier `published_at < tip` dans `published_forecasts` et retrouver l’édition dans `/api/game?id=IDENTIFIANT_ESPN`. L’horodatage de publication provient de D1.

Après vérification des éditions, la notification unique `{"type":"bootstrap_observed_odds","date":"AAAAMMJJ"}` relève le tableau ESPN de la journée et les offres joueurs disponibles. La cadence normale reprend ensuite les deux opérations. Les observations portant sur un match déjà commencé sont exclues.
