# Arbora Protocol — System Architecture

> **Deployment**: Arbitrum Sepolia · Chain ID 421614 · Live since 2026-09-25

---

## System Diagram

```
                  LAYER 1                    LAYER 2                   LAYER 3                  LAYER 4
            Data & Scoring Model          Smart Contracts           Scoring Pipeline             Frontend
            ────────────────────          ───────────────           ────────────────             ────────

            ┌──────────────────┐
            │  Allium Explorer │
            │  SQL Warehouse   │
            │                  │
  Arb    ──▶│  Query A:        │──┐
  ETH    ──▶│  Arbitrum lending│  │   ┌──────────────────────┐   ┌──────────────────┐   ┌──────────────────┐
  Opt    ──▶│  & balances      │  ├──▶│                      │   │                  │   │                  │
  Poly   ──▶│                  │  │   │  CreditOracle        │   │  FastAPI         │   │  React 19 + Vite │
  Base   ──▶│  Query B:        │──┘   │  ├ onchain scores    │◀──│  POST /score     │   │  Score gauge     │
            │  multichain tx   │      │  ├ composite math    │   │  POST /score/    │   │  Factor table    │──▶ Wallet
            │  DEX + bridge    │      │  └ identity history  │   │    stream (SSE)  │   │  Attestation UI  │    (MetaMask
            └──────────────────┘      └──────────┬───────────┘   │  GET /health     │   │  Lending desk    │     tx)
                                                 │               └──────────────────┘   └──────────────────┘
            ┌──────────────────┐      ┌──────────▼───────────┐
            │  Logistic Regr.  │      │  OffchainAttestation │◀────── admin sets FICO attestation (MetaMask tx)
            │  10 features     │      │  Registry            │
            │  24 one-hot cols │      │  ├ FICO attestations │
            │  AUC 0.8182      │      │  ├ identity hash     │
            │  (frozen)        │      │  └ Sybil resistance  │
            └──────────────────┘      └──────────┬───────────┘
                                                 │
                                      ┌──────────▼───────────┐
                                      │  LendingPool         │◀────── deposit / borrow / repay (MetaMask tx)
                                      │  USDG debt           │
                                      │  ETH collateral      │
                                      │  Curve: 75%–150%     │
                                      └──────────────────────┘

                                      All contracts on Arbitrum Sepolia (chain ID 421614)
```

**Data flows**:
1. Allium SQL warehouse returns raw lending + cross-chain data from 5 chains (Tier 0 — live only when `ALLIUM_API_KEY` is set; fallback to cached or synthetic)
2. Scoring pipeline runs two concurrent SQL queries → extracts 10 features → frozen model inference → pushes score to `CreditOracle` via EIP-1559
3. `CreditOracle` reads attestation state from `OffchainAttestationRegistry` → computes composite score on-read
4. `LendingPool` calls `CreditOracle` to determine each borrower's collateral requirement
5. Frontend reads composite scores and collateral ratios from contracts; renders factor breakdown from the API response

---

## Layer 1 — Data and Credit Scorecard

### Training Dataset

| Property | Value |
|---|---|
| Total wallets | 115,687 |
| Liquidated (positive label) | 15,889 (13.7%) |
| Label source | Onchain lending liquidation events (Aave v3 / Radiant) |
| Feature chains | Arbitrum (primary) + Ethereum, Optimism, Polygon, Base |
| Data infrastructure | Allium Explorer SQL (institutional-grade) |

Labels derive from empirical liquidation and default events across premier onchain lending protocols. Protocols with non-standard liquidation penalties or debt auctions were normalized to ensure consistent label semantics across the borrower population.

### Feature Engineering

Each continuous feature is binned into 3–5 discrete risk tiers. The lowest-risk bin is the **reference category** (dropped from one-hot encoding), so retained coefficients represent the penalty for being in that tier relative to the safest bucket — the FICO scorecard method.

| Feature | Category | Allium Table |
|---|---|---|
| Borrowing protocol activity (days) | Lending behavior | `arbitrum.lending.loans` |
| Repayment consistency ratio | Lending behavior | `arbitrum.lending.repayments` |
| Loan repayment count | Lending behavior | `arbitrum.lending.repayments` |
| Distinct assets borrowed | Lending behavior | `arbitrum.lending.loans` |
| Portfolio value (USD) | Financial profile | `arbitrum.assets.fungible_balances_latest` |
| Stablecoin allocation | Financial profile | `arbitrum.assets.fungible_balances_latest` |
| Recent accumulation trend | Financial profile | `crosschain.assets.transfers` |
| Multichain transaction volume | Cross-chain | `<chain>.raw.transactions` |
| Multichain DEX activity | Cross-chain | `crosschain.dex.trades` |
| Blockchain networks used | Cross-chain | `crosschain.bridges.transfers` |

**Result**: 24 binary one-hot columns from 10 raw features → L2-regularized logistic regression (C=1.0, balanced class weights, 5-fold stratified CV) → P(not liquidated) → scaled to 0–100 integer score.

**Model frozen**: 2026-04-16. Will not be retrained.

> **Arbitrum-Native Data Architecture**: Allium SQL queries run against Arbitrum tables (`arbitrum.*`) and unified multichain tables (`crosschain.*`), capturing real-time lending behavior (Aave v3 / Radiant), wallet token holdings, and crosschain activity.

### Key Model Statistics

| Metric | Value |
|---|---|
| AUC-ROC (5-fold CV) | **0.8182** |
| Precision | 0.9508 |
| Recall | 0.7208 |
| Dominant coefficient | Borrowing activity 15+ days → **−1.23** |
| Median score (non-liquidated) | 71 |
| Median score (liquidated) | 29 |

---

## Layer 2 — Smart Contracts

Three Solidity contracts — Foundry, OpenZeppelin v5, solc 0.8.24, 200 optimizer runs — targeting Arbitrum Sepolia (chain ID 421614). The same bytecode runs unchanged on Robinhood Chain (Arbitrum Orbit L2, mainnet chain ID 4663 / testnet 46630), where Paxos USDG natively lives.

### Deployed Addresses — Arbitrum Sepolia

| Contract | Address | Purpose |
|---|---|---|
| `OffchainAttestationRegistry` | `0x812a283c68F76E169B1DbdBe23434Bc47f11a897` | FICO attestations + Sybil-resistant identity |
| `CreditOracle` | `0x93Fb575277eb28f5C0b3987aC233534cF8d11E8A` | Onchain scores + composite math |
| `LendingPool` | `0xf3b1381013f6475b659b9468163ff23935dd3351` | USDG loans with ETH collateral |
| `USDG` (Paxos Global Dollar) | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` | Debt and liquidity asset (6 decimals) |
| `AdminPriceOracle` | `0xad4b47A38167FBA59CD2b4F63Bdb29090b4EAB22` | ETH/USD price for collateral valuation |

### OffchainAttestationRegistry

Stores FICO-equivalent credit attestations with **persistent identity across wallet resets**.

In this build, attestations are owner-published (`setAttestation` is `onlyOwner`). In production, a ZK verifier contract (Brevis or Primus) would be granted write access and would call `setAttestation` after validating zero-knowledge proofs derived from offchain credit bureau data. The data model and every downstream contract remain unchanged.

**Sybil resistance mechanics**:

Each attestation carries a `bytes32 identityHash` derived deterministically from the ZK proof — same person, same hash, regardless of which wallet submits. The registry maintains three mappings:

```
_historicalOnchainScores[identityHash]  → persistent score surviving wallet rebinds
_identityToCurrentWallet[identityHash]  → current wallet holding this identity
_walletToIdentity[address]              → reverse lookup
```

**Rebind behavior**: When an attestation transfers to a new wallet whose `identityHash` is already bound to a different wallet, the registry clears the old wallet's attestation, preserves the historical score, and binds the identity to the new wallet. A wallet created to escape bad credit inherits that credit history. History is portable and inescapable.

Only `CreditOracle` may call `updateHistoricalScore`. This is enforced via access control set once via `setCreditOracle`.

### CreditOracle

Stores per-wallet onchain scores pushed by the pipeline. Computes composite scores **on-read**:

```
┌─────────────────────────────────────────────────────────────────┐
│  No attestation (thin-file cap):                                 │
│    composite = (onchainScore × onchainOnlyMultiplier) / 100     │
│    default multiplier = 50 → max composite = 50                  │
│                                                                  │
│  With attestation:                                               │
│    baseline = (offchainScore × 70) / 100                        │
│    boost    = (onchainScore  × 40) / 100                        │
│    composite = min(100, baseline + boost)                        │
└─────────────────────────────────────────────────────────────────┘
```

All three multipliers are `uint8` state variables, admin-settable, each capped at 100.

**FICO mapping**: `mapFicoToZero100` linearly maps FICO 300–850 → 0–100. FICO 850 = 100, FICO 575 = 50.

**Fresh wallet with attestation**: If a wallet has no onchain score but has an attestation with a historical score from a prior wallet rebind, the oracle uses that historical score instead of zero — the rebind mechanism that prevents clean-slate abuse.

### LendingPool

**USDG is the liquidity/debt asset. Native ETH is the collateral.**

- LPs: `deposit(usdgAmount)` → `withdraw(usdgAmount)` (only for unlent liquidity)
- Borrowers: `borrow(usdgAmount)` with `msg.value` = ETH collateral → `addCollateral` / `withdrawCollateral` / `repay(usdgAmount)` / `repayAll()`
- Liquidators: `liquidate(borrower, usdgAmount)` when health factor < 100%

**Collateral curve** (continuous piecewise-linear):

```
Score:      0          20         50         70         85        100
            │          │          │          │          │          │
Bps:      15000 ─────15000───▶12000───▶10000 ───▶ 8500───▶7500
Ratio:    150%         150%        120%       100%       85%        75%
```

Stored as breakpoints `[20, 50, 70, 85, 100]` and ratios `[15000, 15000, 12000, 10000, 8500, 7500]` bps. Re-tunable via `setCollateralCurve` with sanity bounds. Ratio is fixed at origination; position cannot be liquidated if the curve is later tightened.

**Liquidation**: Aave-style partial. Liquidator repays USDG → seizes ETH at repaid value + 5% bonus (owner-settable, capped at 20%) → residual collateral returns to borrower when debt = 0.

**Health factor** = `collateralUSD / requiredUSD`. Below 100% → liquidatable.

**Safety features**: `ReentrancyGuard`, `SafeERC20`, `Pausable` (pause blocks deposits/borrows/moves but keeps `withdraw` and `repay` open for exits), custom errors, NatSpec throughout.

**Oracle**: pluggable `IPriceOracle`. `AdminPriceOracle` (owner-fed) on testnet, `ChainlinkPriceOracle` (staleness-guarded, decimal-normalized) in production. Pool enforces max price age (`default 7d`, capped at 30d) and rejects zero/negative prices.

---

## Layer 3 — Scoring Pipeline

FastAPI microservice (`backend/pipeline/`) exposing three endpoints:

| Endpoint | Description |
|---|---|
| `POST /score` | Score wallet, optionally push to oracle, return JSON |
| `POST /score/stream` | Same — returns Server-Sent Events progress stream |
| `GET /health` | Status: model loaded, Allium configured, oracle configured |

### Three-Tier Data Sourcing

```
ALLIUM_API_KEY set?
      │
      ├── Yes → Tier 0: Live Allium SQL (~90s)
      │          Two concurrent queries via ThreadPoolExecutor
      │
      └── No → Address in demo_wallets.json?
               │
               ├── Yes → Tier 1: Cached response (instant)
               │          Real features captured during development
               │
               └── No → Tier 2: Deterministic synthetic (instant)
                          Features derived from SHA-256 of address
                          Same address always → same features
```

Every response carries `data_source: "live" | "cached" | "synthetic"`. The pipeline never silently degrades.

### Allium Query Architecture

Two SQL queries run concurrently:

| Query | Data Extracted | Required? |
|---|---|---|
| **Query A** — Arbitrum lending | `lending_active_days`, `borrow_repay_ratio`, `repay_count`, `unique_borrow_tokens`, `current_total_usd`, `stablecoin_ratio`, `net_flow_usd_90d` | Must succeed for Tier 0 |
| **Query B** — Multichain & Cross-chain | `crosschain_total_tx_count`, `crosschain_dex_trade_count`, `chains_active_on`, `has_used_bridge` | Fails gracefully → cross-chain features default to zero |

Query B starts with a 3-second delay to avoid consecutive Allium rate-limit hits. Each query polls every 3 seconds with a 180-second timeout.

### Onchain Score Push

After model inference, the pipeline broadcasts an **EIP-1559 (type-2) transaction** to Arbitrum Sepolia (chain ID 421614):

```python
CreditOracle.setOnchainScore(address, score, chainsUsed)
```

It then reads back:
- `CreditOracle.getCompositeScore(address)` → composite score
- `LendingPool.getBorrowerCollateralRatioBps(address)` → collateral ratio

If no private key / contract addresses are configured: push is skipped, `composite_score`, `collateral_ratio_bps`, and `tx_hash` return `null`, and an explanatory `error` string is included. The endpoint still returns a full score.

### Activity Tier Adjustments

Applied after model inference, before the onchain push:

| Tier | Condition | Score Adjustment |
|---|---|---|
| No onchain activity | Zero transactions found | Score = 0; no push |
| No lending history | General activity, zero onchain lending events | Raw score × 0.6 |
| Thin history | < 2 active lending days | Raw score × 0.8 |
| Full history | ≥ 2 active lending days | 1.0× (unchanged) |

This corrects for the model's mathematically valid but economically misleading output for thin-file wallets — "low risk from no exposure" ≠ "low risk from responsible management."

### SSE Progress Events

`/score/stream` emits real-time events as each backend stage completes:

```
start → arbitrum_start → arbitrum_done → crosschain_start → crosschain_done
      → queries_complete → model_start → model_done
      → push_start → push_done → result
```

The frontend renders a live network map with EVM blockchain nodes (Arbitrum, Ethereum, Optimism, Polygon, Base) that light up as their data arrives. Events represent real backend execution milestones.

---

## Layer 4 — Frontend

React 19 + Vite + Tailwind CSS 4 + ethers.js v6 + Web3Modal v5.

### Network Enforcement

Every write action is gated on **Arbitrum Sepolia (chain ID 421614)**. A persistent `NetworkBanner` component offers one-click `wallet_switchEthereumChain` → `wallet_addEthereumChain`. All write buttons are disabled while on the wrong chain.

Contract addresses come from `VITE_*` environment variables. Missing/zero addresses resolve to `null`; the UI renders a "Contracts not configured" notice instead of crashing. Scoring and demo panels remain functional.

All transactions go through a shared `sendWalletTx` helper that estimates gas via `estimateGas` and builds EIP-1559 transactions with explicit `maxFeePerGas` / `maxPriorityFeePerGas` — preventing the stale gas price issue common with MetaMask on testnets.

### User Flow

| Step | UI Element | What Happens |
|---|---|---|
| 1 | Wallet search bar | Address / ENS submitted → 4-step SSE progress indicator |
| 2 | Score dashboard | Composite score gauge (hero) · factor table · collateral ratio · activity tier badge |
| 3 | Full credit report | Per-feature tier ratings · benchmark vs. top wallets · improvement suggestions |
| 4 | Attestation simulator | Owner submits FICO attestation → gauge re-renders live from onchain read |
| 5 | Lending desk | LP deposit/withdraw · borrower borrow/repay · liquidator health-factor watch |

---

## Collateral Curve Calibration Matrix

Composite score → collateral ratio for representative borrower profiles.
FICO mapped linearly: FICO 300 = 0, FICO 850 = 100.

| | No FICO | FICO 500 (→36) | FICO 650 (→64) | FICO 780 (→87) | FICO 850 (→100) |
|---|---|---|---|---|---|
| **No onchain (0)** | composite 0 → **150%** | composite 25 → **148%** | composite 45 → **125%** | composite 61 → **110%** | composite 70 → **100%** |
| **Weak (20)** | composite 10 → **150%** | composite 35 → **140%** | composite 53 → **117%** | composite 69 → **101%** | composite 78 → **95%** |
| **Median (50)** | composite 25 → **148%** | composite 45 → **125%** | composite 65 → **108%** | composite 81 → **93%** | composite 90 → **82%** |
| **Strong (80)** | composite 40 → **130%** | composite 57 → **115%** | composite 77 → **95%** | composite 93 → **81%** | composite 100 → **75%** |
| **Max (100)** | composite 50 → **120%** | composite 65 → **108%** | composite 85 → **85%** | composite 100 → **75%** | composite 100 → **75%** |

**Matrix reading**:
- **Top-left** (no data): standard DeFi → 150%
- **Bottom-left** (onchain only): the 50% cap floors collateral at ~120%, even with a perfect onchain score
- **Top-right** (FICO 850, no DeFi history): 100% collateral — competitive with bank lending
- **Bottom-right** (strong both): 75% — genuinely undercollateralized, better than a bank can offer

The thesis in one row: a wallet with onchain score 80 goes from **130% collateral** (no FICO) → **95%** (FICO 650) → **75%** (FICO 850). The offchain attestation unlocks sub-100% terms.

---

## End-to-End Data Flow — Single Wallet Scoring

**Input**: `0xa6292d924098f50eaa14f0bed07a9eef2ac82f91` (Active borrower demo wallet)

```
1. Frontend: POST /score {"address": "0xa629..."}

2. Pipeline: validates address, checks rate limit, determines data source tier
   → Tier 1 (cached): returns instantly from demo_wallets.json
   → Tier 0 (live): runs two concurrent Allium SQL queries (~90s)

3. Query A result: lending_active_days=22, borrow_repay_ratio=0.98,
                   repay_count=34, unique_borrow_tokens=4,
                   current_total_usd=18420, stablecoin_ratio=0.31

4. Query B result: crosschain_total_tx_count=847, crosschain_dex_trade_count=112,
                   chains_active_on=4, has_used_bridge=true

5. model/score.py: bins features → one-hot → logistic regression
   → credit_score = 44  (raw, pre-activity adjustment)
   → activity_tier = "full_history" (22 active days) → no adjustment

6. Pipeline: CreditOracle.setOnchainScore("0xa629...", 44, 5)
   → EIP-1559 tx on chain 421614 → tx_hash = "0x..."

7. Pipeline: CreditOracle.getCompositeScore("0xa629...")
   → wallet has FICO-780 attestation (mapped to 87)
   → composite = min(100, 87×70/100 + 44×40/100) = min(100, 61+17) = 77

8. Pipeline: LendingPool.getBorrowerCollateralRatioBps("0xa629...")
   → score 77 in band [70, 85]: ratio = 10000 - (77-70)/(85-70) × (10000-8500) = 9300 bps = 93%

9. API returns:
   {
     "credit_score": 44,
     "composite_score": 77,
     "collateral_ratio_bps": 9300,
     "data_source": "cached",
     "chains_used": 5,
     "tx_hash": "0x...",
     "factor_breakdown": [...]
   }

10. Frontend: animates gauge to composite 77 (green-amber zone)
    → "93% collateral required" · "Prime" tier badge
    → factor table with display names

11. Attestation simulator: clear the FICO attestation
    → composite drops to 44×50/100 = 22 → collateral rises to ~148%
    Re-publish FICO-780 → composite restores to 77 → collateral back to 93%
    (Re-renders from live onchain reads, no page reload)
```

---

## Test Suite

```bash
cd contracts && forge test          # 122 tests, 6 suites, 0 failures
forge test -vvv --gas-report        # verbose + gas breakdown
```

| Suite | Coverage |
|---|---|
| `OffchainAttestationRegistry.t.sol` | Attestation lifecycle, Sybil resistance, rebind, access control |
| `CreditOracle.t.sol` | Composite math, thin-file cap, historical score, FICO mapping |
| `LendingPool.t.sol` | Deposit, withdraw, borrow, collateral ops, repay, liquidation, health factor |
| `ChainlinkPriceOracle.t.sol` | Price staleness, decimal handling, aggregator edge cases |
| `Mocks.t.sol` | MockUSDG (6 dec), MockAggregator |
| Fuzz | Curve interpolation boundary conditions, score arithmetic overflow guards |

**Gas** (indicative): `borrow` ≈ 186k · `deposit` ≈ 114k · `liquidate` ≈ 96k
**Contract size**: `LendingPool` runtime ≈ 9.5 kB (24 kB limit)
**Lint**: `forge lint` clean
