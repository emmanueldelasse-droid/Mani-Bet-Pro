# Persistent Observer Agent · architecture future

## Statut

- Architecture préparatoire uniquement · aucun agent persistant connecté au runtime.
- Nom de travail · `Observer` · compatible avec futur agent persistant type Dot.
- Aucun nouveau provider · secret · cron · binding · table · clé KV créé par ce document.
- Activation future = PR dédiée + validation créateur si architecture/storage/runtime change.

## Objectif

Ajouter une couche persistante capable de surveiller Mani Bet Pro sans devenir le moteur.

Rôle ·
- observer santé pipeline ;
- contrôler cohérence données / provenance ;
- détecter dérive moteur et divergence front/backend ;
- analyser performances versionnées ;
- comparer shadows vs production ;
- produire alertes et hypothèses testables ;
- préparer review humaine.

Non-rôle ·
- calculer vérité canonique à la place du backend ;
- remplacer une API/provider par navigation web non structurée ;
- modifier poids/seuils/calibration ;
- écrire dans logs prédictifs historiques ;
- déclencher pari réel ;
- merger/deployer du code de manière autonome.

## Principe d'autorité

Ordre source ·
1. backend Mani Bet Pro + stockage canonique ;
2. providers déclarés dans `PROVIDERS_MATRIX.md` ;
3. données officielles externes corroborées ;
4. sources web secondaires ;
5. inférence agent.

Une source niveau 3-5 peut déclencher une alerte ou investigation · jamais remplacer silencieusement niveau 1-2.

Si contradiction ·
- conserver valeurs canoniques ;
- marquer divergence ;
- citer provenance/timestamps ;
- état `INCONCLUSIVE` si résolution impossible.

## Position architecture

```
Providers déclarés
      ↓
Cloudflare Worker · moteur canonique
      ↓
KV runtime/latest + D1 historique optionnel
      ↓ lecture seule
Persistent Observer Agent
      ↓
Observations · alertes · rapports · hypothèses
      ↓
ChatGPT review
      ↓
Créateur
      ↓ si GO
PR séparée · tests · forward validation
```

L'agent ne se place jamais entre provider et moteur sur chemin décisionnel.

## Entrées autorisées

### Runtime
- `GET /health` · heartbeats · storage · version déployée.
- `GET /bot/logs` · latest snapshots NBA.
- `GET /mlb/bot/logs`.
- `GET /tennis/bot/logs`.
- exports read-only documentés.

### Historique
- D1 `nba_analysis_history` · seulement après provisioning/validation.
- D1 `nba_match_outcomes`.
- D1 settlements.
- Toujours joindre analyses/outcomes par `match_id`.
- Toujours segmenter par `engine_version`.

### Références
- docs projet · rules · ADR.
- code source en review.
- sources web externes uniquement comme corroboration explicite.

## Contrat observation

Chaque run futur doit porter ·
- `agent_run_id` unique ;
- `started_at` / `finished_at` UTC ;
- version agent/prompt/config ;
- versions moteur rencontrées ;
- sports / périodes / checkpoints inspectés ;
- sources lues + timestamps ;
- anomalies ;
- preuves ;
- niveau certitude ;
- action proposée ou `NO_ACTION`.

Aucun champ d'observation agent ne doit être confondu avec `motor_prob`, `decision_prob`, `confidence_level` ou recommandation moteur.

## Surveillance P1

### Opérationnel
- heartbeat NBA horaire.
- heartbeat odds 15 min.
- checkpoints H6/H4/H2/H1 attendus vs présents.
- doublons / trous / settlement overdue.
- providers stale/down.
- D1 write errors si binding actif.
- version runtime inattendue.

### Intégrité données
- `season_id` / `event_type` / `season_type`.
- datetime/slate timezone.
- data quality legacy + weighted shadow.
- prix d'exécution et âge closing snapshot.
- provenance injury/roster/odds/recent form.
- absence de recommandation rétroactive.

### Parité moteur
- backend vs frontend.
- B2B backend ±0.6 vs shadow ±1.
- EMA legacy vs decay-lambda shadow.
- DQ legacy vs weighted shadow.
- spread shadow.
- aucune activation automatique.

### Statistique
- Wilson IC 95%.
- ROI flat-stake.
- CLV observée.
- Brier par bucket.
- calibration par confidence.
- effect size.
- segmentation `engine_version` / phase / checkpoint / marché.
- pré-saison séparée de regular/postseason.

## États sortie

- `OK` · aucune anomalie actionnable.
- `WARN` · anomalie non bloquante / observation à suivre.
- `INCONCLUSIVE` · données insuffisantes ou contradictoires.
- `BLOCK` · intégrité/sécurité invalide · recommander abstention/arrêt du chemin concerné.

`BLOCK` n'autorise pas l'agent à modifier le runtime · il remonte au pilote/humain.

## Persistance future

### Phase 0 · actuelle
- aucun état agent persistant.
- docs + runbooks seulement.

### Phase 1 · read-only
- exécution manuelle/schedulée externe.
- lit endpoints existants.
- rapport éphémère.
- aucun write Mani Bet Pro.

### Phase 2 · journal agent séparé
- stockage append-only dédié à l'agent.
- jamais `PAPER_TRADING` canonique.
- schéma/version propres.
- nécessite ADR + validation créateur si D1/KV modifié.

### Phase 3 · alerting
- notifications anomalies uniquement.
- dédup/idempotence par `agent_run_id` + fingerprint anomalie.
- pas de spam si état inchangé.

### Phase 4 · propositions assistées
- agent peut préparer issue/PR draft ou hypothèse.
- changement moteur reste humainement validé.
- aucun auto-merge.

## Sécurité

- lecture minimale nécessaire.
- secrets jamais dans prompt/log/rapport.
- endpoint mutation non accordé par défaut.
- pas de `PAPER_API_KEY` si observation n'utilise pas routes Paper.
- pas de `BOT_RUN_API_KEY` pour surveillance normale.
- `DEBUG_SECRET` réservé investigation ponctuelle autorisée.
- aucune donnée brute sensible envoyée à source tierce sans nécessité.

## Remplacement providers · interdit par défaut

Un agent navigateur peut trouver une information publique, mais cela ne transforme pas cette page en provider canonique.

Pour qu'une nouvelle source devienne provider ·
1. provenance/stabilité/licence/quota analysés ;
2. fallback documenté ;
3. data contract défini ;
4. tests fixtures + panne ;
5. `PROVIDERS_MATRIX.md` mis à jour ;
6. validation ChatGPT ;
7. validation créateur si provider payant / architecture majeure ;
8. PR dédiée.

## Interaction Alon

- Observer collecte/qualifie anomalies et datasets.
- Alon analyse calibration read-only.
- Observer ne propose pas directement poids précis.
- Alon ne modifie pas code.
- ChatGPT arbitre validité méthode.
- créateur décide changement majeur.

## Pré-requis avant implémentation

- PR #241 validée runtime pré-saison.
- D1 provisionné si historique multi-checkpoint persistant requis.
- endpoint/read path historique défini sans exposer secrets.
- format observation versionné.
- tests idempotence + fail-closed + provider outage.
- coût cadence défini.
- politique notification définie.
