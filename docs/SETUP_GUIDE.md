# Arbora Protocol — Setup & Reproduction Guide

Complete instructions for running Arbora Protocol locally from a clean checkout.

> **Network**: Arbitrum Sepolia · **Chain ID**: 421614 · **Lending Asset**: Paxos USDG · **Collateral**: ETH

---

## Architecture Overview

Arbora Protocol is a four-layer system. Data flows left to right: raw blockchain history → credit score → smart contract → lending UI.

```
┌─────────────────┐   ┌──────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│  Layer 1        │   │  Layer 2             │   │  Layer 3           │   │  Layer 4           │
│  ML Credit      │──▶│  Smart Contracts     │◀──│  Scoring Pipeline  │   │  React Frontend    │
│  Scorecard      │   │  Arbitrum Sepolia    │   │  FastAPI + Allium  │──▶│  ethers v6         │
│  AUC 0.8182     │   │  USDG / ETH Pool     │   │  EIP-1559 Push     │   │  Web3Modal         │
└─────────────────┘   └──────────────────────┘   └────────────────────┘   └────────────────────┘
```

**Layer 1 — Credit Scorecard** (`backend/model/`): FICO-style logistic regression trained on 115,687 onchain DeFi borrowers across 5 blockchains. 10 behavioral features → 24 one-hot columns → 0–100 credit score. Model is frozen and ships as `model.pkl`.

**Layer 2 — Smart Contracts** (`contracts/`): Three Solidity contracts on Arbitrum Sepolia. `OffchainAttestationRegistry` stores FICO attestations with Sybil-resistant identity persistence. `CreditOracle` blends onchain score + attestation into a composite score. `LendingPool` accepts USDG deposits and ETH-collateralized USDG loans priced by the composite score on a continuous curve.

**Layer 3 — Scoring Pipeline** (`backend/pipeline/`): FastAPI microservice that takes a wallet address, queries 5 blockchains via Allium SQL, runs the frozen model, and pushes the result to `CreditOracle` on Arbitrum Sepolia as an EIP-1559 transaction. Supports three data tiers (live/cached/synthetic) so the demo works with zero configuration.

**Layer 4 — Frontend** (`frontend/`): React 19 + Vite + Tailwind + ethers v6. Wallet scoring flow, composite score gauge, factor breakdown, attestation simulator, and full lending desk (deposit / borrow / repay / liquidate) — all enforcing Arbitrum Sepolia.

---

## Live Contract Addresses — Arbitrum Sepolia (Chain ID 421614)

Deployed 2026-09-25. Addresses also in `deployments/ARBITRUM_SEPOLIA.address`.

| Contract | Address | Arbiscan |
|---|---|---|
| `OffchainAttestationRegistry` | `0x812a283c68F76E169B1DbdBe23434Bc47f11a897` | [View](https://sepolia.arbiscan.io/address/0x812a283c68F76E169B1DbdBe23434Bc47f11a897) |
| `CreditOracle` | `0x93Fb575277eb28f5C0b3987aC233534cF8d11E8A` | [View](https://sepolia.arbiscan.io/address/0x93Fb575277eb28f5C0b3987aC233534cF8d11E8A) |
| `LendingPool` | `0xf3b1381013f6475b659b9468163ff23935dd3351` | [View](https://sepolia.arbiscan.io/address/0xf3b1381013f6475b659b9468163ff23935dd3351) |
| `USDG` (Paxos Global Dollar, 6 dec) | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` | [View](https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |
| `AdminPriceOracle` | `0xad4b47A38167FBA59CD2b4F63Bdb29090b4EAB22` | [View](https://sepolia.arbiscan.io/address/0xad4b47A38167FBA59CD2b4F63Bdb29090b4EAB22) |

---

## Prerequisites

| Tool | Version | Required for |
|---|---|---|
| Python | 3.11+ | Scoring pipeline & model inference |
| Node.js | 18+ | Frontend dev server |
| Foundry | latest | Contract tests & redeployment (optional) |
| Web3 wallet | any EIP-6963 | MetaMask, Coinbase Wallet, Rabby, WalletConnect |

Install Foundry (only needed to redeploy or run tests):

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/vi5hnuraj/Arbora-Protocol.git
cd Arbora-Protocol

# 2. Backend dependencies
pip install -r backend/pipeline/requirements.txt

# 3. Frontend dependencies
cd frontend && npm install && cd ..

# 4. Environment (everything is optional — demo works with an empty .env)
cp .env.example .env
```

**Terminal 1 — Scoring Backend:**

```bash
python3 -m uvicorn backend.pipeline.api:app --host 0.0.0.0 --port 8000
```

**Terminal 2 — Frontend:**

```bash
cd frontend && npm run dev
```

Open **http://localhost:3000**. Click any demo wallet chip for instant results, or enter any `0x` address for live scoring.

---

## Environment Variables

All variables are optional. An empty `.env` runs the full demo in synthetic/cached mode. One exception: the pay-per-score gate defaults to **on** — uncached `POST /score` calls cost 0.01 USDG unless `USDG_PAY_PER_SCORE=0` (cached demo wallets are always free).

| Variable | Description |
|---|---|
| `ALLIUM_API_KEY` | Live blockchain data via Allium SQL. Without it, uses cached or synthetic wallet data. Get one at [app.allium.so](https://app.allium.so). |
| `ARBITRUM_SEPOLIA_RPC` | Defaults to `https://sepolia-rollup.arbitrum.io/rpc` |
| `ARBITRUM_SEPOLIA_PRIVATE_KEY` | Required only to push scores onchain or redeploy. Never use a mainnet key here. |
| `ETHERSCAN_API_KEY` | Etherscan V2 key (works for Arbiscan via chain ID 421614). Only needed for contract verification. |
| `ATTESTATION_REGISTRY_ADDRESS` | `0x812a...1a897` (pre-filled in `.env.example`) |
| `CREDIT_ORACLE_ADDRESS` | `0x93Fb...3cF8d11E8A` (pre-filled in `.env.example`) |
| `LENDING_POOL_ADDRESS` | `0xf3b1...35dd3351` (pre-filled in `.env.example`) |
| `USDG_TOKEN_ADDRESS` | `0xFFC9...0b41892` (pre-filled in `.env.example`) |
| `USDG_PAY_PER_SCORE` | `1` (default) = uncached `/score` queries cost 0.01 USDG (x402-style 402 → onchain `Transfer` verification + replay guard). Set `0` to disable the gate for local dev. |
| `USDG_TREASURY` | Treasury receiving pay-per-score payments. Defaults to the EIP-55-checksummed deployer `0xD25F8736C3Efc19a7cb7A3D15f2aF22c2980E317`. |

---

## Data Sourcing Tiers

The scoring pipeline operates across three tiers, falling back automatically:

| Tier | Condition | Data Source | Latency |
|---|---|---|---|
| **0 — Live** | `ALLIUM_API_KEY` set | Real-time SQL across Arbitrum, Ethereum, Optimism, Polygon, Base | ~90 seconds |
| **1 — Cached** | No API key, known address | Pre-cached real wallet data (`demo_wallets.json`) | Instant |
| **2 — Synthetic** | No API key, unknown address | Deterministic features derived from the address hash | Instant |

Every API response includes a `data_source` field (`"live"`, `"cached"`, or `"synthetic"`) so the data origin is always transparent in the UI.

> **Arbitrum-Native Data Architecture**: Real-time SQL queries read Arbitrum onchain tables and multichain transfers, evaluating lending history and balances natively on Arbitrum.

---

## Demo Walkthrough

### Step 1: Score a Wallet

At `http://localhost:3000`, either click a **demo wallet chip** (instant cached result) or enter any `0x` address. The 4-step progress indicator shows:

1. **Wallet Lookup** — address resolution
2. **Data Collection** — querying blockchain data
3. **Credit Scoring** — model inference
4. **Score Publication** — onchain push (if private key is configured)

### Step 2: Read the Credit Dashboard

The dashboard surfaces:

- **Composite score gauge** (0–100)
- **Factor breakdown** with human-readable feature labels
- **Collateral ratio** (75%–150%) derived from the composite score
- **Data source badge** (live / cached / synthetic)
- **Activity tier notice** if the wallet score was adjusted for thin-file behavior
- **Full credit report** — per-feature tier ratings, benchmark comparisons, improvement suggestions

### Step 3: Connect a Wallet

Click **Connect Wallet** (Web3Modal). Supported: MetaMask, WalletConnect, Coinbase Wallet, Rabby, any EIP-6963 browser wallet.

Ensure the wallet is on **Arbitrum Sepolia (Chain ID 421614)**. A persistent wrong-chain banner gates all write actions and offers a one-click chain switch.

> **Testnet setup**: RPC `https://sepolia-rollup.arbitrum.io/rpc` · Chain ID `421614` · Currency `ETH` · Explorer `https://sepolia.arbiscan.io`

### Step 4: Submit an Attestation

The **Attestation Simulator** panel submits a FICO-equivalent credit attestation (300–850) via the owner-controlled registry. Without an attestation, the composite score is capped at 50% of the onchain score (thin-file cap). With a strong attestation, the full composite range unlocks.

### Step 5: Lend or Borrow

| Role | Actions |
|---|---|
| **Liquidity Provider** | `deposit(usdgAmount)` → earns on utilization · `withdraw(usdgAmount)` |
| **Borrower** | `borrow(usdgAmount)` + ETH as `msg.value` · `addCollateral`, `withdrawCollateral`, `repay`, `repayAll` |
| **Liquidator** | `liquidate(borrower, usdgAmount)` on positions with health factor < 100% · seizes ETH at a 5% bonus |

The collateral curve maps composite score to required collateral:

| Composite Score | Required Collateral |
|---|---|
| 0–20 | 150% |
| 20–50 | 150% → 120% (linear) |
| 50–70 | 120% → 100% (linear) |
| 70–85 | 100% → 85% (linear) |
| 85–100 | 85% → 75% (linear) |

Onchain this is a continuous piecewise-linear curve: breakpoints `[20, 50, 70, 85, 100]` → bps `[15000, 15000, 12000, 10000, 8500, 7500]`, re-tunable via `setCollateralCurve`.

---

## Smart Contract Tests

```bash
cd contracts
forge test
```

**122 tests across 6 suites** — unit, fuzz, and integration — covering:

- Composite score math and attestation lifecycle
- Sybil-resistant identity persistence across wallet rebinds
- Collateral curve interpolation and boundary conditions
- USDG decimal normalization (6 decimals)
- Health factors, liquidation with 5% bonus
- Price oracle staleness enforcement

```bash
forge test -vvv --gas-report   # verbose with gas breakdown
```

Gas benchmarks: `borrow` ≈186k · `deposit` ≈114k · `liquidate` ≈96k · `LendingPool` runtime ≈9.5 kB (well under 24 kB limit).

---

## Redeployment / Porting

The protocol is already live on Arbitrum Sepolia. Use these commands only to port to another network (e.g. Robinhood Chain / Orbit L2):

```bash
cd contracts && forge install && forge build

source ../.env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url $ARBITRUM_SEPOLIA_RPC \
  --broadcast \
  --verify
```

The deploy script creates `MockUSDG` (6 dec) unless `USDG_TOKEN_ADDRESS` is set, and `AdminPriceOracle` unless `PRICE_ORACLE_ADDRESS` is set. After deployment, update `ATTESTATION_REGISTRY_ADDRESS`, `CREDIT_ORACLE_ADDRESS`, `LENDING_POOL_ADDRESS`, and `USDG_TOKEN_ADDRESS` in `.env` and `frontend/.env`.

To port to **Robinhood Chain** (where real Paxos USDG natively lives), pass `USDG_TOKEN_ADDRESS` pointing to the native USDG contract. No contract code changes are required.

---

## REST API Reference

Base URL: `http://localhost:8000`

### `POST /score`

```json
// Request
{ "address": "0x1234...abcd" }

// Response
{
  "address": "0x1234...abcd",
  "credit_score": 44,
  "raw_model_score": 44,
  "chains_used": 5,
  "data_completeness": "5-chain history",
  "data_source": "cached",
  "activity_tier": "full_history",
  "activity_note": null,
  "factor_breakdown": [
    {
      "feature": "lending_active_days",
      "display_name": "Borrowing protocol activity (days)",
      "bin": "[15, inf)",
      "coefficient": -1.23,
      "is_reference": false
    }
  ],
  "composite_score": 22,
  "collateral_ratio_bps": 14800,
  "tx_hash": null,
  "error": null
}
```

`composite_score`, `collateral_ratio_bps`, and `tx_hash` are `null` in demo mode (no private key / no contract addresses configured).

### `POST /score/stream`

Same payload. Returns Server-Sent Events progress stream:

`start` → `arbitrum_start` → `arbitrum_done` → `crosschain_start` → `crosschain_done` → `queries_complete` → `model_start` → `model_done` → `push_start` → `push_done` → `result`

> Event stages represent real backend execution milestones as Arbitrum and multichain data are ingested.

### `GET /health`

```json
{
  "status": "ok",
  "model_loaded": true,
  "allium_configured": false,
  "oracle_configured": false
}
```

---

## Project Structure

```
Arbora-Protocol/
├── backend/
│   ├── data/
│   │   ├── queries/            # 6 Allium SQL files (arbitrum.* + crosschain.*)
│   │   └── raw/                # Training CSVs (gitignored)
│   ├── model/
│   │   ├── train.py            # Scorecard training (frozen)
│   │   ├── score.py            # Inference module
│   │   ├── model.pkl           # Frozen logistic regression (AUC 0.8182)
│   │   ├── feature_config.json # Bin definitions, coefficients, display names
│   │   └── validation_report.md
│   └── pipeline/
│       ├── api.py              # FastAPI — POST /score, POST /score/stream, GET /health
│       ├── config.py           # Env vars + Arbitrum Sepolia defaults
│       ├── data_sources.py     # Three-tier data sourcing
│       ├── activity_tier.py    # Thin-file score adjustments
│       ├── scoring_queries.py  # Parameterized Allium SQL
│       ├── onchain.py          # EIP-1559 score push to chain 421614
│       ├── demo_wallets.json   # Cached wallets for keyless demo
│       └── requirements.txt
├── contracts/
│   ├── src/
│   │   ├── LendingPool.sol
│   │   ├── CreditOracle.sol
│   │   ├── OffchainAttestationRegistry.sol
│   │   ├── oracles/            # AdminPriceOracle, ChainlinkPriceOracle
│   │   ├── mocks/              # MockUSDG (6 dec), MockAggregator
│   │   └── interfaces/         # IPriceOracle, IAggregatorV3
│   ├── test/                   # 122 tests — unit / fuzz / integration
│   ├── script/                 # Deploy.s.sol, DeployUsdgPool.s.sol, Demo.s.sol
│   └── foundry.toml
├── frontend/
│   ├── src/
│   │   ├── components/         # layout / scoring / lending / attestation / hero
│   │   ├── config/             # Contract addresses, Web3Modal setup
│   │   ├── hooks/              # useWallet, useContracts
│   │   └── lib/                # ethers helpers, network switching
│   └── package.json
├── deployments/
│   └── ARBITRUM_SEPOLIA.address
└── docs/
    ├── OVERVIEW.md             # Project overview & value proposition
    ├── SETUP_GUIDE.md          # This file
    ├── ARCHITECTURE.md         # System architecture & data flows
    ├── WHITEPAPER.md           # Model methodology & protocol economics
    ├── DEVELOPMENT.md          # Engineering process & build log
    └── RESOURCES.md
```

---

## Troubleshooting

**`Failed to fetch` or network error in the UI**
The scoring backend must be running on port 8000. The Vite dev server proxies `/score` and `/health` to `http://localhost:8000`.

**`No module named 'backend'`**
Run `python3 -m uvicorn backend.pipeline.api:app` from the **project root** (`Arbora-Protocol/`), not from inside `backend/` or `backend/pipeline/`.

**Wallet won't connect / stuck on wrong chain**
Ensure the wallet is configured for Arbitrum Sepolia (Chain ID 421614). The UI shows a persistent wrong-chain banner with a one-click switch. Manual RPC: `https://sepolia-rollup.arbitrum.io/rpc`.

**Contract transactions fail**
Arbitrum Sepolia uses native ETH for gas. Fund the wallet from the Arbitrum Sepolia faucet before executing any write transactions.

**Frontend shows "Contracts not configured"**
The `VITE_*` contract addresses are not set in `frontend/.env`. Scoring and demo panels still work; fill in the addresses from `deployments/ARBITRUM_SEPOLIA.address` to enable onchain writes.

**`forge test` fails with missing dependencies**
Run `forge install` inside `contracts/` first to fetch `forge-std` and `openzeppelin-contracts` submodules.
