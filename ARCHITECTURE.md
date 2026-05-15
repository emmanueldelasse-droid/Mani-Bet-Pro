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

## Worker (`worker.js` 10533 lignes · MBP-A.1 audit)
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

## Zones sensibles
- `_botEngineCompute` (worker.js:5128) · cœur calcul NBA
- `_botComputeConfidence` (worker.js:5805) · gate HIGH/MEDIUM/LOW/INCONCLUSIVE
- `_botComputeBettingRecs` (worker.js:5251) · génération recos · Kelly · edge
- `_botSaveLog` (worker.js:3606) · persistance logs KV
- `_botSettleDate` (worker.js:3852) · réconciliation résultats
- `_runNightlySettle` (worker.js:4237) · idempotence 48h
- `handlePaperPlaceBet` · `handlePaperSettleBet` (worker.js:5887, 5937) · paper trading

## Sécurité (audit MBP-A.4 détail · `SECURITY_AUDIT.md`)
- `_denyIfNoDebugAuth(url, env, origin)` (worker.js:881) · **fail-CLOSE** confirmé (401 si secret absent) · 5 routes guardées
- ✗ `/tennis/_espn_probe` (worker.js:372) · **sans guard** · à corriger (MBP-A.4 CRIT-E)
- Secret `DEBUG_SECRET` en URL query string · referer leak possible (MBP-A.4 HAUT-8)
- CORS `corsHeaders(origin)` (worker.js:206) · whitelist 3 origins · pas wildcard
- ✗ CORS `startsWith` vulnerability · subdomain forge possible (MBP-A.4 CRIT-C)
- `escapeHtml` côté UI avant `innerHTML` · helpers ui.bot.js
- Regex validation params user avant clé KV · OK pour la plupart
- ✗ Auth utilisateur · **aucune sur Paper / Bot run** (MBP-A.4 CRIT-A · CRIT-D)
- ✗ `err.message` fuit dans 14 occurrences (MBP-A.4 CRIT-B)
- ✗ `ai.guard.js` défini mais **jamais appelé** dans worker.js (MBP-A.4 HAUT-1)

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
- ✗ `engine.robustness.js` rôle exact · non audité MBP-A.1
- ✗ `provider.cache.js` / `provider.injuries.js` / `provider.nba.js` utilisation actuelle · non audité
- ✗ Handler `/mlb/weather` inline vs fonction nommée (worker.js:350)
- ✗ Lignes exactes handlers MLB approximatives · ré-auditer si besoin

## Audit MBP-A.1
Voir `ROUTES_AUDIT.md` · routes + auth + provider + cache par ligne.
Voir `KNOWN_ISSUES.md` section "Écarts MBP-A.1" · incohérences critiques.
