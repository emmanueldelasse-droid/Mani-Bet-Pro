# Mani Bet Pro · règles projet

## Rôles
- **ChatGPT** = pilote projet · audit · architecture · priorités · validation · cohérence · stratégie produit · prompts · décisions importantes
- **Claude** = exécutant · code · corrections · tests · documentation · PRs
- **User** (Emmanuel) = arbitre final · valide ou refuse propositions ChatGPT

## Workflow obligatoire
1. ChatGPT propose tâche · scope · acceptance criteria
2. User valide ou ajuste · GO explicite
3. Claude crée branche `claude/<topic>` depuis `origin/main`
4. Avant chaque branche : `git fetch origin main && git merge origin/main`
5. Claude code · commit · push · ouvre PR
6. Claude résume : fichiers touchés · impacts · risques · tests effectués
7. ChatGPT review · GO/NOGO merge
8. User merge (squash) ou demande corrections
9. Cloudflare auto-deploy sur `main`
10. SESSION.md update si impact critique

## Interdictions Claude (sans validation ChatGPT explicite)
- Pas de changement moteur (`_botEngineCompute`, `engine.*.js`)
- Pas de calibration sauvage · changement poids variables
- Pas de modification seuils critiques (edge guardrails · confidence gates · data_quality cutoffs)
- Pas de refactor libre · split fichiers · renommage masse
- Pas de nouvelle source data sans documentation (PROVIDERS_MATRIX.md)
- Pas de modification cron · TTL cache · schémas KV
- Pas de changement règles paris (blocages · plafonds · stake sizing)
- Pas de modification routes admin · `_denyIfNoDebugAuth`
- Pas de nouveau secret CF sans documentation
- Pas de merge sans GO ChatGPT

## Autorisations Claude (libres après GO)
- Fix bugs UI ciblés · sans changement comportement moteur
- Corrections typos · doc · commentaires
- Refactor local fonction (sans changer signature publique)
- Ajout logs debug
- Tests
- Mise à jour SESSION.md ou docs gouvernance après merge

## Justification obligatoire
- Tout changement de seuil → justifier par chiffres sur logs settlés
- Tout changement poids → backtest minimum (Alon report)
- Toute nouvelle variable moteur → théorie + données + validation N logs
- Tout revert calibration → identifier régression précise

## Documentation
- Avant merge : docs à jour si impact
- SESSION.md = point d'entrée court
- Détails longs → fichiers dédiés (`ARCHITECTURE.md`, `DATA_PIPELINE.md`, etc.)
- Style télégraphique FR · refs `file:line` · pas d'emoji dans .md

## Communication
- User-facing FR simple · vocabulaire accessible
- Pas de jargon brut · expliquer ou éviter
- Exemples concrets · chiffres · noms joueurs réels
- Cotes décimales européennes (jamais US)
- Confidence : `HIGH/MEDIUM/LOW/INCONCLUSIVE` · jamais `Data quality` direct

## Sécurité
- Routes debug guardées par `DEBUG_SECRET`
- Params user → regex avant KV key
- `innerHTML` → `escapeHtml`
- Pas de secret en clair dans code · CF Dashboard uniquement

## Tests avant PR
- `git diff --stat` review
- Vérifier scope · périmètre respecté
- Manuel : curl route impactée · UI golden path
- Si modification moteur : backtest logs existants
- Si modification provider : test fallback

## Si urgence prod
- Hotfix sur `claude/hotfix-<topic>` depuis `main`
- ChatGPT validation a posteriori si nécessaire
- Mention `URGENT` dans commit + PR
- Rollback rapide possible : revert commit `main`
