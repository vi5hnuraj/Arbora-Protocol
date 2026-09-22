-- =============================================================================
-- QUERY 05: Arbitrum Financial Profile Features
-- =============================================================================
-- PURPOSE: Compute financial profile features for each Arbitrum borrower using
--          token balance snapshots and net transfer flow on Arbitrum.
--
-- DEPENDENCY: Uses the same Arbitrum borrower population as Query 01.
--
-- OUTPUT COLUMNS:
--   wallet_address          VARCHAR  — wallet address
--   current_total_usd       FLOAT    — current total portfolio value in USD on Arbitrum
--   current_native_usd      FLOAT    — current native ETH balance in USD
--   current_stablecoin_usd  FLOAT    — current stablecoin holdings (USDC, USDT, DAI, USDG)
--   stablecoin_ratio        FLOAT    — stablecoins as fraction of total holdings
--   token_diversity         INT      — count of distinct tokens currently held (balance > 0)
--   net_flow_usd_90d        FLOAT    — net token flow in USD over trailing 90 days on Arbitrum
--
-- EXPECTED ROW COUNT: Same as Query 01
-- =============================================================================

WITH arbitrum_wallets AS (
    SELECT DISTINCT LOWER(borrower_address) AS wallet_address
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
),

portfolio AS (
    SELECT
        LOWER(bl.address)                                       AS wallet_address,
        SUM(bl.usd_balance_current)                             AS current_total_usd,
        SUM(CASE
            WHEN bl.token_address = '0x0000000000000000000000000000000000000000'
              OR LOWER(bl.token_address) = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1' -- WETH
            THEN bl.usd_balance_current ELSE 0
        END)                                                    AS current_native_usd,
        SUM(CASE
            WHEN LOWER(bl.token_address) IN (
                '0xaf88d065e77c8cc2239327c5edb3a432268e5831',  -- Native USDC
                '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',  -- Bridged USDC.e
                '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9',  -- USDT
                '0xda10009cbd5d07dd0cecc66161544737f1479079'   -- DAI
            )
            THEN bl.usd_balance_current ELSE 0
        END)                                                    AS current_stablecoin_usd,
        COUNT(DISTINCT CASE
            WHEN bl.usd_balance_current > 1.0 THEN bl.token_address
        END)                                                    AS token_diversity
    FROM arbitrum.assets.fungible_balances_latest bl
    WHERE LOWER(bl.address) IN (SELECT wallet_address FROM arbitrum_wallets)
    GROUP BY LOWER(bl.address)
),

net_flow AS (
    SELECT
        aw.wallet_address,
        COALESCE(SUM(CASE WHEN LOWER(t.to_address) = aw.wallet_address THEN COALESCE(t.usd_amount, 0) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN LOWER(t.from_address) = aw.wallet_address THEN COALESCE(t.usd_amount, 0) ELSE 0 END), 0)
        AS net_flow_usd_90d
    FROM arbitrum_wallets aw
    LEFT JOIN crosschain.assets.transfers t
        ON t.chain = 'arbitrum'
        AND (LOWER(t.from_address) = aw.wallet_address OR LOWER(t.to_address) = aw.wallet_address)
        AND t.block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '90 days'
    GROUP BY aw.wallet_address
)

SELECT
    aw.wallet_address,
    COALESCE(p.current_total_usd, 0)        AS current_total_usd,
    COALESCE(p.current_native_usd, 0)       AS current_native_usd,
    COALESCE(p.current_stablecoin_usd, 0)   AS current_stablecoin_usd,
    CASE
        WHEN COALESCE(p.current_total_usd, 0) > 0
        THEN COALESCE(p.current_stablecoin_usd, 0) / p.current_total_usd
        ELSE 0
    END                                     AS stablecoin_ratio,
    COALESCE(p.token_diversity, 0)          AS token_diversity,
    COALESCE(nf.net_flow_usd_90d, 0)        AS net_flow_usd_90d
FROM arbitrum_wallets aw
LEFT JOIN portfolio p ON aw.wallet_address = p.wallet_address
LEFT JOIN net_flow nf ON aw.wallet_address = nf.wallet_address
ORDER BY current_total_usd DESC;
