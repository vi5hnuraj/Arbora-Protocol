-- =============================================================================
-- QUERY 02: Arbitrum On-Chain Activity Features
-- =============================================================================
-- PURPOSE: Compute wallet-level activity features from Arbitrum raw transactions
--          for all wallets in the Arbitrum borrower set (Query 01).
--
-- DEPENDENCY: Run Query 01 first. This query uses the same borrower_address
--             population by joining against arbitrum.lending.loans.
--
-- OUTPUT COLUMNS:
--   wallet_address                 VARCHAR   — wallet address
--   arbitrum_total_tx_count        INT       — total transactions sent on Arbitrum
--   arbitrum_unique_active_days    INT       — distinct days with >= 1 tx
--   arbitrum_avg_tx_per_active_day FLOAT     — total_tx / active_days
--   arbitrum_wallet_age_days       INT       — days between first and last tx
--   arbitrum_first_tx_ts           TIMESTAMP — first transaction timestamp
--   arbitrum_last_tx_ts            TIMESTAMP — most recent transaction timestamp
--   arbitrum_unique_to_addresses   INT       — distinct addresses interacted with
--
-- EXPECTED ROW COUNT: Same as Query 01 (~50K–150K wallets)
--
-- NOTES:
--   - Only counts SENT transactions (from_address = wallet).
--   - Only successful transactions (receipt_status = 1).
-- =============================================================================

WITH arbitrum_wallets AS (
    SELECT DISTINCT LOWER(borrower_address) AS wallet_address
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
)

SELECT
    aw.wallet_address,
    COUNT(t.hash)                                           AS arbitrum_total_tx_count,
    COUNT(DISTINCT DATE(t.block_timestamp))                 AS arbitrum_unique_active_days,
    CASE
        WHEN COUNT(DISTINCT DATE(t.block_timestamp)) > 0
        THEN COUNT(t.hash)::FLOAT / COUNT(DISTINCT DATE(t.block_timestamp))
        ELSE 0
    END                                                     AS arbitrum_avg_tx_per_active_day,
    DATEDIFF('day', MIN(t.block_timestamp), MAX(t.block_timestamp)) AS arbitrum_wallet_age_days,
    MIN(t.block_timestamp)                                  AS arbitrum_first_tx_ts,
    MAX(t.block_timestamp)                                  AS arbitrum_last_tx_ts,
    COUNT(DISTINCT t.to_address)                            AS arbitrum_unique_to_addresses
FROM arbitrum_wallets aw
LEFT JOIN arbitrum.raw.transactions t
    ON aw.wallet_address = LOWER(t.from_address)
    AND t.receipt_status = 1
GROUP BY aw.wallet_address
ORDER BY arbitrum_total_tx_count DESC;
