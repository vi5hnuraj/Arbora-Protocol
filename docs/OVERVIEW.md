# Arbora Protocol — Project Overview

> **Arbitrum Open House Singapore: Online Buildathon**
> Built by vishnuraj · [github.com/vi5hnuraj/Arbora-Protocol](https://github.com/vi5hnuraj/Arbora-Protocol)

---

## The Problem

Every major DeFi lending protocol — Aave, Compound, MakerDAO — operates identically: post 150% collateral or you cannot borrow. There is no concept of a borrower's creditworthiness. A wallet that has maintained a healthy position across two years of active DeFi usage is treated the same as a wallet created this morning.

This is not an engineering limitation. It is an information problem. Protocols overcollateralize because they know nothing about who they are lending to.

Traditional finance resolved this decades ago with credit scoring. FICO and VantageScore use logistic regression trained on historical repayment behavior to price risk at the individual level. A 780 FICO pays less for a mortgage than a 620 FICO, and the lender's portfolio performs better as a result.

DeFi has no equivalent underwriting infrastructure. Arbora builds it.

---

## The Solution

Arbora Protocol is a two-source composite credit scoring system deployed on **Arbitrum Sepolia (chain ID 421614)** for the Arbitrum Open House Singapore Buildathon. The lending pool uses **Paxos USDG as the debt/liquidity asset** and **native ETH as collateral**. The same contracts run unchanged on Robinhood Chain (Arbitrum Orbit L2), where USDG natively lives.

Collateral requirements are set by a continuous piecewise-linear curve driven by a composite credit score — from **150% down to 75%** — replacing the fixed overcollateralization model entirely.

---

## Two Independent Risk Signals

### Signal 1 — Onchain Behavioral Score

A FICO-methodology logistic regression model trained on **115,687 onchain DeFi borrowers** across premier lending protocols (including Aave v3 on Arbitrum) and major EVM blockchains (Arbitrum, Ethereum, Optimism, Polygon, Base). The model uses **11 interpretable features** spanning:

- **Lending behavior**: borrowing protocol activity days, repayment consistency ratio, loan repayment count, distinct assets borrowed
- **Financial profile**: portfolio value, stablecoin allocation, accumulation trend
- **Cross-chain breadth**: transaction volume, chains active on, bridge usage, DEX activity

Output: a 0–100 credit score with explainable coefficients. Every feature's contribution can be stated in a single sentence — a regulatory requirement that black-box models cannot satisfy.

> **Arbitrum-Native Data Pipeline**: Real-time scoring queries run against Arbitrum onchain tables (`arbitrum.lending.loans`, `arbitrum.lending.repayments`, `arbitrum.assets.fungible_balances_latest`) alongside multichain activity tables to assess creditworthiness natively on Arbitrum.

### Signal 2 — Offchain Credit Attestation

Simulates ZKredit: traditional FICO scores are verified via zero-knowledge proofs and attested onchain without exposing personal data. In the current implementation, an admin sets attestations. In production, a ZK verifier contract (Brevis or Primus) would call this permissionlessly after validating the proof.

---

## Composite Scoring — Asymmetric Weighting by Design

The two signals combine asymmetrically:

- **Offchain attestation** establishes a competitive baseline — reflecting verified real-world creditworthiness.
- **Onchain behavior** boosts above that baseline — reflecting DeFi-native competence.
- **Onchain-only scores are capped at 50** — a high score from thin onchain activity (one borrow, one repay) is not equivalent to proven creditworthiness. This is the thin-file problem: mathematically correct but economically misleading.

All weighting parameters are configurable onchain by the protocol owner.

---

## Why Two Signals Are Better Than One

The value of combining onchain and offchain data is **not** that onchain data improves FICO's prediction of default risk. There is no published evidence for that claim, and Arbora does not make it.

Instead, the two sources measure **structurally different risk domains**:

| Risk Domain | Measured by |
|---|---|
| Bill payments, credit utilization, income stability | FICO / offchain attestation |
| Health factor management, market volatility survival, protocol interaction patterns | Onchain behavior |

A lender operating onchain faces risk in both domains. Measuring both provides more complete coverage than either alone.

The analogy is auto insurance telematics: insurers use GPS driving-behavior data alongside credit scores. Driving data does not improve credit prediction — it captures a separate risk surface that credit scores cannot see. The combination reduces total information asymmetry.

**Concrete example**: a FICO 780 borrower with no DeFi history gets 100–110% collateral based on their attestation alone. The same borrower with two years of responsible Arbitrum lending history — consistent repayments, no liquidations — gets 75–85% collateral. The onchain data did not change the FICO score. It assessed a second, independent risk domain.

---

## How It Works End-to-End

```
Wallet Address
      ↓
Allium SQL (5 chains, live) or cached/synthetic fallback
      ↓
11-feature extraction → Frozen logistic regression (AUC 0.8182)
      ↓
Onchain credit score pushed to CreditOracle (Arbitrum Sepolia)
      ↓
CreditOracle combines onchain score + FICO attestation → Composite score
      ↓
LendingPool reads composite score → Collateral ratio on continuous curve
      ↓
Borrower posts ETH → Borrows USDG at their credit-adjusted terms
```

The full scoring flow takes approximately 90 seconds with live data — comparable to applying for a credit card online.

---

## Deployment Status

| Component | Status |
|---|---|
| Smart contracts | Live on Arbitrum Sepolia (deployed 2026-09-25) |
| Test suite | 122 Foundry tests — 6 suites — 0 failures |
| Backend | FastAPI — x402 pay-per-score gate (0.01 USDG per uncached query) + zero-config demo mode |
| Frontend | React 19 + Vite, live at arbora-protocol.vercel.app |

Contract addresses are in [`deployments/ARBITRUM_SEPOLIA.address`](../deployments/ARBITRUM_SEPOLIA.address) and the root `README.md`.

---

## Handling the Thin-File Problem

The model was trained on onchain lending borrowers, so wallets with **no lending history** produce unexpectedly high raw scores — zero exposure means zero liquidation events, which the model reads as low risk. This is mathematically correct but economically misleading.

Arbora applies tiered post-inference adjustments:

| Activity Tier | Scale Factor |
|---|---|
| No lending history | 0.6× raw score |
| Minimal lending history | 0.8× raw score |
| Meaningful track record | 1.0× (full model score) |

The frontend displays both raw and adjusted scores with an explanation of the adjustment and what actions would improve the score.

---

## Sybil Resistance

Offchain attestations are anchored to a deterministic **identity hash** rather than directly to a wallet address. If a borrower rebinds their attestation to a new wallet, the new wallet **inherits the old wallet's full onchain credit history**. Creating a fresh wallet to escape a bad credit record does not work — the identity follows the person, not the key.

---

## Production Roadmap

- **ZKredit**: Replace admin attestations with Brevis/Primus ZK proofs for trustless, privacy-preserving credit verification.
- **Latency**: Pre-compute wallet features via materialized views. Model inference is already sub-millisecond; data retrieval is the only bottleneck.
- **Training expansion**: Add Aave, Compound, and MakerDAO liquidation labels for broader model generalization.
- **Bidirectional identity**: Onchain behavior feeds back into the persistent identity record — a portable, unforgeable credit profile spanning wallets, protocols, and chains.
- **Composable infrastructure**: Any lending protocol on any EVM network can query `CreditOracle` and adjust their own underwriting terms. Arbora becomes credit scoring infrastructure for the ecosystem.
- **Onchain hard inquiries**: Every `CreditOracle` query is logged via event emissions, mirroring FICO hard pulls. High query frequency becomes a negative model feature in production.

---

## Team & Hackathon

| | |
|---|---|
| **Event** | [Arbitrum Open House Singapore: Online Buildathon](https://openhouse.arbitrum.io/) |
| **Author** | vishnuraj — [github.com/vi5hnuraj](https://github.com/vi5hnuraj) |
| **Repository** | [github.com/vi5hnuraj/Arbora-Protocol](https://github.com/vi5hnuraj/Arbora-Protocol) |

---

*Arbora applies battle-tested credit scoring methodology to onchain data, because the trillion-dollar lending market will not move to DeFi until DeFi can underwrite with the same rigor the real world does.*

*For the full technical treatment — model methodology, contract design rationale, and composite score calibration — see [WHITEPAPER.md](WHITEPAPER.md).*
