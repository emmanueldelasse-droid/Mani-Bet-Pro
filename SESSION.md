# SESSION – Mani Bet Pro
> **Fichier de continuité de session — à lire en PREMIER à chaque nouvelle session IA**

---

## Métadonnées
| Champ | Valeur |
|-------|--------|
| **Dernière mise à jour** | 2026-04-19 |
| **IA utilisée** | ChatGPT |
| **Branche active** | main |
| **Repo GitHub** | emmanueldelasse-droid / Mani-Bet-Pro |

---

## Stack technique
- **Frontend** : Vanilla JS ES modules, GitHub Pages
- **Backend** : Cloudflare Workers + KV
- **Fichiers clés** : `worker.js`, `src/ui/ui.match-detail.teamdetail.js`, `src/orchestration/data.orchestrator.js`
- **API externe** : Tank01, ESPN, The Odds API, Claude web search côté worker
- **Staking** : Kelly/4, cap 5% bankroll
- **Paper settler** : présent côté worker
- **Worker réel de référence vu en session** : `Cloudflare Worker v6.41`

## Abréviations Tank01 non-standard (CONFIRMÉES)
`GS` = Golden State | `NO` = New Orleans | `NY` = New York | `SA` = San Antonio

---

## État actuel du projet

### Ce qui fonctionne
- [x] La route `/nba/team-detail` répond correctement avec `last10`, `h2h`, `homeSplit`, `awaySplit`, `restDays`, `avgTotal`, `last5ScoringAvg`, `momentum`, `top10scorers`
- [x] Le worker renvoie maintenant `home.latestGame` et `away.latestGame`
- [x] Le front affiche bien le résumé du dernier match sous chaque équipe dans **Stats équipes**
- [x] Le branchement front ↔ worker est validé sur la fiche match NBA
- [x] Le chargement général dashboard / fiche match continue de fonctionner après l’ajout

### Ce qui est cassé / en cours
- [ ] `home.latestMediaSummary` et `away.latestMediaSummary` restent à `null`
- [ ] Donc aucun résumé / lien Basket USA ne s’affiche encore dans l’UI
- [ ] Petit bug front : doublon de libellé `Dernier match : Dernier match : ...`
- [ ] Il manque une vraie route debug worker pour inspecter le fetch / parsing / scoring Basket USA
- [ ] Le cache `team-detail` peut masquer certaines modifs worker pendant les tests

---

## Dernière session

**Date** : 2026-04-19
**IA** : ChatGPT
**Durée estimée** : session courte à moyenne

### Tâches accomplies
- Analyse du vrai fichier worker fourni par l’utilisateur
- Vérification de la route `/nba/team-detail`
- Génération d’un front modifié pour afficher le dernier match et un éventuel bloc média
- Vérification de la réponse JSON réelle du worker sur `BOS` vs `PHI`
- Vérification visuelle sur la fiche match que le résumé du dernier match s’affiche bien
- Identification claire que le problème restant est côté worker Basket USA, pas côté front

### Bugs résolus
- Validation du branchement `latestGame` côté front
- Validation que l’absence de résumé média ne vient pas du front

### Bugs encore présents
- `latestMediaSummary = null` pour les équipes testées
- Affichage en double de `Dernier match :`

### Décisions techniques prises
- Garder la logique : **vérité match = données structurées worker**
- Garder la logique : **média = couche complémentaire facultative**
- Ne pas continuer à bricoler le front tant que le worker ne renvoie pas de vrai `latestMediaSummary`
- Ajouter une route debug Basket USA dans le worker avant toute autre tentative de correction média
- Corriger le doublon front en affichant soit `summary_short` avec label front, soit `summary_long` sans label front

### Fichiers modifiés
| Fichier | Changement |
|---------|------------|
| `worker.js` | enrichissement visé autour de `/nba/team-detail` avec `latestGame` / tentative `latestMediaSummary` |
| `src/ui/ui.match-detail.teamdetail.js` | ajout affichage résumé dernier match + bloc média optionnel |

---

## Prochaine étape prioritaire

> **TODO #1** : Ajouter une route debug Basket USA dans le worker pour comprendre pourquoi `latestMediaSummary` reste `null`

**Contexte nécessaire pour reprendre** :
- Le résumé du dernier match fonctionne déjà
- Le front est prêt à afficher un bloc média si `latestMediaSummary` existe
- Le vrai blocage restant est côté worker
- Il faut exposer en debug :
  - taille du HTML récupéré
  - liste des titres candidats extraits
  - scoring des candidats
  - meilleur candidat retenu ou `null`
- Il faudra probablement bypass le cache `team-detail` pendant les tests
- Il faudra aussi corriger le doublon visuel `Dernier match : Dernier match : ...`

---

## Historique des sessions

| Date | IA | Résumé |
|------|----|--------|
| 2026-04-19 | ChatGPT | Validation du résumé du dernier match dans `Stats équipes`, identification du blocage worker sur `latestMediaSummary`, besoin d’une route debug Basket USA |

---

## Notes permanentes

- Ne jamais afficher de prix fictifs ou périmés — toujours un état de chargement
- Les abréviations Tank01 non-standard (GS, NO, NY, SA) sont CORRECTES — ne pas les "corriger"
- Déploiement via GitHub web UI uniquement (pas de Git en local sur le PC du bureau)
- Réseau corporate bloque les API externes — tester hors réseau corp si besoin
- Pour cette feature, toujours distinguer :
  - **résumé du dernier match** = donnée structurée fiable du worker
  - **résumé média** = donnée complémentaire facultative
- Tant que `latestMediaSummary` vaut `null`, le front a raison de ne rien afficher pour la partie média
