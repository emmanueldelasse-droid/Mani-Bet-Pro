# Livraison MacFly · originaux et reçus vérifiables

## Périmètre

- Incident du 24/11/2026 · trois rapports annoncés bloqués avant réception D1.
- Correctif côté émetteur · archivage durable vérifié · journal des opérations · reprise par lecture préalable.
- Rapports standard uniquement · les expériences et suppléments gardent les tables et notifications du point 10.
- Utilitaire · `macfly-delivery.mjs` · aucun secret · aucun accès réseau propre · requêtes limitées à D1 et Queue existants.
- Moteurs, probabilités, historiques et cadence · inchangés.
- Métrique · rapports préparés → reçus identiques → versions Max reliées · trois nombres distincts.

## Préparer et conserver

1. Sérialiser chaque rapport une seule fois · tableau de chaînes JSON · `collection_run_id` stable.
2. Préparer le manifeste et l’archive avec le script ci-dessous.
3. Créer l’archive privée durable · retenir identité Library, identité de version, numéro de version, taille et SHA-256.
4. Matérialiser indépendamment cette version dans un autre emplacement · comparer octets et SHA-256.
5. Fournir cette relecture au script · un nom ou chemin local seul ne valide aucune archive.
6. Conserver le manifeste sous une identité durable distincte · mettre à jour cette même identité avec contrôle de version avant et après chaque appel externe.

```sh
node max/deployed/release/macfly-delivery.mjs prepare ORIGINAL_STRINGS.json RUN_ID MANIFEST.json ARCHIVE.json
node max/deployed/release/macfly-delivery.mjs archive MANIFEST.json LIBRARY_FILE_ID INDEPENDENT_READBACK.json
node max/deployed/release/macfly-delivery.mjs validate MANIFEST.json
```

Les arguments en majuscules désignent les chemins ou identifiants réellement obtenus. L’archive contient les chaînes originales ; aucune resérialisation d’un rapport lors de la transmission. Un échec d’archivage ou de relecture suspend le lot avant mutation externe.

## Exécuter une opération

```sh
node max/deployed/release/macfly-delivery.mjs next MANIFEST.json
```

- Résultat `null` · aucune opération due dans ce passage.
- Sinon · conserver l’opération `pending` dans le manifeste durable avant d’appeler le connecteur Cloudflare.
- Transmettre exclusivement `account_id` et `request` produits par l’utilitaire · laisser les contrôles d’autorisation s’exécuter normalement.
- Aucun INSERT hors paramètres liés · aucun endpoint public d’ingestion ajouté.
- Conserver la réponse réelle avec l’`operation_id` exact dans `OUTCOME.json`.

```json
{"operation_id":"identifiant exact de next","kind":"RESPONSE","response":{"success":true,"result":[],"errors":[]}}
```

L’enveloppe ci-dessus illustre la structure, pas un reçu valide à recopier. Utiliser la réponse réelle, y compris les résultats D1 et leurs métadonnées.

```sh
node max/deployed/release/macfly-delivery.mjs outcome MANIFEST.json OUTCOME.json
```

- `RESPONSE` · réponse réelle du serveur.
- `REFUSED` · refus explicite de l’outil, de l’approbation ou des droits · conserver le message exact, sans secrets.
- `AMBIGUOUS` · rupture de transport ou délai dépassé effectivement constatés.
- `ERROR` · autre erreur ou résultat indisponible · aucun succès supposé.
- Sauvegarder le manifeste mis à jour avant de demander l’opération suivante.

L’ordre imposé est lecture → insertion éventuelle → relecture indépendante → notification → preuve d’intégration. Un INSERT seul ne valide pas le reçu. Une notification seule ne valide pas l’intégration.

## Reprendre

- Rapport déjà reçu à l’identique · conserver son reçu et l’heure serveur · aucune nouvelle ligne.
- Même identité avec octets différents · conflit bloquant · conserver les deux éléments de diagnostic ; ne pas réécrire l’original.
- Transport ambigu après INSERT · relire le reçu avant toute nouvelle écriture.
- `NOTIFIED_WAITING_INTEGRATION` · au passage autorisé suivant, relire seulement l’intégration · aucune nouvelle notification.
- `AFTER_TIP_DOCUMENTARY` · état terminal documentaire · aucun pronostic rétroactif.
- Refus explicite · suspendre tout le lot · résolution ou autorisation explicite requise · aucune autre route, découpe ou identité pour contourner le refus.

```sh
node max/deployed/release/macfly-delivery.mjs resume MANIFEST.json "Référence précise de l’autorisation ou de la résolution"
```

La référence doit désigner une instruction ou correction réelle. Une chaîne inventée n’est pas une autorisation.

### Interruption avec une opération pending

`next` conserve l’opération avant l’appel ; `resume` ne l’efface pas. Retrouver d’abord la réponse réelle du connecteur. Consigner un refus comme `REFUSED`, un incident de transport constaté comme `AMBIGUOUS`. Si cette réponse a disparu, consigner `ERROR` avec `EXECUTION_RESULT_UNAVAILABLE`, conserver l’opération et les traces disponibles, puis relire les reçus sans mutation. Ne jamais fabriquer une réponse ni inventer un délai dépassé pour débloquer le lot. Un résultat inconnu doit rester visible jusqu’à une résolution documentée.

## Incident du 24 novembre · preuves disponibles

- Compte rendu 07h45 Paris · trois transmissions déclarées refusées · aucun message brut de refus conservé dans le résultat accessible.
- Audit Cloudflare 06h40–06h48 UTC · 18 appels journalisés · tous HTTP 200 · zéro écriture D1 · aucune erreur Cloudflare relevée dans cette fenêtre.
- Journal avant réparation · 11 rapports · aucun reçu depuis 06h00 UTC.
- Test d’écriture identique sur reçu 11 · accepté · zéro modification · total conservé à 11.
- Conclusion étayée · blocage signalé avant réception Cloudflare ; motif détaillé du contrôle non récupérable · aucun défaut de droits Cloudflare actuel reproduit.
- Archive annoncée du lot de 06h44 UTC · non retrouvée dans les emplacements accessibles · aucune reconstruction ni antédatation.
- Nouvelle collecte explicitement distincte · 07h45m02s136 UTC · matchs 401909314, 401909315, 401909316 · statuts médicaux reconfirmés, aucun changement médical revendiqué.
- Livraison de cette nouvelle collecte · reçus 12, 13, 14 · versions Max 57, 58, 59 · intégrations 07h49m35s575, 07h49m43s352, 07h49m55s925 UTC, toutes avant match.

Ce correctif assure la conservation et la traçabilité de la reprise. Il ne désactive aucun contrôle externe et ne démontre pas qu’un refus futur est impossible.

## Validation et retour arrière

```sh
node --test max/deployed/tests/macfly-delivery.test.mjs
node --test max/deployed/tests/*.test.mjs
```

- Cas nécessaires · archive absente/altérée · octets conservés · doublon/conflit SQLite · refus outil/HTTP · ambiguïté · preuve indépendante · arrivée tardive · CLI complète.
- Activation · consigne de l’automatisation MacFly mise à jour ; planning existant conservé.
- Retour arrière · revenir à la révision précédente de l’utilitaire et de la consigne, uniquement après diagnostic · conserver toutes les archives et tous les reçus.
- Aucun déploiement du Worker nécessaire pour ce correctif de l’émetteur.
