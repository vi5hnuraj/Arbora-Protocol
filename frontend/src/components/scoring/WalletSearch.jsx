import { useState } from 'react';
import { ethers } from 'ethers';
import { ENS_RPC } from '../../config/contract-addresses.js';

export default function WalletSearch({ onSearch, isLoading, account }) {
  const [input, setInput] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resolvedInfo, setResolvedInfo] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    let address = trimmed;

    // ENS resolution: if input contains a dot, try resolving
    if (trimmed.includes('.')) {
      setResolving(true);
      setResolvedInfo(null);
      try {
        const provider = new ethers.JsonRpcProvider(ENS_RPC);
        const resolved = await provider.resolveName(trimmed);
        if (resolved) {
          address = resolved;
          setResolvedInfo({ ens: trimmed, address: resolved });
        } else {
          setResolvedInfo({ ens: trimmed, error: 'Could not resolve ENS name' });
          setResolving(false);
          return;
        }
      } catch (err) {
        console.warn('ENS resolution failed:', err.message);
        setResolvedInfo({ ens: trimmed, error: `ENS resolution failed: ${err.message}` });
        setResolving(false);
        return;
      }
      setResolving(false);
    }

    // Validate address format
    if (!address.startsWith('0x') || address.length !== 42) {
      setResolvedInfo({ error: 'Invalid address format (expected 0x + 40 hex characters)' });
      return;
    }

    onSearch(address);
  };

  const handleScoreMyWallet = () => {
    if (account && !isLoading) {
      setInput(account);
      setResolvedInfo(null);
      onSearch(account);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <form onSubmit={handleSubmit} className="text-center">
        <h3 className="display text-[clamp(1.85rem,3.4vw,2.6rem)] leading-[1.08]">
          Which wallet are we underwriting?
        </h3>

        <div className="mt-8 space-y-2.5 text-left">
          <label htmlFor="wallet-address-input" className="kicker block">
            Wallet address
          </label>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <div className="relative flex-1">
              <input
                id="wallet-address-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="0x… or vitalik.eth"
                disabled={isLoading}
                className="field !h-12 pr-24"
              />
              {resolving && (
                <span className="kicker absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-ink-2">
                  Resolving ens…
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || resolving || !input.trim()}
              className="btn-primary sm:!w-auto"
            >
              {isLoading ? 'Scoring…' : 'Run score'}
            </button>
          </div>

          {/* Score My Wallet button — only when wallet is connected */}
          {account && !isLoading && (
            <button
              type="button"
              onClick={handleScoreMyWallet}
              className="kicker inline-flex items-center gap-1.5 transition-colors hover:text-ink"
            >
              Score my connected wallet
              <span className="font-mono normal-case tracking-normal text-ink-2">
                ({account.slice(0, 6)}...{account.slice(-4)})
              </span>
            </button>
          )}

          {/* Resolve / validation feedback — red mono when invalid */}
          {resolvedInfo && (
            <div className="font-mono text-[11px] leading-relaxed">
              {resolvedInfo.error ? (
                <span className="text-negative">{resolvedInfo.error}</span>
              ) : (
                <span className="text-ink-3">
                  <span className="text-ink-2">{resolvedInfo.ens}</span>
                  {' → '}
                  <span className="text-ink">{resolvedInfo.address}</span>
                </span>
              )}
            </div>
          )}

          <p className="kicker pt-2 text-[10px] text-ink-3/80">
            Demo mode · cached wallets return instantly · live scoring streams
            from five chains
          </p>
        </div>
      </form>
    </div>
  );
}
