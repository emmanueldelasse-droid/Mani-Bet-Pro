# Known issues Mani Bet Pro

Source · SESSION.md + audit code + git log mai 2026.

## P1 (prioritaire · à traiter rapidement)

### P1-1 · Hit rate MLB v6.94 sous cible
- Hit rate 49.8% post 315 logs · cible >55%
- Garde-fou edge [5, 10] zone seule profitable (54.7% sur 64 paris)
- TODO SESSION.md:14 · surveiller post 50 paris v6.94 · si <52% désactiver bot (Option C)
- Ref · `worker.js:8330` (changements v6.94)

### P1-2 · Hit rate Tennis v6.93 à valider
- Recalibration v6.95 data-driven 273 logs · revert v6.93 (Elo poids surévalué)
- TODO SESSION.md:15 · surveiller post 50 paris · revert isolé si baisse
- Ref · `worker.js:9097` + `sports.config.js:190`

### P1-3 · Confidence gate INCONCLUSIVE manquant
- Pas de gate auto `confidence=INCONCLUSIVE` si `data_quality<0.55`
- Risque · recos publiées sur données fragiles
- TODO P2 SESSION.md:17 (en réalité priorité critique)
- Ref · `worker.js:5185`

## P2 (à traiter sous quelques semaines)

### P2-1 · NBA recheck calibration à 80+ logs
- Actuel · 53 logs hit 67.9% v6.79 valide mais petit échantillon
- `travel_load_diff` signe inversé n=22 · ignoré pour l'instant
- TODO SESSION.md:16

### P2-2 · Calibration tennis post 30+ logs settlés v6.85+
- Lancer `/bot/calibration/analyze?sport=tennis`
- Vérifier 9 vars poids data-driven OK
- TODO SESSION.md:18

### P2-3 · ESPN ↔ Tank01 noms joueurs
- v6.34 fix · `_normalizeName` (worker.js:179)
- Avant fix · 27/44 noms rataient le matching
- Risque · changement format ESPN sans préavis
- Surveillance continue requise

### P2-4 · Sackmann CSV lag 2-3j tennis
- CSV publié avec retard · derniers matchs absents
- `recent_form_ema` qualité dégradée si lag > 3j
- Mitigation · v7.00 recalcul Elo incrémental depuis ESPN (commit `8f640e9`)
- Mais ESPN tennis matching surname uniquement (faux positifs prénoms réglés v6.99)

### P2-5 · Effect size Elo tennis signe douteux
- v6.95 · Elo poids réduit à 0.10 car effect_size = 0.15 signe douteux
- À reconfirmer post 100+ logs supplémentaires

## P3 (long terme · low impact)

### P3-1 · Playoff `-4.5` par round
- Calibrer après 100+ logs playoff par round
- Alon 50+ logs aussi
- TODO SESSION.md:19

### P3-2 · Paris contrarian
- Désactivés actuellement
- Réactiver après 200+ logs · cotes ≥ 3
- TODO SESSION.md:20

### P3-3 · api-tennis fixtures
- Compte payant non actif
- TODO SESSION.md:21 · réactiver si `TENNIS_API_FIXTURES_ENABLED=1`

## Bugs résolus récemment (référence git log mai 2026)

| Version | Commit | Fix |
|---|---|---|
| v6.96 phase 4 | 23a728a | UI tennis · surface badge honest + Elo threshold sync |
| v6.96 phase 3 | 58cdfa1 | UI tennis · sync front/back phases + Pourquoi pondéré |
| v6.96 phase 2 | d2c269c | UI tennis · honest markets display |
| v6.96 phase 1 | 8c96a28 | UI tennis · confidence + handlers post-inversion v6.81 |
| v6.95 | 841317b | Recalibration tennis data-driven 273 logs · revert v6.93 |
| v6.94 | 199bb1e | MLB recalibration · concentrate 4 vars + edge guardrail [5, 10] |
| v7.01 | 23a728a (tennis-espn) | Garde-fou Elo opp inconnu + strip baseline avant JSON |
| v7.00 | 8f640e9 | Recalcul Elo incrémental overall + surface depuis ESPN |
| v6.99 | 99fe5b7 | Tennis-espn matching surname uniquement · stop faux positifs |

## Dette technique

### Worker.js taille
- ~9600 lignes · SESSION.md mentionne ~8500L (à jour ?)
- Mix backend bot inline + handlers routes
- Refactor possible · découper en modules · mais risque régression élevé · pas prioritaire

### Pas de tests automatisés
- Pas de Jest · Vitest · etc.
- Tests manuels uniquement (curl + UI)
- Risque régression à chaque merge
- TODO long terme · suite tests unitaires (à valider ChatGPT)

### Duplication moteur NBA
- Frontend `src/engine/engine.nba.js` (4 fichiers split)
- Backend inline `worker.js:_botEngine*`
- Doit rester synchronisé manuellement
- Risque divergence frontend/backend

### Pas de staging
- Push `main` → prod directe Cloudflare
- Pas d'environnement preview avant
- Risque · bug en prod immédiat
- Mitigation possible · branch preview Cloudflare (à étudier)

### Sports config sync
- `sports.config.js:191-210` (poids tennis par phase)
- DOIT rester sync avec `worker.js:9099-9105`
- Pas de check automatisé · risque oubli

## Zones instables

### Tennis Elo
- v7.00 recalcul incrémental ESPN tout récent
- v7.01 garde-fou opp inconnu
- À surveiller stabilité prochaines semaines

### Claude API model
- `claude-sonnet-4-20250514` (config worker · à confirmer)
- Models évoluent · sonnet-4-6 sonnet-4-7 haiku-4-5 disponibles
- TODO · validation ChatGPT pour upgrade

### Pinnacle clé invité
- Clé publique frontend Pinnacle · `CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R`
- Peut être révoquée sans préavis
- Pas de fallback documenté · TODO documenter alternative

### TheOddsAPI quota
- Quota tracké KV mais pas d'alerte si proche épuisement
- TODO · alerte Telegram à 80% quota

## Risques par sport

### NBA
- Saison régulière OK · 53 logs hit 67.9%
- Playoff peu de logs · poids v6.0 hypothétique
- Player props Claude rate-limited 1/25h · couverture limitée

### MLB
- Hit rate 49.8% post 315 logs · critique
- Recalibration v6.94 récente · validation en cours
- Météo facultative · pas tous matchs couverts

### Tennis
- 9 vars complexes · calibration sensible
- Lag Sackmann CSV
- api-tennis désactivé · perte fixtures live
- ESPN matching fragile (surname uniquement)
- 4 phases · poids distincts par phase · risque bug détection phase

## Surveillance continue
- Hit rate par sport (`/bot/calibration/analyze?sport=X`)
- Quota TheOddsAPI
- Cache KV TTL fonctionnant (pas de stale data)
- Erreurs Cloudflare observability (worker.js exceptions)
- Telegram notifications reçues (vérif user)

## À vérifier
- OpenWeather usage actuel · matchs MLB couverts %
- Pinnacle disponibilité long terme (clé guest)
- ✓ Worker.js taille réelle · **10533 lignes** (MBP-A.1 confirmé)
- ✓ BasketUSA · code vivant (appelé team-detail) mais usage UI ambigu

---

# Écarts détectés · audit MBP-A.1 (router + routes + KV + providers)

## Critique

### MBP-A.1 · CRIT-1 · Guards debug optionnels → routes publiques fallback
- 5 routes NBA debug + `/debug/basketusa` (worker.js:1937, 1973, 2487, 2545, 2345)
- `_denyIfNoDebugAuth` (worker.js:881) requiert `env.DEBUG_SECRET`
- Si secret absent → **routes publiquement accessibles** (note v6.33 "rétrocompatible")
- Risque · scan ports Cloudflare expose info Tank01 raw + box scores + roster
- Fix · forcer 401 si `DEBUG_SECRET` absent en prod

### MBP-A.1 · CRIT-2 · Routes Paper sans auth HTTP
- `/paper/state` `/paper/bet` `/paper/bet/:id` `/paper/reset` (worker.js:401-410)
- Aucun JWT · clé API · token
- Guard = binding KV `PAPER_TRADING` existant
- N'importe quel client public peut placer · settle · reset bets
- Risque · corruption état · vol bankroll · DoS
- Fix · ajouter clé partagée header ou JWT (validation ChatGPT requise)

### MBP-A.1 · CRIT-3 · Erreur globale fuite message brut
- `worker.js:438` · `errorResponse(\`Internal error: ${err.message}\`, 500, origin)`
- Stack traces · chemins internes · clés API potentiellement exposées si erreur format
- Fix · sanitize avant retour user · log full côté Cloudflare uniquement

## Moyen

### MBP-A.1 · MED-1 · `ai_player_props_{date}` lu jamais écrit
- Lu worker.js:1401, 4362, 4656
- Aucun `PAPER_TRADING.put('ai_player_props_*'` trouvé en grep
- Risque · feature props NBA toujours retourne cache vide
- À vérifier · écriture dans `src/` ou autre cron · ou bug réel

### MBP-A.1 · MED-2 · Cron 30h TTL idempotence trop large
- `bot_last_run` 30h · `mlb_bot_last_run` 30h · `tennis_bot_last_run` 30h
- Docs disent "skip si déjà tourné même jour"
- 30h TTL · risque double-run sur transition UTC/Paris (DST · changement heure)
- Fix · réduire à 23h ou utiliser date string

### MBP-A.1 · MED-3 · Rate limiters Claude `_todayParisKey()` drift
- Patterns `ai_*_rate_{YYYYMMDD}` 25h TTL
- `_todayParisKey()` génère YYYYMMDD TZ Paris
- Décalage minuit UTC vs Paris (1-2h selon DST)
- Risque · double appel Claude à minuit UTC

### MBP-A.1 · MED-4 · `/health` version hardcodée
- `worker.js:419` · `version: '6.85.0'`
- Actuel changelog v7.01 tennis-espn
- Pas synced · maintenance manuelle oubliée

### MBP-A.1 · MED-5 · Constante `MLB_PITCHER_KV_KEY` morte
- `worker.js:7372` · `MLB_PITCHER_KV_KEY = 'mlb_pitchers_cache'`
- Constante définie · jamais référencée par get/put
- Suppression possible

### MBP-A.1 · MED-6 · NBA injury report PDF constante morte
- `worker.js:117` · `NBA_INJURY_BASE = 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_'`
- Aucun fetch détecté
- Fallback actuel · ESPN + Claude AI (v6.30+)
- Suppression possible · décision ChatGPT

### MBP-A.1 · MED-7 · `mlb_team_recent_*` lu jamais écrit
- worker.js:7822 lu
- Aucune write trouvée
- À vérifier · cache jamais populé ou écrit ailleurs

## Faible

### MBP-A.1 · LOW-1 · Pinnacle clé publique hardcodée
- `worker.js:4523` · `CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R`
- Pas mention risque révocation dans PROVIDERS_MATRIX.md
- Pinnacle peut révoquer sans préavis · pas de fallback documenté
- Note · documenté dans MED-3 PROVIDERS_MATRIX maintenant

### MBP-A.1 · LOW-2 · OPTIONS handler hors try block
- `worker.js:253-254` · 204 No Content + CORS
- `corsHeaders(env)` à confirmer si requiert env

### MBP-A.1 · LOW-3 · Documentation routes debug lacunaire
- Routes `*-debug` mentionnées par catégorie mais sans détail individuel pré-MBP-A.1
- ✓ Corrigé · `ROUTES_AUDIT.md` exhaustif

### MBP-A.1 · LOW-4 · TTL `tennis_csv_stats_v12_*` `tennis_odds_cache_v2_*` non trouvés
- Préfixes dynamiques · grep direct ne capture pas TTL
- À investiguer manuellement worker.js:6775, 6477

### MBP-A.1 · LOW-5 · Worker taille réelle vs SESSION.md
- SESSION.md disait ~8500L
- Audit MBP-A.1 confirme 10533 lignes
- ✓ Corrigé `ARCHITECTURE.md`

### MBP-A.1 · LOW-6 · BasketUSA usage UI ambigu
- Code vivant · `handleNBATeamDetail` (worker.js:508 appelle `_findBestBasketUSAArticle`)
- `article_type: 'preview_fallback'` (worker.js:2311) suggère secondaire
- UI ne montre peut-être pas articles (à confirmer côté front)
- Décision · garder · supprimer · valider ChatGPT

## Statistiques audit MBP-A.1
- 54 routes HTTP recensées (21 NBA · 11 MLB · 9 Tennis · 6 Bot · 4 Paper · 6 Debug · 2 Health)
- 7 cron handlers
- 50+ clés KV trackées
- 10 providers actifs · 1 désactivé (api-tennis) · 1 ambigu (BasketUSA) · 1 mort (NBA PDF)
- 3 clés KV mortes ou orphelines détectées
- 19 variables d'environnement recensées
