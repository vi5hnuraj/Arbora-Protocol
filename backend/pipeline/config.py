"""
Arbora Protocol — Pipeline Configuration
===========================================
Loads environment variables and exposes contract addresses, RPC settings,
and API keys used by the scoring pipeline.

Deployment target: Arbitrum Sepolia (chain id 421614)
Lending asset:     USDG — Paxos Global Dollar (6 decimals); MockUSDG on testnet
"""

import os
import json
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

# --- Allium Explorer API (Tier 0 live feature queries) ---
ALLIUM_API_KEY = os.getenv("ALLIUM_API_KEY", "")
ALLIUM_API_BASE = "https://api.allium.so/api/v1/explorer"
ALLIUM_MAX_ROWS = 10_000  # single-wallet queries return <100 rows; this is a safety cap
ALLIUM_POLL_INTERVAL = 3  # seconds between status checks
ALLIUM_POLL_TIMEOUT = 180  # max seconds to wait for a query to complete

# --- Arbitrum Sepolia ---
ARBITRUM_SEPOLIA_RPC = os.getenv("ARBITRUM_SEPOLIA_RPC", "https://sepolia-rollup.arbitrum.io/rpc")
ARBITRUM_SEPOLIA_CHAIN_ID = 421614
ARBITRUM_SEPOLIA_PRIVATE_KEY = (
    os.getenv("ARBITRUM_SEPOLIA_PRIVATE_KEY") or os.getenv("PRIVATE_KEY", "")
)

# --- Deployed Contract Addresses (empty until deployed → demo mode) ---
ATTESTATION_REGISTRY_ADDRESS = os.getenv("ATTESTATION_REGISTRY_ADDRESS", "")
CREDIT_ORACLE_ADDRESS = os.getenv("CREDIT_ORACLE_ADDRESS", "")
LENDING_POOL_ADDRESS = os.getenv("LENDING_POOL_ADDRESS", "")
# ERC20 lending asset (USDG / MockUSDG) — only needed for pool-side reads;
# the score push itself only touches the CreditOracle.
USDG_TOKEN_ADDRESS = os.getenv("USDG_TOKEN_ADDRESS", "")

# --- Model Artifacts ---
MODEL_DIR = BACKEND_DIR / "model"
MODEL_PKL_PATH = MODEL_DIR / "model.pkl"
FEATURE_CONFIG_PATH = MODEL_DIR / "feature_config.json"

# --- Contract ABIs (extracted from Foundry build artifacts) ---
CONTRACTS_DIR = PROJECT_ROOT / "contracts"

# --- Explorer link used by the push_score CLI ---
SEPOLIA_EXPLORER_TX_URL = "https://sepolia.arbiscan.io/tx/"


def _load_abi(contract_name: str) -> list:
    """Load ABI from pipeline/contracts/ (shipped with repo) or Foundry output."""
    # First try the shipped ABI files (works on Render without Foundry)
    shipped_path = Path(__file__).parent / "contracts" / f"{contract_name}.json"
    if shipped_path.exists():
        with open(shipped_path) as f:
            artifact = json.load(f)
        return artifact["abi"]

    # Fall back to Foundry build output (local development)
    artifact_path = CONTRACTS_DIR / "out" / f"{contract_name}.sol" / f"{contract_name}.json"
    if not artifact_path.exists():
        raise FileNotFoundError(
            f"ABI not found. Checked {shipped_path} and {artifact_path}."
        )
    with open(artifact_path) as f:
        artifact = json.load(f)
    return artifact["abi"]


def get_oracle_abi() -> list:
    return _load_abi("CreditOracle")


def get_registry_abi() -> list:
    return _load_abi("OffchainAttestationRegistry")


def get_pool_abi() -> list:
    return _load_abi("LendingPool")


def get_usdg_abi() -> list:
    """Standard ERC20 ABI (shipped as MockUSDG — same interface as USDG)."""
    return _load_abi("MockUSDG")
