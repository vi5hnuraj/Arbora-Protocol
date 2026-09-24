"""
Arbora Protocol — Tiered Feature Sources
===========================================
Fetches the model features for a wallet, in priority order:

  Tier 0 — "live":      Allium Explorer SQL queries (requires ALLIUM_API_KEY).
                        Query A (lending + balances + net flow) and Query B
                        (crosschain activity) run concurrently (~90s/wallet).
  Tier 1 — "cached":    Real wallet features captured in demo_wallets.json.
  Tier 2 — "synthetic": deterministic pseudo-random features derived from
                        the address hash (always available, zero config).

`fetch_features()` implements the selection + fallback logic shared by the
JSON (/score) and SSE (/score/stream) endpoints. The optional `on_event`
callback receives progress events and may be called from worker threads
(so it should be thread-safe, e.g. queue.Queue.put).

The SQL in scoring_queries.py reads Arbitrum lending data (Aave v3 / Radiant)
and multichain transfers to build the wallet profile on Arbitrum.
"""

import hashlib
import json
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

import requests as http_requests

from pipeline.config import (
    ALLIUM_API_KEY,
    ALLIUM_API_BASE,
    ALLIUM_MAX_ROWS,
    ALLIUM_POLL_INTERVAL,
    ALLIUM_POLL_TIMEOUT,
)
from pipeline.scoring_queries import build_query_a, build_query_b

# Progress events emitted to on_event(name, payload); /score/stream relays
# them verbatim as SSE events (names are part of the frontend contract).
EVENT_ARB_START = "arbitrum_start"
EVENT_ARB_DONE = "arbitrum_done"
EVENT_XCHAIN_START = "crosschain_start"
EVENT_XCHAIN_DONE = "crosschain_done"
EVENT_FALLBACK = "fallback"

EventCallback = Optional[Callable[[str, dict], None]]


@dataclass(frozen=True)
class FeatureResult:
    """Features for one wallet plus the provenance needed for the response."""

    raw_features: dict
    completeness: str
    chains_used: int
    data_source: str  # "live" | "cached" | "synthetic"


ALLIUM_HEADERS = {
    "X-API-KEY": ALLIUM_API_KEY,
    "Content-Type": "application/json",
}


def _noop_event(name: str, payload: dict) -> None:
    pass


# ──────────────────────────────────────────────────────────────────────────────
# Tier 1 / Tier 2: cached wallets + synthetic features
# ──────────────────────────────────────────────────────────────────────────────

_demo_wallets_cache: dict | None = None


def load_demo_wallets() -> dict:
    """Load cached real wallet features from demo_wallets.json (loaded once)."""
    global _demo_wallets_cache
    if _demo_wallets_cache is not None:
        return _demo_wallets_cache

    demo_path = Path(__file__).parent / "demo_wallets.json"
    if demo_path.exists():
        with open(demo_path) as f:
            _demo_wallets_cache = json.load(f)
    else:
        _demo_wallets_cache = {}
    return _demo_wallets_cache


def cached_response(address: str) -> dict | None:
    """Pre-computed /score response for a demo wallet, if one exists."""
    entry = load_demo_wallets().get(address.lower())
    if entry and "cached_response" in entry:
        return entry["cached_response"]
    return None


def generate_synthetic_features(address: str) -> dict:
    """
    Generate deterministic pseudo-random features from a wallet address.
    Same address always produces the same features (SHA-256 hash-based).
    """
    h = hashlib.sha256(address.lower().encode()).digest()
    return {
        "lending_active_days": (h[0] % 30) + 1,
        "borrow_repay_ratio": round(0.5 + (h[1] % 150) / 100, 2),
        "repay_count": h[2] % 20,
        "unique_borrow_tokens": (h[3] % 3) + 1,
        "current_total_usd": float(h[4] * h[5]),
        "stablecoin_ratio": round((h[6] % 100) / 100, 2),
        "net_flow_usd_90d": float((h[7] - 128) * 100),
        "crosschain_total_tx_count": h[8] * h[9],
        "crosschain_dex_trade_count": h[10] * 2,
        "chains_active_on": h[11] % 5,
        "has_used_bridge": 1 if h[12] > 128 else 0,
    }


def try_fallback(address: str) -> FeatureResult:
    """
    Tier 1: check demo_wallets.json for cached real features.
    Tier 2: generate deterministic synthetic features from the address hash.
    """
    cached = load_demo_wallets()
    addr_lower = address.lower()

    if addr_lower in cached:
        entry = cached[addr_lower]
        return FeatureResult(
            raw_features=entry["features"],
            completeness=entry.get("data_completeness", "5-chain history (cached)"),
            chains_used=entry.get("chains_used", 5),
            data_source="cached",
        )

    features = generate_synthetic_features(address)
    chains = 1 + features["chains_active_on"]
    return FeatureResult(
        raw_features=features,
        completeness="synthetic profile",
        chains_used=chains,
        data_source="synthetic",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Tier 0: live Allium queries
# ──────────────────────────────────────────────────────────────────────────────

def run_allium_query(sql: str, label: str, start_delay: float = 0) -> dict | None:
    """
    Create → run → poll → fetch results for a single SQL query.
    Returns the first row as a dict, or None if no rows or error.
    """
    if start_delay > 0:
        time.sleep(start_delay)

    try:
        for attempt in range(3):
            resp = http_requests.post(
                f"{ALLIUM_API_BASE}/queries",
                headers=ALLIUM_HEADERS,
                json={
                    "title": f"arbora_live_{label}_{int(time.time())}",
                    "config": {"sql": sql, "limit": ALLIUM_MAX_ROWS},
                },
                timeout=30,
            )
            if resp.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"  [{label}] Rate limited (429), retrying in {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            print(f"  [{label}] Rate limited after 3 retries")
            return None
        query_id = resp.json().get("query_id") or resp.json().get("id")

        for attempt in range(3):
            resp = http_requests.post(
                f"{ALLIUM_API_BASE}/queries/{query_id}/run-async",
                headers=ALLIUM_HEADERS,
                json={"parameters": {}, "run_config": {"limit": ALLIUM_MAX_ROWS}},
                timeout=30,
            )
            if resp.status_code == 429:
                wait = 5 * (attempt + 1)
                print(f"  [{label}] Rate limited on run (429), retrying in {wait}s...")
                time.sleep(wait)
                continue
            resp.raise_for_status()
            break
        else:
            print(f"  [{label}] Rate limited on run after 3 retries")
            return None
        run_id = resp.json().get("run_id") or resp.json().get("id")

        start = time.time()
        while time.time() - start < ALLIUM_POLL_TIMEOUT:
            resp = http_requests.get(
                f"{ALLIUM_API_BASE}/query-runs/{run_id}/results",
                headers={"X-API-KEY": ALLIUM_API_KEY},
                params={"f": "json"},
                timeout=30,
            )
            if resp.status_code == 200:
                raw = resp.text
                if raw and raw.strip() != "null" and len(raw) > 10:
                    data = resp.json()
                    if data and isinstance(data, dict) and data.get("data"):
                        rows = data["data"]
                        return rows[0] if rows else None
            time.sleep(ALLIUM_POLL_INTERVAL)

        print(f"[{label}] Timed out after {ALLIUM_POLL_TIMEOUT}s")
        return None

    except Exception as e:
        print(f"[{label}] Error: {e}")
        traceback.print_exc()
        return None


def query_wallet_features(address: str, on_event: EventCallback = None) -> FeatureResult:
    """Run Query A (lending history) and Query B (crosschain) concurrently."""
    emit = on_event or _noop_event
    sql_a = build_query_a(address)
    sql_b = build_query_b(address)

    def _run(sql: str, label: str, delay: float, start_evt: str, done_evt: str) -> dict | None:
        emit(start_evt, {})
        try:
            return run_allium_query(sql, label, delay)
        finally:
            emit(done_evt, {})

    with ThreadPoolExecutor(max_workers=2) as pool:
        def _run_a(sql: str) -> dict | None:
            emit(EVENT_ARB_START, {})
            try:
                return run_allium_query(sql, "arbitrum", 0.0)
            finally:
                emit(EVENT_ARB_DONE, {})

        future_a = pool.submit(_run_a, sql_a)
        future_b = pool.submit(_run, sql_b, "crosschain", 3.0, EVENT_XCHAIN_START, EVENT_XCHAIN_DONE)
        a = future_a.result()
        b = future_b.result()

    if a is None:
        raise RuntimeError("Lending data query failed. Falling back to demo mode.")

    raw = {
        "lending_active_days": int(a.get("lending_active_days", 0) or 0),
        "borrow_repay_ratio": float(a.get("borrow_repay_ratio", 0) or 0),
        "repay_count": int(a.get("repay_count", 0) or 0),
        "unique_borrow_tokens": max(int(a.get("unique_borrow_tokens", 0) or 0), 1),
        "current_total_usd": float(a.get("current_total_usd", 0) or 0),
        "stablecoin_ratio": float(a.get("stablecoin_ratio", 0) or 0),
        "net_flow_usd_90d": float(a.get("net_flow_usd_90d", 0) or 0),
    }

    if b is not None:
        raw["crosschain_total_tx_count"] = int(b.get("crosschain_total_tx_count", 0) or 0)
        raw["crosschain_dex_trade_count"] = int(b.get("crosschain_dex_trade_count", 0) or 0)
        raw["chains_active_on"] = int(b.get("chains_active_on", 0) or 0)
        raw["has_used_bridge"] = int(b.get("has_used_bridge", 0) or 0)
        chains_used = 1 + raw["chains_active_on"]
        completeness = f"{chains_used}-chain history"
    else:
        raw["crosschain_total_tx_count"] = 0
        raw["crosschain_dex_trade_count"] = 0
        raw["chains_active_on"] = 0
        raw["has_used_bridge"] = 0
        chains_used = 1
        completeness = "1-chain history (crosschain data unavailable)"

    return FeatureResult(
        raw_features=raw,
        completeness=completeness,
        chains_used=chains_used,
        data_source="live",
    )


# ──────────────────────────────────────────────────────────────────────────────
# Tier selection (shared by /score and /score/stream)
# ──────────────────────────────────────────────────────────────────────────────

def fetch_features(address: str, on_event: EventCallback = None) -> FeatureResult:
    """
    Fetch features with the tiered fallback:
      Tier 0 live Allium → Tier 1 cached → Tier 2 synthetic.

    Never raises for data-source problems — falls back instead. `on_event`
    (optional, thread-safe) receives progress events for the SSE endpoint.
    """
    emit = on_event or _noop_event

    if not ALLIUM_API_KEY:
        print("  [1/3] No Allium API key, using demo mode")
        for evt in (EVENT_ARB_START, EVENT_ARB_DONE, EVENT_XCHAIN_START, EVENT_XCHAIN_DONE):
            emit(evt, {})
        return try_fallback(address)

    try:
        return query_wallet_features(address, on_event=on_event)
    except RuntimeError as exc:
        print(f"  [1/3] {exc}")
        emit(EVENT_FALLBACK, {"reason": str(exc)})
        return try_fallback(address)
