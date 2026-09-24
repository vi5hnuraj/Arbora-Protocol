"""
Arbora Protocol — Push Score (compatibility shim)
====================================================
The implementation moved to `pipeline.onchain`; this module re-exports the
public helpers so existing imports keep working:

    from pipeline.push_score import push_onchain_score, read_composite_score

Scores are pushed to the CreditOracle on Arbitrum Sepolia (chain 421614).

Usage (standalone):
    python3 pipeline/push_score.py 0xWALLET_ADDRESS 75 3
"""

import sys
from pathlib import Path

# Add project root to path for standalone execution
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.config import SEPOLIA_EXPLORER_TX_URL
from pipeline.onchain import (
    ConfigurationError,
    format_error,
    get_web3,
    push_onchain_score,
    read_collateral_ratio_bps,
    read_composite_score,
    read_usdg_balance,
)

__all__ = [
    "ConfigurationError",
    "format_error",
    "get_web3",
    "push_onchain_score",
    "read_collateral_ratio_bps",
    "read_composite_score",
    "read_usdg_balance",
]


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 pipeline/push_score.py <wallet> <score> <chains_used>")
        sys.exit(1)

    wallet = sys.argv[1]
    score = int(sys.argv[2])
    chains = int(sys.argv[3])

    print(f"Pushing score {score} (chains={chains}) for {wallet} on Arbitrum Sepolia...")
    try:
        tx = push_onchain_score(wallet, score, chains)
    except Exception as exc:
        print(f"Push failed: {format_error(exc)}")
        sys.exit(1)

    print(f"Transaction: {tx}")
    print(f"Arbiscan: {SEPOLIA_EXPLORER_TX_URL}{tx}")

    profile = read_composite_score(wallet)
    print(f"On-chain composite: {profile['composite_score']}")
