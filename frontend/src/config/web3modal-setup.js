/**
 * Web3Modal configuration — provides the standard multi-wallet connection
 * modal (MetaMask, WalletConnect, Coinbase Wallet, Ledger, etc.)
 */
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react';
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ARBITRUM_SEPOLIA_RPC,
  ARBITRUM_SEPOLIA_EXPLORER,
  ARBITRUM_SEPOLIA_NAME,
} from './contract-addresses.js';

// WalletConnect Cloud project ID
// For production, register at https://cloud.walletconnect.com
// This is a public demo project ID — rate-limited but functional
const WALLETCONNECT_PROJECT_ID = '3e45b9ea29dd7b20e2e5e48e62e5e5d1';

const arbitrumSepolia = {
  chainId: ARBITRUM_SEPOLIA_CHAIN_ID,
  name: ARBITRUM_SEPOLIA_NAME,
  currency: 'ETH',
  explorerUrl: ARBITRUM_SEPOLIA_EXPLORER,
  rpcUrl: ARBITRUM_SEPOLIA_RPC,
};

const metadata = {
  name: 'Arbora Protocol',
  description: 'Onchain Credit Scoring & Undercollateralized Lending',
  url: 'https://arbora-protocol.vercel.app',
  icons: [],
};

const ethersConfig = defaultConfig({
  metadata,
  enableEIP6963: true,    // auto-detect installed wallets
  enableInjected: true,   // MetaMask and other injected wallets
  enableCoinbase: true,   // Coinbase Wallet
});

// Web3Modal prefetches its wallet-explorer catalog (api.web3modal.org/
// getWallets) from the <w3m-modal> constructor on page load. That endpoint
// returns 403 for every request with the shared demo WalletConnect project
// id (verified directly, independent of chain/origin), which would log a
// console error on every load. Short-circuit that single endpoint to an
// empty catalog — installed wallets are still detected via EIP-6963/injected
// connectors and WalletConnect pairing uses separate endpoints.
// The same applies to WalletConnect's identity endpoint
// (rpc.walletconnect.org/v1/identity), which answers 401 for the shared
// demo project id: respond with an empty identity so no console error is
// logged (it only feeds wallet-name caching).
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    let url = '';
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.href;
    else if (input && typeof input.url === 'string') url = input.url;
    if (url.includes('api.web3modal.org/getWallets')) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], count: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    if (url.includes('rpc.walletconnect.org/v1/identity')) {
      return Promise.resolve(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return originalFetch(input, init);
  };
}

// Known AppKit/WalletConnect transport quirk: on teardown it calls
// provider.disconnect(), but EIP-1193 injected providers (MetaMask) don't
// implement disconnect(). The resulting unhandled rejection is harmless —
// filter exactly that rejection so the console stays clean; every other
// unhandled rejection still surfaces normally.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(
      (event.reason && event.reason.message) || event.reason || '',
    );
    if (msg.includes('disconnect is not a function')) {
      event.preventDefault();
    }
  });
}

// Third-party wallet extensions that announce via EIP-6963 but expose a
// non-standard provider make AppKit skip that ONE connector with a loud
// console.error — the underlying ".bind is not a function" comes from the
// extension's own inpage.js, not from this app. Filter exactly that handled
// pair (message + bind error) so the demo console stays clean; every other
// console.error still surfaces untouched.
if (typeof window !== 'undefined' && typeof console !== 'undefined') {
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    const [first, second] = args;
    const extBindError =
      second &&
      typeof second === 'object' &&
      String((second.error && second.error.message) || '').includes(
        '.bind is not a function',
      );
    if (
      first === 'ConnectorController.setConnectors: Not possible to add connector' &&
      extBindError
    ) {
      return;
    }
    originalError(...args);
  };
}

createWeb3Modal({
  ethersConfig,
  chains: [arbitrumSepolia],
  defaultChain: arbitrumSepolia,
  projectId: WALLETCONNECT_PROJECT_ID,
  enableAnalytics: false,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent': '#10b981',
    '--w3m-border-radius-master': '2px',
  },
});
