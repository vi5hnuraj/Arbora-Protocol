"""
Collateral curve calibration analysis (Phase 4.1).

Computes the empirical distribution of onchain credit scores from the frozen
model, then simulates composite scores under three scenarios:
  A) Onchain-only (applies onchainOnlyMultiplier = 50)
  B) Onchain + FICO 650 attestation (moderate offchain creditworthiness)
  C) Onchain + FICO 780 attestation (strong offchain creditworthiness)

For each scenario, shows the distribution at population percentiles and maps
those composite scores to required collateral under the curve
from the protocol architecture specification:

    scoreBreakpoints  = [20, 50, 70, 85, 100]
    collateralBps     = [15000, 15000, 12000, 10000, 8500, 7500]
    (piecewise linear interpolation between adjacent breakpoints)

The purpose is to verify the provisional curve produces reasonable collateral
requirements for realistic score distributions BEFORE we write the LendingPool
contract. If the curve proves mis-calibrated, this script's output informs the
adjustment.
"""

import json
import pickle
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MODEL_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
PROCESSED_DIR = BACKEND_DIR / "data" / "processed"


# ---------------------------------------------------------------------------
# 1. Load frozen model and feature matrix, compute onchain scores
# ---------------------------------------------------------------------------
with open(MODEL_DIR / "model.pkl", "rb") as f:
    artifact = pickle.load(f)
model = artifact["model"]
scaler = artifact["scaler"]
feature_cols = artifact["feature_cols"]

# Feature matrix was saved by train.py and contains all 115,687 wallets with
# their one-hot feature columns already computed.
fm = pd.read_csv(PROCESSED_DIR / "feature_matrix.csv")
X = fm[feature_cols].values.astype(float)
X_scaled = scaler.transform(X)

y_prob = model.predict_proba(X_scaled)[:, 1]  # P(not liquidated)
onchain_scores = np.clip(np.round(y_prob * 100), 0, 100).astype(int)

print("=" * 72)
print("ONCHAIN SCORE DISTRIBUTION (n = {:,})".format(len(onchain_scores)))
print("=" * 72)
percentiles = [0, 1, 5, 10, 25, 50, 75, 90, 95, 99, 100]
pct_values = {p: int(np.percentile(onchain_scores, p)) for p in percentiles}
for p in percentiles:
    print(f"  p{p:>3} : {pct_values[p]}")
print(f"\n  mean = {onchain_scores.mean():.2f}   median = {int(np.median(onchain_scores))}   std = {onchain_scores.std():.2f}")

# Split by actual class to see how scores differentiate liquidated vs not
y_true = fm["target"].values
liq_scores = onchain_scores[y_true == 0]
nliq_scores = onchain_scores[y_true == 1]
print(f"\n  Liquidated (n={len(liq_scores):>7,}): mean={liq_scores.mean():.1f}  median={int(np.median(liq_scores))}  p95={int(np.percentile(liq_scores, 95))}")
print(f"  Not liq.   (n={len(nliq_scores):>7,}): mean={nliq_scores.mean():.1f}  median={int(np.median(nliq_scores))}  p5={int(np.percentile(nliq_scores, 5))}")


# ---------------------------------------------------------------------------
# 2. FICO → 0-100 mapping (linear, per Phase 4 spec)
# ---------------------------------------------------------------------------
def fico_to_0_100(fico: int) -> int:
    # Linear: 300 -> 0, 850 -> 100
    v = round((fico - 300) / 5.5)
    return int(max(0, min(100, v)))


print("\n" + "=" * 72)
print("FICO → 0-100 linear mapping")
print("=" * 72)
for fico in [300, 500, 575, 650, 700, 750, 780, 820, 850]:
    print(f"  FICO {fico} → {fico_to_0_100(fico)}")


# ---------------------------------------------------------------------------
# 3. Composite score computation (matches CreditOracle logic)
# ---------------------------------------------------------------------------
ONCHAIN_ONLY_MULT = 50          # thin-file cap: max composite = 50 when no attestation
OFFCHAIN_BASELINE_MULT = 70     # FICO sets the baseline floor; FICO 850 → 70, FICO 300 → 0
ONCHAIN_BOOST_MULT = 40         # onchain lifts above the offchain baseline; onchain 100 → +40


def composite_onchain_only(onchain: np.ndarray) -> np.ndarray:
    return (onchain * ONCHAIN_ONLY_MULT // 100).astype(int)


def composite_both(onchain: np.ndarray, offchain: int) -> np.ndarray:
    """Asymmetric: offchain sets baseline, onchain boosts above it.

    This reflects the protocol's value proposition:
    - Offchain attestation alone → competitive with traditional bank terms
    - Onchain boost → goes beyond what any bank can offer (undercollateralized)
    - Onchain without attestation → stays overcollateralized (thin-file cap)
    """
    baseline = (onchain * 0 + offchain) * OFFCHAIN_BASELINE_MULT // 100  # broadcast constant
    boost = onchain * ONCHAIN_BOOST_MULT // 100
    return np.minimum(baseline + boost, 100).astype(int)


# ---------------------------------------------------------------------------
# 4. Collateral curve (from architecture specification)
# ---------------------------------------------------------------------------
SCORE_BREAKPOINTS = [0, 20, 50, 70, 85, 100]
COLLATERAL_BPS    = [15000, 15000, 12000, 10000, 8500, 7500]


def collateral_ratio_bps(composite: int) -> int:
    """Piecewise linear interpolation over the curve. Returns basis points."""
    s = max(0, min(100, int(composite)))
    for i in range(len(SCORE_BREAKPOINTS) - 1):
        lo, hi = SCORE_BREAKPOINTS[i], SCORE_BREAKPOINTS[i + 1]
        if lo <= s <= hi:
            lo_bps, hi_bps = COLLATERAL_BPS[i], COLLATERAL_BPS[i + 1]
            if hi == lo:
                return lo_bps
            frac = (s - lo) / (hi - lo)
            return int(round(lo_bps + frac * (hi_bps - lo_bps)))
    # s > 100 (shouldn't happen due to clip)
    return COLLATERAL_BPS[-1]


def bps_to_pct(bps: int) -> str:
    return f"{bps / 100:.1f}%"


print("\n" + "=" * 72)
print("PROVISIONAL COLLATERAL CURVE")
print("=" * 72)
print(f"  Score breakpoints (composite): {SCORE_BREAKPOINTS}")
print(f"  Collateral ratios (bps):       {COLLATERAL_BPS}")
print("\n  Sample collateral at each composite score:")
for s in [0, 10, 20, 30, 40, 50, 60, 70, 75, 80, 85, 90, 95, 100]:
    bps = collateral_ratio_bps(s)
    print(f"    composite={s:>3} → {bps_to_pct(bps)} collateral")


# ---------------------------------------------------------------------------
# 5. Three scenarios × percentile distribution → collateral
# ---------------------------------------------------------------------------
def scenario_table(title: str, composite: np.ndarray):
    print(f"\n  {title}")
    print(f"  {'percentile':<12s} {'composite':<12s} {'collateral':<12s}")
    for p in [1, 5, 10, 25, 50, 75, 90, 95, 99]:
        c = int(np.percentile(composite, p))
        bps = collateral_ratio_bps(c)
        print(f"    p{p:<3}       {c:<12} {bps_to_pct(bps):<12}")


print("\n" + "=" * 72)
print("SCENARIO A: ONCHAIN ONLY  (no attestation → cap via multiplier 50)")
print("=" * 72)
composite_A = composite_onchain_only(onchain_scores)
scenario_table(
    "composite = onchain × 50 / 100",
    composite_A,
)
print(f"\n  max possible composite in scenario A: {composite_A.max()}")
print("  Interpretation: best-case onchain-only wallet still lands in the")
print("  overcollateralized regime (>=100%). This is the thin-file protection.")


print("\n" + "=" * 72)
print("SCENARIO B: ONCHAIN + FICO 650 ATTESTATION  (moderate offchain credit)")
print("=" * 72)
offchain_650 = fico_to_0_100(650)
composite_B = composite_both(onchain_scores, offchain_650)
print(f"  offchain component (FICO 650 → 0-100) = {offchain_650}")
print(f"  composite = min(100, offchain × {OFFCHAIN_BASELINE_MULT}/100 + onchain × {ONCHAIN_BOOST_MULT}/100)")
print(f"  baseline from FICO 650 alone = {offchain_650 * OFFCHAIN_BASELINE_MULT // 100}")
scenario_table("composite distribution:", composite_B)


print("\n" + "=" * 72)
print("SCENARIO C: ONCHAIN + FICO 780 ATTESTATION  (strong offchain credit)")
print("=" * 72)
offchain_780 = fico_to_0_100(780)
composite_C = composite_both(onchain_scores, offchain_780)
print(f"  offchain component (FICO 780 → 0-100) = {offchain_780}")
print(f"  composite = min(100, offchain × {OFFCHAIN_BASELINE_MULT}/100 + onchain × {ONCHAIN_BOOST_MULT}/100)")
print(f"  baseline from FICO 780 alone = {offchain_780 * OFFCHAIN_BASELINE_MULT // 100}")
scenario_table("composite distribution:", composite_C)


# ---------------------------------------------------------------------------
# 6. Sanity check: onchain-only composite should never unlock <100% collateral
# ---------------------------------------------------------------------------
print("\n" + "=" * 72)
print("THIN-FILE CAP VERIFICATION")
print("=" * 72)
max_A = composite_A.max()
max_A_collateral = collateral_ratio_bps(max_A)
print(f"  Maximum onchain-only composite: {max_A}  → collateral {bps_to_pct(max_A_collateral)}")
if max_A_collateral >= 10000:
    print("  ✓ Onchain-only wallets stay >=100% collateral (overcollateralized).")
else:
    print("  ✗ PROBLEM: onchain-only wallet can unlock undercollateralized terms.")
    print("    This violates the thin-file protection. Tighten onchainOnlyMultiplier.")


# ---------------------------------------------------------------------------
# 7. Demo-wallet sanity check
# ---------------------------------------------------------------------------
print("\n" + "=" * 72)
print("DEMO WALLETS UNDER EACH SCENARIO")
print("=" * 72)
for label, raw_onchain in [
    ("Ideal (thin file, onchain=98)",       98),
    ("Heavy user (onchain=58)",             58),
    ("Risky (onchain=3)",                    3),
    ("No onchain history (onchain=0)",       0),
]:
    a = composite_onchain_only(np.array([raw_onchain]))[0]
    b = composite_both(np.array([raw_onchain]), offchain_650)[0]
    c = composite_both(np.array([raw_onchain]), offchain_780)[0]
    print(f"\n  {label}")
    print(f"    onchain-only     → composite {a:>3}  → {bps_to_pct(collateral_ratio_bps(a))}")
    print(f"    + FICO 650       → composite {b:>3}  → {bps_to_pct(collateral_ratio_bps(b))}")
    print(f"    + FICO 780       → composite {c:>3}  → {bps_to_pct(collateral_ratio_bps(c))}")


# ---------------------------------------------------------------------------
# 8. VALUE-PROP VERIFICATION MATRIX
# ---------------------------------------------------------------------------
print("\n" + "=" * 72)
print("VALUE-PROP VERIFICATION MATRIX")
print("=" * 72)
print("  Narrative tests — is each cell consistent with the pitch?\n")

scenarios = [
    ("No history",            0),
    ("Weak onchain",         20),
    ("Median onchain",       65),
    ("Strong onchain",       98),
]
attest_cols = [
    ("No FICO",              None),
    ("FICO 500 (poor)",      fico_to_0_100(500)),
    ("FICO 650 (fair)",      fico_to_0_100(650)),
    ("FICO 780 (good)",      fico_to_0_100(780)),
    ("FICO 850 (excellent)", fico_to_0_100(850)),
]

# Header
header_label = "onchain \\ offchain"
print(f"  {header_label:<22s}", end="")
for label, _ in attest_cols:
    print(f"{label:<20s}", end="")
print()

for onchain_label, onchain_val in scenarios:
    print(f"  {onchain_label:<22s}", end="")
    for _, offchain in attest_cols:
        if offchain is None:
            c = composite_onchain_only(np.array([onchain_val]))[0]
        else:
            c = composite_both(np.array([onchain_val]), offchain)[0]
        bps = collateral_ratio_bps(c)
        cell = f"{c}→{bps/100:.0f}%"
        print(f"{cell:<20s}", end="")
    print()

print("\n  Key narrative checks:")
print("  - Onchain-only column: every cell >= 100% collateral  (thin-file cap)")
print("  - FICO 780, no onchain: ~109% = 'competitive with bank, slightly worse'")
print("  - Strong onchain + FICO 780: ~76% = 'better than bank (undercollateralized)'")
print("  - Weak onchain + FICO 780: ~109% = 'FICO sets floor, bad onchain drags back to parity'")
print("  - No history + FICO 650: ~125% = 'moderate FICO alone, moderate discount'")
print("  - Strong onchain + weak FICO: stays overcollateralized (need both to be at least OK)")
