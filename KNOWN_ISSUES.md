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

### P1-3 · Confidence gate INCONCLUSIVE manquant · ✓ RÉSOLU MBP-P1 (corrigé v2 post-review)
- Gate appliqué sur 6 surfaces · couverture étendue après review ChatGPT PR #197 ·
  - backend NBA `_botComputeConfidence` (worker.js:5888) · dq numérique < 0.55
  - backend Tennis `_botTennisConfidence` (worker.js:9458) · dq numérique < 0.55 (ex-0.30)
  - backend MLB `_mlbEngineCompute` (worker.js:8424) · `recommendations: []` + `best: null` si `dataQuality === 'LOW'`
  - backend MLB enrichissement props · `_mlbAnalyzeMatch` (worker.js:8336) · skip strikeouts merge si LOW
  - frontend `EngineCore._computeConfidenceLevel` (engine.core.js:319) · branches NBA + legacy
  - frontend MLB UI `_analyzeMLBMatch` (data.orchestrator.js:1370) · `recommendations: []` + `best_recommendation: null` + `decision: 'INSUFFISANT'` si LOW
- **Correction claim erroné** · première version PR #197 affirmait "MLB LOW = pas de reco déjà gaté" · vérification code a montré que `_mlbEngineCompute` produisait recos peu importe `dataQuality` · ChatGPT a flaggé · gate ajouté explicitement dans le moteur
- Tests · `node scripts/test-data-quality-gate.mjs` · 44 assertions
- Test parité NBA toujours OK · 492 pass · 0 fail
- Doc · `BETTING_LOGIC.md` §"Gate data_quality faible (MBP-P1)"
- Note · `src/engine/engine.mlb.betting.js` (`computeMLB`) est dead code · jamais importé en prod · non gaté (hors scope · à nettoyer en P3)

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

### MBP-A.1 · CRIT-1 · **CORRIGÉ MBP-A.4 · fausse alerte**
- Vérification directe worker.js:883 · `_denyIfNoDebugAuth` est **fail-CLOSE**
- Si `DEBUG_SECRET` absent → 401 Unauthorized (pas accès)
- Le commentaire historique v6.33 "rétrocompatible" est trompeur · code actuel correct
- ✓ 5 routes guardées effectivement (worker.js:1937, 1973, 2487, 2545, 2345)
- **Nouvelles critiques MBP-A.4** remplacent · voir section dédiée ci-dessous

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

---

# Écarts détectés · audit MBP-A.4 sécurité

Détail complet · `SECURITY_AUDIT.md`. Résumé classification ici.

## Critique (à corriger urgent)

### MBP-A.4 · CRIT-A · Paper routes sans auth HTTP (résolu MBP-S.2 + hotfix CORS)
- ✓ Résolu MBP-S.2 · helper `requirePaperApiKey` (worker.js:898) appliqué aux 4 handlers
- Secret `PAPER_API_KEY` requis · fail-close si absent · 401 générique sinon
- Routes protégées · GET `/paper/state` · POST `/paper/bet` · PUT `/paper/bet/:id` · POST `/paper/reset`
- Logs serveur conservés (sans valeur clé)
- ✓ Hotfix CORS Allow-Headers ajouté `X-API-Key` (worker.js:213) · preflight browser passait pas sinon
- Front non encore adapté · MBP-S.2.1 à prévoir pour saisie/envoi clé depuis l'app

### MBP-A.4 · CRIT-B · `errorResponse` fuite `err.message` (résolu MBP-S.1)
- ✓ Résolu MBP-S.1 · constantes `SAFE_ERROR_MSG_500` · `SAFE_ERROR_MSG_UNAVAILABLE` ajoutées (worker.js:232)
- `replace_all` appliqué · 23 `error: err.message` + 17 `note: err.message` sanitizés
- Catch global worker.js:438 · `Internal error: ${err.message}` → `SAFE_ERROR_MSG_500`
- Stack/err.message conservés dans `console.error` (logs Cloudflare owner only)

### MBP-A.4 · CRIT-C · CORS prefix matching vulnerability (résolu MBP-S.1)
- ✓ Résolu MBP-S.1 · `startsWith` → `ALLOWED_ORIGINS.includes(origin)` (worker.js:207)
- Forge subdomain impossible · whitelist exacte 3 origins

### MBP-A.4 · CRIT-D · Routes bot/run sans auth → quota DoS (résolu MBP-S.3)
- ✓ Résolu MBP-S.3 · helper `requireBotRunApiKey` (worker.js:914)
- Secret `BOT_RUN_API_KEY` requis · header `X-Bot-Api-Key` · fail-close
- 8 routes POST protégées · `/bot/run` · `/mlb/bot/run` · `/tennis/bot/run` · `/bot/settle-logs` · `/{sport}/bot/settle-logs` · `/nba/ai-injuries-batch` · `/nba/ai-player-props-batch`
- Cron scheduled exempté (pas de request involved)
- CORS Allow-Headers étendu · `X-Bot-Api-Key`
- Note · `/nba/bot/run` n'existe pas comme route distincte · `/bot/run` global = NBA par historique

### MBP-A.4 · CRIT-E · `/tennis/_espn_probe` sans guard (résolu MBP-S.1)
- ✓ Résolu MBP-S.1 · `_denyIfNoDebugAuth` ajouté · signature handler `(url, env, origin)`
- Route worker.js:378 + handler worker.js:9883
- Validation params `player`/`tour`/`days` reste à faire (HAUT-3/4 phase ultérieure)

### MBP-A.4 · CRIT-F · Rate limit Claude global cross-user (résolu MBP-S.4)
- ✓ Résolu MBP-S.4 · helper `_rateLimitIpHash(request)` (worker.js:914)
- Hash SHA-256 tronqué (16 hex) · salt `mbp-s4-salt-v1:` · IP brute jamais stockée
- 3 clés rate suffixées `_${ipHash}` · injuries_batch · player_props · injuries_single
- Cron handlers exemptés · fakeReq sans `CF-Connecting-IP` → namespace `'system'`
- Spam user A n'épuise plus le quota user B

## Haut

| ID | Composant | Effort |
|---|---|---|
| MBP-A.4 HAUT-1 | `ai.guard.js` jamais appelé · validation Claude réponses absente | 2h |
| MBP-A.4 HAUT-2 | Prompt injection ESPN MLB/Tennis · NBA mitigé par enum 30 équipes | 1h |
| MBP-A.4 HAUT-3 | `request.json()` sans try/catch (worker.js:5890) | 10 min |
| MBP-A.4 HAUT-4 | POST body size unbounded (tous handlers POST/PUT) | 30 min |
| MBP-A.4 HAUT-5 | Paper `result` enum non strict (worker.js:5940) | 10 min |
| ~~MBP-A.4 HAUT-6~~ | ✓ Résolu MBP-S.1 · CSV error response → JSON cohérent | — |
| MBP-A.4 HAUT-7 | Race condition KV rate limit (worker.js:1319-1328) | 1h |
| MBP-A.4 HAUT-8 | `DEBUG_SECRET` en URL query (referer leak · browser history) | 30 min |
| MBP-A.4 HAUT-9 | Hallucinations joueurs Claude non bloquée (pas whitelist) | 3h |

## Moyen

| ID | Composant | Effort |
|---|---|---|
| MBP-A.4 MOY-2 | Headers sécu manquants (CSP · HSTS · X-Frame) | 30 min |
| MBP-A.4 MOY-3 | Stale cache 8-24h AI injuries sans warning | 15 min |
| MBP-A.4 MOY-4 | `DEBUG_SECRET` pas de rate limit brute-force | 1h |
| MBP-A.4 MOY-5 | Validation date Claude params · regex non stricte | 10 min |
| MBP-A.4 MOY-6 | `closing_odds` non validé | 10 min |
| MBP-A.4 MOY-7 | `initial_bankroll` NaN possible | 5 min |

## Faible

| ID | Composant |
|---|---|
| MBP-A.4 FAI-1 | `/health` info disclosure (version · routes) |
| MBP-A.4 FAI-2 | Logs publics exposent edge moteur (intentionnel ?) |
| MBP-A.4 FAI-3 | Sport param validation fragile (currently safe via enum) |
| MBP-A.4 FAI-4 | Claude error text logged 200 chars |
| MBP-A.4 FAI-5 | `paper_trading_state` floating point precision (millions bets) |

---

# Écarts détectés · audit MBP-A.2 moteur NBA

Détail complet · `NBA_ENGINE_AUDIT.md`. Résumé classification ici.

## Critique

### MBP-A.2 · CRIT-1 · 2 moteurs NBA distincts coexistent
- Backend `_botEngineCompute` (worker.js:5211) · appelé par cron `_runBotCron` uniquement
- Frontend `EngineCore.compute('NBA', rawData)` (`data.orchestrator.js:857`) · appelé à chaque chargement utilisateur
- Pas de garantie de synchronisation
- Calibration Alon analyse les logs backend · UI affiche le frontend
- Décision ChatGPT requise · supprimer un · ou aligner strictement

### MBP-A.2 · CRIT-2 · Algorithme confidence backend ≠ frontend (résolu MBP-FIX-A.2.1)
- ✓ Résolu MBP-FIX-A.2.1 · frontend aligné strict sur backend (distance-based)
- `_computeConfidenceLevel` (src/engine/engine.core.js:314) · branche `sport === 'NBA'` utilise dist+dq+pen
- MLB · Tennis · legacy min-based préservé (audit séparé prévu)
- Robustness conservée dans `analysis.robustness_score` · ne pilote plus la confidence NBA

### MBP-A.2 · CRIT-3 · `home_away_split` formule divergente (résolu MBP-FIX-A.2.2)
- ✓ Résolu MBP-FIX-A.2.2 · frontend aligné strict sur backend
- `computeHomeSplit` (`src/engine/engine.nba.variables.js:262`) utilise désormais 4 variables + formule backend
- `(hs.home_win_pct - hs.away_win_pct) - (as.away_win_pct - as.home_win_pct)` clamp [-0.50, 0.50]
- Identique à `_botExtractVariables` worker.js:5037-5043
- MLB · Tennis · pas concernés (formule NBA only)
- UI rétrocompatible · `raw.home_home_win_pct` et `raw.away_away_win_pct` conservés + 2 nouveaux champs `home_away_win_pct` et `away_home_win_pct`

## Moyen

| ID | Composant | Effort |
|---|---|---|
| MBP-A.2 MED-1 | `back_to_back` numérique différent (-0.6/+0.6 backend vs -1/+1 frontend) | 30 min |
| MBP-A.2 MED-2 | `robustness_score` n'existe pas backend · confidence cron ignore cette dimension | 4-6h ou 1h selon stratégie |
| MBP-A.2 MED-3 | `confidence_penalty.score` toujours `null` côté backend · code mort | 30 min |
| MBP-A.2 MED-4 | Pill couleur UI requiert `quality ≥ 0.80` (seuil n'existe pas moteur) | 30 min |
| MBP-A.2 MED-5 | `playoff_weights` somme = 0.91 ≠ 1.00 · normalisé downstream (fragile) | 15 min doc |
| MBP-A.2 MED-6 | Kelly EUR UI bankroll hardcodé 500€ · pas sync paper state | 1h |

## Faible

| ID | Composant |
|---|---|
| MBP-A.2 FAI-1 | 5 variables backend orphelines (`home_back_to_back`, `away_back_to_back`, `home_last5_avg_pts`, `away_last5_avg_pts`, `confidence_penalty.score`) |
| MBP-A.2 FAI-2 | `ts_diff` · `avg_pts_diff` extraites poids 0 (morts v5) |
| MBP-A.2 FAI-3 | Quality statuts plus détaillés frontend (5 niveaux) vs backend (2) · pas dégrader |
| MBP-A.2 FAI-4 | Strikethrough edge fantôme UI · message petit (user peut louper) |
| MBP-A.2 FAI-5 | `__ema_lambda` magic field injecté par orchestrator · fragile sans guard |
| MBP-A.2 FAI-6 | SIGNAL_LABELS UI hardcodé · pas synchro `sports.config.js` |

## Statistiques audit MBP-A.2
- 2 moteurs NBA distincts identifiés
- 1 recalcul frontend critique (`EngineCore.compute` à chaque chargement) + 4 recalculs UI cosmétiques (edge · kelly EUR · implied_prob · Win %)
- 5 variables backend orphelines + 2 morts (`ts_diff`, `avg_pts_diff`)
- 3 incohérences critiques (CRIT-1, 2, 3) + 6 moyennes
- 1 algo robustness inexistant côté backend

## Statistiques audit MBP-A.4
- 6 critiques · 9 hauts · 6 moyens · 5 faibles
- 1 MBP-A.1 fausse alerte reclassée (CRIT-1)
- 14 occurrences fuites `err.message` localisées
- 6 stratégies auth Paper proposées (à valider ChatGPT)
- Phase 1 (critiques rapides · CRIT-B/C/E + HAUT-6) · ~2h effort · risque faible
