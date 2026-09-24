"""
Arbora Protocol — Single-Wallet Scoring SQL Queries
====================================================
Two parameterized SQL queries run concurrently via the Allium Explorer API
to compute all 10 model features for a single wallet address on Arbitrum.

Query A: Arbitrum Lending & Asset Profile (Aave v3 / Radiant + balances + 90-day net flow)
Query B: Multichain & Crosschain Activity (EVM tx counts, DEX trades, bridge usage)

Both use CTE-based aggregation to minimize round trips and run in parallel.
"""

# ──────────────────────────────────────────────────────────────────────────────
# QUERY A: Arbitrum Lending & Asset Profile (Aave v3 / Radiant + Balances)
# ──────────────────────────────────────────────────────────────────────────────
# Returns a SINGLE ROW with all Arbitrum native features for the given wallet.
# If the wallet has never borrowed on Arbitrum, lending features default to 0.

QUERY_A_ARBITRUM = """
WITH params AS (
    SELECT LOWER('{wallet_address}') AS wallet
),

borrow_stats AS (
    SELECT
        COUNT(*) AS borrow_count,
        COUNT(DISTINCT token_address) AS unique_borrow_tokens
    FROM arbitrum.lending.loans
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
      AND borrower_address = (SELECT wallet FROM params)
),

repay_stats AS (
    SELECT COUNT(*) AS repay_count
    FROM arbitrum.lending.repayments
    WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
      AND borrower_address = (SELECT wallet FROM params)
),

lending_days AS (
    SELECT COUNT(DISTINCT activity_date) AS lending_active_days
    FROM (
        SELECT DATE(block_timestamp) AS activity_date
        FROM arbitrum.lending.loans
        WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
          AND borrower_address = (SELECT wallet FROM params)
        UNION ALL
        SELECT DATE(block_timestamp) AS activity_date
        FROM arbitrum.lending.repayments
        WHERE project IN ('aave_v3', 'aave', 'radiant', 'compound_v3')
          AND borrower_address = (SELECT wallet FROM params)
    )
),

balances AS (
    SELECT
        COALESCE(SUM(usd_balance_current), 0) AS current_total_usd,
        COALESCE(SUM(CASE
            WHEN LOWER(token_address) IN (
                '0xaf88d065e77c8cc2239327c5edb3a432268e5831', -- Native USDC
                '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', -- Bridged USDC.e
                '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', -- USDT
                '0xda10009cbd5d07dd0cecc66161544737f1479079'  -- DAI
            ) THEN usd_balance_current ELSE 0
        END), 0) AS current_stablecoin_usd
    FROM arbitrum.assets.fungible_balances_latest
    WHERE address = (SELECT wallet FROM params)
),

net_flow AS (
    SELECT
        COALESCE(SUM(CASE WHEN to_address = p.wallet THEN COALESCE(usd_amount, 0) ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN from_address = p.wallet THEN COALESCE(usd_amount, 0) ELSE 0 END), 0)
        AS net_flow_usd_90d
    FROM crosschain.assets.transfers t
    CROSS JOIN params p
    WHERE chain = 'arbitrum'
      AND (t.from_address = p.wallet OR t.to_address = p.wallet)
      AND t.block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '90 days'
)

SELECT
    (SELECT wallet FROM params) AS wallet_address,
    COALESCE(bs.borrow_count, 0) AS borrow_count,
    COALESCE(rs.repay_count, 0) AS repay_count,
    CASE
        WHEN COALESCE(bs.borrow_count, 0) > 0
        THEN COALESCE(rs.repay_count, 0)::FLOAT / bs.borrow_count
        ELSE 0
    END AS borrow_repay_ratio,
    COALESCE(bs.unique_borrow_tokens, 0) AS unique_borrow_tokens,
    COALESCE(ld.lending_active_days, 0) AS lending_active_days,
    bl.current_total_usd,
    bl.current_stablecoin_usd,
    CASE
        WHEN bl.current_total_usd > 0
        THEN bl.current_stablecoin_usd / bl.current_total_usd
        ELSE 0
    END AS stablecoin_ratio,
    nf.net_flow_usd_90d
FROM borrow_stats bs
CROSS JOIN repay_stats rs
CROSS JOIN lending_days ld
CROSS JOIN balances bl
CROSS JOIN net_flow nf
"""


# ──────────────────────────────────────────────────────────────────────────────
# QUERY B: Multichain & Crosschain Features
# ──────────────────────────────────────────────────────────────────────────────
# Returns a SINGLE ROW with multichain activity metrics across Ethereum,
# Optimism, Polygon, and Base, centered around Arbitrum.

QUERY_B_CROSSCHAIN = """
WITH params AS (
    SELECT LOWER('{wallet_address}') AS wallet
),

chain_transfers AS (
    SELECT
        chain,
        COUNT(*) AS transfer_count
    FROM crosschain.assets.transfers
    WHERE from_address = (SELECT wallet FROM params)
      AND chain IN ('ethereum', 'arbitrum', 'polygon', 'optimism', 'base')
    GROUP BY chain
),

chain_summary AS (
    SELECT
        COALESCE(SUM(transfer_count), 0) AS crosschain_total_tx_count,
        COUNT(DISTINCT chain) AS chains_active_on
    FROM chain_transfers
),

dex_stats AS (
    SELECT COUNT(*) AS crosschain_dex_trade_count
    FROM crosschain.dex.trades
    WHERE transaction_from_address = (SELECT wallet FROM params)
      AND chain IN ('ethereum', 'arbitrum', 'polygon', 'optimism', 'base')
),

bridge_stats AS (
    SELECT
        CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END AS has_used_bridge
    FROM crosschain.bridges.transfers
    WHERE transaction_from_address = (SELECT wallet FROM params)
)

SELECT
    (SELECT wallet FROM params) AS wallet_address,
    cs.crosschain_total_tx_count,
    cs.chains_active_on,
    COALESCE(ds.crosschain_dex_trade_count, 0) AS crosschain_dex_trade_count,
    br.has_used_bridge
FROM chain_summary cs
CROSS JOIN dex_stats ds
CROSS JOIN bridge_stats br
"""


def build_query_a(wallet_address: str) -> str:
    """Parameterize Query A (Arbitrum lending & balances) with a wallet address."""
    return QUERY_A_ARBITRUM.format(wallet_address=wallet_address.lower().strip())


def build_query_b(wallet_address: str) -> str:
    """Parameterize Query B (Multichain activity) with a wallet address."""
    return QUERY_B_CROSSCHAIN.format(wallet_address=wallet_address.lower().strip())
