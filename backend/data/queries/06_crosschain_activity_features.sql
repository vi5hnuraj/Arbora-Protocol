-- =============================================================================
-- QUERY 06: Multichain & Crosschain Activity Features
-- =============================================================================
-- PURPOSE: Compute multichain activity features across Ethereum, Optimism,
--          Polygon, and Base for each Arbitrum borrower.
--
-- DEPENDENCY: Uses the same Arbitrum borrower population as Query 01.
--
-- OUTPUT COLUMNS:
--   wallet_address               VARCHAR  — wallet address
--   chains_active_on             INT      — count of non-Arbitrum EVM chains with activity (0–4)
--   eth_tx_count                 INT      — Ethereum transaction count
--   optimism_tx_count            INT      — Optimism transaction count
--   polygon_tx_count             INT      — Polygon transaction count
--   base_tx_count                INT      — Base transaction count
--   crosschain_total_tx_count    INT      — sum of non-Arbitrum transactions
--   crosschain_dex_trade_count   INT      — DEX trades across EVM chains
--   crosschain_dex_volume_usd    FLOAT    — DEX volume across EVM chains
--
-- EXPECTED ROW COUNT: Same as Query 01
-- =============================================================================

WITH arbitrum_wallets AS (
    SELECT DISTINCT LOWER(borrower_address) AS wallet_address
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
),

chain_transfers AS (
    SELECT
        LOWER(from_address) AS wallet_address,
        chain,
        COUNT(*) AS tx_count
    FROM crosschain.assets.transfers
    WHERE LOWER(from_address) IN (SELECT wallet_address FROM arbitrum_wallets)
      AND chain IN ('ethereum', 'optimism', 'polygon', 'base')
    GROUP BY LOWER(from_address), chain
),

chain_pivots AS (
    SELECT
        wallet_address,
        COUNT(DISTINCT chain) AS chains_active_on,
        SUM(tx_count) AS crosschain_total_tx_count,
        SUM(CASE WHEN chain = 'ethereum' THEN tx_count ELSE 0 END) AS eth_tx_count,
        SUM(CASE WHEN chain = 'optimism' THEN tx_count ELSE 0 END) AS optimism_tx_count,
        SUM(CASE WHEN chain = 'polygon' THEN tx_count ELSE 0 END) AS polygon_tx_count,
        SUM(CASE WHEN chain = 'base' THEN tx_count ELSE 0 END) AS base_tx_count
    FROM chain_transfers
    GROUP BY wallet_address
),

dex_stats AS (
    SELECT
        LOWER(transaction_from_address) AS wallet_address,
        COUNT(*) AS crosschain_dex_trade_count,
        SUM(usd_amount) AS crosschain_dex_volume_usd
    FROM crosschain.dex.trades
    WHERE LOWER(transaction_from_address) IN (SELECT wallet_address FROM arbitrum_wallets)
      AND chain IN ('ethereum', 'optimism', 'polygon', 'base')
    GROUP BY LOWER(transaction_from_address)
)

SELECT
    aw.wallet_address,
    COALESCE(cp.chains_active_on, 0)          AS chains_active_on,
    COALESCE(cp.eth_tx_count, 0)              AS eth_tx_count,
    COALESCE(cp.optimism_tx_count, 0)         AS optimism_tx_count,
    COALESCE(cp.polygon_tx_count, 0)          AS polygon_tx_count,
    COALESCE(cp.base_tx_count, 0)             AS base_tx_count,
    COALESCE(cp.crosschain_total_tx_count, 0) AS crosschain_total_tx_count,
    COALESCE(ds.crosschain_dex_trade_count, 0) AS crosschain_dex_trade_count,
    COALESCE(ds.crosschain_dex_volume_usd, 0) AS crosschain_dex_volume_usd
FROM arbitrum_wallets aw
LEFT JOIN chain_pivots cp ON aw.wallet_address = cp.wallet_address
LEFT JOIN dex_stats ds ON aw.wallet_address = ds.wallet_address
ORDER BY crosschain_total_tx_count DESC;
