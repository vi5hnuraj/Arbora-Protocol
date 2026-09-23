# Arbora Protocol — Model Validation Report

**Model**: Logistic regression (L2, class_weight='balanced', 5-fold stratified CV).
**Design**: FICO-style scorecard. Every continuous feature binned into 3–5 discrete buckets.
The lowest-risk bin is the reference category and is dropped from one-hot encoding. 
Every retained coefficient represents the credit-score penalty for being in that bin 
relative to the safest bucket.

## Summary Metrics

| Metric | Value |
|---|---|
| **AUC-ROC (5-fold CV)** | **0.8182** |
| Precision | 0.9508 |
| Recall | 0.7208 |
| F1 | 0.8200 |
| Training samples | 115,687 |
| Positive class rate | 86.3% (not liquidated) |
| Feature columns (post one-hot) | 24 |
| Intercept | +0.6724 |

### Confusion Matrix

```
                  Predicted
                  Liquidated  Not Liquidated
Actual Liquidated     12167          3722
Actual Not Liq.       27861         71937
```

```
                precision    recall  f1-score   support

    Liquidated       0.30      0.77      0.44     15889
Not Liquidated       0.95      0.72      0.82     99798

      accuracy                           0.73    115687
     macro avg       0.63      0.74      0.63    115687
  weighted avg       0.86      0.73      0.77    115687

```

## Calibration

How well do predicted probabilities match actual outcomes?

| Mean Predicted P(not liq) | Actual P(not liq) |
|---|---|
| 0.142 | 0.550 |
| 0.274 | 0.688 |
| 0.388 | 0.782 |
| 0.502 | 0.857 |
| 0.603 | 0.899 |
| 0.705 | 0.924 |
| 0.782 | 0.965 |
| 0.840 | 0.973 |
| 0.923 | 0.991 |
| 0.963 | 0.997 |

## Coefficient Table (grouped by source feature)

Positive coefficient = bin raises credit score vs reference. 
Negative coefficient = bin lowers credit score vs reference. 
In a correctly-specified scorecard, every bin dummy should be ≤ 0 (reference is the safest bin); 
boolean features can go either direction depending on what the feature captures.

### Loan repayment count
*(internal name: `repay_count` — Arbitrum lending repay event count (Aave v3 / Radiant))*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[0, 3]` | 0.0000 | **reference (safest)** |
| `[4, 9]` | +0.0221 | |
| `[10, inf)` | +0.0422 | |

### Repayment consistency ratio
*(internal name: `borrow_repay_ratio` — Repay/borrow ratio (1 = balanced))*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[0, 0.9]` | -0.2502 | |
| `(0.9, 1.1]` | 0.0000 | **reference (safest)** |
| `(1.1, 2.0]` | -0.5356 | |
| `(2.0, inf)` | -0.5977 | |

### Distinct assets borrowed
*(internal name: `unique_borrow_tokens` — Distinct tokens borrowed on Arbitrum)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[1, 1]` | 0.0000 | **reference (safest)** |
| `[2, 2]` | -0.0156 | |
| `[3, inf)` | -0.0572 | |

### Borrowing protocol activity (days)
*(internal name: `lending_active_days` — Days with active Arbitrum lending interactions)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[1, 1]` | 0.0000 | **reference (safest)** |
| `[2, 4]` | -0.8024 | |
| `[5, 14]` | -1.0536 | |
| `[15, inf)` | -1.2260 | |

### Portfolio value (USD)
*(internal name: `current_total_usd` — Current Arbitrum portfolio value USD)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[0, 10]` | 0.0000 | **reference (safest)** |
| `(10, 100]` | -0.0750 | |
| `(100, 1000]` | -0.1681 | |
| `(1000, inf)` | -0.1106 | |

### Stablecoin allocation
*(internal name: `stablecoin_ratio` — Stablecoins as fraction of portfolio)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[0, 0.05]` | -0.2632 | |
| `(0.05, 0.5]` | -0.1725 | |
| `(0.5, 1.0]` | 0.0000 | **reference (safest)** |

### Cross-chain transaction volume
*(internal name: `crosschain_total_tx_count` — Total multichain transactions across ETH/ARB/POLY/OP/BASE)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[0, 0]` | 0.0000 | **reference (safest)** |
| `[1, 100]` | +0.0210 | |
| `[101, 1000]` | +0.0118 | |
| `[1001, inf)` | +0.0298 | |

### Cross-chain DEX activity
*(internal name: `crosschain_dex_trade_count` — Multichain DEX trade count)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `[0, 0]` | 0.0000 | **reference (safest)** |
| `[1, 100]` | -0.0617 | |
| `[101, inf)` | -0.0788 | |

### Blockchain networks used
*(internal name: `chains_active_on` — EVM chains with recorded activity)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `0` | 0.0000 | **reference (safest)** |
| `1-3` | -0.0032 | |
| `4` | +0.0674 | |

### Cross-chain bridge experience
*(internal name: `has_used_bridge` — Has used a cross-chain bridge)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `has_used_bridge` (0 / 1) | +0.1440 | boolean |

### Recent accumulation trend
*(internal name: `net_flow_direction` — Accumulating (1) or depleting (0) over 90d)*

| Bin / Level | Coefficient | Role |
|---|---|---|
| `net_flow_direction` (0 / 1) | +0.2249 | boolean |

## Top 15 Coefficients by Absolute Magnitude

| Rank | Feature Column | Coefficient |
|---|---|---|
| 1 | `lending_active_days__[15, inf)` | -1.2260 |
| 2 | `lending_active_days__[5, 14]` | -1.0536 |
| 3 | `lending_active_days__[2, 4]` | -0.8024 |
| 4 | `borrow_repay_ratio__(2.0, inf)` | -0.5977 |
| 5 | `borrow_repay_ratio__(1.1, 2.0]` | -0.5356 |
| 6 | `stablecoin_ratio__[0, 0.05]` | -0.2632 |
| 7 | `borrow_repay_ratio__[0, 0.9]` | -0.2502 |
| 8 | `net_flow_direction` | +0.2249 |
| 9 | `stablecoin_ratio__(0.05, 0.5]` | -0.1725 |
| 10 | `current_total_usd__(100, 1000]` | -0.1681 |
| 11 | `has_used_bridge` | +0.1440 |
| 12 | `current_total_usd__(1000, inf)` | -0.1106 |
| 13 | `crosschain_dex_trade_count__[101, inf)` | -0.0788 |
| 14 | `current_total_usd__(10, 100]` | -0.0750 |
| 15 | `chains_active_on__4` | +0.0674 |

## Credit Score Distribution by Actual Class

| Statistic | Liquidated Wallets | Non-Liquidated Wallets |
|---|---|---|
| Mean | 34.1 | 64.9 |
| Median | 29 | 71 |
| Std | 20.9 | 25.1 |
| Min / Max | 2 / 98 | 2 / 98 |

## Score Percentiles (all wallets)

| Percentile | Score |
|---|---|
| 5th | 14 |
| 25th | 38 |
| 50th | 65 |
| 75th | 83 |
| 95th | 96 |

## Notes

- Each continuous feature is binned with the lowest-risk bucket as reference.
- `borrow_repay_ratio` uses the balanced bin (0.9, 1.1] as reference; all other bins should have negative coefficients representing the risk of deviating from 1:1 repayment.
- `crosschain_dex_trade_count` uses heavy traders (501+) as reference; sophisticated DEX usage is empirically the safest bucket.
- `stablecoin_ratio` uses stable-heavy wallets (>50%) as reference.
- Two booleans (`has_used_bridge`, `net_flow_direction`) are passed through as 0/1. `net_flow_direction`=1 (accumulating) is expected to have a positive coefficient.