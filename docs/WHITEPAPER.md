# Arbora Protocol — Technical Whitepaper

**Live Demo**: [arbora-protocol.vercel.app](https://arbora-protocol.vercel.app/)
**Repository**: [github.com/vi5hnuraj/Arbora-Protocol](https://github.com/vi5hnuraj/Arbora-Protocol)

---

## 1. Problem Statement

DeFi lending protocols collectively trap hundreds of billions in excess collateral. Aave, Compound, MakerDAO — every major protocol applies the same blunt rule: post 150% or more of your loan value as collateral, or you cannot borrow. A wallet that has never missed a repayment across two years of active DeFi borrowing is treated identically to a wallet created this morning.

This is not a protocol design failure. It is an information gap. Protocols overcollateralize because they have no mechanism to distinguish creditworthy borrowers from non-creditworthy ones.

Traditional finance solved this with credit scoring. FICO and VantageScore model default probability from historical financial behavior using logistic regression with interpretable coefficients. A borrower with a 780 FICO pays materially less for a mortgage than one with a 620. The lender's portfolio performs better, the creditworthy borrower pays less, and capital flows to its highest-value use. DeFi has no equivalent underwriting infrastructure.

The capital cost is concrete: a $10,000 USDG borrow requires $15,000 in ETH collateral. The $5,000 excess earns nothing, locked in a contract that cannot distinguish good borrowers from bad ones.

---

## 2. Protocol Design

Arbora Protocol is a two-source composite credit scoring system that prices USDG-denominated loans by measured creditworthiness instead of uniform overcollateralization. It is deployed on **Arbitrum Sepolia (chain ID 421614)** for the Arbitrum Open House Singapore Buildathon and runs the same bytecode unchanged on Robinhood Chain (Arbitrum Orbit L2, mainnet chain ID 4663 / testnet 46630), where Paxos USDG natively lives.

**Lending mechanics**: LPs deposit USDG (Paxos Global Dollar, 6 decimals). Borrowers post native ETH as collateral via `borrow(usdgAmount)`. The required collateral ratio is computed from a continuous curve driven by the borrower's composite credit score — from **150% down to 75%**.

Two independent risk signals feed into the composite:

### Signal 1 — Onchain Behavioral Scorecard

A logistic regression model trained on **115,687 onchain DeFi borrowers** across five blockchains (Arbitrum, Ethereum, Optimism, Polygon, Base), using the FICO/VantageScore methodology: 10 behavioral features binned into discrete risk tiers, one-hot encoded, and passed through L2-regularized logistic regression with balanced class weights. Output: a 0–100 credit score with fully interpretable coefficients. Every factor's contribution to the score can be stated in a single sentence — a regulatory transparency requirement that black-box ML models cannot satisfy.

### Signal 2 — Offchain Credit Attestation (ZKredit Simulation)

Traditional FICO scores are verified via zero-knowledge proof and attested onchain without exposing personal data. In this build, an admin wallet writes attestations directly to `OffchainAttestationRegistry` — the same contract interface a ZK verifier (Brevis or Primus) would call in production. The protocol's data model does not change when the attestation source upgrades.

### Composite Score — Asymmetric Weighting

```
┌──────────────────────────────────────────────────────────────────┐
│ No attestation (thin-file cap):                                  │
│   composite = onchainScore × 0.50                                │
│                                                                  │
│ With attestation:                                                │
│   baseline  = offchainScore × 0.70                               │
│   boost     = onchainScore  × 0.40                               │
│   composite = min(100, baseline + boost)                         │
└──────────────────────────────────────────────────────────────────┘
```

The 50% cap on onchain-only scores is deliberate. A wallet that borrowed once and repaid once can score 98 — mathematically correct (zero ongoing exposure = zero liquidation risk) but economically misleading. Thin-file creditworthiness should not unlock institutional-grade undercollateralized lending. All multipliers are `uint8` state variables, owner-configurable, each capped at 100.

---

## 3. System Architecture

For implementation detail, see [ARCHITECTURE.md](ARCHITECTURE.md) and [SETUP_GUIDE.md](SETUP_GUIDE.md).

```
Layer 1: ML Scorecard          Layer 2: Smart Contracts        Layer 3: Scoring Pipeline      Layer 4: Frontend
─────────────────────          ────────────────────────        ─────────────────────────      ──────────────
Logistic Regression            OffchainAttestationRegistry     FastAPI + Allium SQL            React 19 + Vite
115,687 DeFi borrowers    ──▶  CreditOracle (composite)   ◀── EIP-1559 score push             ethers v6
11 features / AUC 0.8182       LendingPool (USDG/ETH)          Three-tier data sourcing        Web3Modal
```

**Layer 1 — Credit Scorecard** (`backend/model/`): FICO-style logistic regression, frozen at AUC 0.8182. 11 raw features → 24 one-hot columns → 0–100 score. Ships as `model.pkl`.

**Layer 2 — Smart Contracts** (`contracts/`): Three contracts on Arbitrum Sepolia (Foundry, OpenZeppelin v5, solc 0.8.24, 200 optimizer runs). 122 Foundry tests, 6 suites, 0 failures.

**Layer 3 — Scoring Pipeline** (`backend/pipeline/`): FastAPI microservice. Accepts wallet address → runs Allium SQL across 5 chains → infers score → pushes to `CreditOracle` via EIP-1559. Three data tiers (live/cached/synthetic) for zero-config demo operation.

**Layer 4 — Frontend** (`frontend/`): React 19 + Vite + Tailwind + ethers.js v6. Bloomberg-terminal aesthetic, 4-step progress flow, SSE-driven live network map, full lending desk.

---

## 4. Data and Model Methodology

### Training Dataset

| Metric | Value |
|---|---|
| Total borrower wallets | 115,687 |
| Liquidated wallets | 15,889 (13.7%) |
| Label source | Onchain lending liquidation events (Aave v3 / Radiant) |
| Feature data chains | Arbitrum, Ethereum, Optimism, Polygon, Base |
| Data infrastructure | Allium Explorer SQL (institutional-grade) |

Labels derive from empirical liquidation and default events across premier onchain lending protocols (Aave v3 and Radiant), with protocol-normalized liquidations to preserve clean training signal.

> **Arbitrum Native Data Pipeline**: Allium SQL queries run against Arbitrum tables (`arbitrum.*`) and multichain tables (`crosschain.*`), capturing real-time lending behavior, wallet balances, and cross-chain transfers natively on Arbitrum.

### Feature Engineering

Each continuous feature is binned into 3–5 discrete risk tiers. The lowest-risk bin is the reference category (dropped from one-hot encoding), so every retained coefficient represents the score *penalty* for being in that tier relative to the safest bucket — exactly how FICO scorecards work.

| Feature | Category | Risk Rationale |
|---|---|---|
| Borrowing protocol activity (days) | Lending behavior | Dominant signal. More active days = more market exposure = higher liquidation probability. |
| Repayment consistency ratio | Lending behavior | Balanced ratio near 1.0 signals disciplined debt management. |
| Loan repayment count | Lending behavior | Demonstrated track record of fulfilling obligations. |
| Distinct assets borrowed | Lending behavior | Borrowing across many token types increases complexity and liquidation surface. |
| Portfolio value (USD) | Financial profile | Larger portfolios buffer against liquidation. |
| Stablecoin allocation | Financial profile | Higher stablecoin ratio = conservative positioning = lower volatility exposure. |
| Recent accumulation trend | Financial profile | Positive 90-day net flow = accumulation phase = healthier balance sheet. |
| Cross-chain transaction volume | Cross-chain | Broad DeFi activity signals an established, experienced participant. |
| Cross-chain DEX activity | Cross-chain | Multi-chain DEX usage indicates DeFi sophistication. |
| Blockchain networks used | Cross-chain | Number of non-Arbitrum EVM chains with recorded activity. |
| Cross-chain bridge experience | Cross-chain | Bridge usage indicates comfort with cross-chain operations. |

### Model Training — Four Iterations

| Round | Change | Result |
|---|---|---|
| **1** | L2 logit with raw continuous features | AUC 0.81; multicollinearity inflated coefficient variance |
| **2** | FICO scorecard conversion (all features binned) | AUC 0.845; 25 sign flags (economically contradictory coefficient directions) |
| **3** | Dropped `total_lending_volume`; collapsed zero-repayment-ratio bin | Reduced sign flags; some remained |
| **4** | Dropped 7 correlated features (wallet age, high-frequency noise, etc.) | AUC **0.8182**; 11 features; **0 serious sign flags** |

### Top 5 Coefficients (Final Model)

| Feature | Bin | Coefficient | Economic Meaning |
|---|---|---|---|
| Borrowing protocol activity (days) | 15+ days | **−1.23** | Dominant signal — sustained exposure drives liquidation risk |
| Borrowing protocol activity (days) | 5–14 days | −1.05 | Same pattern, lower magnitude |
| Borrowing protocol activity (days) | 2–4 days | −0.80 | Even short active periods increase risk vs. single-day borrowers |
| Repayment consistency ratio | > 2.0× | −0.60 | Over-repaying signals position mismanagement or liquidation pressure |
| Repayment consistency ratio | 1.1–2.0× | −0.54 | Moderate imbalance vs. the 0.9–1.1 balanced reference bin |

### Model Performance

| Metric | Value |
|---|---|
| AUC-ROC (5-fold stratified CV) | **0.8182** |
| Precision | 0.9508 |
| Recall | 0.7208 |
| F1 | 0.8200 |
| Median score — non-liquidated | 71 |
| Median score — liquidated | 29 |

---

## 5. Smart Contract Design

### OffchainAttestationRegistry

Stores FICO-equivalent attestations with **persistent credit identity**. Each attestation contains a `bytes32 identityHash` derived deterministically from the ZK proof inputs (same offchain identity → same hash, regardless of wallet). The registry maintains:

- `_historicalOnchainScores`: persistent per-identity onchain score that survives wallet rebinding
- `_identityToCurrentWallet`: current wallet holding this identity
- `_walletToIdentity`: reverse lookup

**Sybil resistance via rebinding**: When an attestation transfers to a new wallet whose `identityHash` is already bound to a different wallet, the registry clears the old wallet's attestation and binds the identity to the new wallet — but carries the historical onchain score forward. A wallet created to escape a bad credit record inherits that record. Credit history is portable and inescapable, exactly as in traditional finance.

### CreditOracle

Stores onchain scores pushed by the scoring pipeline and computes composite scores on-read:

```solidity
// Onchain-only (thin-file cap):
composite = (onchainScore * onchainOnlyMultiplier) / 100;  // default multiplier: 50

// With attestation:
baseline = (offchainScore * offchainBaselineMultiplier) / 100;  // default: 70
boost    = (onchainScore  * onchainBoostMultiplier)    / 100;  // default: 40
composite = min(100, baseline + boost);
```

What this means in practice:

| Borrower Profile | Composite Score | Collateral Required |
|---|---|---|
| FICO 780, no DeFi history | ~56 | ~115% |
| Onchain-only power user (score 90, no FICO) | ~45 | ~122% |
| FICO 780 + 2 years DeFi history (score 75) | ~79 | ~88% |
| Best case: FICO 850 + onchain score 100 | 100 | 75% |

### LendingPool — Collateral Curve

USDG is the liquidity and debt asset (6 decimals). ETH is collateral (`borrow(usdgAmount)` with ETH as `msg.value`). The required collateral maps composite score through a continuous piecewise-linear curve:

```
Composite Score:   0    20         50         70       85    100
                   │    │          │          │        │      │
Collateral (bps): 15000 15000 → 12000 → 10000 → 8500 → 7500
```

Breakpoints and ratios are owner-re-tunable via `setCollateralCurve`. USDG amounts normalize internally (`usdgScale = 10^(18 - decimals)`). Collateral is priced through a pluggable `IPriceOracle` — `AdminPriceOracle` (owner-fed) on testnet, `ChainlinkPriceOracle` in production — with staleness enforcement (`maxPriceAge`, default 7 days, capped at 30 days).

**Liquidation**: Aave-style partial liquidation with a 5% bonus (owner-settable, capped at 20%). Liquidators repay USDG, seize ETH worth the repaid amount plus the bonus. Residual ETH collateral returns to the borrower when debt reaches zero. Health factor = `collateral_USD / required_USD`; below 100% the position is liquidatable.

### Test Coverage — 122 Tests, 6 Suites

```bash
cd contracts && forge test
```

| Suite | What It Covers |
|---|---|
| `OffchainAttestationRegistry.t.sol` | Attestation lifecycle, identity binding, Sybil resistance, access control |
| `CreditOracle.t.sol` | Composite score math, onchain-only cap, attestation integration |
| `LendingPool.t.sol` | Deposit/withdraw, borrow, collateral ops, repay, liquidation, health factor |
| `ChainlinkPriceOracle.t.sol` | Price staleness, decimal handling, aggregator edge cases |
| `Mocks.t.sol` | MockUSDG, MockAggregator behavior |
| Fuzz suites | Collateral curve interpolation, score boundary conditions |

Gas benchmarks: `borrow` ≈ 186k · `deposit` ≈ 114k · `liquidate` ≈ 96k · `LendingPool` runtime ≈ 9.5 kB (well under 24 kB limit). `forge lint` clean.

---

## 6. Scoring Pipeline — Data Sourcing Tiers

```
ALLIUM_API_KEY set?
       │
       ├── Yes → Tier 0: Live SQL across 5 chains (~90s)
       │          - arbitrum.lending.loans
       │          - crosschain.* activity
       │
       └── No  → Known address in demo_wallets.json?
                  │
                  ├── Yes → Tier 1: Cached response (instant)
                  │
                  └── No  → Tier 2: Synthetic features from address hash (instant)
```

Every response carries a `data_source` field (`"live"` / `"cached"` / `"synthetic"`) surfaced in the UI — the data origin is always transparent.

**Onchain push**: if `ARBITRUM_SEPOLIA_PRIVATE_KEY` and `CREDIT_ORACLE_ADDRESS` are set, the pipeline broadcasts an EIP-1559 transaction to chain 421614, writing the score to `CreditOracle`. Without configuration, the push is skipped and reported as `null` in the response — the full scoring flow still executes.

---

## 7. Activity Tier Adjustments (Thin-File Handling)

The model produces mathematically valid but economically misleading scores for wallets outside its training population. A wallet with zero lending history scores high because it has zero liquidation exposure — but that high score reflects *absence of risk*, not *proven creditworthiness*.

Post-inference adjustments correct for this before the score is pushed onchain:

| Activity Tier | Condition | Score Adjustment |
|---|---|---|
| **No activity** | No onchain transactions found | Score = 0; no push |
| **No lending history** | General onchain activity, zero lending interactions | Raw score × 0.6 |
| **Thin lending history** | < 2 active lending days | Raw score × 0.8 |
| **Full history** | ≥ 2 active lending days | No adjustment (1.0×) |

The frontend displays both the raw model score and the adjusted score with an explanation of the tier and what actions improve it.

---

## 8. Frontend & UX

**4-step progress flow** — inspired by online credit card applications:
1. Wallet Lookup (address / ENS resolution)
2. Data Collection (live network map showing 5 blockchains lighting up via SSE)
3. Credit Scoring (model inference progress)
4. Score Publication (onchain push status)

**Dashboard components**:
- Composite score gauge (semicircular arc, red → yellow → green)
- Factor breakdown table (human-readable feature names)
- Collateral ratio display
- Activity tier notice
- Data source badge
- Full credit report expansion (Experian-style: tier rating, qualitative impact, benchmark vs. top-scoring wallets, improvement suggestions)

**Wallet integration**: Web3Modal — MetaMask, WalletConnect, Coinbase Wallet, Rabby, all EIP-6963 wallets. Persistent wrong-chain banner with one-click `wallet_switchEthereumChain` / `wallet_addEthereumChain`.

**Lending desk**: USDG approval + deposit/withdraw for LPs; ETH collateral quoting + borrow/addCollateral/withdrawCollateral/repay/repayAll for borrowers; live health factor + liquidate for liquidators.

---

## 9. Two Independent Risk Domains

This section addresses the central design claim: that combining onchain and offchain signals provides more complete risk coverage than either alone.

There is no published evidence that onchain data improves FICO's prediction of default risk. This protocol does not claim it does.

The two signals measure structurally different risk domains:

| Risk Domain | FICO / Offchain | Onchain Behavioral |
|---|---|---|
| Bill payment history | ✅ | ❌ |
| Credit utilization | ✅ | ❌ |
| Income & employment stability | ✅ | ❌ |
| DeFi health factor management | ❌ | ✅ |
| Market volatility survival | ❌ | ✅ |
| Cross-chain protocol behavior | ❌ | ✅ |

A lender operating onchain faces risk in both domains. Measuring both provides more complete coverage than either alone — not because onchain data improves FICO, but because it covers a second risk surface FICO is structurally unable to see.

The auto-insurance analogy is precise: telematics (GPS driving data) does not improve credit score prediction. It measures actual driving behavior — a separate risk domain. Combining both reduces total information asymmetry.

**Concrete example**: A FICO 780 borrower with no DeFi history receives approximately 110% collateral based on their attestation alone. The same borrower with two years of responsible Arbitrum lending protocol usage — consistent repayments, no liquidations — receives approximately 76% collateral. The onchain data did not change the FICO score. It assessed a second independent risk domain, further reducing lender uncertainty. The 34-point collateral difference is the measurable value of that second signal.

---

## 10. Production Considerations

| Issue | Current Implementation | Production Path |
|---|---|---|
| **Scoring latency** | ~90s via ad-hoc Allium SQL | Materialized views / indexing service → single-digit seconds |
| **FICO mapping** | Linear 300–850 → 0–100 (dead space below 500) | Piecewise-linear or sigmoid mapping concentrated in 600–800 range |
| **Attestation source** | Admin `onlyOwner` (`setAttestation`) | ZK verifier contract (Brevis/Primus) calls registry — no data model change |
| **Loan rebinding** | No active-loan handling during wallet transfer | Force repayment, freeze at current terms, or implement debt transfer before rebind |
| **Interest accrual** | Not implemented (out of scope, documented in NatSpec) | Utilization-based interest curve (Aave/Compound model) |
| **Bad debt** | Liquidation bonus covers standard slippage | Insurance fund or protocol reserves for gaps beyond bonus |
| **Training data** | Aave v3 & Radiant onchain borrowers | Expand to universal cross-rollup lending positions |
| **Governance** | `onlyOwner` for all parameter changes | DAO / multisig with timelock for curve params, multipliers, liquidation bonus |
| **Security** | OZ v5, `ReentrancyGuard`, `Pausable`, `SafeERC20`, custom errors | Formal verification of score/curve math; audit; multisig |

**Composable infrastructure**: Any EVM lending protocol can query `CreditOracle` to read composite scores and adjust its own underwriting. Arbora becomes credit scoring infrastructure for DeFi — revenue via per-query or subscription fees to integrating protocols.

**Onchain hard inquiries**: Every `CreditOracle` query emits an event, creating a transparent inquiry trail. In production, query frequency becomes a negative model feature — penalizing wallets rapidly seeking credit across multiple protocols, exactly as FICO penalizes multiple hard inquiries.

---

## 11. Contract Addresses — Arbitrum Sepolia (Chain ID 421614)

Deployed 2026-09-25. Verified on [Arbiscan](https://sepolia.arbiscan.io).

| Contract | Address |
|---|---|
| `OffchainAttestationRegistry` | `0x812a283c68F76E169B1DbdBe23434Bc47f11a897` |
| `CreditOracle` | `0x93Fb575277eb28f5C0b3987aC233534cF8d11E8A` |
| `LendingPool` | `0xf3b1381013f6475b659b9468163ff23935dd3351` |
| `USDG` (Paxos Global Dollar, 6 decimals) | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` |
| `AdminPriceOracle` | `0xad4b47A38167FBA59CD2b4F63Bdb29090b4EAB22` |

---

## 12. Built With

| Component | Technology |
|---|---|
| Smart contracts | Solidity 0.8.24, Foundry, OpenZeppelin v5 |
| ML model | scikit-learn (LogisticRegression, L2, balanced weights) |
| Scoring pipeline | FastAPI, Web3.py, Allium Explorer SQL |
| Frontend | React 19, Vite, Tailwind CSS 4, ethers.js v6, Web3Modal |
| Data infrastructure | Allium (institutional blockchain data, 80+ chains) |
| Deployment | Arbitrum Sepolia, Vercel (frontend), Render (backend) |

---

*Arbora applies battle-tested credit scoring methodology to onchain data, because the trillion-dollar lending market will not move to DeFi until DeFi can underwrite with the same rigor the real world does.*
