"""
Arbora Protocol — Single-wallet inference
===========================================
Scores a single wallet using the frozen model in model/model.pkl.
Applies the identical binning, one-hot encoding, and scaling that
train.py used, driven entirely by feature_config.json so training
and inference stay in lockstep.

Usage (programmatic):
    from model.score import score_wallet

    raw_features = {
        "lending_active_days": 7,
        "borrow_repay_ratio": 1.0,
        "repay_count": 5,
        "unique_borrow_tokens": 2,
        "current_total_usd": 450.0,
        "stablecoin_ratio": 0.6,
        "crosschain_total_tx_count": 120,
        "crosschain_dex_trade_count": 30,
        "chains_active_on": 2,
        "has_used_bridge": 1,
        "net_flow_usd_90d": 250.0,   # raw; converted to net_flow_direction
    }
    result = score_wallet(raw_features)
    # {
    #   "credit_score": 73,
    #   "prob_not_liquidated": 0.73,
    #   "intercept": 0.6724,
    #   "factor_breakdown": [
    #       {"feature": "lending_active_days",
    #        "display_name": "Borrowing protocol activity (days)",
    #        "bin": "[5, 14]",
    #        "contribution_logit": -1.05,   # before scaler
    #        "contribution_score_points": -12.3, ...},
    #       ...
    #   ]
    # }

Usage (CLI, for quick sanity checks):
    python3 model/score.py examples/test_wallet.json
"""

import json
import math
import pickle
import sys
from pathlib import Path
from typing import Any

import numpy as np

MODEL_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = MODEL_DIR.parent.parent


# ---------------------------------------------------------------------------
# Load artifacts (lazy — module-level cache)
# ---------------------------------------------------------------------------
_ARTIFACT_CACHE: dict[str, Any] = {}


def _load() -> dict:
    if "config" in _ARTIFACT_CACHE:
        return _ARTIFACT_CACHE
    with open(MODEL_DIR / "model.pkl", "rb") as f:
        pkl = pickle.load(f)
    with open(MODEL_DIR / "feature_config.json", "r") as f:
        cfg = json.load(f)

    # Restore +/- inf in bin_edges
    for feat_name, spec in cfg["feature_specs"].items():
        if "bin_edges" in spec:
            spec["bin_edges"] = [
                -math.inf if e == "-Infinity"
                else math.inf if e == "Infinity"
                else e
                for e in spec["bin_edges"]
            ]

    _ARTIFACT_CACHE.update({
        "model": pkl["model"],
        "scaler": pkl["scaler"],
        "feature_cols": pkl["feature_cols"],
        "feature_specs": cfg["feature_specs"],
        "feature_display_names": cfg["feature_display_names"],
        "intercept": cfg["intercept"],
        "coefficients": cfg["coefficients"],
        "scaler_mean": np.array(cfg["scaler_mean"]),
        "scaler_scale": np.array(cfg["scaler_scale"]),
        "config": cfg,
    })
    return _ARTIFACT_CACHE


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _bin_value(value: float, edges: list, labels: list) -> str:
    """Right-closed binning that matches pd.cut(include_lowest=True, right=True)."""
    # edges: [-inf, e1, e2, ..., inf]
    # bin i is (edges[i], edges[i+1]] for i>=1, and [edges[0], edges[1]] for i=0
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        if i == 0:
            # Lowest bin is inclusive on both ends
            if lo <= value <= hi:
                return labels[i]
        else:
            if lo < value <= hi:
                return labels[i]
    # Fallback: value exceeds the top edge (shouldn't happen when top is +inf)
    return labels[-1]


def _derive_raw_features(raw: dict) -> dict:
    """Compute derived features from raw inputs (same logic as train.py).

    The caller may pass either:
      - net_flow_direction (already 0/1), or
      - net_flow_usd_90d (raw USD flow; we derive direction).
    """
    out = dict(raw)
    if "net_flow_direction" not in out:
        flow = out.get("net_flow_usd_90d", 0) or 0
        out["net_flow_direction"] = 1 if flow > 0 else 0
    return out


# ---------------------------------------------------------------------------
# Main inference
# ---------------------------------------------------------------------------
def build_feature_vector(raw: dict) -> tuple[np.ndarray, dict]:
    """Return (feature_vector, per_feature_bin_assignment)."""
    art = _load()
    specs = art["feature_specs"]
    feature_cols = art["feature_cols"]

    raw = _derive_raw_features(raw)

    # Validate all required raw inputs present
    for feat_name, spec in specs.items():
        if feat_name not in raw:
            raise KeyError(
                f"Missing raw feature: '{feat_name}'. "
                f"Required inputs: {list(specs.keys())}"
            )

    # Assign bin / dummy values for each raw feature
    dummies: dict[str, int] = {}
    assignments: dict[str, str] = {}  # feat_name -> bin/group label (for display)

    for feat_name, spec in specs.items():
        value = raw[feat_name]

        if spec["type"] == "continuous_binned":
            edges = spec["bin_edges"]
            labels = spec["bin_labels"]
            bin_label = _bin_value(float(value), edges, labels)
            assignments[feat_name] = bin_label
            for i, lab in enumerate(labels):
                if i == spec["reference_bin_idx"]:
                    continue
                col = f"{feat_name}__{lab}"
                dummies[col] = 1 if lab == bin_label else 0

        elif spec["type"] == "small_int_grouped":
            groups = spec["groups"]
            v = int(value)
            matched_group = None
            for gname, gvals in groups.items():
                if v in gvals:
                    matched_group = gname
                    break
            if matched_group is None:
                raise ValueError(
                    f"{feat_name}: value {v} not in any group. "
                    f"Valid groups: {list(groups.keys())}"
                )
            assignments[feat_name] = matched_group
            for gname in groups:
                if gname == spec["reference_group"]:
                    continue
                col = f"{feat_name}__{gname}"
                dummies[col] = 1 if gname == matched_group else 0

        elif spec["type"] == "boolean":
            dummies[feat_name] = int(bool(value))
            assignments[feat_name] = "1" if dummies[feat_name] == 1 else "0"

        else:
            raise ValueError(f"Unknown feature type for {feat_name}: {spec['type']}")

    # Assemble vector in the exact column order the model expects
    vec = np.array([dummies[c] for c in feature_cols], dtype=float)
    return vec, assignments


def score_wallet(raw: dict) -> dict:
    """Run the full scoring pipeline: build vector → scale → logit → 0-100 score."""
    art = _load()
    model = art["model"]
    scaler = art["scaler"]
    feature_cols = art["feature_cols"]
    display_names = art["feature_display_names"]
    specs = art["feature_specs"]

    vec, assignments = build_feature_vector(raw)
    vec_scaled = scaler.transform(vec.reshape(1, -1))
    prob_not_liq = float(model.predict_proba(vec_scaled)[0, 1])
    credit_score = int(round(prob_not_liq * 100))

    # Build factor breakdown: which bin the wallet fell into for each feature,
    # and the (raw) coefficient that applies.
    breakdown = []
    for feat_name, spec in specs.items():
        bin_label = assignments[feat_name]
        display = display_names.get(feat_name, feat_name)

        if spec["type"] == "boolean":
            col = feat_name
            coef = float(art["coefficients"].get(col, 0.0))
            breakdown.append({
                "feature": feat_name,
                "display_name": display,
                "bin": bin_label,
                "coefficient": coef,
                "is_reference": False,
            })
        elif spec["type"] == "continuous_binned":
            ref_label = spec["bin_labels"][spec["reference_bin_idx"]]
            is_ref = (bin_label == ref_label)
            col = f"{feat_name}__{bin_label}"
            coef = 0.0 if is_ref else float(art["coefficients"].get(col, 0.0))
            breakdown.append({
                "feature": feat_name,
                "display_name": display,
                "bin": bin_label,
                "coefficient": coef,
                "is_reference": is_ref,
            })
        elif spec["type"] == "small_int_grouped":
            ref = spec["reference_group"]
            is_ref = (bin_label == ref)
            col = f"{feat_name}__{bin_label}"
            coef = 0.0 if is_ref else float(art["coefficients"].get(col, 0.0))
            breakdown.append({
                "feature": feat_name,
                "display_name": display,
                "bin": bin_label,
                "coefficient": coef,
                "is_reference": is_ref,
            })

    # Sort by coefficient magnitude (most impactful first)
    breakdown.sort(key=lambda r: abs(r["coefficient"]), reverse=True)

    return {
        "credit_score": credit_score,
        "prob_not_liquidated": prob_not_liq,
        "intercept": float(art["intercept"]),
        "factor_breakdown": breakdown,
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _cli():
    if len(sys.argv) < 2:
        print("Usage: python3 model/score.py <raw_features.json>")
        print()
        print("Example raw_features.json:")
        print(json.dumps({
            "lending_active_days": 7,
            "borrow_repay_ratio": 1.0,
            "repay_count": 5,
            "unique_borrow_tokens": 2,
            "current_total_usd": 450.0,
            "stablecoin_ratio": 0.6,
            "crosschain_total_tx_count": 120,
            "crosschain_dex_trade_count": 30,
            "chains_active_on": 2,
            "has_used_bridge": 1,
            "net_flow_usd_90d": 250.0,
        }, indent=2))
        sys.exit(1)

    with open(sys.argv[1], "r") as f:
        raw = json.load(f)

    result = score_wallet(raw)
    print(f"Credit score: {result['credit_score']}")
    print(f"P(not liquidated): {result['prob_not_liquidated']:.4f}")
    print()
    print("Factor breakdown (most impactful first):")
    print(f"  {'Feature':<40s}  {'Bin':<15s}  {'Coef':>8s}")
    for item in result["factor_breakdown"]:
        tag = " (ref)" if item["is_reference"] else ""
        print(
            f"  {item['display_name']:<40s}  "
            f"{item['bin']:<15s}  "
            f"{item['coefficient']:+8.4f}{tag}"
        )


if __name__ == "__main__":
    _cli()
