# Arbora Frontend

The web user interface for **Arbora Protocol** — onchain credit scoring and undercollateralized USDG lending on Arbitrum Sepolia.

## Tech Stack

- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS v4 + Vanilla CSS Design System
- **Web3**: Ethers v6 + Web3Modal (`@web3modal/ethers`)

## Running Locally

```bash
# Install dependencies
npm install

# Start Vite development server
npm run dev

# Build for production
npm run build
```

## Structure

```text
src/
├── components/        # Feature-grouped UI components (layout, scoring, lending, attestation, hero)
├── config/            # Contract addresses, RPC, Web3Modal configuration
├── hooks/             # useWallet & useContracts React hooks
├── lib/               # Ethers v6 normalization & chain switching helpers
├── App.jsx            # Main app orchestrator
└── main.jsx           # App entry point
```
