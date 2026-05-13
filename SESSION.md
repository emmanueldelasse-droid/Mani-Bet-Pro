# Mani Bet Pro

## Règles update
Début → "En cours" 1/N · Fin étape → +1 · Merge → vider · User future → TODO+prio

## En cours
néant

## Conventions
3 sports même vocabulaire confiance : `Conf. HIGH/MEDIUM/LOW/INCONCLUSIVE` · jamais `Data quality`
UI user-facing FR (v6.90+) : helpers `_qualityFr` `_betTypeFr` `_fmtOdds` `_confidenceFr` `_interpretVariable` (ui.bot.js:1090-1215) · cotes décimales européennes jamais US

## TODO
- [ ] P1 surveiller hit rate MLB v6.94 post 50 paris · si <52% désactiver bot (Option C)
- [ ] P1 surveiller hit rate tennis v6.93 post 50 paris · revert isolé si baisse
- [ ] P2 NBA recheck calib à 80+ logs (actuel 53 hit 67.9% v6.79 valide) · `travel_load` inversé n=22 ignoré
- [ ] P2 gate `confidence=INCONCLUSIVE` si `data_quality<0.55` (worker.js:5185)
- [ ] P2 `/bot/calibration/analyze?sport=tennis` après 30+ logs settlés v6.85+
- [ ] P3 calibrer `-4.5` playoff par round après 100+ logs · Alon 50+ logs
- [ ] P3 réactiver paris contrarian après 200+ logs · cotes≥3
- [ ] P3 réactiver api-tennis fixtures si compte payé → `env.TENNIS_API_FIXTURES_ENABLED=1`

## État
Worker `manibetpro.emmanueldelasse.workers.dev` · Front GH Pages · KV `PAPER_TRADING` `17eb7ddc41a949dd99bd840142832cfd`

## Routes
- `/nba/*` `/mlb/*` `/tennis/*` `/bot/*` · détail via `git grep` worker.js:340-400
- Cron `0 * * * *` · 10-11h nightly-settle UTC · 22h AI props

## Fichiers
- `worker.js` ~8500L · `wrangler.jsonc`
- `src/ui/match-detail.{js,teamdetail,tennis,helpers}` · dashboard · bot · history
- `src/engine/engine.tennis.js` front · backend bot dans worker.js
- `src/utils/utils.odds.js` conversions cotes

## Pièges Tank01
`team.Roster` R maj · `statsToGet=averages` · `teamAbv.trim().toUpperCase()` · cache 6h · `?bust=1`

## Pièges TheOddsAPI
`player_points` sans `bookmakers=` → books dispo · filtre → 422 si absent (worker.js:2450)

## Pièges MLB
`_mlbSeason()` dynamique · IP `X.Y` = X innings + Y outs · ESPN `YYYYMMDD` aligné logs
v6.94 (worker.js:8330) après 315 logs hit 49.8% : 4 vars supprimées (run_diff/split/bullpen/babip) · pitcher_fip 0.10→0.18 · last10 0.10→0.20 · garde-fou edge MLB [5, 10] (zone seule profitable 54.7% sur 64 paris)

## Pièges Tennis
Sackmann CSV lag 2-3j · api-tennis désactivé (cod=1006 non payé) · CSV qual hors tour
9 vars : ranking_elo · surface_wr · recent_form · pressure_dom · h2h_pondéré · service · physical_load_14d · market_steam · fatigue
Elo K=32 · log 90j · odds_snap 7j · steam<3% bruit · Garde-fous edge>18% / cote≥5+edge>15% / matchs<15 drop
H2H pondéré récence (v6.85 worker.js:7270 engine.tennis.js:217) : ≤12m×1 24m×0.5 36m×0.25 >36×0.1 · fallback global si surfWT<1.5
Dates estimées round offset (v6.87 worker.js:7080) R128+1j..F+7j · slam ×2 · `opponent_rank` last5 (v6.92)
Modal stats adversaire clic nom (ui.match-detail.tennis.js:570)
Poids v6.93 (worker.js:9078 sports.config.js:190) : Elo 0.28→0.38 masters · réduit dilution favoris écrasants · challenger inchangé

## Pièges Timezone
`_botFormatDate` Intl · DST auto · nightly idempotent

## Sécu
Debug `_denyIfNoDebugAuth()` · params user regex avant KV key · innerHTML → `escapeHtml`

## Deploy
`git push origin main` → CF auto-deploy

## Hors SESSION
`.claude/onboarding.md` · `git log` · `.claude/agents/alon.md`
