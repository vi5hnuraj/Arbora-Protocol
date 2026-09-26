/* eslint-disable react-refresh/only-export-components -- shares field helpers + constants with lending tabs */
import { ethers } from 'ethers';
import { toBig, toNum, structAt } from '../../lib/ethers-helpers.js';

export const EMPTY_SNAPSHOT = {
  totalDeposits: null,
  totalDebt: null,
  available: null,
  balance: null,
  allowance: null,
  lpDeposit: null,
  collateralWei: null,
  debtUsdg: null,
  loanRatioBps: null,
  healthBps: null,
};

export async function safe(promise) {
  try {
    return await promise;
  } catch {
    return null;
  }
}

// Fetch everything the panel shows. Never throws — individual reads that
// revert (e.g. RPC hiccups) resolve to null and render as "--".
export async function loadSnapshot(readPool, readUsdg, walletAddress) {
  const snap = { ...EMPTY_SNAPSHOT };
  if (!readPool) return snap;

  const [totalDeposits, totalDebt, available] = await Promise.all([
    safe(readPool.totalDeposits()),
    safe(readPool.totalDebt()),
    safe(readPool.availableLiquidity()),
  ]);
  snap.totalDeposits = toBig(totalDeposits);
  snap.totalDebt = toBig(totalDebt);
  snap.available = toBig(available);

  if (walletAddress) {
    const [position, health, lpDeposit, balance, allowance] = await Promise.all([
      safe(readPool.getBorrowerPosition(walletAddress)),
      safe(readPool.healthFactorBps(walletAddress)),
      safe(readPool.lpDeposits(walletAddress)),
      readUsdg ? safe(readUsdg.balanceOf(walletAddress)) : null,
      readUsdg ? safe(readUsdg.allowance(walletAddress, readPool.target)) : null,
    ]);

    const pos = structAt(position);
    if (pos) {
      snap.collateralWei = toBig(pos[0]);
      snap.debtUsdg = toBig(pos[1]);
      snap.loanRatioBps = toNum(pos[2]);
    }
    snap.healthBps = toBig(health);
    snap.lpDeposit = toBig(lpDeposit);
    snap.balance = toBig(balance);
    snap.allowance = toBig(allowance);
  }

  return snap;
}

export function parseAmount(value, decimals) {
  try {
    const parsed = ethers.parseUnits(value, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export function formatHealth(bps) {
  const big = toBig(bps);
  if (big == null) return '--';
  return `${(Number(big) / 10000).toFixed(2)}x`;
}

export function healthTone(bps) {
  const big = toBig(bps);
  if (big == null) return 'text-ink';
  if (big >= 12000n) return 'text-positive';
  if (big >= 10000n) return 'text-amber';
  return 'text-negative';
}

// Display-only chip: same thresholds as healthTone above.
export function healthState(bps) {
  const big = toBig(bps);
  if (big == null) return { label: 'Unknown', cls: 'chip-neutral' };
  if (big >= 12000n) return { label: 'Healthy', cls: 'chip-positive' };
  if (big >= 10000n) return { label: 'At risk', cls: 'chip-warning' };
  return { label: 'Liquidatable', cls: 'chip-negative' };
}

export function StatRow({ label, value, unit, accent = false, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="kicker text-[10px]">{label}</span>
      <span
        className={`font-mono text-[13px] tabular-nums ${
          tone || (accent ? 'text-positive' : 'text-ink')
        }`}
      >
        {value}{' '}
        {unit && <span className="text-[10px] uppercase text-ink-3">{unit}</span>}
      </span>
    </div>
  );
}

export function FieldLabel({ children, hint }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="kicker">{children}</label>
      {hint && (
        <span className="font-mono text-[10px] tabular-nums text-ink-3">{hint}</span>
      )}
    </div>
  );
}

// Input shell: mono numeric text + unit pill (USDG / ETH)
export const INPUT_WRAP =
  'flex flex-1 min-w-0 items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 h-11 transition-colors focus-within:border-line-strong';

export const INPUT_CLASS =
  'flex-1 min-w-0 bg-transparent font-mono text-[13px] tabular-nums text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-50';

export const SUFFIX_CLASS =
  'shrink-0 rounded-md border border-line bg-bg px-2 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3';

export const TABS = [
  { id: 'supply', label: 'Supply' },
  { id: 'borrow', label: 'Borrow' },
  { id: 'repay', label: 'Repay' },
  { id: 'liquidate', label: 'Liquidate' },
];
