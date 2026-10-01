# DECISION-006 · agent persistant observateur

## Statut
PROPOSED · architecture préparée · implémentation non autorisée par ce document.

## Contexte
Mani Bet Pro doit pouvoir accueillir un futur agent persistant capable de surveiller de nombreux flux, contrôler cohérence du moteur et exploiter l'historique sans devenir une seconde source de vérité.

Risque principal · agent trop puissant → données web non structurées remplacent providers · calibration sauvage · mutation historique · auto-merge · faux edge.

## Décision proposée
Adopter un agent **observer-first** séparé du moteur.

- backend reste canonique ;
- agent read-only par défaut ;
- web externe = corroboration, pas remplacement provider ;
- sortie agent séparée des probabilités/recommandations moteur ;
- aucune mutation moteur/calibration/storage canonique ;
- hypothèse → shadow → forward validation → ChatGPT review → validation créateur → PR ;
- stockage persistant agent éventuel séparé et append-only ;
- aucun auto-bet · auto-merge · auto-deploy.

Spécification · `docs/project/PERSISTENT_AGENT_ARCHITECTURE.md`.

## Alternatives rejetées

### Agent comme provider universel
Rejeté · reproductibilité/provenance/latence fragiles · hallucination possible · impossible de garantir closing line/blessure/stat observée au bon moment.

### Agent intégré au score
Rejeté avant validation · créerait une variable opaque difficile à backtester et versionner.

### Agent autorisé à recalibrer automatiquement
Rejeté · conflit gouvernance + risque overfit.

### Agent autorisé à écrire logs historiques
Rejeté · viole immutabilité prédiction pré-match.

## Conséquences
Positives ·
- intégration future découplée ;
- auditabilité ;
- moindre risque de contamination moteur ;
- compatible D1 multi-checkpoint ;
- remplaçable indépendamment du fournisseur d'agent.

Coûts ·
- besoin contrat données stable ;
- stockage/alerting séparés futurs ;
- latence supplémentaire pour analyses non décisionnelles ;
- validation humaine conservée.

## Critères GO implémentation
- pré-saison valide pipeline NBA ;
- besoin/cadence précis ;
- coût estimé ;
- permissions minimales définies ;
- stockage agent défini ;
- tests fail-closed/idempotence ;
- validation créateur si architecture/storage change.

## Rollback
Architecture docs-only actuellement · aucun rollback runtime.
Future implémentation doit pouvoir être désactivée sans effet sur Worker/moteur.
