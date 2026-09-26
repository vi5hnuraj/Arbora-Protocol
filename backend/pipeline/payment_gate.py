"""x402-style pay-per-score gate.

An uncached /score query costs 0.01 USDG on Arbitrum Sepolia: the client sends
the ERC-20 transfer first, then passes the tx hash with the score request. The
server verifies the receipt onchain (token, payer, treasury, amount, no replay)
before running the pipeline. Demo-wallet cache hits stay free, so the five
demo chips and cached responses are unaffected.

Disable with USDG_PAY_PER_SCORE=0 (local dev / keyless demos).
"""

import os

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from web3 import Web3

from .config import USDG_TOKEN_ADDRESS
from .onchain import get_web3

PRICE_LABEL = "0.01 USDG"
PRICE_ATOMIC = 10_000  # 0.01 × 10^6 — USDG has 6 decimals
USDG_DECIMALS = 6
# Deployer / owner receives query fees.
DEFAULT_TREASURY = "0xD25F8736C3Efc19a7cb7A3D15f2aF22c2980E317"
TREASURY = Web3.to_checksum_address(os.getenv("USDG_TREASURY", DEFAULT_TREASURY))
ENABLED = os.getenv("USDG_PAY_PER_SCORE", "1") != "0"

TRANSFER_TOPIC = Web3.keccak(text="Transfer(address,address,uint256)")

# In-process replay guard: one tx hash pays for exactly one score.
_used_txs: set[str] = set()


def gate_enabled() -> bool:
    return ENABLED


def payment_terms(reason: str = "uncached_query") -> dict:
    return {
        "error": "payment_required",
        "reason": reason,
        "payment": {
            "protocol": "x402",
            "price_label": PRICE_LABEL,
            "price_atomic": PRICE_ATOMIC,
            "decimals": USDG_DECIMALS,
            "token": USDG_TOKEN_ADDRESS,
            "token_symbol": "USDG",
            "chain": "arbitrum-sepolia",
            "chain_id": 421614,
            "pay_to": TREASURY,
            "memo": "arbora-score-query",
        },
    }


def _addr_topic(addr: str) -> bytes:
    return b"\x00" * 12 + bytes.fromhex(addr.lower().replace("0x", ""))


def evaluate(payment_tx: str | None, payer: str | None) -> dict | None:
    """Return an x402-style error dict when the query is not (properly) paid."""
    if not ENABLED:
        return None
    if not payment_tx or not payer:
        return payment_terms("payment_tx and payer are required")
    if not (
        isinstance(payment_tx, str)
        and payment_tx.startswith("0x")
        and len(payment_tx) == 66
        and isinstance(payer, str)
        and payer.startswith("0x")
        and len(payer) == 42
    ):
        return payment_terms("malformed payment_tx or payer")
    if not USDG_TOKEN_ADDRESS:
        return payment_terms("USDG_TOKEN_ADDRESS not configured on server")
    if payment_tx.lower() in _used_txs:
        return payment_terms("payment_tx already used (replay rejected)")

    try:
        w3 = get_web3()
        receipt = w3.eth.get_transaction_receipt(payment_tx)
    except Exception:
        return payment_terms("payment_tx not found or still pending")

    if receipt.status != 1:
        return payment_terms("payment transaction failed")

    token = USDG_TOKEN_ADDRESS.lower()
    payer_topic = _addr_topic(payer)
    treasury_topic = _addr_topic(TREASURY)
    matched = False
    for log in receipt.logs:
        if str(log["address"]).lower() != token:
            continue
        topics = list(log["topics"])
        if len(topics) != 3 or topics[0] != TRANSFER_TOPIC:
            continue
        if topics[1] != payer_topic or topics[2] != treasury_topic:
            continue
        data = log["data"]
        value = int.from_bytes(data, "big") if isinstance(data, (bytes, bytearray)) else int(data)
        if value >= PRICE_ATOMIC:
            matched = True
            break

    if not matched:
        return payment_terms(
            f"expected a USDG Transfer of >= {PRICE_ATOMIC} units from payer to {TREASURY}"
        )

    return None


def mark_used(payment_tx: str | None) -> None:
    """Consume a verified payment (charge only on success).

    Called after the score has been produced; a failed run leaves the tx
    reusable so the payer is never charged for a result they didn't get.
    """
    if payment_tx:
        _used_txs.add(payment_tx.lower())


def require_json_response(payment_tx: str | None, payer: str | None) -> JSONResponse | None:
    """HTTP 402 JSONResponse for /score and /score/stream, or None when payable."""
    err = evaluate(payment_tx, payer)
    if err is None:
        return None
    return JSONResponse(status_code=402, content=err)


def require_payment(payment_tx: str | None, payer: str | None) -> None:
    """Raise HTTP 402 when the query is not (properly) paid."""
    err = evaluate(payment_tx, payer)
    if err is not None:
        raise HTTPException(status_code=402, detail=err)
