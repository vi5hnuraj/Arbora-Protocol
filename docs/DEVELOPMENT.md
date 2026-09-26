# Arbora Protocol — Engineering Process & Development Log

> A phase-by-phase chronicle of the engineering decisions, iterations, and human-AI collaboration that produced Arbora Protocol for the **Arbitrum Open House Singapore Buildathon (Sep 14 – Oct 4, 2026)**.

The consistent pattern throughout: AI generates code, proposes designs, and runs experiments. The engineer reviews at checkpoints, makes every strategic decision, executes external steps (Allium queries, wallet funding, deployment), and drives iterative refinement when outputs miss the bar.

---

## Phase 0 — Architecture & Planning

**AI generated**: Initial architecture proposal — 4-layer system (data, contracts, pipeline, frontend), tech stack recommendations (Foundry over Hardhat, logistic regression over neural networks, Arbitrum Sepolia as target network).

**Engineer decided**:
- Complete project specification from first principles
- Standardized onchain lending labels (Aave v3 / Radiant) — normalized liquidation event mechanics to eliminate label noise
- 5-chain feature set for cross-chain breadth signals
- FICO-style scorecard methodology, not black-box ML
- Collateral curve breakpoints (initially provisional)
- Checkpoint-driven development methodology governing all subsequent phases

**Key decision**: Logistic regression was chosen explicitly for regulatory interpretability (ECOA/FCRA alignment requirements), not on AI recommendation. The AI implemented the choice.

---

## Phase 1 — Schema Discovery

**AI attempted**: Used Allium MCP tools for schema discovery → received 403 errors (account plan limitation). Fell back to generating `SHOW TABLES` / `DESCRIBE TABLE` queries for manual execution.

**Engineer discovered**: Allium Explorer does not support metadata queries. Reported the failure.

**AI executed**: Extracted table schemas from documentation and query explorers to extract exact table paths, column names, and data types. Produced a confirmed schema map covering:
- Arbitrum raw tables and lending verticals (Aave v3, Radiant)
- Cross-chain token transfers, DEX trades, bridge events
- Arbitrum and multichain wallet balances
- Wallet 360 pre-aggregated features

**Key finding**: Analytical schemas required custom aggregation from raw lending and transaction tables to precisely isolate liquidation events.

---

## Phase 2 — SQL Queries & Data Ingestion

**AI wrote**: 6 SQL query files in `data/queries/`, each with documentation covering purpose, expected schema, and approximate row count. All queries used `LEFT JOIN` from the borrower population to preserve zero-activity wallets.

**What diverged from the plan**: The original plan called for manual CSV exports from Allium Explorer UI. The engineer's account restricted CSV downloads. The AI wrote a Python ingestion script (`data/run_queries.py`) using the Allium Explorer API directly:
- API supports 250,000 rows per query (vs. 10,000 in the UI)
- Full 115,687-wallet dataset pulled in single API calls

**Engineer contributions**:
- Provided the Allium API key
- Caught an onchain lending project filter discrepancy during early query testing and verified exact protocol identifiers in `arbitrum.lending.loans`
- AI updated all 6 queries

---

## Phase 3 — Model Training (4 Iterations)

This was the most iterative phase. The model went through 4 training cycles, each with an engineering checkpoint.

### Iteration 1 — Baseline Logit

AI trained L2 logistic regression on 23 features (log-transformed continuous, boolean, categorical).

**Result**: AUC 0.8107.

**Engineer review**: Approved as baseline. Flagged multicollinearity: `total_borrowed_usd_log` (+2.12) and `total_repaid_usd_log` (−1.92) had anti-correlated coefficients individually but measure essentially the same behavior.

**Engineer direction**: Convert to FICO-style scorecard — bin all continuous features into 3–5 discrete risk tiers, use lowest-risk bin as reference category (dropped), one-hot encode. Drop the correlated borrow/repay pair, replace with `total_lending_volume_log`. Present proposed bin edges for review before retraining.

### Iteration 2 — FICO Scorecard

AI analyzed distributions across 115,687 wallets, proposed bin edges for each feature with domain-informed justifications. Engineer reviewed and approved all bin definitions.

**Result**: AUC 0.8451. But 25 coefficient sign flags appeared — non-reference bins showing positive coefficients (suggesting those bins are "safer" than the reference, which is economically wrong).

**AI root-cause analysis**: Multicollinearity between overlapping lending-activity features. `total_lending_volume_log` had all non-reference bins positive (unpitchable). The `borrow_repay_ratio [0, 0]` bin showed +0.88 due to right-censoring: 2,010 wallets that had never repaid showed 0% liquidation rate because they were recent borrowers, not because never repaying is safe.

**Engineer decision**: Drop `total_lending_volume_log` (redundant with `lending_active_days` + `repay_count`). Collapse `borrow_repay_ratio [0, 0]` into `[0, 0.9]`, pooling never-repaid wallets with under-repayers.

### Iteration 3 — Post-Fix Retraining

**Result**: AUC 0.8308. 22 sign flags remaining. Tier 1 issues resolved but signal redistributed to `borrow_count` (now +0.25 for some bins) and generic activity features.

**Engineer decision**: Drop 7 additional features where any non-reference bin showed a coefficient > +0.10. Kept `crosschain_total_tx_count` and `chains_active_on` despite small positive flips (<0.10) — dropping all cross-chain features would weaken the protocol's differentiation thesis.

### Iteration 4 — Final 11-Feature Scorecard

AI retrained. Post-training: discovered `wallet_age_days` had become non-monotonic after correlated features were removed. AI presented three options (drop, keep with caveats, simplify to 2 bins). Engineer chose to drop it.

**Final model**: 11 features · 24 one-hot columns · AUC **0.8182** · 0 serious sign flags. Every coefficient explainable in one sentence. **Model frozen**.

**Post-freeze engineer decision**: Specified user-facing display names for all features (e.g., `lending_active_days` → "Borrowing protocol activity (days)") to eliminate DeFi terminology ambiguity in the UI and credit reports.

---

## Phase 4 — Smart Contracts

**AI built**: Foundry project scaffold, OpenZeppelin v5 integration, all core contracts (`OffchainAttestationRegistry`, `CreditOracle`, `LendingPool`, `AdminPriceOracle`, `MockUSDG`) with full NatSpec documentation. Complete unit, integration, and fuzz test suites. Deployed to Arbitrum Sepolia; contract sources verified (Sourcify, exact match). Ran a demo transaction confirming composite score transitions (49 → 99) onchain.

**Engineer contributions**:
- Funded the Arbitrum Sepolia deployment wallet
- Provided the Etherscan V2 API key for contract verification
- Reviewed compiled interfaces and collateral curve math before the test suite was written

**Three key design decisions — all engineer-directed**:

**1. Asymmetric composite weighting**
The AI's initial implementation used symmetric weighted blending (40/60 onchain/offchain). Engineer rejected it. Specified the asymmetric approach: offchain attestation sets a competitive baseline; onchain data provides a boost above that baseline. Rationale: offchain attestation is the gateway to undercollateralized terms, not one equal input of two. The onchain-only cap (composite capped at 50% of raw score) was specified to prevent thin-file wallets from accessing undercollateralized lending.

**2. Sybil-resistant identity persistence**
Conceived during engineering dialogue. Engineer specified the full design:
- `bytes32 identityHash` field on each attestation (derived from ZK proof in production)
- Three storage mappings: historical scores per identity, identity→current wallet, wallet→identity
- Rebind logic: when attestation transfers, old wallet loses attestation but new wallet inherits historical score
- One-shot oracle authorization via `setCreditOracle`
- Production considerations to document but not implement

This was not in the original project prompt.

**3. Thin-file problem framing**
Engineer identified that a high onchain score from minimal lending activity (one borrow, one repay) is structurally analogous to a FICO thin file and should not unlock undercollateralized terms. This insight directly motivated the 50% onchain-only composite cap.

**Bug caught by tests**: The initial collateral curve implementation had an off-by-one in the control-point mapping — the interpolation function treated `ratios[i]` as the value at `breakpoints[i-1]` instead of using the correct 6-control-point scheme. Unit tests caught this immediately before deployment.

---

## Phase 5 — Scoring Pipeline

**AI built**: FastAPI scoring endpoint, parameterized single-wallet SQL queries, web3.py contract interaction for EIP-1559 score pushing.

**Key architectural decision (AI evaluated, engineer approved)**:

Allium Wallet API was evaluated as a potential replacement for per-chain Explorer SQL queries. AI tested the Wallet API against a known active borrower using the MCP realtime tools.

**Finding**: The Wallet API returns transaction-level activities (DEX trades labeled) but does not expose protocol-specific lending events (borrow, repay, liquidation). Since 4 of the 5 dominant model features require lending event history, the Wallet API cannot drive the model. Decision: rejected. Engineer approved.

**Engineer framing**: The 90-second live scoring latency should be framed as a feature, not a limitation — comparable to a credit card application. Specified the 4-step progress indicator design for the frontend.

---

## Phase 6 — Frontend

**AI built**: Vite + React 19 + Tailwind CSS scaffold, 9 UI components, 2 custom hooks, Web3Modal integration (MetaMask, WalletConnect, Coinbase Wallet, EIP-6963 auto-detection), 4-step credit-application-style scoring progress indicator with live SSE network map.

**Engineer directed**:
- Layout swap: composite score as the hero gauge (not raw onchain score)
- Web3Modal adoption after the initial MetaMask-only implementation
- "Score My Wallet" button, testnet warning banner, logo-click-to-reset behavior
- Three-tier Allium fallback system (live → cached real wallets → deterministic synthetic), so judges can run without an API key
- Rate limiting requirements: 20 requests/hour per IP, 100 requests/day global
- Security requirement: no Allium credentials exposed to the frontend

**Bug caught by engineer**: Signer-connected contract instances were using `BrowserProvider` (read-only) instead of a resolved `Signer`, causing "contract runner does not support sending transactions" on attestation submission. AI restructured `useContracts.js` to resolve the signer asynchronously via `useEffect`.

---

## Phase 7 — Documentation

**AI wrote**: All documentation files — `README.md`, `OVERVIEW.md`, `SETUP_GUIDE.md`, `ARCHITECTURE.md`, `WHITEPAPER.md`, `RESOURCES.md`, this development log, and `deployments/ARBITRUM_SEPOLIA.address`.

**Engineer directed**:
- Judge-oriented documentation structure (`OVERVIEW.md` first, `SETUP_GUIDE.md` for reproduction)
- Information-asymmetry framing for the two-signal thesis (explicitly disclaiming that onchain data improves FICO — this distinction is critical for defensibility)
- Active voice, first-person plural, concrete examples over abstractions
- Internal preparation documents gitignored
- API composability paragraph for the production roadmap
- Vercel + Render deployment configuration

---

## Engineering Summary

| Phase | AI Output | Engineer Input |
|---|---|---|
| Architecture | 4-layer design, tech stack proposals | Complete specification, all scoping decisions |
| Schema discovery | 8-page Allium doc read, schema map | Identified metadata query limitation, suggested alternative |
| Data ingestion | 6 SQL files, API ingestion script | API key, protocol query verification |
| Model training | 4 training iterations, coefficient analysis | Feature selection, scorecard methodology, every bin decision, drop decisions |
| Smart contracts | All 3 contracts + tests, deployment | Composite weighting design, Sybil resistance mechanism, thin-file cap insight |
| Scoring pipeline | FastAPI service, web3.py integration | Allium API evaluation, latency framing |
| Frontend | 9 components, 2 hooks, Web3Modal | Layout decisions, fallback tier spec, signer bug catch |
| Documentation | All 6 doc files | Structure, framing, defensive disclaimers, style |

**Iterations required**: 4 model retraining rounds · 3 contract revisions (composite math, identity persistence, curve bugfix) · 2 wallet integration approaches (MetaMask → Web3Modal) · continuous documentation updates as design evolved.

None of the non-trivial design decisions (scorecard methodology, asymmetric composite weighting, Sybil resistance, thin-file cap) appeared in the original prompt. They emerged from the engineering process.

---

## Final Architecture Snapshot

| Component | Technology | Status |
|---|---|---|
| Credit scorecard | scikit-learn LogisticRegression, L2, balanced weights | Frozen · AUC 0.8182 |
| Smart contracts | Foundry, OZ v5, solc 0.8.24, 200 optimizer runs | Live · Arbitrum Sepolia · 122 tests passing |
| Scoring pipeline | FastAPI, web3.py, Allium SQL | Running · 3-tier fallback |
| Frontend | React 19, Vite, Tailwind CSS 4, ethers v6, Web3Modal | Live · arbora-protocol.vercel.app |
| Documentation | `docs/` — 6 files, fully cross-referenced | Complete |

**Model training data**: 115,687 onchain DeFi borrowers across Arbitrum and major EVM lending protocols — ground-truth behavioral credit labels for multi-chain inference on Arbitrum.
