# DECISION-005 · NBA playoff gate · observabilité Option A

## Statut
**accepted · Option A (observabilité pure) implémentée · audit ks7cN**

## Contexte
Audit `claude/manibetpro-nba-audit-ks7cN` · matchs NBA disparus silencieusement de l'UI en playoffs. Cause racine confirmée par 2 agents indépendants ·

- `src/engine/engine.nba.js:64-75` · hard-block playoff retourne `score:null, score_method:'MISSING_ABSENCES_PLAYOFF'` quand `absences_confirmed===false`
- `src/orchestration/data.orchestrator.js:877` · branche `rejected++` sans log par matchId
- `src/ui/ui.match-detail.helpers.js:89-101` · mapping FR absent pour `MISSING_ABSENCES_PLAYOFF` · UI affiche "Données insuffisantes" générique
- Backend `_botEngineCompute` worker.js:5382 · n'applique pas le gate · `bot_log_{matchId}` créé · Telegram envoie reco · divergence MBP-A.2 CRIT-1 toujours active

Conséquences prod ·
- Chaque playoff casse silencieusement l'UI dès qu'ESPN+Claude renvoient vides
- Impossible de grep CF Dashboard "pourquoi ce match a disparu"
- Confusion utilisateur · UI vide vs Telegram reco

Référence audit · message Claude→ChatGPT du 2026-05-22 · 2 agents read-only Explore + code-debugger.

## Décision
Implémenter **uniquement** l'Option A · observabilité pure · 6 patches non-comportementaux.

Interdictions absolues respectées · pas de bypass du gate · pas de modification calibration · pas de modification scoring · pas de modification seuils · pas de modification confidence · pas de modification ROI/history/Telegram · pas de degraded mode · pas de nouvel état.

### Patches appliqués
1. `src/engine/engine.nba.js:63-89` · `Logger.warn('NBA_PLAYOFF_GATE_BLOCKED', { match_id, home, away, phase, absences_confirmed, has_injury_report, score_method })` avant le return null
2. `src/engine/engine.nba.js:80` · `rejection_reason: 'MISSING_ABSENCES_PLAYOFF'` ajouté au return du gate (au lieu de null implicite)
3. `src/orchestration/data.orchestrator.js:903-915` · `Logger.info('NBA_MATCH_REJECTED_FOR_HISTORY', { match_id, home, away, confidence_level, rejection_reason, score_method, decision })` dans la branche `rejected++`
4. `src/orchestration/data.orchestrator.js:184-203` · `Logger.warn('INJURIES_EMPTY_BOTH_SOURCES', { date, espn_teams, ai_teams, espn_report_present, ai_report_present })` quand merge ESPN+Claude renvoie 0 équipes des 2 côtés
5. `src/ui/ui.match-detail.helpers.js:96` · mapping `MISSING_ABSENCES_PLAYOFF: 'Données blessures non confirmées (playoff)'`
6. `worker.js:3382` cronLog `playoff_gate_blocked: 0` + `worker.js:3756-3760` flag éphémère `_meta_playoff_gate_would_block` calculé dans `_botAnalyzeMatch` (lu puis supprimé avant `_botSaveLog` · KV non pollué)

### Alternatives rejetées
- Option B (état dégradé visible · UI badge) · rejetée · changement comportemental UI · nécessite ADR séparée
- Option C (alignement architectural front/back) · rejetée · refactor majeur · interdiction Claude moteur sans GO ChatGPT
- Bypass simple du gate · rejeté · invalide intention v6.0 (recalibration playoff absences obligatoires · KNOWN_ISSUES.md P3-1)
- Forcer `absences_confirmed=true` partout · rejeté · invalide calibration future

## Conséquences

### Positives
- Visibilité immédiate prod via CF Dashboard grep · `NBA_PLAYOFF_GATE_BLOCKED` · `NBA_MATCH_REJECTED_FOR_HISTORY` · `INJURIES_EMPTY_BOTH_SOURCES` · `playoff_gate_blocked` dans `[BOT-CRON-LOG]`
- `rejection_reason` exposé dans le retour engine → UI peut afficher libellé clair
- Mapping FR explicite "Données blessures non confirmées (playoff)" remplace "Données insuffisantes" générique
- Aucun changement métier · aucune régression possible · 0 calibration impactée

### Négatives
- Volume de logs WARN potentiellement élevé pendant playoffs · acceptable (1 ligne par match-jour playoff)
- KV log non modifié · le flag `_meta_playoff_gate_would_block` est éphémère

### Neutres
- Divergence backend/frontend `_botEngineCompute` vs `EngineNBA.compute` toujours présente (MBP-A.2 CRIT-1) · audit séparé requis (Option C future)
- Définition `absences_confirmed` divergente (`injuryReport!==null` frontend vs `homeInjuries||awayInjuries !==null` backend) inchangée · documentée

## Tests
- `scripts/test-nba-playoff-gate.mjs` · 21 assertions · 0 fail
  - playoff + absences=false → score null + score_method correct + rejection_reason exposé
  - Logger.warn capté avec payload complet
  - mapping UI correct
  - saison régulière inchangée (gate jamais déclenché)
  - playoff + absences=true → gate franchi · pas de warn · pas de rejection_reason
- `scripts/test-nba-engine-parity.mjs` · 492 passed · 8 known-divergence · 0 fail · **parité backend↔frontend préservée**
- 6 autres suites · 0 régression · cumul 902 assertions / 0 fail

## Validation
- Audit ks7cN (read-only) · ChatGPT review → Option A validée par créateur
- Implémentation patches 1-6 · branche `claude/manibetpro-nba-audit-ks7cN`
- Tests 21+492 passants · 6 suites annexes 0 régression
- ChatGPT GO merge requis avant push prod (validation finale post-implémentation)
- Créateur GO requis avant déploiement

## Références code
- `src/engine/engine.nba.js:63-89` · PATCH 1+2
- `src/orchestration/data.orchestrator.js:184-203` · PATCH 4
- `src/orchestration/data.orchestrator.js:903-915` · PATCH 3
- `src/ui/ui.match-detail.helpers.js:96` · PATCH 5
- `worker.js:3382` + `worker.js:3756-3760` + `worker.js:3577-3582` · PATCH 6
- `scripts/test-nba-playoff-gate.mjs` · 21 assertions

## TODO post-merge (P1-P2)
- Validation prod 24h post-merge · grep CF Dashboard `NBA_PLAYOFF_GATE_BLOCKED` · OKC vs SAS 18/05/2026
- ADR séparée si Option B/C envisagée (alignement front/back, état dégradé, ou softening gate)
- TODO gouvernance · `GOVERNANCE.md` · `BOT_OBJECTIVE.md` · `PROJECT_RULES.md` à créer après validation ChatGPT (cf. SESSION.md)
