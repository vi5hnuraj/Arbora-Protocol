"""
Arbora Protocol — Activity Tier Classification
=================================================
Classifies a wallet's lending activity and returns the penalty multiplier
applied to the raw model score (before the onchain push).

Tiers:
    no_activity          — zero activity anywhere (score → 0, no push)
    no_lending_history   — general onchain activity, zero lending interactions
    thin_lending_history — lending interactions but < 2 active lending days
    full_history         — meaningful lending history (2+ active days)

The lending features evaluate onchain lending history across Arbitrum & EVM protocols;
the tier itself only gates how much of the raw score survives.
"""

# Activity tier penalty multipliers (applied after model inference, before contract push)
NO_LENDING_PENALTY = 0.6    # Has onchain activity but zero lending-protocol interactions
THIN_LENDING_PENALTY = 0.8  # Has lending interactions but < 2 active lending days


def classify_activity_tier(raw_features: dict) -> tuple[str, str | None, float]:
    """
    Classify wallet activity level and return (tier, note, penalty_multiplier).

    Tiers:
      no_activity         — zero activity across all chains (score → 0, don't push)
      no_lending_history  — has general activity but zero lending interactions
      thin_lending_history — has lending interactions but < 2 active lending days
      full_history        — meaningful lending history (2+ active days)
    """
    lending_days = raw_features.get("lending_active_days", 0)
    repay_count = raw_features.get("repay_count", 0)
    borrow_ratio = raw_features.get("borrow_repay_ratio", 0)
    crosschain_tx = raw_features.get("crosschain_total_tx_count", 0)
    has_bridge = raw_features.get("has_used_bridge", 0)

    # Check if there's any onchain activity at all
    has_any_activity = (
        lending_days > 0
        or repay_count > 0
        or crosschain_tx > 0
        or has_bridge > 0
        or raw_features.get("current_total_usd", 0) > 0
    )

    if not has_any_activity:
        return "no_activity", "No onchain activity found.", 0.0

    # Check for lending history
    has_lending = lending_days > 0 or repay_count > 0 or borrow_ratio > 0

    if not has_lending:
        return (
            "no_lending_history",
            "Score based on general onchain activity only. No borrowing history found.",
            NO_LENDING_PENALTY,
        )

    if lending_days < 2:
        return (
            "thin_lending_history",
            "Limited borrowing history. Score will improve with additional lending activity.",
            THIN_LENDING_PENALTY,
        )

    return "full_history", None, 1.0
