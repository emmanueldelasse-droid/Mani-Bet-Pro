# Security audit Mani Bet Pro · MBP-A.4

Audit documentaire uniquement · aucun code modifié.
Méthode · 3 agents Explore en parallèle (auth/routes · validation/CORS/erreurs · AI/KV/debug) + vérification directe.

## 1. Surface sécurité globale

| Couche | Statut | Risque |
|---|---|---|
| Auth utilisateur | **inexistante** sur Paper / Bot run | critique |
| Auth debug | `_denyIfNoDebugAuth` fail-close (worker.js:883) | bon · sauf brute-force URL |
| CORS | whitelist 3 origins · pas wildcard | **prefix matching bug** |
| CSRF | aucune protection (pas de cookie · stateless API) | acceptable car pas de session |
| Headers sécu | CSP · HSTS · X-Frame-Options **absents** | moyen |
| Rate limiting | Claude global · pas per-IP | partagé entre users |
| Validation inputs | regex stricte sur dates · enum sport · **err.message fuit** | mixte |
| Secrets env | 19 secrets · masquage logs Tank01 OK · **DEBUG_SECRET en URL** | bon · sauf detail |
| AI / Claude | prompt injection mitigée par enum NBA · `ai.guard.js` **jamais appelé** | haut |
| KV namespace | single-tenant · pas d'isolation user | acceptable solo |

## 2. Routes sensibles

### Routes Paper (4)

| Route | Méthode | Auth attendue | Auth réelle | Validation body | Risque |
|---|---|---|---|---|---|
| `/paper/state` | GET | session user | **AUCUNE** | n/a | lecture publique bankroll |
| `/paper/bet` | POST | session user | **AUCUNE** | stake>0 · odds≠0 · market enum | DoS · pollution bets |
| `/paper/bet/:id` | PUT | session user | **AUCUNE** | result **non enum** strict | corruption PnL |
| `/paper/reset` | POST | confirmation | **AUCUNE** | initial_bankroll optionnel | **wipe complet illimité** |

### Routes Bot run / settle (6)

| Route | Auth attendue | Auth réelle | Coût/call | Risque |
|---|---|---|---|---|
| `/bot/run` | admin/cron | **AUCUNE** | ~20-30 Tank01 + 1-2 Claude | quota DoS |
| `/nba/bot/...` | idem | inclus dans /bot/run | idem | idem |
| `/mlb/bot/run` | admin/cron | **AUCUNE** | ESPN + MLB Stats | quota DoS |
| `/tennis/bot/run` | admin/cron | **AUCUNE** | Sackmann + ESPN | quota DoS |
| `/bot/settle-logs` | admin | **AUCUNE** | ESPN × N matches (max 30j) | partiel DoS |
| `/{sport}/bot/settle-logs` | admin | **AUCUNE** | idem | idem |

### Routes Debug (6)

| Route | Auth attendue | Auth réelle | Données exposées |
|---|---|---|---|
| `/nba/player/test` | DEBUG_SECRET | ✓ fail-close (worker.js:1937) | Tank01 player info |
| `/nba/roster-debug` | DEBUG_SECRET | ✓ fail-close (worker.js:1973) | rosters complets |
| `/nba/boxscore-debug` | DEBUG_SECRET | ✓ fail-close (worker.js:2487) | box scores bruts |
| `/nba/schedule-debug` | DEBUG_SECRET | ✓ fail-close (worker.js:2545) | schedule complet |
| `/debug/basketusa` | DEBUG_SECRET | ✓ fail-close (worker.js:2345) | scraping articles |
| `/tennis/_espn_probe` | DEBUG_SECRET | **AUCUNE** (worker.js:372, 9877) | matches ESPN bruts |

### Routes Logs (4) · données publiques

| Route | Auth | Données exposées | Risque |
|---|---|---|---|
| `/bot/logs` | aucune | motor_prob · variables · recos | reverse-engineering moteur |
| `/bot/logs/export.csv` | aucune | idem en CSV | idem · scraping facile |
| `/nba/bot/logs` `/mlb/bot/logs` `/tennis/bot/logs` | aucune | idem par sport | idem |
| `/bot/odds-history` | aucune | mouvements cotes 72h | moyen · info marché |

### Routes Cron / scheduler

Toutes invoquées par Cloudflare scheduler (pas exposées HTTP).
Mais déclenchables manuellement via `/bot/run` (sans auth · voir ci-dessus).

## 3. Secrets et auth

### Variables env critiques

| Secret | Utilisé où | Critique ? | Fail-open ? | Risque fuite |
|---|---|---|---|---|
| `CLAUDE_API_KEY` | worker.js:1308, 1340, 1569, 1587, 1731 | OUI | fail-close (return `available: false`) | masqué logs ✓ |
| `TANK01_API_KEY1..3,KEY` | worker.js:873-876, 891-904 | OUI | rotation 4 clés | masqué logs (`***${key.slice(-4)}`) ✓ |
| `DEBUG_SECRET` | worker.js:883 | OUI sécu | fail-close (401) | **en URL query** · referer leak |
| `ODDS_API_KEY_1/2` | TheOddsAPI calls | OUI | rotation | non vérifié exhaustif |
| `BALLDONTLIE_API_KEY` | recent form | non | `available: false` | header bearer · pas loggé |
| `TENNIS_API_KEY` | api-tennis | non · désactivé | skip | n/a |
| `TENNIS_API_FIXTURES_ENABLED` | gate | non | skip | n/a |
| `TELEGRAM_BOT_TOKEN` | notifications | non | skip | dans URL API outbound · pas loggé |
| `TELEGRAM_CHAT_ID` | notifications | non | skip | n/a |
| `WEATHER_API_KEY` | météo MLB | non | skip | n/a |
| `PLAYER_PROPS_ENABLED` | gate | non | skip | n/a |
| `AI_PLAYER_PROPS_ENABLED` | gate | non | skip | n/a |
| `PINNACLE_DISABLED` | gate | non | actif default | n/a |
| `PAPER_TRADING` | KV binding | OUI | erreur 500 | binding ID public dans wrangler ✓ |
| `ASSETS` | binding statique | OUI | erreur 500 | n/a |

### Fail-open / fail-close

| Composant | Comportement absent | Évaluation |
|---|---|---|
| `_denyIfNoDebugAuth` (worker.js:881) | **fail-close** · 401 | ✓ bon (contredit commentaire historique v6.33) |
| `CLAUDE_API_KEY` (worker.js:1308) | `available: false` 200 | ✓ pas d'erreur révélée |
| `TANK01_API_KEY*` | rotation 4 clés | ✓ résilience |
| `TELEGRAM_*` | skip silencieux | ✓ acceptable |
| `WEATHER_API_KEY` | skip · `error: 'no_api_key'` | ✓ pas fatal |

## 4. Gestion erreurs

### Fuites `err.message` au client (14 occurrences confirmées)

| Ligne | Handler | Type retour | Sévérité |
|---|---|---|---|
| worker.js:438 | catch global `fetch()` | `Internal error: ${err.message}` 500 | **critique** |
| worker.js:1170 | `handleNBARosterInjuries` | `note: err.message` 200 | haut |
| worker.js:1380 | `handleNBAAIInjuriesBatch` | `note: err.message` 200 | haut |
| worker.js:1419 | `handleNBAAIPlayerPropsGet` | `note: err.message` 500 | haut |
| worker.js:1454 | `handleNBAAIPlayerPropsBatch` | `note: err.message` 500 | haut |
| worker.js:1651 | `handleNBAAIPlayerPropsGet` retry | `note: err.message` 200 | haut |
| worker.js:1800 | `handleNBAAIInjuries` | `note: err.message` 200 | haut |
| worker.js:2667 | `handleNBATeamsStats` | `note: err.message` 200 | haut |
| worker.js:3849 | `handleBotLogs` | `error: err.message` 500 | haut |
| worker.js:4026 | `handleBotSettleLogs` | `error: err.message` 500 | haut |
| worker.js:4814 | `handleBotLogsExportCSV` | `error: ${err.message}` 500 **plain text** | critique |
| worker.js:5934 | `handlePaperPlaceBet` | `error: err.message` 500 | haut |
| worker.js:5995 | `handlePaperSettleBet` | `error: err.message` 500 | haut |
| worker.js:6010 | `handlePaperReset` | `error: err.message` 500 | haut |

### Données potentiellement fuitées
- Noms de fonctions internes
- Paths fichiers (`SyntaxError at position X` → format Claude inféré)
- Présence/absence secrets (`CLAUDE_API_KEY not set` → confirme config)
- Versions librairies via stack frames partielles
- État KV (clés inexistantes)

### Mitigation absente
- Aucune fonction `sanitizeErrorMessage(err)` centrale
- Pas de mapping erreur interne → message générique client
- Log Cloudflare conserve message complet (acceptable côté serveur)

## 5. Validation inputs

### Query params

| Param | Routes | Validation | État |
|---|---|---|---|
| `date` (YYYYMMDD) | `/nba/matches` worker.js:854 | regex `^\d{8}$` | **bon** |
| `date` filter | `/bot/logs` worker.js:3780 | aucune | moyen (filtrage seulement) |
| `date` Claude | worker.js:1393, 1658 | `replace(-/g,'')` sans regex | moyen |
| `home` `away` NBA | worker.js:450, 1658 | `trim().toUpperCase()` + map enum statique | **bon** |
| `sport` | `/bot/logs` `/bot/calibration` worker.js:743, 4743 | `toLowerCase()` + ternaire | **bon** |
| `bust` | worker.js:466 | `=== '1'` strict | **bon** |
| `days` | worker.js:744 | `Math.min(parseInt, 90)` | bon (NaN possible) |
| `player` | `/tennis/_espn_probe` worker.js:9877 | **aucune** | haut · `encodeURIComponent` à vérifier |
| `secret` | debug routes | comparaison stricte `!==` | bon |

### Body POST/PUT

| Handler | Parsing | Validation | État |
|---|---|---|---|
| `handlePaperPlaceBet` worker.js:5890 | `await request.json()` **sans try/catch** | stake/odds/market | parsing throw → 500 fuite |
| `handlePaperSettleBet` worker.js:5940 | idem | result **non enum strict** | haut |
| `handlePaperReset` worker.js:6001 | `.catch(() => ({}))` | `initial_bankroll` implicite | moyen NaN |
| `handleNBAAIInjuriesBatch` worker.js:1254 | `await .json()` | games slice(0,12) · date regex | bon |
| `handleNBAAIPlayerPropsBatch` worker.js:1460 | try/catch | idem | bon |
| `handleBotSettleLogs` worker.js:4003 | `.catch(() => ({}))` | date range max 30j | partiel |

### Injection KV keys
- Aucune concaténation directe d'user input dans clé KV `.put`/`.get`
- User input borné par regex ou enum avant utilisation
- **Risque · faible**

### Injection URL provider
- ESPN · `?dates=${dateStr}` après regex `^\d{8}$` ✓
- Tank01 · `encodeURIComponent(gameID)` worker.js:696 ✓
- Tank01 · `teamAbv=${home}` worker.js:550 sans encoding mais map enum 30 équipes
- Tennis ESPN probe · `player` non encodé · **à vérifier worker.js:9877**

### Taille body
- Pas de check `content-length` avant `request.json()`
- Cloudflare limite ~100MB par défaut
- Risque · CPU spike si JSON 50MB malicieux

## 6. CORS / headers

### `corsHeaders(origin)` worker.js:206

```javascript
const allowed = ALLOWED_ORIGINS.some(o => origin?.startsWith(o))
  ? origin : ALLOWED_ORIGINS[0];
```

### `ALLOWED_ORIGINS` worker.js:198-202

```
'https://emmanueldelasse-droid.github.io'
'http://localhost'
'http://127.0.0.1'
```

| Aspect | Implémentation | Évaluation |
|---|---|---|
| Wildcard `*` | non | ✓ bon |
| Whitelist | 3 origins | ✓ bon |
| Match | `startsWith()` | **moyen · prefix bug** |
| Credentials | non inclus | ✓ pas de cookie leak |
| Fallback | `ALLOWED_ORIGINS[0]` (GH Pages) | ✓ safe |

### Vulnérabilité prefix matching

```
Attaquant crée · https://emmanueldelasse-droid.github.io.attacker.com
origin reçu  · https://emmanueldelasse-droid.github.io.attacker.com
startsWith   · true (matche prefix)
réflexion CORS · origin attaquant échographié
```

Impact réel limité (pas de cookie ni credentials), mais permet cross-origin fetch des routes publiques.

### Headers manquants

| Header | Présent worker.js | Présent `_headers` | Risque |
|---|---|---|---|
| `Content-Security-Policy` | non | non | faible (worker JSON) |
| `X-Frame-Options` | non | non | clickjacking si HTML retourné |
| `Strict-Transport-Security` | non | non · CF gère côté CDN | OK |
| `X-Content-Type-Options` | non worker | ✓ `_headers` `/index.html` | bon front |
| `Referrer-Policy` | non | non | leak referrer faible |

### `_headers` fichier (front uniquement)
- `X-Content-Type-Options: nosniff` ✓
- `Cache-Control: no-cache, must-revalidate` ✓

## 7. KV / cache

### Données sensibles stockées

| Clé | Contenu | Sensible ? | Risque exposition |
|---|---|---|---|
| `paper_trading_state` | bankroll · bets · PnL | moyen | exposé via GET /paper/state sans auth |
| `paper_bets_index` | bet metadata | faible | idem |
| `bot_log_*` | motor_prob · variables · recos | **stratégie moteur** | exposé /bot/logs sans auth |
| `ai_injuries_*` | noms joueurs blessés non-officiels | moyen | exposé via /nba/ai-injuries |
| `tank01_*` | rosters publics | faible | données publiques par nature |
| `pinnacle_pp_*` | cotes props | faible | données publiques |

### Isolation user
- Single-tenant · pas de prefix user_id
- KV partagé entre tous appelants
- Si futur multi-user · refactor majeur

### Clés prédictibles
- `paper_trading_state` constante · pas de collision (single-tenant OK)
- `bot_log_{matchId}` matchId public (ESPN ID)
- Risque · scan énumérations matchId pour reconstruction historique

### Stale critique
- `paper_trading_state` sans lock RW · risque corruption concurrent
- `ai_injuries_*` 8h · `ai_player_props_*` 20h · si blessure majeure entre 2 caches · reco dégradée
- Pas de versioning · rollback impossible

## 8. AI / prompts

### `ai.guard.js` jamais appelé
- Fichier défini · validation théorique réponses Claude
- Grep `AIGuard\.|require.*ai.guard\|import.*ai.guard` dans worker.js → 0 résultat
- **Validation réponses Claude inexistante en production**

### Prompt injection
- Données externes injectées · noms équipes ESPN/Tank01 + noms joueurs
- NBA · `normalizeTank01TeamAbv` (worker.js:2470) map fermée 30 équipes · **sanitization ok**
- MLB · noms équipes ESPN passés à Claude · **à vérifier sanitization**
- Tennis · noms joueurs Sackmann/api-tennis · validation aucune

### Hallucinations
- Claude peut inventer noms joueurs (non NBA roster)
- Aucune whitelist appliquée à la réponse
- Bot peut publier recos sur joueurs fictifs
- Impact · paris paper sur joueurs inexistants · pas d'argent réel donc faible

### Tool `web_search_20250305`
- worker.js:1847+
- `maxTurns = 6` borné
- 45s timeout fetch (worker.js:1875)
- Pas de timeout global → 6 × 45s = 4.5 min max théorique
- Risque · token cost runaway possible

### Affichage brut
- Réponse Claude → JSON.parse strict
- Bounds validation présent (line · player_points entre 4-55)
- Front utilise `escapeHtml` sur affichage (UI helpers · v6.x)
- **Risque XSS via Claude faible**

## 9. Risks matrix

### Critique (corriger urgent)

| ID | Titre | Composant | Ligne | Impact | Effort fix |
|---|---|---|---|---|---|
| **MBP-A.4 CRIT-A** | Paper routes sans auth HTTP | worker.js:401-410 | wipe / spam / lecture bankroll public | dépend stratégie (1h-1j) |
| **MBP-A.4 CRIT-B** | `errorResponse` fuite `err.message` × 14 | worker.js:438 + 13 handlers | reverse-engineering API · présence secrets inférable | 1h (1 fonction · loop replace) |
| **MBP-A.4 CRIT-C** | CORS prefix matching | worker.js:206 `startsWith` | forge subdomain attacker.com | 5 min (`===` strict) |
| **MBP-A.4 CRIT-D** | Routes bot/run sans auth | worker.js:352, 374, 397 | quota Tank01/Claude DoS · 25h blocage features AI | 30 min (auth header) |
| **MBP-A.4 CRIT-E** | `/tennis/_espn_probe` sans guard | worker.js:372, 9877 | matches ESPN bruts publics · pas rate limit | 5 min (`_denyIfNoDebugAuth`) |
| **MBP-A.4 CRIT-F** | Rate limit Claude global cross-user | worker.js:1319, 1539, 1699 | user A spam = blocage user B 25h | 1-2h (per-IP) |

### Haut

| ID | Titre | Composant | Effort fix |
|---|---|---|---|
| **HAUT-1** | `ai.guard.js` jamais appelé | src/ai/ai.guard.js | 2h (intégration) |
| **HAUT-2** | Prompt injection ESPN MLB/Tennis | worker.js Claude calls MLB/tennis | 1h (whitelist) |
| **HAUT-3** | `request.json()` sans try/catch | worker.js:5890 | 10 min |
| **HAUT-4** | POST body size unbounded | tous handlers POST/PUT | 30 min |
| **HAUT-5** | Paper `result` enum non strict | worker.js:5940 | 10 min |
| **HAUT-6** | CSV error response non-JSON | worker.js:4814 | 5 min |
| **HAUT-7** | Race condition KV rate limit | worker.js:1319-1328 | 1h (incrément atomique) |
| **HAUT-8** | `DEBUG_SECRET` en URL query | worker.js:882 | 30 min (header) |
| **HAUT-9** | Hallucination joueurs Claude non bloquée | worker.js post-Claude | 3h (whitelist roster) |

### Moyen

| ID | Titre | Composant | Effort fix |
|---|---|---|---|
| **MOY-1** | MBP-A.1 CRIT-1 reclassée · guards fail-CLOSE OK mais doc trompeuse | commentaire historique | 5 min (correction doc · déjà fait MBP-A.4) |
| **MOY-2** | Headers sécu manquants (CSP · HSTS · X-Frame) | `_headers` + worker | 30 min |
| **MOY-3** | Stale cache 8-24h AI injuries sans warning | worker.js:1363, 1515 | 15 min (timestamp dans réponse) |
| **MOY-4** | `DEBUG_SECRET` pas de rate limit brute-force | guard | 1h |
| **MOY-5** | Validation `date` Claude params worker.js:1393 | regex non stricte | 10 min |
| **MOY-6** | `closing_odds` non validé | worker.js:5940 | 10 min |
| **MOY-7** | `initial_bankroll` NaN possible | worker.js:6001 | 5 min |
| **MOY-8** | Subdomain takeover CORS si GH Pages compromis | worker.js:206 | n/a (mitigation par strict equality) |

### Faible

| ID | Titre | Composant |
|---|---|---|
| **FAI-1** | `/health` info disclosure (version · routes) | worker.js:415 |
| **FAI-2** | Logs publics exposent edge moteur (intentionnel ?) | `/bot/logs` · `/bot/logs/export.csv` |
| **FAI-3** | Sport param validation fragile (currently safe via enum) | worker.js:4037-4040 |
| **FAI-4** | Claude error text logged 200 chars | worker.js:1830 |
| **FAI-5** | `paper_trading_state` floating point precision (millions bets) | worker.js:5920 |

## 10. Recommandations

### Phase 1 · urgence (avant tout autre dev)
1. CRIT-B · Sanitize `err.message` · fonction unique `safeError(err, status, origin)` · loop replace 14 occurrences
2. CRIT-C · `startsWith` → `===` strict CORS (worker.js:206)
3. CRIT-E · ajouter `_denyIfNoDebugAuth` à `handleTennisEspnProbe`
4. HAUT-6 · `handleBotLogsExportCSV` retour JSON cohérent

Effort total · **~2h** · risque régression très faible · pas de changement design.

### Phase 2 · auth ressources (à valider ChatGPT)
5. CRIT-D · auth header `X-API-Key` partagé sur routes `/bot/run` `/{sport}/bot/run` `/bot/settle-logs`
6. CRIT-A · stratégie auth Paper (voir section ci-dessous)
7. CRIT-F · rate limit per-IP via `CF-Connecting-IP` header
8. HAUT-8 · `DEBUG_SECRET` migré query → header `Authorization: Bearer`

Effort total · **~4-6h** · décision stratégique requise.

### Phase 3 · hardening (post auth)
9. HAUT-1 · intégration `ai.guard.js` dans réponses Claude
10. HAUT-9 · whitelist joueurs NBA depuis Tank01 roster (cache 24h)
11. HAUT-3/4/5/7 · validation body · taille · enum strict · atomicité KV
12. MOY-2 · headers sécu (CSP · HSTS · X-Frame)
13. MOY-3 · timestamp cache AI dans réponse

Effort total · **~6-8h** · risque modéré.

### Stratégies auth Paper (CRIT-A · à valider ChatGPT)

#### Option A · header partagé `X-API-Key`
- **Avantage** · simple · 1 secret CF · 1 ligne front à ajouter
- **Inconvénient** · même secret tous clients · pas de granularité · pas de session
- **Complexité** · 30 min
- **Compatibilité PWA** · parfaite (header en `fetch`)
- **Risque régression** · faible

#### Option B · PIN session 4-6 digits
- **Avantage** · UX simple · stocké KV avec TTL 24h · plusieurs sessions
- **Inconvénient** · brute-forçable si pas de rate limit · code à écrire
- **Complexité** · 2-3h
- **Compatibilité PWA** · bonne (localStorage)
- **Risque régression** · moyen

#### Option C · token temporaire (one-shot login)
- **Avantage** · sécurité moderne · révocable · expiration
- **Inconvénient** · backend auth complet · UX login
- **Complexité** · 4-6h
- **Compatibilité PWA** · bonne
- **Risque régression** · élevé

#### Option D · JWT
- **Avantage** · standard · stateless · expiration
- **Inconvénient** · overkill solo user · librairie · signing key
- **Complexité** · 6-8h
- **Compatibilité PWA** · bonne
- **Risque régression** · élevé

#### Option E · Cloudflare Access (Zero Trust)
- **Avantage** · auth déléguée CF · MFA gratuit · pas de code
- **Inconvénient** · dépendance CF · plan payant possible · config dashboard
- **Complexité** · 30 min config CF
- **Compatibilité PWA** · cookie CF · bonne
- **Risque régression** · faible

#### Option F · IP allowlist
- **Avantage** · zero code · niveau réseau
- **Inconvénient** · IP user change · pas adapté mobile/4G
- **Complexité** · 15 min
- **Compatibilité PWA** · mauvaise (mobilité)
- **Risque régression** · faible

#### Recommandation Claude (à valider ChatGPT)
- Court terme · **Option A** (header partagé) pour `/bot/run` + `/paper/*`
- Long terme · **Option E** (CF Access) si multi-device ou si paper devient critique
- Éviter B · C · D · pour 1 user (sur-engineering)

## 11. Confirmations / corrections MBP-A.1

| MBP-A.1 ID | Statut MBP-A.4 | Note |
|---|---|---|
| CRIT-1 · guards debug optionnels | **fausse alerte** | `_denyIfNoDebugAuth` worker.js:883 est fail-CLOSE · 5 routes guardées · le commentaire historique v6.33 "rétrocompatible" est faux par rapport au code actuel · à corriger dans KNOWN_ISSUES.md |
| CRIT-2 · routes Paper sans auth | **confirmé** · étendu | + `/paper/reset` DoS illimité + `/paper/bet` spam DoS bankroll |
| CRIT-3 · errorResponse fuite err.message | **confirmé** · étendu | 14 occurrences précises identifiées · pas seulement worker.js:438 |

## 12. À vérifier

- Code `handleTennisEspnProbe` (worker.js:9877) · paramètres validés ?
- `web_search_20250305` configuration exacte · max turns · max budget
- `corsHeaders(env)` au lieu de `corsHeaders(origin)` worker.js:253-254 OPTIONS handler · cohérence ?
- BalldonLie / TheOddsAPI / api-tennis · secrets exposés en log dans rotation ?
- Si `paper_trading_state` corrompu · procédure récupération existe ?
- Cloudflare logs retention default · 30j confirmé ?

## 13. Hors périmètre MBP-A.4
- Audit moteur calibration (MBP-A.2 à venir)
- Audit src/orchestration · src/providers · src/paper en détail (MBP-A.5 à venir)
- Tests de pénétration automatisés (suite à code fixes Phase 1)
- Revue Cloudflare Access setup (décision design ChatGPT)
