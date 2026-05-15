# Checklist merge · Mani Bet Pro

À cocher avant chaque demande de merge. ChatGPT valide · User merge.

## Périmètre
- [ ] Branche `claude/<topic>` à jour avec `origin/main`
- [ ] `git fetch origin main && git merge origin/main` effectué
- [ ] `git diff --stat` reviewé · périmètre conforme
- [ ] Aucun fichier hors scope modifié

## Code modifié ?
- [ ] `worker.js` modifié ? → impacts détaillés
- [ ] `src/engine/*` modifié ? → calibration impactée ?
- [ ] `src/ui/*` modifié ? → screenshots ou description visuelle
- [ ] `src/providers/*` modifié ? → PROVIDERS_MATRIX.md à jour
- [ ] `src/paper/*` modifié ? → impacts paper trading documentés
- [ ] `wrangler.jsonc` modifié ? → cron · KV · secrets impactés ?
- [ ] `_headers` · `manifest.json` · `index.html` modifiés ? → front impact

## Sport impacté
- [ ] NBA · MLB · Tennis · plusieurs · aucun
- [ ] Si NBA : recheck calib à 80+ logs (TODO SESSION.md)
- [ ] Si MLB : hit rate v6.94 surveillé · garde-fou edge [5, 10] respecté
- [ ] Si Tennis : 9 vars poids v6.95 inchangées (sauf justification)

## Calibration impactée
- [ ] Poids variables changés ? → justification N logs · biais identifié
- [ ] Seuils edge · cote plafond changés ? → backtest fourni
- [ ] Gates `confidence` · `data_quality` changés ? → impacts sur recos comptés
- [ ] Validation Alon report fournie ?

## Provider impacté
- [ ] Tank01 · ESPN · TheOddsAPI · api-tennis · Sackmann CSV · Claude · Telegram
- [ ] Quota / coût impact ?
- [ ] Fallback documenté · testé ?
- [ ] TTL cache changé ? → justifié

## Odds impactées
- [ ] Conversion cotes décimales OK
- [ ] Affichage user-facing décimal européen
- [ ] Edge calc inchangé ou justifié
- [ ] Snapshot odds (cron) impacté ?

## Blessures impactées
- [ ] NBA injury report PDF parsing OK
- [ ] ESPN injuries fallback testé
- [ ] AI injuries (Claude) prompts inchangés ou validés
- [ ] `absences_impact` poids inchangé sauf justification

## Paper betting impacté
- [ ] KV `PAPER_TRADING` schéma compatible
- [ ] Settle workflow OK (manual + nightly)
- [ ] Bankroll · stake sizing inchangé sauf justification
- [ ] Historique bets toujours lisible

## Route admin / debug impactée
- [ ] `_denyIfNoDebugAuth` toujours appliqué
- [ ] Pas de bypass debug en prod
- [ ] Si nouvelle route debug : guard ajouté

## Sécurité / debug
- [ ] Pas de secret en clair
- [ ] Params user validés (regex avant KV key)
- [ ] `innerHTML` → `escapeHtml` respecté
- [ ] CORS headers cohérents

## Tests effectués
- [ ] Build local OK (si applicable)
- [ ] curl route principale OK
- [ ] UI golden path testée
- [ ] Edge cases (provider down · données vides) testés
- [ ] Logs Cloudflare reviewés (si déjà déployé en preview)

## Documentation
- [ ] SESSION.md mis à jour si impact critique
- [ ] Docs gouvernance à jour si concernées
- [ ] KNOWN_ISSUES.md à jour si bug résolu ou nouveau

## Validation finale
- [ ] PR ouverte sur GitHub
- [ ] Résumé Claude posté : fichiers · impacts · risques · tests
- [ ] GO ChatGPT obtenu
- [ ] User squash-merge → CF auto-deploy
- [ ] Vérif post-deploy (curl + UI)

## Si checklist incomplète
- Ne pas merger
- Compléter ou justifier les `[ ]` restantes
- Reposter résumé à ChatGPT
