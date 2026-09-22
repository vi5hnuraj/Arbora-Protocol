-- =============================================================================
-- QUERY 01: Arbitrum Protocol Borrower Labels
-- =============================================================================
-- PURPOSE: Build the labeled dataset of all wallets that have ever borrowed on
--          Arbitrum lending protocols (Aave v3, Radiant, Compound v3).
--          The label is binary: was this wallet ever liquidated on Arbitrum?
--
-- OUTPUT COLUMNS:
--   borrower_address      VARCHAR   — wallet address (lowercase hex)
--   total_borrows         INT       — lifetime borrow event count on Arbitrum
--   total_repays          INT       — lifetime repay event count on Arbitrum
--   total_liquidations    INT       — lifetime liquidation count (0 = never liquidated)
--   was_liquidated        BOOLEAN   — TRUE if total_liquidations > 0 (our target label)
--   first_borrow_ts       TIMESTAMP — earliest borrow timestamp
--   last_borrow_ts        TIMESTAMP — most recent borrow timestamp
--   total_borrowed_usd    FLOAT     — lifetime borrowed USD (sum across all borrows)
--   total_repaid_usd      FLOAT     — lifetime repaid USD
--   total_liquidated_usd  FLOAT     — lifetime liquidated collateral USD (0 if never liquidated)
--
-- EXPECTED ROW COUNT: ~50K–150K wallets across Arbitrum lending protocols
--
-- NOTES:
--   - Pulls borrow, repay, and liquidation counts in a single query via
--     subquery aggregation + LEFT JOINs so that non-liquidated borrowers appear.
--   - Filter: project IN ('aave_v3', 'aave', 'radiant', 'compound_v3') on Arbitrum.
--   - Run this query FIRST. The output wallet list is the join key for all
--     subsequent feature queries (02–06).
-- =============================================================================

WITH borrows AS (
    SELECT
        LOWER(borrower_address)      AS borrower_address,
        COUNT(*)                     AS total_borrows,
        MIN(block_timestamp)         AS first_borrow_ts,
        MAX(block_timestamp)         AS last_borrow_ts,
        SUM(usd_amount)              AS total_borrowed_usd
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
    GROUP BY LOWER(borrower_address)
),

repays AS (
    SELECT
        LOWER(borrower_address) AS borrower_address,
        COUNT(*)                AS total_repays,
        SUM(usd_amount)         AS total_repaid_usd
    FROM arbitrum.lending.repayments
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
    GROUP BY LOWER(borrower_address)
),

liquidations AS (
    SELECT
        LOWER(borrower_address) AS borrower_address,
        COUNT(*)                AS total_liquidations,
        SUM(usd_amount)         AS total_liquidated_usd
    FROM arbitrum.lending.liquidations
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
    GROUP BY LOWER(borrower_address)
)

SELECT
    b.borrower_address,
    b.total_borrows,
    COALESCE(r.total_repays, 0)          AS total_repays,
    COALESCE(l.total_liquidations, 0)    AS total_liquidations,
    CASE
        WHEN COALESCE(l.total_liquidations, 0) > 0 THEN TRUE
        ELSE FALSE
    END                                  AS was_liquidated,
    b.first_borrow_ts,
    b.last_borrow_ts,
    b.total_borrowed_usd,
    COALESCE(r.total_repaid_usd, 0)      AS total_repaid_usd,
    COALESCE(l.total_liquidated_usd, 0)  AS total_liquidated_usd
FROM borrows b
LEFT JOIN repays r
    ON b.borrower_address = r.borrower_address
LEFT JOIN liquidations l
    ON b.borrower_address = l.borrower_address
ORDER BY b.total_borrows DESC;
