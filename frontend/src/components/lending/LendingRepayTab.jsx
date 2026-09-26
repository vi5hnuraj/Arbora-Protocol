import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { fmtAmount } from '../../lib/ethers-helpers.js';
import {
  CONTRACTS,
  ARBITRUM_SEPOLIA_RPC,
} from '../../config/contract-addresses.js';
import {
  FieldLabel,
  INPUT_WRAP,
  INPUT_CLASS,
  SUFFIX_CLASS,
} from './lending-pool-helpers.jsx';

// Confirmation of Payee: before any USDG moves, the
// displayed payee is verified three ways — configured address, and the pool's
// own immutable token/oracle getters must match the deployment records.
function PayeeLine() {
  const pool = CONTRACTS.pool;
  const [status, setStatus] = useState(pool ? 'checking' : 'missing');

  useEffect(() => {
    if (!pool || !CONTRACTS.usdg || !CONTRACTS.oracle) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(ARBITRUM_SEPOLIA_RPC);
        const abi = [
          'function usdg() view returns (address)',
          'function creditOracle() view returns (address)',
        ];
        const contract = new ethers.Contract(pool, abi, provider);
        const [token, oracle] = await Promise.all([
          contract.usdg(),
          contract.creditOracle(),
        ]);
        if (cancelled) return;
        const ok =
          token.toLowerCase() === CONTRACTS.usdg.toLowerCase() &&
          oracle.toLowerCase() === CONTRACTS.oracle.toLowerCase();
        setStatus(ok ? 'verified' : 'mismatch');
      } catch {
        if (!cancelled) setStatus('unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pool]);

  if (!pool) return null;

  const short = `${pool.slice(0, 6)}…${pool.slice(-4)}`;
  if (status === 'verified') {
    return (
      <p className="font-mono text-[10px] leading-relaxed text-ink-3">
        Payee: <span className="text-positive">Arbora Pool ✓</span> · {short} ·
        three-way match (token + oracle match deployment records)
      </p>
    );
  }
  if (status === 'mismatch') {
    return (
      <p className="break-all font-mono text-[10px] leading-relaxed text-negative">
        Payee ✗ MISMATCH — {short} does not match the recorded deployment
        (token/oracle differ). Do not send funds.
      </p>
    );
  }
  return (
    <p className="font-mono text-[10px] leading-relaxed text-ink-3">
      Payee: Arbora Pool · {short} ·{' '}
      {status === 'checking' ? 'verifying onchain identity…' : 'identity unverified'}
    </p>
  );
}

export default function LendingRepayTab({
  snapshot,
  usdgDecimals,
  inputs,
  setField,
  handleRepay,
  handleRepayAll,
  busy,
  actionsLocked,
  hasPosition,
  buttonClass,
  approvalNote,
}) {
  return (
    <div className="space-y-5">
      {hasPosition ? (
        <>
          <div className="space-y-2.5">
            <FieldLabel hint={`Debt: ${fmtAmount(snapshot.debtUsdg, usdgDecimals, 2)} USDG`}>
              Repay USDG
            </FieldLabel>
            <div className="flex gap-2">
              <div className={INPUT_WRAP}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={inputs.repay}
                  onChange={setField('repay')}
                  placeholder="0.0"
                  className={INPUT_CLASS}
                />
                <span className={SUFFIX_CLASS}>USDG</span>
              </div>
              <button
                onClick={handleRepay}
                disabled={!!busy || actionsLocked || !inputs.repay}
                className={buttonClass('repay', 'primary')}
              >
                {busy === 'repay' ? '…' : 'Repay'}
              </button>
            </div>
            {approvalNote(inputs.repay)}
            <PayeeLine />
            <p className="font-mono text-[10px] tabular-nums text-ink-3">
              Balance: {fmtAmount(snapshot.balance, usdgDecimals, 2)} USDG
            </p>
          </div>

          <div className="rule" />

          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="kicker block">Repay everything</span>
              <p className="mt-1 font-mono text-[15px] tabular-nums text-ink">
                {fmtAmount(snapshot.debtUsdg, usdgDecimals, 2)} USDG
              </p>
            </div>
            <button
              onClick={handleRepayAll}
              disabled={!!busy || actionsLocked}
              className={buttonClass('repayAll', 'secondary')}
            >
              {busy === 'repayAll' ? '…' : 'Repay all'}
            </button>
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-ink-3">
            Closing the loan returns your ETH collateral.
          </p>
          <PayeeLine />
        </>
      ) : (
        <div className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-6 text-center text-[13px] text-ink-2">
          No open loan — borrow first to repay.
        </div>
      )}
    </div>
  );
}
