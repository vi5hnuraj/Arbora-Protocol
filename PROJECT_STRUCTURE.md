# Arbora Project Structure

A clean, judge-friendly overview of the **Arbora Protocol** codebase.

---

## Architecture at a Glance

| Directory | Role | Primary Tech Stack |
|---|---|---|
| **`frontend/`** | Web application & user interface | React 19, Vite, Tailwind CSS v4, Ethers v6, Web3Modal |
| **`backend/`** | Scoring pipeline, ML risk models, & multi-chain dataset queries | Python, FastAPI, Scikit-learn, Web3.py, SQL |
| **`contracts/`** | Core protocol smart contracts on Arbitrum Sepolia | Solidity ^0.8.20, Foundry |
| **`deployments/`** | Live testnet contract addresses & network records | Arbitrum Sepolia deployment records |
| **`docs/`** | Comprehensive technical and architecture documentation | Markdown |
| **`assets/`** | Logo, graphics, and visual demo assets | PNG / SVG |

---

## Directory Layout

```text
Arbora/
├── frontend/                  # React + Vite web application
│   └── src/
│       ├── components/        # Feature-grouped UI components
│       │   ├── layout/        # Header, Footer, Section, NetworkBanner, ContractsNotice
│       │   ├── hero/          # Editorial hero stage
│       │   ├── scoring/       # WalletSearch, ScoringProgress, CreditReport, ScoreGauge
│       │   ├── lending/       # LendingInterface & modular Supply/Borrow/Repay/Liquidate tabs
│       │   └── attestation/   # AttestationSimulator (ZKredit verification)
│       ├── config/            # Contract addresses & Web3Modal configuration
│       ├── hooks/             # useWallet & useContracts React hooks
│       └── lib/               # Ethers v6 decoding & network switching helpers
│
├── backend/                   # Python credit scoring engine, models, and analytics
│   ├── pipeline/              # Real-time scoring API & multi-chain ingestion
│   │   ├── api.py             # FastAPI server with SSE streaming (/score/stream)
│   │   ├── payment_gate.py    # x402 pay-per-score: 402 terms, USDG Transfer verification, replay guard
│   │   ├── config.py          # Backend environment, RPCs, and addresses
│   │   ├── data_sources.py    # 5-chain data fetchers (Etherscan, Blockscout, RPC)
│   │   ├── scoring_queries.py # Feature extraction & transformation logic
│   │   ├── activity_tier.py   # Activity tiering & risk adjustment
│   │   ├── onchain.py         # Contract interaction & reading utilities
│   │   ├── push_score.py      # Onchain score publisher to CreditOracle
│   │   └── demo_wallets.json  # Cached wallet profiles for instant evaluation
│   ├── model/                 # Machine learning credit risk model
│   │   ├── feature_config.json # Scorecard bin definitions & feature weights (AUC 0.818)
│   │   ├── model.pkl          # Serialized trained credit model
│   │   ├── train.py           # Model training script (trained on 115,687 onchain DeFi borrowers)
│   │   ├── score.py           # Inference score generator
│   │   ├── calibrate_curve.py # Collateral curve calibration script
│   │   ├── compute_benchmarks.py # Population top-decile benchmark calculator
│   │   └── validation_report.md # Model performance and validation report
│   └── data/                  # Training data extraction & processing
│       ├── queries/           # BigQuery & Dune analytical SQL queries
│       ├── raw/               # Raw training extracts
│       ├── processed/         # Cleaned feature datasets
│       └── run_queries.py     # Dataset extraction orchestrator
│
├── contracts/                 # Arbitrum Sepolia smart contracts (Foundry)
│   ├── src/
│   │   ├── CreditOracle.sol   # Onchain composite credit scoring oracle
│   │   ├── LendingPool.sol    # USDG lending pool with continuous collateral curve
│   │   ├── MockUSDG.sol       # USDG token (6 decimals)
│   │   └── OffchainAttestationRegistry.sol # Onchain registry for verified credit proofs
│   ├── script/                # Deployment scripts (Deploy.s.sol, DeployUsdgPool.s.sol)
│   └── test/                  # Unit, integration, and fuzz test suites (122 tests)
│
├── deployments/               # Deployed contract artifacts
│   └── ARBITRUM_SEPOLIA.address # Contract addresses on Arbitrum Sepolia
│
├── docs/                      # Technical documentation
│   ├── ARCHITECTURE.md        # Protocol architecture & system flows
│   ├── SETUP_GUIDE.md         # Reproduction guide & API documentation
│   ├── WHITEPAPER.md          # Model methodology & protocol economics
│   ├── OVERVIEW.md            # Project overview & value proposition
│   ├── DEVELOPMENT.md         # Engineering methodology & build process
│   └── RESOURCES.md           # Supplementary references
│
├── assets/                    # Visual assets & logos
│   └── arbora.png             # Arbora Protocol logo
│
├── README.md                  # Project overview & quickstart guide
├── PROJECT_STRUCTURE.md       # Directory layout & module reference
├── .env.example               # Environment variables template
├── render.yaml                # Backend deployment blueprint
└── vercel.json                # Frontend deployment blueprint
```
