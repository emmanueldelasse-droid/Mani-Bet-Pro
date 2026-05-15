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
- BasketUSA scraper actif ou dead code
- OpenWeather usage actuel · matchs MLB couverts %
- Pinnacle disponibilité long terme (clé guest)
- Worker.js taille réelle (SESSION.md dit ~8500L · audit dit ~9600L)
