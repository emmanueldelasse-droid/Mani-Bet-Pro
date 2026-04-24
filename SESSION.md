# Mani Bet Pro

## Règles update SESSION (IA OBLIGATOIRE)
Début → "En cours" · Fin → +1 · Merge → vider+cocher TODO · Future → ajouter TODO+P · Commit si step >5min ou >3 tool calls.

## En cours
néant

## TODO (calibration bot — post-v6.78)
- [ ] P1 bump `net_rating_diff` 0.06→0.16 (worker.js:4418) · stat stable
- [ ] P2 gate `confidence=INCONCLUSIVE` si `data_quality<0.55` (worker.js:5185)
- [ ] P3 relancer Alon après 50+ logs · mesurer effet recent_form_ema fix

## État
Worker `manibetpro` v6.78 · `manibetpro.emmanueldelasse.workers.dev` · Front GH Pages
KV `PAPER_TRADING` id=`17eb7ddc41a949dd99bd840142832cfd`
Stack: CF Worker + KV + Tank01 + ESPN + Claude API + Telegram

## Routes
- `/health` · `/nba/{matches,odds,injuries,standings,results,team-detail,teams/stats,roster-injuries,ai-injuries[-batch],ai-player-props,player-points}`
- `/nba/{roster,boxscore,schedule}-debug` · `/debug/basketusa` (`?secret=X` obligatoire)
- `/mlb/{matches,odds,pitchers,standings,team-stats,bullpen-stats,weather}`
- `/bot/{run POST,logs,settle-logs POST,logs/export.csv,odds-history?matchId=X,calibration}`
- `/tennis/{sports-list,tournaments,odds,stats}` · ATP+WTA · `tour=atp|wta` param stats
- Cron `0 * * * *` · bot NBA+MLB · 10-11h UTC nightly-settle J-1/J-2 · 22h UTC AI props · snapshot ESPN→KV `odds_snap_{id}`

## Fichiers
- `worker.js` ~7263L monolithe · `wrangler.jsonc`
- `src/ui/` → match-detail.teamdetail · match-detail.tennis (6s: Elo/Surface/H2H/Forme/Service/Ctx) · dashboard · bot · history · match-detail.helpers
- `src/utils/utils.odds.js` → source canonique conversions cotes

## Pièges Tank01
- `team.Roster` R maj (fallback `.roster`) · `statsToGet=averages` obligatoire
- `teamAbv.trim().toUpperCase()` systématique · cache KV rosters 6h · team-detail 6/8h · box 7j
- `?bust=1` force refetch, overwrite si data>0 · bundle calls séquentiels anti rate-limit
- `parseFloat(ppg)` → `Number.isFinite` (sinon NaN cascade)

## Pièges TheOddsAPI
- `player_points` sans `bookmakers=` → 422 si filtre absent (worker.js:2450)

## Pièges MLB
- `_mlbSeason()` dynamique · jamais hardcoder (nov-fév = saison précédente)
- Double-header : pitcher keyé teamName → warn + garde 1er (refacto futur)
- IP baseball `X.Y` = X innings + Y outs · `parseFloat` faux
- MLB Stats API `date=YYYY-MM-DD` · ESPN `YYYYMMDD` · logs MLB stockent YYYYMMDD (aligné NBA)

## Pièges Timezone
- `getTodayET`+`_botFormatDate` via `Intl.DateTimeFormat` · DST auto · Nightly-settle 10-11h UTC idempotent

## Sécu
- Debug routes → `_denyIfNoDebugAuth()` · refuse si DEBUG_SECRET unset/wrong
- Params user → regex avant KV key (`matchId [a-zA-Z0-9_-]+` · `date \d{8}`)
- UI innerHTML → `escapeHtml` (helpers.js) pour data tierce

## Deploy
`git push origin main` → CF auto-deploy · pas de `wrangler deploy`.

## Extra
- Secrets → `.claude/onboarding.md` · Historique → `git log` · Alon → `.claude/agents/alon.md`
