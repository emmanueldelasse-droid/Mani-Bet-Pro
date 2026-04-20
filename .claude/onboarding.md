# Onboarding (chargé à la demande)

## Secrets (CF Dashboard → Worker → Variables)
- `TANK01_API_KEY` (RapidAPI tank01-fantasy-stats)
- `ANTHROPIC_API_KEY` (Claude)
- `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID`
- `DEBUG_SECRET` (guard routes debug)

## Workflow dev
1. Branch `claude/<topic>` depuis `origin/main`
2. Edit + commit + push + PR
3. Squash merge → auto-deploy CF (Git integration)
4. Test curl + UI
5. Update SESSION.md si impact critique

## Reprise nouveau compte (5 min)
1. Fork ou clone `https://github.com/emmanueldelasse-droid/Mani-Bet-Pro`
2. CF Dashboard → Workers & Pages → **Create** → **Connect GitHub** → sélectionner le repo
3. Renseigner secrets CF Dashboard (voir section Secrets ci-dessus)
4. Créer KV si absent : Dashboard → KV → Create → binding `PAPER_TRADING` (update `wrangler.jsonc`)
5. Push main → auto-deploy
6. Test : `curl https://<worker>.workers.dev/health`

Front GitHub Pages auto-déployé depuis main.

## Archi
```
index.html + src/ui/*.js (GitHub Pages)
           ↓
    manibetpro.workers.dev (worker.js)
           ↓
  Tank01 · ESPN · Claude · Telegram · KV PAPER_TRADING
```
