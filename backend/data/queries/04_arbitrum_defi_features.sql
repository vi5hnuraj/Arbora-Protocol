-- =============================================================================
-- QUERY 04: Arbitrum DeFi Sophistication Features
-- =============================================================================
-- PURPOSE: Measure how broadly each Arbitrum borrower engages with the Arbitrum
--          DeFi ecosystem — DEX usage (Camelot, Uniswap v3), bridge usage,
--          and protocol diversity.
--
-- DEPENDENCY: Uses the same Arbitrum borrower population as Query 01.
--
-- OUTPUT COLUMNS:
--   wallet_address                VARCHAR  — wallet address
--   has_used_dex                  BOOLEAN  — any DEX swap on Arbitrum
--   arbitrum_dex_trade_count      INT      — total DEX trades on Arbitrum
--   arbitrum_dex_volume_usd       FLOAT    — total DEX volume in USD
--   arbitrum_unique_dex_projects  INT      — distinct DEX projects used (Camelot, Uniswap, etc.)
--   has_used_bridge               BOOLEAN  — any bridge transfer involving Arbitrum
--   arbitrum_bridge_tx_count      INT      — bridge transfer count
--   protocol_diversity_score      INT      — count of distinct DeFi categories used
--
-- EXPECTED ROW COUNT: Same as Query 01
-- =============================================================================

WITH arbitrum_wallets AS (
    SELECT DISTINCT LOWER(borrower_address) AS wallet_address
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
),

dex_stats AS (
    SELECT
        LOWER(transaction_from_address) AS wallet_address,
        COUNT(*)                        AS arbitrum_dex_trade_count,
        SUM(usd_amount)                 AS arbitrum_dex_volume_usd,
        COUNT(DISTINCT project)         AS arbitrum_unique_dex_projects
    FROM crosschain.dex.trades
    WHERE chain = 'arbitrum'
      AND LOWER(transaction_from_address) IN (SELECT wallet_address FROM arbitrum_wallets)
    GROUP BY LOWER(transaction_from_address)
),

bridge_stats AS (
    SELECT
        LOWER(transaction_from_address) AS wallet_address,
        COUNT(*)                        AS arbitrum_bridge_tx_count
    FROM crosschain.bridges.transfers
    WHERE LOWER(transaction_from_address) IN (SELECT wallet_address FROM arbitrum_wallets)
    GROUP BY LOWER(transaction_from_address)
)

SELECT
    aw.wallet_address,
    CASE WHEN COALESCE(ds.arbitrum_dex_trade_count, 0) > 0 THEN TRUE ELSE FALSE END AS has_used_dex,
    COALESCE(ds.arbitrum_dex_trade_count, 0)     AS arbitrum_dex_trade_count,
    COALESCE(ds.arbitrum_dex_volume_usd, 0)      AS arbitrum_dex_volume_usd,
    COALESCE(ds.arbitrum_unique_dex_projects, 0) AS arbitrum_unique_dex_projects,
    CASE WHEN COALESCE(bs.arbitrum_bridge_tx_count, 0) > 0 THEN TRUE ELSE FALSE END AS has_used_bridge,
    COALESCE(bs.arbitrum_bridge_tx_count, 0)    AS arbitrum_bridge_tx_count,
    (1 + 
     CASE WHEN COALESCE(ds.arbitrum_dex_trade_count, 0) > 0 THEN 1 ELSE 0 END +
     CASE WHEN COALESCE(bs.arbitrum_bridge_tx_count, 0) > 0 THEN 1 ELSE 0 END
    )                                           AS protocol_diversity_score
FROM arbitrum_wallets aw
LEFT JOIN dex_stats ds ON aw.wallet_address = ds.wallet_address
LEFT JOIN bridge_stats bs ON aw.wallet_address = bs.wallet_address
ORDER BY arbitrum_dex_trade_count DESC;
