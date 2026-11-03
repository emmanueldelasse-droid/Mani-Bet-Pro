# ManiBetProMax — fiabilité des projections joueurs

Date : 3 novembre 2026. Périmètre : Max uniquement, sans modification de ManiBetPro, de main ou des horaires existants.

## Livré

- `points.mjs` : `max-player-points-0.2.0`, blob Git `0019d61f38ac9950bd92bd672ff85da0d813be76`.
- Suppression des doublons de match/joueur dans le calcul, validation des points/minutes et exclusion des rencontres postérieures au moment de la projection.
- Couverture jugée séparément pour les deux équipes : une équipe avec 12 joueurs documentés ne compense plus une équipe adverse sans données.
- Métadonnées `sample_quality`, `quality_warnings` et `interval_calibration` ajoutées. Trois ou quatre apparitions sont un échantillon très faible, pas une preuve de fiabilité.
- Minutes publiées alignées avec le plafond déjà utilisé par le modèle de points ; poids prédictifs et paramètres de victoire inchangés.
- `baseline_points_last5` est figé avec les nouvelles prévisions. Les erreurs prospectives sont comparées à cette moyenne sur EXACTEMENT les mêmes joueurs évaluables. Les anciennes prévisions n'obtiennent jamais une baseline reconstruite après le résultat.
- Les joueurs annoncés absents mais effectivement entrés en jeu sont comptabilisés séparément dans `availability_error_count` lorsqu'une évaluation du match existe.
- Identifiants du match vérifiés lors de l'évaluation. Une statistique finale absente n'est jamais transformée en zéro point.

## Validation séparée

`quality-worker.mjs` devient le point d'entrée et délègue sans changement les routes et collectes au Worker existant. Après la collecte, une validation rétrospective est effectuée au plus toutes les six heures, si la source est fraîche. Un contrôle mis en cache ne relance ni lecture complète ni écriture.

La route GET `/api/player-validation` est en lecture seule. Le résultat est conservé sous `max:validation:player-history` dans le seul namespace MAX_STATE. Aucun nouveau fournisseur, abonnement, secret ou binding n'a été ajouté.

La comparaison rétrospective rejoue le modèle de base sans prévision d'équipe ni historique de blessures, avec une séparation chronologique de six heures et au moins trois apparitions antérieures. Elle est explicitement NON prospective : les feuilles ont été collectées après les matchs. Les échantillons sélectionnés ne démontrent pas la calibration du modèle complet.

## Tests réellement exécutés

- Node.js 22 : 49 contrôles du modèle de points (doublons, données futures, faible échantillon, cohérence des minutes, mauvais ID, erreurs finales, comparaison appariée et audit chronologique).
- Node.js 22 : 16 contrôles de l'entrée de validation, avec stockage simulé et Worker principal simulé pour les tests locaux de délégation. Contrôle du cache, des écritures bornées, de la source périmée, des réponses nulles et de la liste incomplète.
- Fichiers versionnés : `tests/test-player-reliability.mjs`, `tests/test-quality-worker.mjs`.
- Les coefficients de projection sont restés identiques sur les données valides de la fixture de régression (19,7 points attendus).

## Déploiement et limites

Cloudflare a accepté la version `62f1bfe8-fe96-418c-a31c-a833450dc415` à 100 % le 3 novembre 2026 à 12:38 UTC. Les empreintes Git des deux modules modifiés/ajoutés ont été vérifiées avant upload ; les quatre autres modules et le prompt embarqué ont été conservés.

Au contrôle de 12:39 UTC, le dernier cycle de collecte terminé était encore celui de 12:30 UTC : le premier audit automatique de cette livraison n'était pas encore observé. Ne pas le présenter comme effectué. La vérification HTTP depuis le conteneur de travail a échoué sur la résolution DNS ; ce résultat ne prouve pas une panne de l'application.

Le premier essai de comparaison sur 38 feuilles réelles ne disposait d'aucune observation test après trois apparitions antérieures. Il est donc impossible d'en déduire une amélioration de précision. Les prévisions restent exploratoires et non calibrées.

## Retour arrière

Revenir à la version Cloudflare `f7ca16bf-1d00-4b79-90ea-97540f32c56e`. Ne supprimer ni prévisions, ni résultats, ni rapports MacFly. Le nouveau résultat de validation est indépendant et ne modifie pas les anciens snapshots.
