# Architecture Mani Bet Pro

## Stack global
```
index.html + src/ui/*.js (GitHub Pages front)
           ↓ fetch HTTPS
    manibetpro.workers.dev (worker.js)
           ↓
  Tank01 · ESPN · TheOddsAPI · api-tennis · Sackmann CSV
  Claude API · Telegram · Pinnacle · BallDontLie
           ↓
  KV PAPER_TRADING (Cloudflare)
```

## Front (GitHub Pages)
- `index.html` · entrée HTML statique
- `_headers` · CORS · CSP
- `manifest.json` · PWA
- `assets/` · CSS · icônes
- Déploiement auto sur push `main` (GH Pages branch)

## Modules UI (`src/ui/`)
- `ui.router.js` · routing client
- `ui.dashboard.js` · tableau matchs jour
- `ui.match-detail.js` · vue détail NBA
- `ui.match-detail.tennis.js` · vue détail tennis
- `ui.match-detail.teamdetail.js` · vue équipe approfondie
- `ui.match-detail.helpers.js` · helpers communs
- `ui.bot.js` · recos bot · helpers FR `_qualityFr` `_betTypeFr` `_fmtOdds` `_confidenceFr` `_interpretVariable` (ui.bot.js:1090-1215)
- `ui.history.js` · historique paris
- `ui.lab.js` · zone test
- `ui.settings.js` · réglages user
- `ui.loading.js` · spinners
- `ui.theme-toggle.js` · dark/light

## Worker (`worker.js` 10634 lignes · MBP-A.1 audit + ajouts sécu MBP-S.1 à S.4)
- Point d'entrée unique · Cloudflare Worker
- Export default `worker.js:234` · `fetch` `worker.js:248` · `scheduled` `worker.js:238`
- Router = if/else chain linéaire (pas de switch · pas de table) · lignes 248-432
- Categories routes : 21 NBA · 11 MLB · 9 Tennis · 6 Bot · 4 Paper · 6 Debug · 2 Health → **54 routes HTTP total**
- 7 cron handlers (scheduled)
- Détail exhaustif · `ROUTES_AUDIT.md`

## Modules src/ (importés par worker.js)
- `src/ai/` · client Claude · contexte · garde-fous · prompts
- `src/config/` · `api.config.js` · `sports.config.js` (poids · seuils · NBA_TEAMS)
- `src/engine/` · moteurs NBA (4 fichiers split) · MLB · Tennis · robustness · core
- `src/orchestration/data.orchestrator.js` · agrégation data multi-providers
- `src/paper/` · `paper.engine.js` (place bet) · `paper.settler.js` (settle bet)
- `src/providers/` · `provider.cache.js` · `provider.injuries.js` · `provider.nba.js`
- `src/state/store.js` · état global front
- `src/utils/` · `utils.logger.js` · `utils.odds.js` · `utils.update-checker.js`

## Cloudflare Worker config (`wrangler.jsonc`)
- `name: manibetpro`
- `main: worker.js`
- `compatibility_date: 2026-04-19`
- `compatibility_flags: ["nodejs_compat"]`
- `assets.binding: ASSETS` · directory `.`
- `observability.enabled: true`
- KV binding `PAPER_TRADING` · id `17eb7ddc41a949dd99bd840142832cfd`
- Cron `0 * * * *` (toutes les heures)

## KV Namespace `PAPER_TRADING`
- Unique namespace · multi-usage
- Voir DATA_PIPELINE.md section KV pour clés détaillées

## Cron handler (worker.js scheduled)
- `_runBotCron` · NBA · fenêtre dynamique ~1h avant 1er match
- `_runMLBBotCron` (worker.js:8066) · MLB · idem
- `_runTennisBotCron` (worker.js:9372) · Tennis · idem
- `_runNightlySettle` (worker.js:4237) · 10-11h UTC · settle J-1 J-2 (tennis J-10)
- `_runOddsSnapshot` (worker.js:4298) · chaque heure
- `_runAIPlayerPropsCron` (worker.js:4350) · 22h UTC · Claude batch props
- `_runCalibrationCron` (worker.js:4415) · lundi 7h UTC · Telegram résumé hebdo

## Routes principales (extrait · détail `ROUTES_AUDIT.md`)
- `/health` · status worker · version hardcodée `6.85.0` (worker.js:419 · non sync changelog)
- `/nba/*` · 21 routes · matches · injuries · stats · odds · team-detail · 5 debug
- `/mlb/*` · 11 routes · matches · pitchers · standings · weather · bot
- `/tennis/*` · 9 routes · tournaments · odds · stats · bot · _espn_probe
- `/bot/*` · 6 routes · logs · settle · calibration · run · odds-history
- `/paper/*` · 4 routes · state · bet · reset · **aucune auth HTTP**

## Séparation front / backend
- Front fetch worker via HTTPS · CORS `_headers`
- Worker stateless · état → KV
- Cron Cloudflare = scheduler · pas de serveur persistant
- Pas de DB SQL · KV uniquement

## 2 moteurs NBA coexistent (audit MBP-A.2 · `NBA_ENGINE_AUDIT.md`)
- **Backend** · `_botEngineCompute` (worker.js:5211) · appelé uniquement par cron `_runBotCron` (worker.js:3528) · sortie logs KV `bot_log_*` → calibration Alon
- **Frontend** · `EngineCore.compute('NBA', rawData)` (`data.orchestrator.js:857`) · appelé à chaque chargement utilisateur · sortie store · affichage UI
- **Pas de route HTTP `/nba/analyze`** · l'UI ne consomme jamais le moteur backend
- **3 divergences critiques** détectées · confidence algo · `home_away_split` · `back_to_back` (voir `KNOWN_ISSUES.md` MBP-A.2 CRIT-1/2/3)

## Zones sensibles
- `_botEngineCompute` (worker.js:5211) · cœur calcul NBA backend (cron · logs · calibration)
- `EngineCore.compute` `EngineNBA.compute` `EngineRobustness.compute` · cœur calcul NBA frontend (runtime user)
- `_botComputeConfidence` (worker.js:5888) · gate HIGH/MEDIUM/LOW/INCONCLUSIVE · source canonique NBA (MBP-FIX-A.2.1)
- `_botComputeBettingRecs` (worker.js:5334) · génération recos · Kelly · edge
- `_botSaveLog` (worker.js:3606) · persistance logs KV
- `_botSettleDate` (worker.js:3852) · réconciliation résultats
- `_runNightlySettle` (worker.js:4237) · idempotence 48h
- `handlePaperPlaceBet` · `handlePaperSettleBet` (worker.js:5887, 5937) · paper trading

## Sécurité (post chantier MBP-A.4 · `SECURITY_AUDIT.md`)
**6/6 critiques résolues** ·
- ✓ `_denyIfNoDebugAuth(url, env, origin)` (worker.js:881) · fail-CLOSE confirmé · 5 routes NBA debug guardées + `/debug/basketusa`
- ✓ `/tennis/_espn_probe` guard ajouté · MBP-S.1 CRIT-E (worker.js:9883)
- ✓ CORS strict equality · MBP-S.1 CRIT-C · `ALLOWED_ORIGINS.includes(origin)` (worker.js:207)
- ✓ `err.message` sanitisé 14+ occurrences · MBP-S.1 CRIT-B · constantes `SAFE_ERROR_MSG_*` (worker.js:233)
- ✓ Auth Paper · MBP-S.2 + S.2.1 · `requirePaperApiKey` · header `X-API-Key` · secret `PAPER_API_KEY` · 4 routes protégées
- ✓ Auth Bot Run · MBP-S.3 · `requireBotRunApiKey` · header `X-Bot-Api-Key` · secret `BOT_RUN_API_KEY` · 8 routes POST protégées
- ✓ Rate limit Claude per-IP · MBP-S.4 · `_rateLimitIpHash` SHA-256 tronqué · cron exempté `'system'`
- `escapeHtml` côté UI avant `innerHTML` · helpers ui.bot.js
- Regex validation params user avant clé KV · OK pour la plupart

**Restent (P2/P3)** ·
- ✗ Secret `DEBUG_SECRET` en URL query string · referer leak possible (MBP-A.4 HAUT-8)
- ✗ `ai.guard.js` défini mais jamais appelé (MBP-A.4 HAUT-1)
- ✗ HAUT-2 à 9 + MOY-1 à 7 + FAI-1 à 5 · validations body · CSP headers · race KV · etc.

## Déploiement
- Push `main` → Cloudflare auto-deploy worker
- Push `main` → GitHub Pages auto-deploy front
- Pas de staging · prod direct (à surveiller)

## Logs · observability
- `observability.enabled: true` dans wrangler · Cloudflare dashboard
- `utils.logger.js` · format console
- Logs KV `bot_log_{matchId}` 90j TTL (NBA/MLB/Tennis préfixes distincts)

## Build · versionning
- Pas de bundler · scripts ES6 modules natifs front
- Versions `vX.YY` mentionnées commits + SESSION.md
- Build chore commits `chore: bump build YYYYMMDD-HHMMSS-hash` post merge

## Zones à vérifier (MBP-A.1 résolu pour routes)
- ✓ Router worker.js confirmé · 54 routes HTTP · ROUTES_AUDIT.md
- ✓ `engine.robustness.js` documenté MBP-A.2 · perturbation systématique ±10% ±20% · sortie `analysis.robustness_score` · ne pilote plus confidence NBA (post MBP-FIX-A.2.1)
- ✗ `provider.cache.js` / `provider.injuries.js` / `provider.nba.js` utilisation actuelle · non audité
- ✗ Handler `/mlb/weather` inline vs fonction nommée (worker.js:350)
- ✗ Lignes exactes handlers MLB approximatives · ré-auditer si besoin

## Audit MBP-A.1
Voir `ROUTES_AUDIT.md` · routes + auth + provider + cache par ligne.
Voir `KNOWN_ISSUES.md` section "Écarts MBP-A.1" · incohérences critiques.
