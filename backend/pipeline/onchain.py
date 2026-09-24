"""
Arbora Protocol — Onchain Score Push (Arbitrum Sepolia)
==========================================================
Web3 client for the CreditOracle / LendingPool on Arbitrum Sepolia
(chain id 421614, RPC https://sepolia-rollup.arbitrum.io/rpc).

Transactions are EIP-1559 (type 2): maxFeePerGas / maxPriorityFeePerGas
derived from eth_feeHistory + eth_maxPriorityFeePerGas with sane fallbacks,
plus explicit chainId, nonce and an estimated gas limit (with a safety
multiplier).

Arbitrum is a standard optimistic rollup — no PoA/extraData middleware is
needed (web3.py v6+ default middleware stack is enough).

All public helpers raise readable exceptions; callers that must never fail
(the API endpoints) catch them and surface the message instead.

Usage (programmatic):
    from pipeline.onchain import push_onchain_score, read_composite_score
    tx_hash = push_onchain_score("0x...", score=75, chains_used=3)
"""

from web3 import Web3

from pipeline.config import (
    ARBITRUM_SEPOLIA_CHAIN_ID,
    ARBITRUM_SEPOLIA_PRIVATE_KEY,
    ARBITRUM_SEPOLIA_RPC,
    CREDIT_ORACLE_ADDRESS,
    LENDING_POOL_ADDRESS,
    USDG_TOKEN_ADDRESS,
    get_oracle_abi,
    get_pool_abi,
    get_usdg_abi,
)

RPC_TIMEOUT_SECONDS = 20
GAS_SAFETY_MULTIPLIER = 1.2  # estimate_eth * this → gas limit
DEFAULT_GAS_LIMIT = 200_000  # only used if a build path leaves gas unset
RECEIPT_TIMEOUT_SECONDS = 120

# EIP-1559 fee fallbacks (wei) used when the node can't answer fee queries.
PRIORITY_FEE_FALLBACK_WEI = Web3.to_wei(0.05, "gwei")
BASE_FEE_FALLBACK_WEI = Web3.to_wei(0.1, "gwei")
PRIORITY_FEE_CAP_WEI = Web3.to_wei(5, "gwei")  # guard against absurd answers

# uint8 bounds enforced by the contracts
SCORE_MAX = 255
CHAINS_MAX = 255


class ConfigurationError(ValueError):
    """Missing configuration (private key / contract address) — not a crash."""


def format_error(exc: BaseException) -> str:
    """Turn a web3/RPC exception into a short, human-readable message."""
    message = getattr(exc, "message", None)
    if isinstance(message, str) and message:
        data = getattr(exc, "data", None)
        if isinstance(data, str) and data and data not in message:
            return f"{message} ({data[:80]})"[:400]
        return message[:400]
    if exc.args and isinstance(exc.args[0], str) and exc.args[0]:
        return exc.args[0][:400]
    if exc.args and isinstance(exc.args[0], dict):
        err = exc.args[0].get("error")
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:400]
        return str(exc.args[0])[:400]
    return f"{type(exc).__name__}: {exc}"[:400]


def get_web3() -> Web3:
    """Create a Web3 instance connected to Arbitrum Sepolia (no PoA middleware)."""
    w3 = Web3(Web3.HTTPProvider(ARBITRUM_SEPOLIA_RPC, request_kwargs={"timeout": RPC_TIMEOUT_SECONDS}))
    if not w3.is_connected():
        raise ConnectionError(f"Cannot reach Arbitrum Sepolia RPC at {ARBITRUM_SEPOLIA_RPC}")
    return w3


# ──────────────────────────────────────────────────────────────────────────────
# EIP-1559 fee / gas helpers
# ──────────────────────────────────────────────────────────────────────────────

def _priority_fee(w3: Web3) -> int:
    """eth_maxPriorityFeePerGas with a sane fallback."""
    try:
        fee = int(w3.eth.max_priority_fee)
    except Exception:
        fee = PRIORITY_FEE_FALLBACK_WEI
    return max(0, min(fee, PRIORITY_FEE_CAP_WEI))


def _base_fee(w3: Web3) -> int:
    """Recent base fee from eth_feeHistory, falling back to eth_gasPrice."""
    try:
        history = w3.eth.fee_history(5, "latest", [25.0, 50.0, 75.0])
        blocks = history.get("baseFeePerGas") or []
        if blocks:
            return max(int(x) for x in blocks)
    except Exception:
        pass
    try:
        return int(w3.eth.gas_price)
    except Exception:
        return BASE_FEE_FALLBACK_WEI


def _eip1559_fees(w3: Web3) -> tuple[int, int]:
    """Return (maxFeePerGas, maxPriorityFeePerGas) for a type-2 transaction."""
    priority = _priority_fee(w3)
    base = _base_fee(w3)
    max_fee = 2 * base + priority  # room for a few base-fee bumps
    return max_fee, priority


def _gas_limit(w3: Web3, tx: dict) -> int:
    """Estimate gas for `tx` and apply the safety multiplier."""
    try:
        estimate = w3.eth.estimate_gas(tx)
    except Exception as exc:
        raise RuntimeError(f"Gas estimation failed: {format_error(exc)}") from exc
    return max(int(estimate * GAS_SAFETY_MULTIPLIER), 21_000)


def _require(*pairs: tuple[str, str]) -> None:
    missing = [name for name, value in pairs if not value]
    if missing:
        raise ConfigurationError(
            f"Not configured for onchain push (missing: {', '.join(missing)})"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Push
# ──────────────────────────────────────────────────────────────────────────────

def push_onchain_score(
    wallet_address: str,
    score: int,
    chains_used: int,
    *,
    dry_run: bool = False,
) -> str | None:
    """
    Push an onchain credit score to the CreditOracle on Arbitrum Sepolia.

    Calls CreditOracle.setOnchainScore(wallet, score, chainsUsed) as an
    EIP-1559 transaction.

    Args:
        wallet_address: The wallet being scored (0x hex string)
        score: Credit score 0-100 (uint8 onchain)
        chains_used: Number of chains that contributed data (1-5)
        dry_run: If True, simulate without broadcasting

    Returns:
        Transaction hash (hex string) if broadcast, None if dry_run.
    """
    _require(
        ("CREDIT_ORACLE_ADDRESS", CREDIT_ORACLE_ADDRESS),
        ("ARBITRUM_SEPOLIA_PRIVATE_KEY", ARBITRUM_SEPOLIA_PRIVATE_KEY),
    )

    score = max(0, min(int(score), SCORE_MAX))
    chains_used = max(0, min(int(chains_used), CHAINS_MAX))

    w3 = get_web3()
    oracle = w3.eth.contract(
        address=Web3.to_checksum_address(CREDIT_ORACLE_ADDRESS),
        abi=get_oracle_abi(),
    )
    account = w3.eth.account.from_key(ARBITRUM_SEPOLIA_PRIVATE_KEY)
    max_fee, priority_fee = _eip1559_fees(w3)

    build_params = {
        "from": account.address,
        "nonce": w3.eth.get_transaction_count(account.address, "pending"),
        "chainId": ARBITRUM_SEPOLIA_CHAIN_ID,
        "type": 2,
        "maxFeePerGas": max_fee,
        "maxPriorityFeePerGas": priority_fee,
    }

    contract_call = oracle.functions.setOnchainScore(
        Web3.to_checksum_address(wallet_address),
        score,
        chains_used,
    )

    # Build with a placeholder gas so web3 does not estimate on its own;
    # we then estimate explicitly and apply the safety multiplier.
    try:
        tx = contract_call.build_transaction({**build_params, "gas": DEFAULT_GAS_LIMIT})
    except Exception as exc:
        raise RuntimeError(f"Transaction build failed: {format_error(exc)}") from exc
    estimate_tx = {k: v for k, v in tx.items() if k != "gas"}
    tx["gas"] = _gas_limit(w3, estimate_tx)

    if dry_run:
        print(f"[DRY RUN] setOnchainScore({wallet_address}, {score}, {chains_used})")
        print(f"  From: {account.address}")
        print(f"  Oracle: {CREDIT_ORACLE_ADDRESS}")
        print(f"  maxFeePerGas={max_fee} maxPriorityFeePerGas={priority_fee} gas={tx['gas']}")
        return None

    signed = w3.eth.account.sign_transaction(tx, ARBITRUM_SEPOLIA_PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=RECEIPT_TIMEOUT_SECONDS)

    if receipt["status"] != 1:
        raise RuntimeError(f"Transaction reverted: {Web3.to_hex(tx_hash)}")

    return Web3.to_hex(tx_hash)


# ──────────────────────────────────────────────────────────────────────────────
# Read-backs
# ──────────────────────────────────────────────────────────────────────────────

def read_composite_score(wallet_address: str) -> dict:
    """
    Read the composite score and full profile from the CreditOracle.

    Returns keys: composite_score, onchain_score, historical_onchain_score,
    offchain_score, chains_used, has_offchain_attestation,
    is_using_inherited_score, last_updated (unix seconds).
    """
    _require(("CREDIT_ORACLE_ADDRESS", CREDIT_ORACLE_ADDRESS))
    w3 = get_web3()
    oracle = w3.eth.contract(
        address=Web3.to_checksum_address(CREDIT_ORACLE_ADDRESS),
        abi=get_oracle_abi(),
    )
    wallet = Web3.to_checksum_address(wallet_address)

    composite = oracle.functions.getCompositeScore(wallet).call()
    profile = oracle.functions.getFullProfile(wallet).call()

    # profile matches CreditProfile:
    # (onchainScore, historicalOnchainScore, offchainScore, compositeScore,
    #  chainsUsed, hasOffchainAttestation, isUsingInheritedScore, lastUpdated)
    def field(index: int, name: str):
        try:
            return profile[index]
        except (IndexError, KeyError, TypeError):
            if isinstance(profile, dict):
                return profile.get(name)
            return getattr(profile, name, None)

    return {
        "composite_score": int(composite),
        "onchain_score": int(field(0, "onchainScore") or 0),
        "historical_onchain_score": int(field(1, "historicalOnchainScore") or 0),
        "offchain_score": int(field(2, "offchainScore") or 0),
        "chains_used": int(field(4, "chainsUsed") or 0),
        "has_offchain_attestation": bool(field(5, "hasOffchainAttestation")),
        "is_using_inherited_score": bool(field(6, "isUsingInheritedScore")),
        "last_updated": int(field(7, "lastUpdated") or 0),
    }


def read_collateral_ratio_bps(wallet_address: str) -> int | None:
    """
    Collateral ratio (bps) required for `wallet_address`, None if not deployed.

    Returns the ratio locked into the wallet's open position, or — when the
    wallet has no loan — the score→ratio curve value for its composite score.
    Mirrors LendingPool.getRequiredCollateral's no-position fallback; a raw
    getBorrowerCollateralRatioBps read would return 0 for wallets that never
    borrowed.
    """
    if not LENDING_POOL_ADDRESS:
        return None
    w3 = get_web3()
    pool = w3.eth.contract(
        address=Web3.to_checksum_address(LENDING_POOL_ADDRESS),
        abi=get_pool_abi(),
    )
    wallet = Web3.to_checksum_address(wallet_address)

    ratio = int(pool.functions.getBorrowerCollateralRatioBps(wallet).call())
    if ratio:
        return ratio

    if not CREDIT_ORACLE_ADDRESS:
        return ratio
    oracle = w3.eth.contract(
        address=Web3.to_checksum_address(CREDIT_ORACLE_ADDRESS),
        abi=get_oracle_abi(),
    )
    composite = int(oracle.functions.getCompositeScore(wallet).call())
    return int(pool.functions.getCollateralRatioBps(composite).call())


def read_usdg_balance(wallet_address: str) -> int | None:
    """
    Balance of the USDG lending asset (6 decimals, base units) held by the
    wallet, None if USDG_TOKEN_ADDRESS is not configured.
    """
    if not USDG_TOKEN_ADDRESS:
        return None
    w3 = get_web3()
    usdg = w3.eth.contract(
        address=Web3.to_checksum_address(USDG_TOKEN_ADDRESS),
        abi=get_usdg_abi(),
    )
    return int(usdg.functions.balanceOf(Web3.to_checksum_address(wallet_address)).call())
