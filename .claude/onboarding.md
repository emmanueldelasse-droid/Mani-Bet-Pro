# Onboarding (chargé à la demande)

## Secrets (CF Dashboard → Worker → Variables)
- `TANK01_API_KEY` (RapidAPI tank01-fantasy-stats)
- `ANTHROPIC_API_KEY` (Claude)
- `TELEGRAM_BOT_TOKEN` · `TELEGRAM_CHAT_ID`
- `DEBUG_SECRET` (guard routes debug)

## Workflow dev
1. Branch `claude/<topic>` depuis `origin/main`
2. Edit + commit + push + PR
3. Squash merge
4. Deploy manuel `npx wrangler deploy` (côté user)
5. Test curl + UI
6. Update SESSION.md si impact critique

## Reprise nouveau compte (5 min)
```
git clone https://github.com/emmanueldelasse-droid/Mani-Bet-Pro && cd Mani-Bet-Pro
npm i -g wrangler && wrangler login
wrangler secret put TANK01_API_KEY        # + autres secrets
# si KV absent :
wrangler kv namespace create PAPER_TRADING  # update wrangler.jsonc avec l'id
npx wrangler deploy
curl https://manibetpro.workers.dev/health
```
Front GitHub Pages auto-déployé depuis main.

## Archi
```
index.html + src/ui/*.js (GitHub Pages)
           ↓
    manibetpro.workers.dev (worker.js)
           ↓
  Tank01 · ESPN · Claude · Telegram · KV PAPER_TRADING
```
