"""
Arbora Protocol — Scoring API
===============================
FastAPI server exposing:

    POST /score
    Body: {"address": "0x..."}
    POST /score/stream   (same payload, Server-Sent Events with progress)
    GET  /health

Tiered data source (pipeline.data_sources):
  Tier 0: Live Allium queries (if ALLIUM_API_KEY is set — ~90s per wallet)
  Tier 1: Cached real wallet data (from demo_wallets.json — instant)
  Tier 2: Deterministic synthetic features from address hash (instant)

The model runs on every request regardless of data source. When the wallet
has any onchain activity, the score is pushed to the CreditOracle on
Arbitrum Sepolia (chain id 421614) as an EIP-1559 transaction and read
back (composite score, onchain score/timestamp, collateral ratio, USDG
balance). The response includes a `data_source` field: "live", "cached",
or "synthetic".

Without any configuration (no RPC/key/addresses) the API still works in
demo mode: scores are computed locally and `composite_score`/`tx_hash`
come back as null.

SSE events emitted by /score/stream (names are part of the frontend
contract and unchanged): start, arbitrum_start, arbitrum_done,
crosschain_start, crosschain_done, queries_complete, fallback, model_start, model_done,
push_start, push_done, result, error.

Usage:
    uvicorn pipeline.api:app --host 0.0.0.0 --port 8000 --reload
"""

import sys
import time
import json
import asyncio
import queue
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Add project root and backend directory for imports
_backend_dir = Path(__file__).resolve().parent.parent
_project_root = _backend_dir.parent
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_backend_dir))

from pipeline.activity_tier import classify_activity_tier
from pipeline.config import ALLIUM_API_KEY, CREDIT_ORACLE_ADDRESS
from pipeline.data_sources import FeatureResult, cached_response, fetch_features
from pipeline import payment_gate
from pipeline.onchain import (
    format_error,
    push_onchain_score,
    read_collateral_ratio_bps,
    read_composite_score,
    read_usdg_balance,
)
from model.score import score_wallet

# ──────────────────────────────────────────────────────────────────────────────
# FastAPI App
# ──────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Arbora Protocol Scoring API",
    description="On-demand credit scoring for wallets, published to the CreditOracle on Arbitrum Sepolia (USDG lending market)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────────────────────────────────────
# Rate Limiting (in-memory, hackathon-grade)
# ──────────────────────────────────────────────────────────────────────────────

_rate_limit_per_ip: dict[str, list[float]] = defaultdict(list)
_rate_limit_global: list[float] = []
RATE_LIMIT_PER_IP_HOUR = 20
RATE_LIMIT_GLOBAL_DAY = 100


def _check_rate_limit(client_ip: str):
    """Raise HTTP 429 if rate limits are exceeded."""
    now = time.time()
    hour_ago = now - 3600
    day_ago = now - 86400

    # Clean up old entries
    _rate_limit_per_ip[client_ip] = [t for t in _rate_limit_per_ip[client_ip] if t > hour_ago]
    _rate_limit_global[:] = [t for t in _rate_limit_global if t > day_ago]

    if len(_rate_limit_per_ip[client_ip]) >= RATE_LIMIT_PER_IP_HOUR:
        raise HTTPException(429, "Scoring rate limit reached. Please try again in a few minutes.")
    if len(_rate_limit_global) >= RATE_LIMIT_GLOBAL_DAY:
        raise HTTPException(429, "Scoring rate limit reached. Please try again in a few minutes.")

    _rate_limit_per_ip[client_ip].append(now)
    _rate_limit_global.append(now)


# ──────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ──────────────────────────────────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    address: str = Field(..., description="Wallet address (0x hex string)")
    payment_tx: str | None = Field(
        default=None,
        description="0.01 USDG transfer tx hash paying for this (uncached) query",
    )
    payer: str | None = Field(
        default=None,
        description="Wallet address that sent payment_tx (checked against the transfer log)",
    )


class FactorItem(BaseModel):
    feature: str
    display_name: str
    bin: str
    coefficient: float
    is_reference: bool


class ScoreResponse(BaseModel):
    address: str
    credit_score: int
    raw_model_score: int | None = None  # score before activity penalty
    chains_used: int
    data_completeness: str
    data_source: str = "live"  # "live", "cached", or "synthetic"
    activity_tier: str = "full_history"  # "no_activity", "no_lending_history", "thin_lending_history", "full_history"
    activity_note: str | None = None
    factor_breakdown: list[FactorItem]
    composite_score: int | None = None
    collateral_ratio_bps: int | None = None
    tx_hash: str | None = None
    error: str | None = None
    # Onchain read-backs (null unless the push/read path is configured)
    onchain_score: int | None = None
    score_last_updated: int | None = None  # CreditOracle lastUpdated (unix seconds)
    usdg_balance: int | None = None  # wallet's USDG balance, base units (6 decimals)


# ──────────────────────────────────────────────────────────────────────────────
# Scoring pipeline helpers (shared by /score and /score/stream)
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class PushOutcome:
    """Result of the onchain push + read-back step. Never raises."""

    tx_hash: str | None = None
    composite_score: int | None = None
    onchain_score: int | None = None
    score_last_updated: int | None = None
    collateral_ratio_bps: int | None = None
    usdg_balance: int | None = None
    error: str | None = None


def _factor_items(model_result: dict) -> list[FactorItem]:
    return [FactorItem(**item) for item in model_result["factor_breakdown"]]


def _run_model(raw_features: dict) -> tuple[dict, int, str, str | None, int]:
    """
    Run the frozen model + activity-tier penalty.
    Returns (model_result, raw_model_score, tier, note, credit_score).
    """
    model_result = score_wallet(raw_features)
    raw_model_score = int(model_result["credit_score"])
    activity_tier, activity_note, penalty = classify_activity_tier(raw_features)
    credit_score = 0 if activity_tier == "no_activity" else max(0, int(raw_model_score * penalty))
    print(f"  [2/3] Model inference → raw score {raw_model_score}")
    print(f"        Activity tier: {activity_tier} (penalty: {penalty}x) → adjusted score {credit_score}")
    return model_result, raw_model_score, activity_tier, activity_note, credit_score


def _push_to_chain(address: str, credit_score: int, chains_used: int) -> PushOutcome:
    """
    Push the score to the CreditOracle and read state back.
    Never raises — configuration/RPC problems are reported via `error`.
    """
    outcome = PushOutcome()

    try:
        outcome.tx_hash = push_onchain_score(address, credit_score, chains_used)
        print(f"  [3/3] Pushed to CreditOracle: tx {outcome.tx_hash}")
    except Exception as exc:
        outcome.error = format_error(exc)
        print(f"  [3/3] Push failed: {outcome.error}")
        return outcome

    try:
        profile = read_composite_score(address)
        outcome.composite_score = profile["composite_score"]
        outcome.onchain_score = profile["onchain_score"]
        outcome.score_last_updated = profile["last_updated"]
        outcome.collateral_ratio_bps = read_collateral_ratio_bps(address)
        outcome.usdg_balance = read_usdg_balance(address)

        print(f"        On-chain composite: {outcome.composite_score}")
        if outcome.collateral_ratio_bps is not None:
            print(f"        Collateral ratio: {outcome.collateral_ratio_bps} bps "
                  f"({outcome.collateral_ratio_bps / 100:.1f}%)")
    except Exception as exc:
        outcome.error = format_error(exc)
        print(f"  [3/3] Read-back failed: {outcome.error}")

    return outcome


def _build_response(
    address: str,
    features: FeatureResult,
    model_result: dict,
    raw_model_score: int,
    activity_tier: str,
    activity_note: str | None,
    credit_score: int,
    push: PushOutcome,
) -> ScoreResponse:
    return ScoreResponse(
        address=address,
        credit_score=credit_score,
        raw_model_score=raw_model_score,
        chains_used=features.chains_used,
        data_completeness=features.completeness,
        data_source=features.data_source,
        activity_tier=activity_tier,
        activity_note=activity_note,
        factor_breakdown=_factor_items(model_result),
        composite_score=push.composite_score,
        collateral_ratio_bps=push.collateral_ratio_bps,
        tx_hash=push.tx_hash,
        error=push.error,
        onchain_score=push.onchain_score,
        score_last_updated=push.score_last_updated,
        usdg_balance=push.usdg_balance,
    )


def _validate_address(address: str) -> str:
    address = address.strip()
    if not address.startswith("0x") or len(address) != 42:
        raise HTTPException(400, "Invalid address format (expected 0x + 40 hex chars)")
    return address


# ──────────────────────────────────────────────────────────────────────────────
# Main endpoint
# ──────────────────────────────────────────────────────────────────────────────

@app.post("/score", response_model=ScoreResponse)
async def score_endpoint(req: ScoreRequest, request: Request):
    """
    Score a wallet: query data → run model → push to CreditOracle → return.
    Data source is tiered: live Allium → cached → synthetic.
    """
    address = _validate_address(req.address)

    # Rate limiting
    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    print(f"\n{'='*60}")
    print(f"Scoring wallet: {address}")
    print(f"{'='*60}")

    # Fast path: return cached response instantly for demo wallets
    precomputed = cached_response(address)
    if precomputed is not None:
        print("  [CACHE HIT] Returning pre-computed response instantly")
        return ScoreResponse(**precomputed)

    # Pay-per-score (x402-style): uncached queries cost 0.01 USDG onchain
    blocked = payment_gate.require_json_response(req.payment_tx, req.payer)
    if blocked is not None:
        print("  [402] Payment required for uncached query")
        return blocked

    # Step 1: Get features (tiered: live → cached → synthetic)
    t0 = time.time()
    features = fetch_features(address)

    t_query = time.time() - t0
    print(f"  [1/3] Features ready in {t_query:.1f}s (source: {features.data_source})")
    print(f"        Data completeness: {features.completeness}")

    # Step 2: Run the frozen model (always real, regardless of data source)
    t1 = time.time()
    try:
        model_result, raw_model_score, activity_tier, activity_note, credit_score = _run_model(
            features.raw_features
        )
    except Exception as e:
        raise HTTPException(500, f"Model inference failed: {e}")
    t_model = time.time() - t1

    # Step 3: Push score to CreditOracle (skipped when there's no activity)
    t2 = time.time()
    if activity_tier == "no_activity":
        print("  [3/3] Skipped push (no onchain activity)")
        push = PushOutcome()
    else:
        push = _push_to_chain(address, credit_score, features.chains_used)

    t_push = time.time() - t2
    t_total = time.time() - t0
    print(f"  Total time: {t_total:.1f}s (data={t_query:.1f}s, model={t_model*1000:.0f}ms, push={t_push:.1f}s)")

    # Payment consumed only after a successful run (failed runs stay retryable)
    payment_gate.mark_used(req.payment_tx)

    # Build response — no Allium details, SQL, or API keys exposed
    return _build_response(
        address,
        features,
        model_result,
        raw_model_score,
        activity_tier,
        activity_note,
        credit_score,
        push,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Streaming endpoint (SSE) — real-time progress updates
# ──────────────────────────────────────────────────────────────────────────────

def _sse_event(data: dict) -> str:
    """Format a single SSE event."""
    return f"data: {json.dumps(data)}\n\n"


def _sse_error(message: str) -> StreamingResponse:
    async def error_gen():
        yield _sse_event({"event": "error", "message": message})

    return StreamingResponse(error_gen(), media_type="text/event-stream")


@app.post("/score/stream")
async def score_stream(req: ScoreRequest, request: Request):
    """
    Same as /score but returns Server-Sent Events with real-time progress.
    Events emitted:
      - {event: "start", address}
      - {event: "arbitrum_start"} / {event: "arbitrum_done"}
      - {event: "crosschain_start"} / {event: "crosschain_done"}
      - {event: "fallback", reason}          (Allium failed → demo mode)
      - {event: "queries_complete", data_source}
      - {event: "model_start"}
      - {event: "model_done", score, raw_score, activity_tier}
      - {event: "push_start"}
      - {event: "push_done", tx_hash | error}
      - {event: "result", data: {full ScoreResponse}}
      - {event: "error", message}
    """
    address = req.address.strip()
    if not address.startswith("0x") or len(address) != 42:
        return _sse_error("Invalid address format")

    # Fast path: return cached response instantly for demo wallets
    precomputed = cached_response(address)
    if precomputed is not None:
        print(f"  [CACHE HIT] Returning pre-computed response instantly for {address}")

        async def cached_gen():
            yield _sse_event({"event": "start", "address": address})
            yield _sse_event({"event": "arbitrum_start"})
            yield _sse_event({"event": "arbitrum_done"})
            yield _sse_event({"event": "crosschain_start"})
            yield _sse_event({"event": "crosschain_done"})
            yield _sse_event({"event": "queries_complete", "data_source": "cached"})
            yield _sse_event({
                "event": "model_done",
                "score": precomputed["credit_score"],
                "raw_score": precomputed.get("raw_model_score"),
                "activity_tier": precomputed.get("activity_tier", "full_history"),
            })
            yield _sse_event({"event": "result", "data": precomputed})

        return StreamingResponse(cached_gen(), media_type="text/event-stream")

    # Pay-per-score (x402-style): uncached queries cost 0.01 USDG onchain
    blocked = payment_gate.require_json_response(req.payment_tx, req.payer)
    if blocked is not None:
        print("  [402] Payment required for uncached query")
        return blocked

    client_ip = request.client.host if request.client else "unknown"
    try:
        _check_rate_limit(client_ip)
    except HTTPException as e:
        return _sse_error(e.detail)

    progress_q: queue.Queue = queue.Queue()

    async def generate():
        yield _sse_event({"event": "start", "address": address})

        loop = asyncio.get_running_loop()
        pool = ThreadPoolExecutor(max_workers=1)

        # Step 1: tiered feature fetch, relaying progress events as they arrive
        try:
            future = loop.run_in_executor(
                pool,
                lambda: fetch_features(
                    address,
                    on_event=lambda name, payload: progress_q.put((name, payload)),
                ),
            )
            while not future.done():
                emitted = False
                while True:
                    try:
                        name, payload = progress_q.get_nowait()
                    except queue.Empty:
                        break
                    yield _sse_event({"event": name, **payload})
                    emitted = True
                if not emitted:
                    await asyncio.sleep(0.1)

            # Final drain — everything was queued before the future resolved
            while True:
                try:
                    name, payload = progress_q.get_nowait()
                except queue.Empty:
                    break
                yield _sse_event({"event": name, **payload})

            features: FeatureResult = await future
        except Exception as exc:
            yield _sse_event({"event": "error", "message": f"Data fetch failed: {format_error(exc)}"})
            return
        finally:
            pool.shutdown(wait=False)

        yield _sse_event({"event": "queries_complete", "data_source": features.data_source})

        # Model inference
        yield _sse_event({"event": "model_start"})
        try:
            model_result, raw_model_score, activity_tier, activity_note, credit_score = _run_model(
                features.raw_features
            )
        except Exception as e:
            yield _sse_event({"event": "error", "message": f"Model inference failed: {e}"})
            return

        yield _sse_event({
            "event": "model_done",
            "score": credit_score,
            "raw_score": raw_model_score,
            "activity_tier": activity_tier,
        })

        # Push to contract (skipped when there's no activity)
        push = PushOutcome()
        if activity_tier != "no_activity":
            yield _sse_event({"event": "push_start"})
            push = await loop.run_in_executor(
                None, _push_to_chain, address, credit_score, features.chains_used
            )
            if push.error:
                event = {"event": "push_done", "error": push.error}
                if push.tx_hash:
                    event["tx_hash"] = push.tx_hash
                yield _sse_event(event)
            else:
                yield _sse_event({"event": "push_done", "tx_hash": push.tx_hash})

        # Final result — consume the payment only now (success-gated charging)
        payment_gate.mark_used(req.payment_tx)
        response = _build_response(
            address,
            features,
            model_result,
            raw_model_score,
            activity_tier,
            activity_note,
            credit_score,
            push,
        )
        yield _sse_event({"event": "result", "data": response.model_dump()})

    return StreamingResponse(generate(), media_type="text/event-stream")


# ──────────────────────────────────────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": True,
        "allium_configured": bool(ALLIUM_API_KEY),
        "oracle_configured": bool(CREDIT_ORACLE_ADDRESS),
    }
