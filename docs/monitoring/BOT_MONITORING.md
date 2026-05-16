# Bot monitoring post-deploy

## Pourquoi

Suivre l'impact réel des derniers garde-fous (MBP-A.2 parité moteur · MBP-P1 gate `data_quality`) sans toucher au moteur. Piloter MLB · Tennis · NBA avec des chiffres · pas à l'instinct.

Répond précisément à ·
- combien de matchs analysés
- combien de recos produites / bloquées
- combien d'INCONCLUSIVE
- combien de MLB LOW bloqués (MBP-P1)
- combien de NBA/Tennis avec `data_quality < 0.55` bloqués (MBP-P1)
- hit rate global · par sport · par confidence · par type de pari
- décision MLB (garder / surveiller / limiter) selon hit rate sur 50 derniers settlés
- décision Tennis (garder / surveiller / revert) selon hit rate sur 50 derniers settlés

## Comment lancer

3 modes ·

```
# Mode 1 · prod live · récupère via les 3 routes publiques GET
node scripts/report-bot-monitoring.mjs --url https://manibetpro.emmanueldelasse.workers.dev

# Mode 2 · dump local · format JSON { NBA: [...], MLB: [...], TENNIS: [...] }
node scripts/report-bot-monitoring.mjs --fixture ./bot-logs-export.json

# Mode 3 · démo · fixtures embarquées (présentation / test)
node scripts/report-bot-monitoring.mjs --demo
```

Aucun secret requis. Aucun appel provider externe (Tank01 · ESPN · TheOddsAPI · Claude · Telegram). Aucune écriture KV.

### Comportement `--url` en cas d'erreur

**Règle stricte (validée ChatGPT post-review PR #198)** · un rapport partiel ou vide ne doit jamais être présenté comme s'il était complet.

- **0 endpoint en échec** · rapport complet · exit 0
- **1 à 3 endpoints en échec** · ·
  - bandeau `[ERROR] RAPPORT INCOMPLET` affiché en TÊTE (stderr) avant le rapport
  - liste des routes échouées + raison (HTTP code · fetch error · payload inattendu)
  - mention explicite "ne pas baser de décision MLB/Tennis sur ce rapport"
  - **exit 1**

**Un rapport incomplet n'est pas une base de décision.** Ne jamais merger une calibration ou désactiver un sport en se basant sur un rapport en échec partiel.

Fonction pure `evaluateFetchErrors(errors)` exportée par `scripts/lib/monitoring-summary.mjs` · testable sans réseau.

## Sources de données

Routes publiques existantes (audit ROUTES_AUDIT.md confirmé) ·
- `GET /bot/logs` → `handleBotLogs` (worker.js:3855) · logs NBA depuis KV `bot_log_*`
- `GET /mlb/bot/logs` → `handleMLBBotLogs` (worker.js:8924) · logs MLB depuis KV `mlb_bot_log_*`
- `GET /tennis/bot/logs` → `handleTennisBotLogs` (worker.js:10558) · logs Tennis depuis KV `tennis_bot_log_*`

Toutes en lecture seule · TTL 90j sur les clés KV.

## Métriques calculées

### Globales
- matchs analysés
- matchs avec reco exploitable · `total_recos_exploitable` · compte les LOGS qui ont au moins une reco utilisable (`best !== null` OU `recommendations[].length > 0`) · pas le nombre total de recos individuelles
- recommandations bloquées (INCONCLUSIVE + dq < 0.55 numérique + MLB LOW)
- settlés / non settlés
- hit rate global pondéré

### Par sport
- matchs analysés
- matchs avec reco exploitable (alias `total_recos_exploitable` · LOGS · pas recos individuelles)
- **`total_blocked`** · logs UNIQUES bloqués (un log à la fois INCONCLUSIVE ET dq<0.55 compte 1 fois)
- **`blocked_reasons_total`** · somme brute des raisons (peut dépasser `total_blocked` si chevauchements) · diagnostic
- compteurs séparés par raison ·
  - `total_inconclusive` · NBA · Tennis · `confidence_level === 'INCONCLUSIVE'`
  - `dq_below_055_blocked` · NBA · Tennis · `data_quality < 0.55` (MBP-P1)
  - `mlb_low_blocked` · MLB · `data_quality === 'LOW'` (MBP-P1)
- settlés / non settlés
- hit rate global
- hit rate sur les 50 derniers settlés (proxy "post-recalibration")
- hit rate par confidence (HIGH · MEDIUM · LOW · INCONCLUSIVE)
- hit rate par type de pari (MONEYLINE · SPREAD · OVER_UNDER · PLAYER_POINTS · PITCHER_STRIKEOUTS)
- distribution data_quality (buckets numériques NBA/Tennis · labels MLB)

### Statut par sport
- `NBA` · `OK` si ≥80 settlés · sinon `SURVEILLER` (recheck calibration TODO P2)
- `MLB` · `LIMITER_OU_DESACTIVER` si ≥50 settlés ET hit_rate_last_50 < 52% · sinon `SURVEILLER`
- `Tennis` · `SURVEILLER_REVERT` si ≥50 settlés ET hit_rate_last_50 < 50% · sinon `SURVEILLER`

### Conclusion
Texte synthétique par sport + recommandation globale "ne pas recalibrer tant que les logs post-MBP-P1 ne parlent pas".

## Règles de calcul

### Hit rate
- calculé uniquement sur les logs settlés (`motor_was_right === true` ou `false`)
- non settlés (`motor_was_right === null`) exclus
- canonique · champ `motor_was_right` posé par les settlers respectifs (`_botSettleDate` NBA worker.js:3930 · `_mlbBotSettleDate` worker.js:8977 · settler tennis)

### Reco exploitable
- log a `betting_recommendations.best !== null` OU `recommendations[].length > 0`
- conséquence MBP-P1 ·
  - MLB LOW → `recommendations: []` + `best: null` → non compté
  - NBA/Tennis dq < 0.55 → `confidence: INCONCLUSIVE` + recs vide → non compté

### Reco bloquée
- NBA · Tennis · `confidence_level === 'INCONCLUSIVE'` OU `data_quality < 0.55`
- MLB · `data_quality === 'LOW'`

**Important · `total_blocked` compte les LOGS uniques · pas les raisons.**
Un log NBA/Tennis avec dq < 0.55 a aussi `confidence_level === 'INCONCLUSIVE'`
(MBP-P1 force le label). Ne pas additionner les compteurs · ils chevauchent.
Pour la somme brute des raisons → champ séparé `blocked_reasons_total`.

### Hit rate par type
- par reco individuelle · champ `was_right` (boolean ou null)
- exclut les `was_right === null` (non settlées)

## Limites · ne PAS confondre avec autre chose

### Pas de stamp engine_version dans les logs
- "post-v6.94 MLB" et "post-v6.93 Tennis" sont approximés par "50 derniers settlés"
- Hypothèse · les 50 derniers logs settlés ont été produits avec la calibration actuelle (vérifiable manuellement via dates)
- Non mesurable · combien de logs sont avant/après chaque calibration précise

### Pas de mesure des recos pré-MBP-P1
- Anciens logs (pré-PR #197) peuvent avoir des recos en MLB LOW ou en NBA/Tennis dq < 0.55
- Le rapport compte ces logs comme "bloqués" car la métrique se base sur les champs `confidence_level` et `data_quality` du log ·
- Les logs post-MBP-P1 ont aussi `recommendations: []` et `best: null` quand bloqués
- Hypothèse correcte si toute analyse est faite avec les conditions actuelles

### Hit rate "last 50" peut être faussé sur petits volumes
- Si <50 logs settlés · le calcul utilise tous les settlés disponibles (statut basé sur n<50 → SURVEILLER)
- Avec >50 settlés · seuls les 50 plus récents servent

### CLV / Brier non recalculés ici
- Les routes `/bot/logs`, `/mlb/bot/logs` exposent déjà ces métriques · le rapport ne les duplique pas
- Pour CLV / Brier · consulter `/bot/calibration/analyze?sport=X` (route existante)

### PLAYER_POINTS / PITCHER_STRIKEOUTS · champ `was_right` peut être absent
- Les props pas encore évaluées par ESPN box score → `was_right === null` exclus du hit rate

## Décisions à prendre selon les chiffres

### MLB · après 50+ logs settlés post-v6.94
- `hit_rate_last_50 >= 52%` · garder · continuer à surveiller
- `hit_rate_last_50 < 52%` · `LIMITER_OU_DESACTIVER` · proposer Option C SESSION.md (limiter aux edges [5,10] ou désactiver le bot MLB)
- Décision finale · ChatGPT + user · jamais auto

### Tennis · après 50+ logs settlés post-v6.93
- `hit_rate_last_50 >= 50%` · garder · continuer à surveiller
- `hit_rate_last_50 < 50%` · `SURVEILLER_REVERT` · envisager revert isolé vers v6.93 (SESSION.md TODO)
- Décision finale · ChatGPT + user · jamais auto

### NBA · après 80+ logs settlés
- Lancer `/bot/calibration/analyze?sport=nba` · audit Alon
- Décision · garder · ajuster poids · documenter dans NBA_ENGINE_AUDIT.md

## Pourquoi pas recalibrer maintenant

- MBP-P1 vient de modifier le comportement des recos (gate dq) · les anciens hits/misses ne sont plus représentatifs du nouveau comportement
- Recalibrer maintenant introduirait du bruit · les chiffres sont mélangés (pré + post gate)
- Attendre 50 nouveaux paris settlés avec le gate actif avant toute décision de calibration
- Conformité avec PROJECT_RULES.md · "Tout changement de seuil → justifier par chiffres sur logs settlés"

## Tests

```
node scripts/test-bot-monitoring-summary.mjs
```

Couvre · 50 assertions sur fixtures déterministes ·
- comptage NBA / MLB / Tennis (analysed · settled · unsettled · blocked · inconclusive)
- hit rate excluant non-settlés
- seuil strict dq 0.55 (0.55 autorisé · 0.549 bloqué)
- décisions MLB (50 settlés · hit 50% → LIMITER · hit 54% → SURVEILLER)
- décisions Tennis (50 settlés · hit 44% → SURVEILLER_REVERT · hit 56% → SURVEILLER)
- cohérence totaux globaux
- `total_blocked` unique vs `blocked_reasons_total` somme brute (post-review · pas de double comptage)
- `evaluateFetchErrors` · 0 / 1 / 2 / 3 erreurs · input null safe

## Architecture fichiers

- `scripts/report-bot-monitoring.mjs` · CLI · 3 modes (`--demo` · `--url` · `--fixture`)
- `scripts/lib/monitoring-summary.mjs` · fonction pure `summarize` + `formatReport` · constantes seuils
- `scripts/lib/monitoring-fixtures.mjs` · données déterministes pour démo + tests
- `scripts/test-bot-monitoring-summary.mjs` · tests unitaires
- `docs/monitoring/BOT_MONITORING.md` · ce document

## Étendre

- Ajouter une nouvelle métrique · éditer `summarizeSport` dans `monitoring-summary.mjs` + ajouter test correspondant
- Ajouter un nouveau seuil de décision · modifier `_CONST` + `decideXxxStatus`
- Branche route worker dédiée (`/bot/monitoring/summary`) · hors scope actuel · pourrait être ajoutée plus tard sans modif moteur

## Hors scope

- Pas de UI · le rapport est console-only (mission · "le plus important est le rapport fiable · UI secondaire")
- Pas de route worker dédiée · les 3 routes existantes suffisent
- Pas d'envoi automatique (Telegram · email) · à ajouter plus tard si besoin
- Pas de stockage historique des rapports · à lancer à la demande
