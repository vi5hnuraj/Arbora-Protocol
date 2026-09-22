# Allium Explorer SQL Queries — Arbora Protocol (Arbitrum Ecosystem)

## Overview

Arbora extracts onchain credit and underwriting signals natively from the **Arbitrum** ecosystem (Aave v3, Radiant Capital, Camelot DEX) with multichain activity tracking across Ethereum, Optimism, Polygon, and Base.

## How to Use

1. Open [Allium Explorer](https://app.allium.so) and log in.
2. Run each query **in order** (01 through 06). Query 01 must run first — the others depend on its borrower population.
3. Export each result as CSV.
4. Save each CSV in `data/raw/` with the filename matching the query number:
   - `01_arbitrum_borrower_labels.csv`
   - `02_arbitrum_activity_features.csv`
   - `03_arbitrum_lending_features.csv`
   - `04_arbitrum_defi_features.csv`
   - `05_arbitrum_financial_features.csv`
   - `06_crosschain_activity_features.csv`
5. The training pipeline (`model/train.py`) picks them up from `data/raw/`.

## Query Summary

| # | File | Purpose | Key Tables | Est. Rows | Est. Runtime |
|---|------|---------|------------|-----------|-------------|
| 01 | `01_arbitrum_borrower_labels.sql` | Build labeled dataset: Arbitrum borrowers + liquidation flag | `arbitrum.lending.loans`, `arbitrum.lending.repayments`, `arbitrum.lending.liquidations` | 50K–150K | < 1 min |
| 02 | `02_arbitrum_activity_features.sql` | Arbitrum on-chain activity (tx count, wallet age, active days) | `arbitrum.raw.transactions` | Same as Q01 | 1–5 min |
| 03 | `03_arbitrum_lending_features.sql` | Arbitrum lending behavior (borrow/repay counts, ratios, duration) | `arbitrum.lending.loans`, `arbitrum.lending.repayments` | Same as Q01 | < 1 min |
| 04 | `04_arbitrum_defi_features.sql` | DeFi sophistication (Camelot/Uniswap DEX, bridge, protocol diversity) | `crosschain.dex.trades`, `crosschain.bridges.transfers` | Same as Q01 | 1–3 min |
| 05 | `05_arbitrum_financial_features.sql` | Financial profile (ETH/stablecoin balances, USDG, net flow) | `arbitrum.assets.fungible_balances_latest`, `crosschain.assets.transfers` | Same as Q01 | 1–3 min |
| 06 | `06_crosschain_activity_features.sql` | Multichain activity (tx counts across ETH, OP, POLY, BASE) | `crosschain.assets.transfers`, `crosschain.dex.trades` | Same as Q01 | 2–5 min |

## Output Schema Reference

### Query 01 — Arbitrum Borrower Labels
| Column | Type | Description |
|--------|------|-------------|
| `borrower_address` | VARCHAR | Wallet address (join key for all queries) |
| `total_borrows` | INT | Lifetime Arbitrum borrow events |
| `total_repays` | INT | Lifetime Arbitrum repay events |
| `total_liquidations` | INT | Lifetime liquidation count (0 = never liquidated) |
| `was_liquidated` | BOOLEAN | **TARGET LABEL** — TRUE if ever liquidated |
| `first_borrow_ts` | TIMESTAMP | Earliest borrow |
| `last_borrow_ts` | TIMESTAMP | Most recent borrow |
| `total_borrowed_usd` | FLOAT | Lifetime borrowed USD |
| `total_repaid_usd` | FLOAT | Lifetime repaid USD |
| `total_liquidated_usd` | FLOAT | Lifetime liquidated collateral USD |

### Query 02 — Arbitrum Activity Features
| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | VARCHAR | Join key |
| `arbitrum_total_tx_count` | INT | Total sent transactions on Arbitrum |
| `arbitrum_unique_active_days` | INT | Distinct days with >= 1 tx |
| `arbitrum_avg_tx_per_active_day` | FLOAT | Avg transactions per active day |
| `arbitrum_wallet_age_days` | INT | Days between first and last tx |
| `arbitrum_first_tx_ts` | TIMESTAMP | First Arbitrum transaction |
| `arbitrum_last_tx_ts` | TIMESTAMP | Most recent Arbitrum transaction |
| `arbitrum_unique_to_addresses` | INT | Distinct addresses interacted with |

### Query 03 — Arbitrum Lending Features
| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | VARCHAR | Join key |
| `borrow_count` | INT | Total Arbitrum borrow events |
| `repay_count` | INT | Total Arbitrum repay events |
| `borrow_repay_ratio` | FLOAT | Repay/borrow ratio (>1 = positive signal) |
| `total_borrowed_usd` | FLOAT | Lifetime borrowed USD |
| `total_repaid_usd` | FLOAT | Lifetime repaid USD |
| `avg_borrow_usd` | FLOAT | Average borrow USD |
| `max_borrow_usd` | FLOAT | Largest borrow USD |
| `unique_borrow_tokens` | INT | Distinct tokens borrowed |
| `unique_markets` | INT | Distinct lending markets used |
| `lending_active_days` | INT | Distinct days with lending activity |
| `first_lending_ts` | TIMESTAMP | First lending interaction |
| `last_lending_ts` | TIMESTAMP | Most recent lending interaction |

### Query 04 — Arbitrum DeFi Features
| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | VARCHAR | Join key |
| `has_used_dex` | BOOLEAN | Any DEX swap on Arbitrum |
| `arbitrum_dex_trade_count` | INT | Total DEX trades on Arbitrum |
| `arbitrum_dex_volume_usd` | FLOAT | Total DEX volume in USD |
| `arbitrum_unique_dex_projects` | INT | Distinct DEX projects (Camelot, Uniswap, etc.) |
| `has_used_bridge` | BOOLEAN | Bridge transfer involving Arbitrum |
| `arbitrum_bridge_tx_count` | INT | Bridge transfer count |
| `protocol_diversity_score` | INT | Distinct DeFi categories used |

### Query 05 — Arbitrum Financial Features
| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | VARCHAR | Join key |
| `current_total_usd` | FLOAT | Current Arbitrum portfolio value in USD |
| `current_native_usd` | FLOAT | Current native ETH balance in USD |
| `current_stablecoin_usd` | FLOAT | Stablecoin holdings (USDC, USDT, DAI, USDG) |
| `stablecoin_ratio` | FLOAT | Stablecoins as fraction of portfolio |
| `token_diversity` | INT | Distinct tokens currently held |
| `net_flow_usd_90d` | FLOAT | Net flow USD over trailing 90 days |

### Query 06 — Multichain Activity Features
| Column | Type | Description |
|--------|------|-------------|
| `wallet_address` | VARCHAR | Join key |
| `chains_active_on` | INT | Count of non-Arbitrum EVM chains active |
| `eth_tx_count` | INT | Ethereum transaction count |
| `optimism_tx_count` | INT | Optimism transaction count |
| `polygon_tx_count` | INT | Polygon transaction count |
| `base_tx_count` | INT | Base transaction count |
| `crosschain_total_tx_count` | INT | Sum of non-Arbitrum transactions |
| `crosschain_dex_trade_count` | INT | Non-Arbitrum DEX trades |
| `crosschain_dex_volume_usd` | FLOAT | Non-Arbitrum DEX volume USD |
