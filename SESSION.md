# SESSION – Mani Bet Pro
> **Fichier de continuité de session — à lire en PREMIER à chaque nouvelle session IA**

---

## Métadonnées
| Champ | Valeur |
|-------|--------|
| **Dernière mise à jour** | 2026-04-20 |
| **IA utilisée** | Claude Code (Sonnet 4.6) |
| **Branche active** | claude/update-previous-session-YrRS6 |
| **Repo GitHub** | emmanueldelasse-droid / Mani-Bet-Pro |

---

## Stack technique
- **Frontend** : Vanilla JS ES modules, GitHub Pages
- **Backend** : Cloudflare Workers + KV
- **Fichiers clés** : `worker.js`, `src/ui/ui.match-detail.teamdetail.js`, `src/orchestration/data.orchestrator.js`
- **API externe** : Tank01, ESPN, The Odds API, Claude web search côté worker
- **Staking** : Kelly/4, cap 5% bankroll
- **Paper settler** : présent côté worker
- **Worker réel de référence vu en session** : `Cloudflare Worker v6.44`

## Abréviations Tank01 non-standard (CONFIRMÉES)
`GS` = Golden State | `NO` = New Orleans | `NY` = New York | `SA` = San Antonio

---

## État actuel du projet

### Ce qui fonctionne
- [x] La route `/nba/team-detail` répond correctement avec `last10`, `h2h`, `homeSplit`, `awaySplit`, `restDays`, `avgTotal`, `last5ScoringAvg`, `momentum`, `top10scorers`
- [x] Le worker renvoie maintenant `home.latestGame` et `away.latestGame`
- [x] Le front affiche bien le résumé du dernier match sous chaque équipe dans **Stats équipes**
- [x] Le branchement front ↔ worker est validé sur la fiche match NBA
- [x] Le chargement général dashboard / fiche match continue de fonctionner après l'ajout
- [x] Fix matchs live dans l'orchestrateur (PR #3 intégrée) — plus d'écran vide pendant les playoffs
- [x] Affichage LIVE sur les cartes match (badge "🔴 LIVE", score en temps réel)
- [x] Calcul `rest_days` / `back_to_back` dans le bot
- [x] `wrangler.jsonc` propre : `main: worker.js`, KV binding, cron trigger
- [x] Route `/debug/basketusa` opérationnelle avec `?home=XX&away=XX&no_cache=1`
- [x] Bug root cause `latestMediaSummary = null` identifié et corrigé : abréviations non-standard Tank01 (GS, NO, NY, SA) manquaient dans `BU_DEBUG_TEAMS`
- [x] Doublon visuel `Dernier match : Dernier match :` — déjà corrigé (label HTML + summary_long sans label)

### Ce qui est cassé / en cours
- [ ] `latestMediaSummary` à tester en production après déploiement du fix BU_DEBUG_TEAMS
- [ ] Le cache KV `basketusa_best_v3_*` peut masquer le fix pendant 45 min — utiliser `?no_cache=1` sur `/debug/basketusa` pour vider le cache de la paire

---

## Dernière session

**Date** : 2026-04-20
**IA** : Claude Code (Sonnet 4.6)
**Durée estimée** : session moyenne

### Tâches accomplies
- Intégration des corrections de la PR #3 (`claude/fix-data-loading-ZywKE`) par cherry-pick :
  - Fix `data.orchestrator.js` : matchs live affichés au lieu d'écran vide
  - Fix `ui.dashboard.js` : badge LIVE, score en temps réel, pas de countdown sur match en cours
  - Fix `worker.js` bot : calcul `rest_days` / `back_to_back` fonctionnel
  - Fix `wrangler.jsonc` : `main: worker.js`, KV binding, cron trigger
  - Ajout `.github/workflows/deploy-worker.yml` : déploiement auto sur push main
- Identification du bug root cause de `latestMediaSummary = null` : les abréviations non-standard Tank01 (`GS`, `NO`, `NY`, `SA`) n'étaient pas dans `BU_DEBUG_TEAMS`
- Ajout des entrées manquantes dans `BU_DEBUG_TEAMS` pour les 4 abréviations non-standard
- Amélioration de `/debug/basketusa` : param `?no_cache=1` pour vider le cache KV + affichage des aliases trouvés dans la réponse JSON

### Bugs résolus
- `latestMediaSummary = null` pour GS/NO/NY/SA : fix `BU_DEBUG_TEAMS` (lignes 1355–1358 du worker)
- Doublon `Dernier match : Dernier match :` : déjà corrigé (code propre, vérifié)
- Matchs live : orchestrateur retournait `null` au lieu des matchs en cours (PR #3)
- Bot : `rest_days_diff` / `back_to_back` toujours `null` / `false` (PR #3)

### Bugs encore présents
- `latestMediaSummary` à valider en production (fix déployé mais non testé en live)

### Décisions techniques prises
- `BU_DEBUG_TEAMS` est la table canonique des aliases Basket USA — y ajouter systématiquement les variantes d'abréviation
- `/debug/basketusa?home=GS&away=BOS&no_cache=1` est la commande de référence pour diagnostiquer Basket USA
- Ne pas merger les PR #4 et #5 (SESSION.md only, obsolètes — la vraie mise à jour est dans cette branche)

### Fichiers modifiés
| Fichier | Changement |
|---------|------------|
| `worker.js` | Fix `BU_DEBUG_TEAMS` + 4 abréviations non-standard + amélioration `/debug/basketusa` |
| `src/orchestration/data.orchestrator.js` | Fix matchs live (cherry-pick PR #3) |
| `src/ui/ui.dashboard.js` | Badge LIVE + score en cours (cherry-pick PR #3) |
| `wrangler.jsonc` | Config propre : main, KV, cron (cherry-pick PR #3) |
| `.github/workflows/deploy-worker.yml` | Nouveau : CI/CD déploiement auto |

---

## Prochaine étape prioritaire

> **TODO #1** : Tester `/debug/basketusa?home=GS&away=BOS&no_cache=1` en production pour confirmer que `latestMediaSummary` n'est plus `null` après déploiement

**Contexte nécessaire pour reprendre** :
- Le bug était : `BU_DEBUG_TEAMS` n'avait pas `GS`, `NO`, `NY`, `SA` comme clés → score 0 → `accepted = null`
- Le fix est en place (worker.js ligne ~1358)
- La route debug retourne maintenant `home_aliases_found` et `away_aliases_found` pour vérifier d'un coup d'œil
- Si `latestMediaSummary` est encore `null` après fix, vérifier :
  1. Le cache KV `basketusa_best_v3_GS_BOS` — utiliser `?no_cache=1` pour le vider
  2. Que basketusa.com est accessible depuis Cloudflare (pas de blocage géo/bot)
  3. Le champ `html_length` dans la réponse debug — si 0, problème de fetch
  4. Le champ `total_candidates` — si 0, problème de parsing HTML

---

## Historique des sessions

| Date | IA | Résumé |
|------|----|--------|
| 2026-04-19 | ChatGPT | Validation du résumé du dernier match dans `Stats équipes`, identification du blocage worker sur `latestMediaSummary`, besoin d'une route debug Basket USA |
| 2026-04-20 | Claude Code (Sonnet 4.6) | Mise en place du guide SESSION.md, exploration codebase, revue PRs (branche claude/zen-tesla-AZKGq) |
| 2026-04-20 | Claude Code (Sonnet 4.6) | Intégration PR #3 (cherry-pick), fix bug root cause `latestMediaSummary` (BU_DEBUG_TEAMS), amélioration `/debug/basketusa` |

---

## Notes permanentes

- Ne jamais afficher de prix fictifs ou périmés — toujours un état de chargement
- Les abréviations Tank01 non-standard (GS, NO, NY, SA) sont CORRECTES — ne pas les "corriger"
- Ces abréviations DOIVENT être présentes dans `BU_DEBUG_TEAMS` pour que le scoring Basket USA fonctionne
- Déploiement via GitHub web UI uniquement (pas de Git en local sur le PC du bureau)
- Réseau corporate bloque les API externes — tester hors réseau corp si besoin
- Pour cette feature, toujours distinguer :
  - **résumé du dernier match** = donnée structurée fiable du worker
  - **résumé média** = donnée complémentaire facultative (Basket USA)
- Route debug : `/debug/basketusa?home=XX&away=XX` — ajouter `&no_cache=1` pour vider le cache KV de la paire
