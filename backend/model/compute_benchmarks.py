"""
Compute top-decile benchmarks for each raw feature.
Loads raw CSVs, scores all wallets, finds top decile (score >= 80),
computes mean raw value, and updates feature_config.json with benchmarks.
"""

import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MODEL_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
RAW_DIR = BACKEND_DIR / "data" / "raw"


def main():
    def _read_candidate(primary: str) -> pd.DataFrame:
        p = RAW_DIR / primary
        if p.exists():
            return pd.read_csv(p)
        raise FileNotFoundError(f"{primary} not found in {RAW_DIR}")

    # --- Load raw CSVs and merge ---
    labels = _read_candidate("01_arbitrum_borrower_labels.csv").rename(
        columns={"borrower_address": "wallet_address"}
    )
    lending = _read_candidate("03_arbitrum_lending_features.csv")
    defi = _read_candidate("04_arbitrum_defi_features.csv")
    financial = _read_candidate("05_arbitrum_financial_features.csv")
    crosschain = _read_candidate("06_crosschain_activity_features.csv")

    df = labels
    for other in [lending, defi, financial, crosschain]:
        df = df.merge(other, on="wallet_address", how="left", suffixes=("", "_dup"))
    df = df.drop(columns=[c for c in df.columns if c.endswith("_dup")])

    # Fill nulls and compute derived features (same as train.py)
    zero_cols = [
        "repay_count", "borrow_repay_ratio", "unique_borrow_tokens",
        "lending_active_days", "current_total_usd", "stablecoin_ratio",
        "crosschain_total_tx_count", "crosschain_dex_trade_count",
        "chains_active_on", "net_flow_usd_90d",
    ]
    for c in zero_cols:
        if c in df.columns:
            df[c] = df[c].fillna(0)

    df["has_used_bridge"] = df["has_used_bridge"].fillna(False).astype(int)
    df["chains_active_on"] = df["chains_active_on"].astype(int)
    df["net_flow_direction"] = (df["net_flow_usd_90d"] > 0).astype(int)

    print(f"Loaded {len(df):,} wallets")

    # --- Load model and score all wallets ---
    sys.path.insert(0, str(MODEL_DIR))
    from score import score_wallet

    raw_features_list = [
        "lending_active_days", "borrow_repay_ratio", "repay_count",
        "unique_borrow_tokens", "current_total_usd", "stablecoin_ratio",
        "crosschain_total_tx_count", "crosschain_dex_trade_count",
        "chains_active_on", "has_used_bridge",
    ]

    # Score all wallets using the frozen model
    scores = []
    errors = 0
    for idx, row in df.iterrows():
        raw = {
            "lending_active_days": row["lending_active_days"],
            "borrow_repay_ratio": row["borrow_repay_ratio"],
            "repay_count": row["repay_count"],
            "unique_borrow_tokens": row["unique_borrow_tokens"],
            "current_total_usd": row["current_total_usd"],
            "stablecoin_ratio": row["stablecoin_ratio"],
            "crosschain_total_tx_count": row["crosschain_total_tx_count"],
            "crosschain_dex_trade_count": row["crosschain_dex_trade_count"],
            "chains_active_on": row["chains_active_on"],
            "has_used_bridge": row["has_used_bridge"],
            "net_flow_direction": row["net_flow_direction"],
        }
        try:
            result = score_wallet(raw)
            scores.append(result["credit_score"])
        except Exception as e:
            errors += 1
            scores.append(None)

    df["credit_score"] = scores
    print(f"Scored {len(df) - errors:,} wallets ({errors} errors)")

    # --- Find top decile (score >= 80) ---
    top_decile = df[df["credit_score"] >= 80].copy()
    print(f"Top decile (score >= 80): {len(top_decile):,} wallets")

    if len(top_decile) == 0:
        # Fallback: use top 10% by score
        threshold = df["credit_score"].quantile(0.9)
        top_decile = df[df["credit_score"] >= threshold].copy()
        print(f"Fallback: top 10% (score >= {threshold}): {len(top_decile):,} wallets")

    # --- Compute mean raw values ---
    benchmarks = {}

    for feat in raw_features_list:
        mean_val = top_decile[feat].mean()
        benchmarks[feat] = {"top_decile_mean": round(float(mean_val), 4)}

    # Format display strings and action items
    display_map = {
        "lending_active_days": lambda m: (
            f"{int(round(m))} day{'s' if round(m) != 1 else ''}",
            "Maintain minimal borrowing activity -- fewer active days correlates with lower liquidation risk"
        ),
        "borrow_repay_ratio": lambda m: (
            f"~{m:.2f} (balanced)",
            "Keep repayments closely matched to borrows for a ratio near 1.0"
        ),
        "repay_count": lambda m: (
            f"~{int(round(m))} repayments",
            "Build a track record of successful loan repayments"
        ),
        "unique_borrow_tokens": lambda m: (
            f"~{int(round(m))} token{'s' if round(m) != 1 else ''}",
            "Focus borrowing on fewer asset types to demonstrate disciplined strategy"
        ),
        "current_total_usd": lambda m: (
            f"${m:,.2f}" if m < 1000 else f"${m:,.0f}",
            "Maintain a modest on-chain portfolio -- smaller portfolios have lower liquidation exposure"
        ),
        "stablecoin_ratio": lambda m: (
            f"{m*100:.0f}% stablecoins",
            "Allocate a significant portion of your portfolio to stablecoins for risk reduction"
        ),
        "crosschain_total_tx_count": lambda m: (
            f"~{int(round(m))} transactions",
            "Focused activity on Arbitrum signals lower liquidation risk"
        ),
        "crosschain_dex_trade_count": lambda m: (
            f"~{int(round(m))} trades",
            "Limited cross-chain DEX trading indicates concentrated, lower-risk behavior"
        ),
        "chains_active_on": lambda m: (
            f"~{m:.1f} chains",
            "Focused activity on fewer chains signals disciplined portfolio management"
        ),
        "has_used_bridge": lambda m: (
            f"{m*100:.0f}% have used bridges",
            "Bridge experience indicates cross-chain sophistication but is not required"
        ),
    }

    for feat in raw_features_list:
        mean_val = benchmarks[feat]["top_decile_mean"]
        display, action = display_map[feat](mean_val)
        benchmarks[feat]["display"] = display
        benchmarks[feat]["action_item"] = action

    # Print results
    print("\n=== Top-Decile Benchmarks ===")
    for feat in raw_features_list:
        b = benchmarks[feat]
        print(f"  {feat}: mean={b['top_decile_mean']}, display=\"{b['display']}\"")

    # --- Update feature_config.json ---
    config_path = MODEL_DIR / "feature_config.json"
    with open(config_path, "r") as f:
        config = json.load(f)

    config["benchmarks"] = benchmarks

    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)

    print(f"\nUpdated {config_path}")
    print("Done.")


if __name__ == "__main__":
    main()
