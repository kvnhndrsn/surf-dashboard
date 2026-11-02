-- SURF Lending dashboard — Supabase schema.
-- Matches the tables written/read by the routes in /api:
--   api/snapshot.js           -> surf_protocol_snapshots, surf_pool_snapshots
--   api/graph.js              -> surf_protocol_snapshots, surf_pool_snapshots
--   api/activity-snapshot.js  -> surf_activities
--   api/activity.js           -> surf_activities
-- Safe to re-run: every statement is idempotent.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Hourly protocol-wide snapshot (one row per cron run).
CREATE TABLE IF NOT EXISTS surf_protocol_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_pools INT NOT NULL DEFAULT 0,
    total_positions INT NOT NULL DEFAULT 0,
    positions_healthy INT NOT NULL DEFAULT 0,
    positions_at_risk INT NOT NULL DEFAULT 0,
    positions_liquidatable INT NOT NULL DEFAULT 0,
    healthy_value_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    at_risk_value_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    liquidatable_value_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_supplied_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_borrowed_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_collateral_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_net_value_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_reserve_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_unpaid_interest_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    avg_ltv NUMERIC(20,10) NOT NULL DEFAULT 0,
    avg_borrow_apr NUMERIC(20,10) NOT NULL DEFAULT 0,
    avg_supply_apy NUMERIC(20,10) NOT NULL DEFAULT 0,
    total_volume_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    ltv_buckets JSONB NOT NULL DEFAULT '{}'::jsonb,
    pool_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    surf_price NUMERIC(30,12) NOT NULL DEFAULT 0,
    surf_price_usd NUMERIC(30,12) NOT NULL DEFAULT 0,
    ada_price NUMERIC(30,12) NOT NULL DEFAULT 0,
    fetch_duration_ms INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_protocol_snapshots_at ON surf_protocol_snapshots(snapshot_at DESC);

-- Per-pool snapshot, written in the same cron run as the protocol snapshot.
CREATE TABLE IF NOT EXISTS surf_pool_snapshots (
    id BIGSERIAL PRIMARY KEY,
    pool_id VARCHAR(100) NOT NULL,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ticker VARCHAR(20) NOT NULL DEFAULT '',
    policy_id VARCHAR(64) NOT NULL DEFAULT '',
    asset_name VARCHAR(128) NOT NULL DEFAULT '',
    decimals INT NOT NULL DEFAULT 0,
    price_ada NUMERIC(30,12) NOT NULL DEFAULT 0,
    price_usd NUMERIC(30,12) NOT NULL DEFAULT 0,
    total_supplied NUMERIC(40,0) NOT NULL DEFAULT 0,
    total_borrowed NUMERIC(40,0) NOT NULL DEFAULT 0,
    reserve NUMERIC(40,0) NOT NULL DEFAULT 0,
    total_supplied_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    total_borrowed_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    reserve_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    supply_apy NUMERIC(20,10) NOT NULL DEFAULT 0,
    borrow_apr NUMERIC(20,10) NOT NULL DEFAULT 0,
    utilization_rate NUMERIC(20,10) NOT NULL DEFAULT 0,
    total_ctoken NUMERIC(40,0) NOT NULL DEFAULT 0,
    total_unpaid_interest NUMERIC(40,0) NOT NULL DEFAULT 0,
    total_unpaid_interest_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    max_ltv NUMERIC(20,10) NOT NULL DEFAULT 0,
    liq_threshold_ltv NUMERIC(20,10) NOT NULL DEFAULT 0,
    recommended_ltv NUMERIC(20,10) NOT NULL DEFAULT 0,
    positions_in_pool INT NOT NULL DEFAULT 0,
    total_volume_usd NUMERIC(30,10) NOT NULL DEFAULT 0,
    historical_apy NUMERIC(20,10) NOT NULL DEFAULT 0,
    collateral_assets JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_pool ON surf_pool_snapshots(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_snapshots_at ON surf_pool_snapshots(snapshot_at DESC);

-- On-chain activity feed, polled every 10 minutes.
-- tx_hash is UNIQUE because api/activity-snapshot.js upserts with onConflict: 'tx_hash'.
CREATE TABLE IF NOT EXISTS surf_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_type TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    amount BIGINT NOT NULL DEFAULT 0,
    asset TEXT NOT NULL DEFAULT '',
    collateral_amount BIGINT NOT NULL DEFAULT 0,
    collateral_asset TEXT NOT NULL DEFAULT '',
    pool_id TEXT NOT NULL DEFAULT '',
    tx_hash TEXT NOT NULL DEFAULT '' UNIQUE,
    activity_time BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_activities_time ON surf_activities(activity_time DESC);
CREATE INDEX IF NOT EXISTS idx_activities_addr ON surf_activities(address);
CREATE INDEX IF NOT EXISTS idx_activities_type ON surf_activities(activity_type);

-- All reads/writes go through the API using the service_role key, which bypasses
-- RLS. Enabling it keeps the anon/public key from touching these tables.
ALTER TABLE surf_protocol_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE surf_pool_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE surf_activities ENABLE ROW LEVEL SECURITY;
