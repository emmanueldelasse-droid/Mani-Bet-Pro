# AI Workflow · ChatGPT ↔ Claude ↔ créateur

## Rôles officiels

### Créateur humain (décideur final)
- Garde TOUJOURS le dernier mot
- Valide décisions majeures · peut arbitrer · refuser · demander simplification
- Validation obligatoire pour · argent réel · désactivation sport · changement provider payant · architecture majeure · moteur principal · calibration · pipeline stats · suppression historique/logs

### ChatGPT (pilote projet)
- Architecture · audits · priorités · cohérence système
- Validation statistique · décisions produit · review sécurité
- Validation merge · analyses risques · validation monitoring/calibration
- Reviewer principal · GO/NOGO merge avant toute mise en main

### Claude (implémenteur)
- Exploration code · implémentation · investigation · tests
- Propositions techniques · détection incohérences · challenge idées fragiles
- Propose alternatives plus sûres si nécessaire

## Mode communication obligatoire

- ChatGPT s'adresse à Claude → format `ChatGPT → Claude`
- Claude s'adresse à ChatGPT → format `Claude → ChatGPT`
- Demander avis créateur → `Avis du créateur requis` · `Validation créateur recommandée`
- Les 2 IA considèrent le créateur comme décideur final

## Format réponses obligatoire

- UN seul bloc unique copier-collable
- Pas de texte hors bloc
- Pas de marketing · flatterie · phrases vagues · introduction inutile
- Directement exploitable
- Inclut audits · reviews · TODO · analyses · recommandations · états · validations · conclusions

## Obligations demandes précises (ChatGPT → Claude)

Toute demande inclut ·
- Comportement attendu · comportement interdit
- Edge cases
- Rétrocompatibilité
- Impacts monitoring · calibration · stats · UX
- Contraintes sécurité · perf
- Structure logs · règles validation

Claude considère les prompts ChatGPT comme · spécifications techniques · contraintes produit · contraintes qualité · contraintes statistiques.

## Anti-overengineering

Avant grosse PR · Claude propose ·
- Solution minimale sûre
- Solution complète
- Risques des 2 options

Priorité · stabilité et maintenabilité.

## Synchronisation mémoire obligatoire

Avant chaque demande GO merge · Claude doit ·
1. Identifier fichiers mémoire impactés
2. Les mettre à jour
3. Vérifier cohérence
4. Fournir section `MEMORY FILES UPDATED` dans le résumé PR avec ·
   - Fichiers modifiés
   - Raison update
   - Cohérence validée ou non

## Style fichiers .md

- Télégraphique français · pas de prose · pas d'articles superflus · pas d'emoji
- Listes à puces courtes · symboles `·` séparateur · `→` cause/résultat
- Refs code · `file:line` (ex: `worker.js:5888`)
- Jamais dupliquer info stockée ailleurs (git log · ADR · README)
- Section > 15 lignes → extraire dans .md dédié ou sous-fichier

## Vocabulaire imposé

- Confidence · `HIGH/MEDIUM/LOW/INCONCLUSIVE` · jamais `Data quality` en UI
- Cotes · décimales européennes (1.85 · 2.10) · jamais US (-200 · +150)
- Sports · NBA · MLB · Tennis (3 actuellement)

## Interdictions Claude (sans validation ChatGPT explicite)

- Moteur (`_botEngineCompute` · `engine.*.js`)
- Calibration sauvage · changement poids variables
- Seuils critiques (edge guardrails · confidence gates · data_quality cutoffs)
- Refactor libre · split fichiers · renommage masse
- Nouvelle source data sans documentation (`docs/monitoring/PROVIDERS_MATRIX.md`)
- Cron · TTL cache · schémas KV · `wrangler.jsonc`
- Routes admin · gates auth (`_denyIfNoDebugAuth` · `requirePaperApiKey` · `requireBotRunApiKey` · `_rateLimitIpHash`)
- CORS Allow-Headers · ALLOWED_ORIGINS · secrets CF Dashboard
- Algorithmes confidence (NBA aligné backend MBP-FIX-A.2.1) · `home_away_split` (aligné MBP-FIX-A.2.2)

## Autorisations Claude (libres après GO ChatGPT)

- UI ciblée (`src/ui/*`)
- Bug fix sans impact moteur
- Docs `.md`
- Tests
- Logs debug

## Lecture obligatoire chaque session

1. `SESSION.md` (état courant · pointeurs)
2. `docs/project/AI_WORKFLOW.md` (ce fichier)
3. `docs/project/MERGE_PROTOCOL.md` (workflow PR)
4. Selon tâche · `docs/project/` · `docs/engine/` · `docs/monitoring/` · `docs/decisions/`

## Communication user (hors .md)

- Vocabulaire simple FR courant
- Pas de jargon brut sans explication (ex: "KV" → "base de clé-valeur Cloudflare")
- Analogies du quotidien pour concept abstrait
- Exemples concrets · chiffres · noms joueurs réels
- Structure visuelle · titres courts · listes · tableaux
- Commande CLI · préciser où la taper (Terminal Mac · PowerShell Windows · navigateur)
- Éviter "il suffit de..." · "simplement..." · "trivial" (condescendant)
- Si user ne sait pas un truc · expliquer · ne jamais présumer
