-- =============================================================================
-- QUERY 03: Arbitrum Lending Behavior Features (Aave v3 / Radiant)
-- =============================================================================
-- PURPOSE: Compute detailed lending behavior features for each Arbitrum borrower.
--          These are the STRONGEST predictors of creditworthiness and liquidation risk.
--
-- DEPENDENCY: Uses the same Arbitrum borrower population as Query 01.
--
-- OUTPUT COLUMNS:
--   wallet_address              VARCHAR   — wallet address
--   borrow_count                INT       — total borrow events
--   repay_count                 INT       — total repay events
--   borrow_repay_ratio          FLOAT     — repay_count / borrow_count (>1 = positive signal)
--   total_borrowed_usd          FLOAT     — lifetime borrowed USD
--   total_repaid_usd            FLOAT     — lifetime repaid USD
--   avg_borrow_usd              FLOAT     — average borrow size in USD
--   max_borrow_usd              FLOAT     — largest single borrow in USD
--   unique_borrow_tokens        INT       — distinct tokens borrowed
--   unique_markets              INT       — distinct lending markets used
--   avg_loan_duration_days      FLOAT     — avg days between sequential borrow and repay
--   lending_active_days         INT       — distinct days with any lending activity
--   first_lending_ts            TIMESTAMP — first lending interaction
--   last_lending_ts             TIMESTAMP — most recent lending interaction
--
-- EXPECTED ROW COUNT: Same as Query 01
-- =============================================================================

WITH arbitrum_wallets AS (
    SELECT DISTINCT LOWER(borrower_address) AS wallet_address
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
),

borrow_stats AS (
    SELECT
        LOWER(borrower_address)         AS wallet_address,
        COUNT(*)                        AS borrow_count,
        SUM(usd_amount)                 AS total_borrowed_usd,
        AVG(usd_amount)                 AS avg_borrow_usd,
        MAX(usd_amount)                 AS max_borrow_usd,
        COUNT(DISTINCT token_address)   AS unique_borrow_tokens,
        COUNT(DISTINCT market_address)  AS unique_markets,
        MIN(block_timestamp)            AS first_borrow_ts,
        MAX(block_timestamp)            AS last_borrow_ts
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
    GROUP BY LOWER(borrower_address)
),

repay_stats AS (
    SELECT
        LOWER(borrower_address)         AS wallet_address,
        COUNT(*)                        AS repay_count,
        SUM(usd_amount)                 AS total_repaid_usd,
        MIN(block_timestamp)            AS first_repay_ts,
        MAX(block_timestamp)            AS last_repay_ts
    FROM arbitrum.lending.repayments
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
    GROUP BY LOWER(borrower_address)
),

lending_activity_days AS (
    SELECT
        wallet_address,
        COUNT(DISTINCT activity_date) AS lending_active_days
    FROM (
        SELECT LOWER(borrower_address) AS wallet_address, DATE(block_timestamp) AS activity_date
        FROM arbitrum.lending.loans
        WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
        UNION ALL
        SELECT LOWER(borrower_address) AS wallet_address, DATE(block_timestamp) AS activity_date
        FROM arbitrum.lending.repayments
        WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
    )
    GROUP BY wallet_address
)

SELECT
    aw.wallet_address,
    COALESCE(bs.borrow_count, 0)                                AS borrow_count,
    COALESCE(rs.repay_count, 0)                                 AS repay_count,
    CASE
        WHEN COALESCE(bs.borrow_count, 0) > 0
        THEN COALESCE(rs.repay_count, 0)::FLOAT / bs.borrow_count
        ELSE 0
    END                                                         AS borrow_repay_ratio,
    COALESCE(bs.total_borrowed_usd, 0)                          AS total_borrowed_usd,
    COALESCE(rs.total_repaid_usd, 0)                            AS total_repaid_usd,
    COALESCE(bs.avg_borrow_usd, 0)                              AS avg_borrow_usd,
    COALESCE(bs.max_borrow_usd, 0)                              AS max_borrow_usd,
    COALESCE(bs.unique_borrow_tokens, 0)                        AS unique_borrow_tokens,
    COALESCE(bs.unique_markets, 0)                              AS unique_markets,
    COALESCE(lad.lending_active_days, 0)                        AS lending_active_days,
    bs.first_borrow_ts                                          AS first_lending_ts,
    GREATEST(
        COALESCE(bs.last_borrow_ts, '1970-01-01'::TIMESTAMP),
        COALESCE(rs.last_repay_ts, '1970-01-01'::TIMESTAMP)
    )                                                           AS last_lending_ts
FROM arbitrum_wallets aw
LEFT JOIN borrow_stats bs ON aw.wallet_address = bs.wallet_address
LEFT JOIN repay_stats rs ON aw.wallet_address = rs.wallet_address
LEFT JOIN lending_activity_days lad ON aw.wallet_address = lad.wallet_address
ORDER BY borrow_count DESC;
