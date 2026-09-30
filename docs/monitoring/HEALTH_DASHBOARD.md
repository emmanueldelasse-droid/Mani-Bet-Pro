# Operational Health Dashboard

## Route

`GET /health`

The route is public and read-only. It does **not** call ESPN, Tank01, BallDontLie, TheOddsAPI, Claude or any other external provider. It only reads runtime metadata and values already persisted in the `PAPER_TRADING` KV namespace.

## Global status

`status=ok` when no blocking operational issue is detected.

`status=degraded` when at least one item in `issues[]` is present.

Warnings are intentionally non-blocking. In particular, `D1_HISTORY_BINDING_NOT_CONFIGURED` remains a warning until the optional D1 rollout is provisioned and validated.

## Worker deployment identity

Wrangler binds Cloudflare Worker version metadata as `CF_VERSION_METADATA`.

`deployed_version` exposes:

- `id`: exact Worker version ID serving the request;
- `tag`: optional deployment/version tag;
- `created_at`: Worker version creation timestamp.

This replaces the old hardcoded `6.85.0` health value.

## Scheduler health

### NBA hourly engine

KV heartbeat: `nba_cron_heartbeat_v1`

Written at the **start** of every `_runBotCron` invocation, before ESPN is called. Therefore:

- fresh heartbeat + no analyses can legitimately mean no match/checkpoint was due;
- stale/missing heartbeat means the scheduled NBA pipeline itself may not be running.

Freshness threshold: **90 minutes**.

Issue: `NBA_CRON_HEARTBEAT_NOT_FRESH`.

### Odds snapshot scheduler

KV heartbeat: `odds_snapshot_heartbeat_v1`

Written after every 15-minute snapshot pass, including the numbers of NBA and MLB snapshots persisted.

Freshness threshold: **35 minutes**.

Issue: `ODDS_SNAPSHOT_HEARTBEAT_NOT_FRESH`.

## NBA coverage

The health payload reports, from latest KV snapshots:

- `logs_scanned`;
- `latest_analysis_at`;
- `latest_analysis_freshness`;
- `latest_snapshot_logs_24h`;
- `status_breakdown`;
- `checkpoint_breakdown_latest_snapshots`;
- `checkpoint_keys_72h`;
- `overdue_settlements_6h_after_tip`.

A pending NBA log more than six hours after scheduled tip raises `NBA_SETTLEMENT_OVERDUE`.

KV listing is explicitly bounded. If more than 1000 NBA log keys are present and the scan is incomplete, health reports `NBA_LOG_SCAN_TRUNCATED` rather than silently claiming complete coverage.

## Provider cache observability

The route reports presence and last observable timestamp/age for:

- Tank01 team stats;
- injury impact cache;
- roster injuries cache;
- enriched rosters cache.

Missing caches are warnings, not automatic pipeline failures, because a cache can legitimately be cold outside an NBA activity window.

No provider is fetched by `/health`.

## Storage

`storage.kv_configured` confirms the canonical KV binding.

`storage.d1_history_configured` confirms whether the optional `MANI_HISTORY_DB` binding is available.

A missing D1 binding does not degrade the current production engine because KV remains the canonical compatibility path until D1 runtime validation is completed.

## Runtime validation for preseason

For a real preseason game, verify in order:

1. `scheduler.nba_hourly.status = FRESH`;
2. `scheduler.odds_snapshot_15m.status = FRESH`;
3. checkpoint keys increase as H6/H4/H2/H1 become due;
4. `latest_analysis_at` advances on actual analyses;
5. no `NBA_SETTLEMENT_OVERDUE` remains after nightly settlement;
6. `deployed_version.id` matches the Worker version under test.

A green health response is operational evidence, but does not by itself prove predictive correctness or calibration.
