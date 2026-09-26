/**
 * Network helpers — Arbitrum Sepolia (chain id 421614) enforcement.
 *
 * switchToArbitrumSepolia() uses EIP-3326 (wallet_switchEthereumChain) and
 * falls back to EIP-3085 (wallet_addEthereumChain) when the wallet does not
 * know the chain yet.
 */
import {
  ARBITRUM_SEPOLIA_CHAIN_ID,
  ARBITRUM_SEPOLIA_CHAIN_ID_HEX,
  ARBITRUM_SEPOLIA_NETWORK,
} from '../config/contract-addresses.js';

// Normalize chain ids from wallets: number, decimal string or hex string.
export function toChainNumber(chainId) {
  if (chainId == null || chainId === '') return null;
  if (typeof chainId === 'number') return chainId;
  if (typeof chainId === 'bigint') return Number(chainId);
  if (typeof chainId === 'string') {
    const trimmed = chainId.trim();
    const parsed = /^0x/i.test(trimmed)
      ? parseInt(trimmed, 16)
      : parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const n = Number(chainId);
  return Number.isNaN(n) ? null : n;
}

export function isCorrectChain(chainId) {
  return toChainNumber(chainId) === ARBITRUM_SEPOLIA_CHAIN_ID;
}

/**
 * Ask the connected wallet to move to Arbitrum Sepolia.
 * @param {object} provider EIP-1193 provider (e.g. window.ethereum / Web3Modal walletProvider)
 */
export async function switchToArbitrumSepolia(provider) {
  if (!provider || typeof provider.request !== 'function') {
    throw new Error('No wallet provider available');
  }

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: ARBITRUM_SEPOLIA_CHAIN_ID_HEX }],
    });
    return true;
  } catch (switchErr) {
    // 4901 = user rejected the switch — surface it as-is.
    if (switchErr && switchErr.code === 4001) throw switchErr;

    // 4902 = chain unknown to the wallet (often nested in an internal error),
    // plus generic switch failures → add the chain (EIP-3085) and retry.
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [ARBITRUM_SEPOLIA_NETWORK],
    });
    return true;
  }
}
