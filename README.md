<p align="center">
  <img src="assets/arbora.png" alt="Arbora Protocol Logo" width="120" style="border-radius: 16px;" />
</p>

<h1 align="center">Arbora Protocol</h1>

<p align="center">
  <strong>Onchain credit scoring and undercollateralized lending on Arbitrum, settled in USDG.</strong>
  <br />
  <em>Built for the <a href="https://openhouse.arbitrum.io/">Arbitrum Open House Singapore: Online Buildathon</a></em>
</p>

Arbora blends two independent credit signals — onchain wallet behavior across 5 blockchains and offchain credit attestations — into a composite score that sets collateral requirements on a continuous curve. Creditworthy borrowers post less collateral than any overcollateralized protocol allows; thin-file wallets stay capped. The lending asset is **[USDG](https://paxos.com/usdg/)** (Global Dollar, 6 decimals), so the pool's deposits, debt, and repayments are all denominated in a fully reserved stablecoin.

**Arbora applies battle-tested credit scoring methodology to onchain data for the first time, because the trillion-dollar lending market won't move to DeFi until DeFi can underwrite with the same rigor the real world does.**

> **Network:** Arbitrum Sepolia (chain id `421614`). The same contracts run unchanged on **Robinhood Chain** (Arbitrum Orbit L2, mainnet chain id `4663`), where USDG natively lives — on Arbitrum Sepolia the live pool runs on the **real Paxos USDG** (`0xFFC95faa…`, 6 decimals, [faucet.paxos.com](https://faucet.paxos.com)); `MockUSDG` is only a fallback for other testnets.

## Why this fits the track

- **Arbitrum:** everything deploys and runs on Arbitrum Sepolia today (Foundry scripts, Explorer verification via Etherscan's V2 API, an Arbitrum-only Sepolia feed for production price data). Nothing in the protocol is chain-specific.
- **USDG as the lending asset:** the pool holds USDG, borrowers owe USDG, LPs earn USDG. USDG's 6 decimals are handled explicitly (`usdgScale`), so the protocol is ready for a mainnet USDG deployment on Orbit/Robinhood Chain with no code change.
- **USDG as a revenue unit too:** uncached `POST /score` queries cost **0.01 USDG** — the API replies `402 Payment Required`, the client sends a USDG `Transfer`, and the backend verifies it onchain before scoring (replay-guarded, x402-style). Cached demo queries stay free.
- **Real problem:** undercollateralized credit is the missing primitive in DeFi, and it needs underwriting, not just collateral.

## Architecture

| Layer | What it does | Where |
|---|---|---|
| **Model** | FICO-style logistic regression (0–100) trained on 115,687 onchain DeFi borrowers, AUC 0.8182 | `backend/model/` (frozen) |
| **Contracts** | Attestations, composite score, score→collateral curve, USDG pool with ETH collateral | `contracts/` (Foundry) |
| **Pipeline** | FastAPI: live/cached/synthetic feature tiers → model → optional onchain push (EIP-1559) | `backend/pipeline/` |
| **Frontend** | Vite + React + ethers v6, network-enforced wallet UX | `frontend/` |

**Arbitrum Native Architecture**: Allium SQL queries extract real-time lending history (Aave v3 / Radiant on Arbitrum), wallet balances, and multichain activity across Arbitrum, Ethereum, Optimism, and Polygon. Built natively for the Arbitrum ecosystem.

## Status

| Item | State |
|---|---|
| Contracts rewritten (Arbitrum/USDG) | Done — `forge test`: **122 passing**, `forge lint` clean of structural warnings |
| Backend rewritten (modular, EIP-1559) | Done — zero-config demo mode works out of the box |
| Frontend rewritten (Arbitrum Sepolia, USDG UX) | Done — `npm run build` + `npm run lint` clean |
| Pay-per-score API (x402-style) | Done — 402 → USDG `Transfer` → onchain verification + replay guard (0.01 USDG/query) |
| Testnet deployment | **Done — live on Arbitrum Sepolia (2026-09-25)** |

### Deployed contracts — Arbitrum Sepolia (chain 421614)

| Contract | Address | Explorer |
|---|---|---|
| OffchainAttestationRegistry | `0x812a283c68F76E169B1DbdBe23434Bc47f11a897` | [arbiscan](https://sepolia.arbiscan.io/address/0x812a283c68F76E169B1DbdBe23434Bc47f11a897) |
| CreditOracle | `0x93Fb575277eb28f5C0b3987aC233534cF8d11E8A` | [arbiscan](https://sepolia.arbiscan.io/address/0x93Fb575277eb28f5C0b3987aC233534cF8d11E8A) |
| LendingPool | `0xf3b1381013f6475b659b9468163ff23935dd3351` | [arbiscan](https://sepolia.arbiscan.io/address/0xf3b1381013f6475b659b9468163ff23935dd3351) |
| USDG (Paxos Global Dollar, 6 decimals) | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` | [arbiscan](https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |
| AdminPriceOracle | `0xad4b47A38167FBA59CD2b4F63Bdb29090b4EAB22` | [arbiscan](https://sepolia.arbiscan.io/address/0xad4b47A38167FBA59CD2b4F63Bdb29090b4EAB22) |

Deployer / owner of every contract: `0xd25f8736c3efc19a7cb7a3d15f2af22c2980e317`.

## Quick start (no keys required)

```bash
git clone https://github.com/vi5hnuraj/Arbora-Protocol.git && cd Arbora-Protocol
pip install -r backend/pipeline/requirements.txt
cd frontend && npm install && cd ..

# Terminal 1: backend (works with zero configuration — demo scoring mode)
python3 -m uvicorn backend.pipeline.api:app --host 127.0.0.1 --port 8000

# Terminal 2: frontend
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Cached demo wallets score instantly and free; uncached queries prompt a 0.01 USDG pay-per-score payment first (x402-style 402 — set `USDG_PAY_PER_SCORE=0` to disable the gate for local runs). Onchain push simply reports "not configured" until you deploy.

## Contracts — already deployed

The Arbitrum Sepolia deployment above is live; addresses are recorded in
[`deployments/ARBITRUM_SEPOLIA.address`](deployments/ARBITRUM_SEPOLIA.address) and
pre-filled in `.env.example` / `frontend/.env.example`. To redeploy or port to
Robinhood Chain (Arbitrum Orbit):

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts

# 1. Deploy the protocol (deployer becomes registry/oracle/pool owner).
#    MockUSDG (6 decimals) and AdminPriceOracle are created by the same script
#    unless you pass USDG_TOKEN_ADDRESS / PRICE_ORACLE_ADDRESS to use existing ones.
forge script script/Deploy.s.sol --rpc-url $ARBITRUM_SEPOLIA_RPC --private-key $PRIVATE_KEY \
  --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

After deploying:

1. Paste the addresses into root `.env` (`ATTESTATION_REGISTRY_ADDRESS`, `CREDIT_ORACLE_ADDRESS`, `LENDING_POOL_ADDRESS`, `USDG_TOKEN_ADDRESS`) for the backend.
2. Paste them into `frontend/.env` as `VITE_*` for the app.
3. Seed the demo flow: `forge script script/Demo.s.sol` publishes an attestation, pushes an onchain score, deposits USDG, and opens an ETH-collateralized loan.

Full detail — env vars, oracle selection, verification — is in [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md).

## Documentation

- [OVERVIEW.md](docs/OVERVIEW.md) — Project overview (start here)
- [SETUP_GUIDE.md](docs/SETUP_GUIDE.md) — Architecture and reproduction instructions
- [RESOURCES.md](docs/RESOURCES.md) — Demo video and development log
- [WHITEPAPER.md](docs/WHITEPAPER.md) — Model methodology, contract design rationale, composite score calibration

## Team & Hackathon

- **Event:** [Arbitrum Open House Singapore: Online Buildathon](https://openhouse.arbitrum.io/)
- **Author:** vishnuraj — [github.com/vi5hnuraj](https://github.com/vi5hnuraj)
- **Repository:** [https://github.com/vi5hnuraj/Arbora-Protocol](https://github.com/vi5hnuraj/Arbora-Protocol)

## License

MIT

