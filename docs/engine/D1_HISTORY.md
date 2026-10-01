# NBA immutable history · Cloudflare D1

## Goal

Keep the existing KV path stable while adding a long-term, append-only history suitable for calibration, replay and audit.

Current behavior after this change:

- KV `bot_log_{matchId}` remains the production compatibility path and keeps the latest snapshot for 90 days.
- D1 binding `MANI_HISTORY_DB` is optional.
- When the binding is absent, the Worker behaves exactly as before.
- When the binding exists, each pre-match analysis is inserted once by unique `analysis_id`.
- Settlement is stored separately and may be corrected without mutating the original analysis.

## Tables

### `nba_analysis_history`

Append-only snapshot captured before settlement.

Primary key: `analysis_id`.

Important indexed dimensions:

- `match_id`
- `season_id`
- `game_datetime`
- `analyzed_at`

Database triggers reject `UPDATE` and `DELETE`.

### `nba_analysis_settlements`

One settlement state per `analysis_id`.

This table is intentionally mutable through an upsert so a force-settle or corrected official result can update settlement metadata while the original prediction remains immutable.

### `nba_match_outcomes`

One canonical official outcome per `match_id`.

This table solves the multi-checkpoint problem: H6/H4/H2/H1 can create several immutable `analysis_id` rows for the same game, while the official score/result/closing snapshot exists only once. Historical calibration must join:

`nba_analysis_history.match_id = nba_match_outcomes.match_id`

This avoids copying the latest checkpoint's `motor_was_right`, recommendation settlement or CLV onto earlier checkpoints, whose probabilities and taken prices may differ.

The outcome row is mutable by upsert so official corrections / force-settle can update the game result without mutating any original analysis snapshot.

## Provisioning

Do not commit a fake D1 UUID to `wrangler.jsonc`.

Create the production database first, preferably in the EU jurisdiction:

```bash
npx wrangler@latest d1 create manibetpro-history --jurisdiction=eu
```

Then add the real binding returned by Cloudflare to `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "MANI_HISTORY_DB",
    "database_name": "manibetpro-history",
    "database_id": "<REAL_CLOUDFLARE_UUID>",
    "migrations_dir": "migrations"
  }
]
```

Apply locally first:

```bash
npx wrangler d1 migrations apply manibetpro-history --local
```

Then apply to the remote database:

```bash
npx wrangler d1 migrations apply manibetpro-history --remote
```

Migrations currently tracked:

- `migrations/0001_nba_immutable_history.sql` · tables append-only analysis + settlement
- `migrations/0002_nba_analysis_checkpoints.sql` · métadonnées `checkpoint_id` / `checkpoint_minutes_to_tip`
- `migrations/0003_nba_verified_closing_line.sql` · closing quote, âge/source/provider et prix ML au settlement
- `migrations/0004_nba_match_outcomes.sql` · résultat officiel + closing quote canonique par `match_id`
- `migrations/0005_nba_engine_version.sql` · `engine_version` + `analysis_schema_version` indexés pour isoler les générations de moteur
- `migrations/0006_nba_recent_form_ema_shadow.sql` · valeur EMA legacy + decay-lambda shadow + delta + λ
- `migrations/0007_nba_b2b_scale_shadow.sql` · échelle B2B backend vs frontend et delta de score pondéré

## Rollout

1. Merge code while no D1 binding exists: no runtime behavior change.
2. Create D1 and apply migration.
3. Add the real binding in a separate PR.
4. Validate one preseason analysis:
   - KV log written;
   - D1 `nba_analysis_history` row written;
   - same `analysis_id` in both;
   - second analysis of same match creates a second D1 row.
5. Validate nightly settlement:
   - original analysis rows unchanged;
   - per-analysis settlement row created/updated for the current KV snapshot;
   - one `nba_match_outcomes` row created for the game;
   - every H6/H4/H2/H1 analysis for that `match_id` joins to the same outcome.
6. Historical calibration reads must join immutable analyses to `nba_match_outcomes`; derived correctness/CLV is recalculated per analysis.
7. Calibration datasets must filter/group by `engine_version` so two predictive generations are never silently mixed.
8. Only after runtime proof, begin using D1 for historical/calibration reads.

## Safety guarantees

- D1 write errors never block KV writes.
- No prediction weights, thresholds, calibration or market rules are changed.
- Analysis history uses `INSERT OR IGNORE`.
- Analysis rows reject `UPDATE` and `DELETE`.
- Settlement is stored in a separate table.
- No automatic migration from existing KV history is performed by this PR.
