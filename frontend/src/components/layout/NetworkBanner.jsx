import { useState } from 'react';
import { switchToArbitrumSepolia } from '../../lib/network-switch.js';
import { ARBITRUM_SEPOLIA_NAME, ARBITRUM_SEPOLIA_CHAIN_ID } from '../../config/contract-addresses.js';

/**
 * Persistent wrong-network banner. Rendered whenever a connected wallet sits
 * on a chain other than Arbitrum Sepolia (421614); offers a one-click switch
 * (EIP-3326 with an EIP-3085 add-chain fallback).
 */
export default function NetworkBanner({ provider, chainId }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSwitch() {
    setBusy(true);
    setError(null);
    try {
      await switchToArbitrumSepolia(provider);
    } catch (err) {
      setError(err?.message || 'Could not switch network');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bar bar-negative">
      <p>
        <span className="mr-1.5" aria-hidden="true">
          ●
        </span>
        Wrong network — wallet on chain {chainId ?? 'unknown'} · Arbora runs
        on {ARBITRUM_SEPOLIA_NAME} (chain {ARBITRUM_SEPOLIA_CHAIN_ID}) ·
        transactions disabled until you switch
      </p>
      <button
        onClick={handleSwitch}
        disabled={busy || !provider}
        className="rounded-md border border-negative/40 bg-negative/15 px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-negative transition-colors hover:bg-negative/25 disabled:cursor-wait disabled:opacity-50"
      >
        {busy ? 'Switching…' : `Switch to ${ARBITRUM_SEPOLIA_NAME}`}
      </button>
      {error && (
        <p className="w-full font-mono text-[10px] normal-case tracking-normal text-ink-2">
          {error}
        </p>
      )}
    </div>
  );
}
