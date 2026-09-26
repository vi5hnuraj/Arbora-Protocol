// Arbora Protocol — Frontend Configuration
// Target network: Arbitrum Sepolia (chain id 421614)

export const ARBITRUM_SEPOLIA_CHAIN_ID = 421614;
export const ARBITRUM_SEPOLIA_CHAIN_ID_HEX = '0x66e8e';
export const ARBITRUM_SEPOLIA_RPC = 'https://sepolia-rollup.arbitrum.io/rpc';
export const ARBITRUM_SEPOLIA_EXPLORER = 'https://sepolia.arbiscan.io';
export const ARBITRUM_SEPOLIA_NAME = 'Arbitrum Sepolia';

// EIP-3085 params used by wallet_addEthereumChain (switch fallback)
export const ARBITRUM_SEPOLIA_NETWORK = {
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID_HEX,
  chainName: ARBITRUM_SEPOLIA_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [ARBITRUM_SEPOLIA_RPC],
  blockExplorerUrls: [ARBITRUM_SEPOLIA_EXPLORER],
};

const env = import.meta.env;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Pick the first candidate that is a non-zero 0x address.
// Missing/zero addresses resolve to null — the app renders a
// "Contracts not configured" notice and disables writes instead of crashing.
function pickAddress(...candidates) {
  for (const raw of candidates) {
    if (!raw) continue;
    const value = String(raw).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) continue;
    if (value.toLowerCase() === ZERO_ADDRESS) continue;
    return value;
  }
  return null;
}

// Env var names for each contract (documented in frontend/.env.example)
export const CONTRACT_ENV_VARS = {
  registry: 'VITE_ATTESTATION_REGISTRY_ADDRESS',
  oracle: 'VITE_CREDIT_ORACLE_ADDRESS',
  pool: 'VITE_LENDING_POOL_ADDRESS',
  usdg: 'VITE_USDG_TOKEN_ADDRESS',
};

// Deployed contract addresses — from VITE_* env vars (legacy VITE_* names
// are accepted as fallbacks). Addresses are not deployed yet: every value
// stays null until the forge deploy script's addresses are written to
// frontend/.env (see root README, "Deploy contracts").
export const CONTRACTS = {
  registry: pickAddress(
    env.VITE_ATTESTATION_REGISTRY_ADDRESS,
    env.VITE_REGISTRY_ADDRESS,
    env.VITE_ATTESTATION_REGISTRY,
  ),
  oracle: pickAddress(
    env.VITE_CREDIT_ORACLE_ADDRESS,
    env.VITE_ORACLE_ADDRESS,
  ),
  pool: pickAddress(
    env.VITE_LENDING_POOL_ADDRESS,
    env.VITE_POOL_ADDRESS,
  ),
  usdg: pickAddress(
    env.VITE_USDG_TOKEN_ADDRESS,
    env.VITE_USDG_ADDRESS,
    env.VITE_MOCK_USDG_ADDRESS,
  ),
};

export const CONTRACTS_MISSING = Object.keys(CONTRACT_ENV_VARS).filter(
  (key) => !CONTRACTS[key],
);
export const CONTRACTS_CONFIGURED = CONTRACTS_MISSING.length === 0;

// Scoring API (FastAPI backend)
// In production: set VITE_API_URL to the deployed backend URL (e.g., https://arbora-api.onrender.com)
// In development: empty string means Vite dev server proxies to localhost:8000
export const API_BASE = env.VITE_API_URL || '';

// ENS resolution uses Ethereum mainnet (ENS is on L1)
// PublicNode's free Ethereum RPC — no API key, reliable for ENS
export const ENS_RPC = 'https://ethereum-rpc.publicnode.com';

// Arbiscan links
export function explorerAddressUrl(address) {
  return `${ARBITRUM_SEPOLIA_EXPLORER}/address/${address}`;
}

export function explorerTxUrl(hash) {
  return `${ARBITRUM_SEPOLIA_EXPLORER}/tx/${hash}`;
}

// Collateral ratio labels for display
export function getCollateralLabel(bps) {
  if (bps >= 15000) return { text: 'Standard DeFi', color: 'text-danger' };
  if (bps >= 12000) return { text: 'Improved', color: 'text-warning' };
  if (bps >= 10000) return { text: 'Competitive', color: 'text-yellow-400' };
  if (bps >= 8500)  return { text: 'Undercollateralized', color: 'text-accent' };
  return               { text: 'Premium', color: 'text-accent-bright' };
}

// Score color for gauge
export function getScoreColor(score) {
  if (score <= 30) return '#ef4444';
  if (score <= 60) return '#f59e0b';
  if (score <= 80) return '#10b981';
  return '#22c55e';
}
