import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { fmtAmount, toBig, toNum, shortHash, txError, sendWalletTx } from '../../lib/ethers-helpers.js';
import {
  EMPTY_SNAPSHOT,
  loadSnapshot,
  parseAmount,
  formatHealth,
  healthTone,
  healthState,
  StatRow,
  TABS,
} from './lending-pool-helpers.jsx';
import LendingSupplyTab from './LendingSupplyTab.jsx';
import LendingBorrowTab from './LendingBorrowTab.jsx';
import LendingRepayTab from './LendingRepayTab.jsx';
import LendingLiquidateTab from './LendingLiquidateTab.jsx';

/**
 * Lending pool panel — USDG-centered UX on Arbitrum Sepolia.
 *
 * Protocol model:
 *   - Liquidity / debt asset: USDG (6 decimals — read from the token,
 *     never assumed)
 *   - Collateral: native ETH (18 decimals)
 *   - LPs deposit/withdraw USDG; borrowers post ETH via borrow/addCollateral
 *     and repay in USDG; liquidators repay USDG for unhealthy positions
 *     (health factor < 100%).
 */
export default function LendingInterface({
  pool,
  usdg,
  readPool,
  readUsdg,
  walletAddress,
  compositeScore,
  canWrite = false,
  blockedReason = null,
}) {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const [usdgDecimals, setUsdgDecimals] = useState(6); // overwritten by token read
  const [tick, setTick] = useState(0);

  const [tab, setTab] = useState('supply');
  const [inputs, setInputs] = useState({
    deposit: '',
    withdraw: '',
    borrow: '',
    collateral: '',
    withdrawCollateral: '',
    repay: '',
    liquidateAddr: '',
    liquidateAmt: '',
  });
  const setField = (name) => (e) =>
    setInputs((prev) => ({ ...prev, [name]: e.target.value }));

  // Derived, freshness-keyed reads (see effects below)
  const [required, setRequired] = useState({ key: null, wei: null });
  const [scoreRatio, setScoreRatio] = useState({ key: null, bps: null });
  const [targetHealth, setTargetHealth] = useState({ key: null, bps: null });

  const [busy, setBusy] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const refresh = () => setTick((t) => t + 1);

  // --- Data loading -----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const snap = await loadSnapshot(readPool, readUsdg, walletAddress);
      if (!cancelled) setSnapshot(snap);
    })();
    return () => {
      cancelled = true;
    };
  }, [readPool, readUsdg, walletAddress, tick]);

  // USDG decimals — read from the token (pool fallback), default 6 only
  // until the read resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let decimals = null;
      if (readUsdg) {
        try {
          decimals = toNum(await readUsdg.decimals());
        } catch {
          /* fall through to the pool */
        }
      }
      if (decimals == null && readPool) {
        try {
          decimals = toNum(await readPool.usdgDecimals());
        } catch {
          /* keep the default */
        }
      }
      if (!cancelled && decimals != null) setUsdgDecimals(decimals);
    })();
    return () => {
      cancelled = true;
    };
  }, [readUsdg, readPool]);

  // Required ETH collateral for the borrow amount
  const requiredKey =
    walletAddress && inputs.borrow
      ? `${walletAddress.toLowerCase()}:${inputs.borrow}`
      : null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!readPool || !walletAddress || !inputs.borrow) return;
      try {
        const amount = parseAmount(inputs.borrow, usdgDecimals);
        if (!amount) return;
        const wei = await readPool.getRequiredCollateral(walletAddress, amount);
        if (!cancelled) {
          setRequired({ key: `${walletAddress.toLowerCase()}:${inputs.borrow}`, wei: toBig(wei) });
        }
      } catch {
        /* invalid input or revert — keep the previous value hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readPool, walletAddress, inputs.borrow, usdgDecimals]);
  const requiredCollateral = required.key === requiredKey ? required.wei : null;

  // Collateral ratio implied by the connected wallet's composite score
  const scoreRatioKey = compositeScore != null ? String(compositeScore) : null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!readPool || compositeScore == null) return;
      try {
        const bps = await readPool.getCollateralRatioBps(compositeScore);
        if (!cancelled) setScoreRatio({ key: String(compositeScore), bps: toNum(bps) });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readPool, compositeScore]);
  const scoreRatioBps = scoreRatio.key === scoreRatioKey ? scoreRatio.bps : null;

  // Live health factor of the liquidation target
  const targetKey =
    inputs.liquidateAddr && ethers.isAddress(inputs.liquidateAddr)
      ? inputs.liquidateAddr.toLowerCase()
      : null;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!readPool || !targetKey) return;
      try {
        const bps = await readPool.healthFactorBps(targetKey);
        if (!cancelled) setTargetHealth({ key: targetKey, bps: toBig(bps) });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readPool, targetKey]);
  const targetHealthBps = targetHealth.key === targetKey ? targetHealth.bps : null;
  const targetIsLiquidatable = targetHealthBps != null && targetHealthBps < 10000n;

  // --- Write helpers ----------------------------------------------------

  function guard() {
    if (pool && usdg && walletAddress && canWrite) return true;
    setFeedback({
      type: 'error',
      message:
        blockedReason ||
        (walletAddress ? 'Wallet is not ready yet' : 'Connect a wallet first'),
    });
    return false;
  }

  async function ensureAllowance(amount) {
    const current = toBig(await readUsdg.allowance(walletAddress, readPool.target));
    if (current != null && current >= amount) return;
    setFeedback({ type: 'pending', message: 'Approve USDG for the pool in your wallet…' });
    const tx = await sendWalletTx(usdg, 'approve', [readPool.target, ethers.MaxUint256]);
    setFeedback({ type: 'pending', message: `Approval tx: ${shortHash(tx.hash)}` });
    await tx.wait();
  }

  async function run(key, work) {
    setBusy(key);
    setFeedback(null);
    try {
      await work();
      refresh();
    } catch (err) {
      setFeedback({ type: 'error', message: txError(err) });
    } finally {
      setBusy(null);
    }
  }

  async function handleDeposit() {
    if (!guard()) return;
    const amount = parseAmount(inputs.deposit, usdgDecimals);
    if (!amount) {
      setFeedback({ type: 'error', message: 'Enter a valid USDG amount' });
      return;
    }
    await run('deposit', async () => {
      await ensureAllowance(amount);
      setFeedback({ type: 'pending', message: 'Confirm deposit in your wallet…' });
      const tx = await sendWalletTx(pool, 'deposit', [amount]);
      setFeedback({ type: 'pending', message: `Deposit tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Deposited ${inputs.deposit} USDG` });
      setInputs((prev) => ({ ...prev, deposit: '' }));
    });
  }

  async function handleWithdraw() {
    if (!guard()) return;
    const amount = parseAmount(inputs.withdraw, usdgDecimals);
    if (!amount) {
      setFeedback({ type: 'error', message: 'Enter a valid USDG amount' });
      return;
    }
    await run('withdraw', async () => {
      setFeedback({ type: 'pending', message: 'Confirm withdrawal in your wallet…' });
      const tx = await sendWalletTx(pool, 'withdraw', [amount]);
      setFeedback({ type: 'pending', message: `Withdraw tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Withdrew ${inputs.withdraw} USDG` });
      setInputs((prev) => ({ ...prev, withdraw: '' }));
    });
  }

  async function handleBorrow() {
    if (!guard()) return;
    const amount = parseAmount(inputs.borrow, usdgDecimals);
    if (!amount) {
      setFeedback({ type: 'error', message: 'Enter a valid USDG amount' });
      return;
    }
    if (requiredCollateral == null) {
      setFeedback({ type: 'error', message: 'Still calculating required ETH collateral — retry' });
      return;
    }
    await run('borrow', async () => {
      setFeedback({ type: 'pending', message: 'Confirm borrow (ETH collateral) in your wallet…' });
      const tx = await sendWalletTx(pool, 'borrow', [amount], { value: requiredCollateral });
      setFeedback({ type: 'pending', message: `Borrow tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Borrowed ${inputs.borrow} USDG` });
      setInputs((prev) => ({ ...prev, borrow: '' }));
      setRequired({ key: null, wei: null });
    });
  }

  async function handleAddCollateral() {
    if (!guard()) return;
    let value;
    try {
      value = ethers.parseEther(inputs.collateral);
    } catch {
      value = 0n;
    }
    if (value <= 0n) {
      setFeedback({ type: 'error', message: 'Enter a valid ETH amount' });
      return;
    }
    await run('addCollateral', async () => {
      setFeedback({ type: 'pending', message: 'Confirm collateral top-up in your wallet…' });
      const tx = await sendWalletTx(pool, 'addCollateral', [], { value });
      setFeedback({ type: 'pending', message: `Add collateral tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Added ${inputs.collateral} ETH collateral` });
      setInputs((prev) => ({ ...prev, collateral: '' }));
    });
  }

  async function handleWithdrawCollateral() {
    if (!guard()) return;
    let amount;
    try {
      amount = ethers.parseEther(inputs.withdrawCollateral);
    } catch {
      amount = 0n;
    }
    if (amount <= 0n) {
      setFeedback({ type: 'error', message: 'Enter a valid ETH amount' });
      return;
    }
    await run('withdrawCollateral', async () => {
      setFeedback({ type: 'pending', message: 'Confirm collateral withdrawal in your wallet…' });
      const tx = await sendWalletTx(pool, 'withdrawCollateral', [amount]);
      setFeedback({ type: 'pending', message: `Withdraw collateral tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Withdrew ${inputs.withdrawCollateral} ETH collateral` });
      setInputs((prev) => ({ ...prev, withdrawCollateral: '' }));
    });
  }

  async function handleRepay() {
    if (!guard()) return;
    const amount = parseAmount(inputs.repay, usdgDecimals);
    if (!amount) {
      setFeedback({ type: 'error', message: 'Enter a valid USDG amount' });
      return;
    }
    await run('repay', async () => {
      await ensureAllowance(amount);
      setFeedback({ type: 'pending', message: 'Confirm repayment in your wallet…' });
      const tx = await sendWalletTx(pool, 'repay', [amount]);
      setFeedback({ type: 'pending', message: `Repay tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Repaid ${inputs.repay} USDG` });
      setInputs((prev) => ({ ...prev, repay: '' }));
    });
  }

  async function handleRepayAll() {
    if (!guard()) return;
    const debt = snapshot.debtUsdg;
    if (debt == null || debt <= 0n) {
      setFeedback({ type: 'error', message: 'No outstanding debt' });
      return;
    }
    await run('repayAll', async () => {
      await ensureAllowance(debt);
      setFeedback({ type: 'pending', message: 'Confirm full repayment in your wallet…' });
      const tx = await sendWalletTx(pool, 'repayAll', []);
      setFeedback({ type: 'pending', message: `Repay-all tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: 'Loan fully repaid — ETH collateral returned' });
    });
  }

  async function handleLiquidate() {
    if (!guard()) return;
    if (!targetKey) {
      setFeedback({ type: 'error', message: 'Enter a valid borrower address' });
      return;
    }
    if (!targetIsLiquidatable) {
      setFeedback({
        type: 'error',
        message: 'Position is healthy — it can only be liquidated below 100% health',
      });
      return;
    }
    const amount = parseAmount(inputs.liquidateAmt, usdgDecimals);
    if (!amount) {
      setFeedback({ type: 'error', message: 'Enter a valid USDG amount' });
      return;
    }
    await run('liquidate', async () => {
      await ensureAllowance(amount);
      setFeedback({ type: 'pending', message: 'Confirm liquidation in your wallet…' });
      const tx = await sendWalletTx(pool, 'liquidate', [targetKey, amount]);
      setFeedback({ type: 'pending', message: `Liquidation tx: ${shortHash(tx.hash)}` });
      await tx.wait();
      setFeedback({ type: 'success', message: `Liquidated ${inputs.liquidateAmt} USDG of debt` });
      setInputs((prev) => ({ ...prev, liquidateAmt: '' }));
    });
  }

  // --- Render helpers ---------------------------------------------------

  function approvalNote(amountStr) {
    if (!walletAddress || snapshot.allowance == null || !amountStr) return null;
    const needed = parseAmount(amountStr, usdgDecimals);
    if (!needed) return null;
    const approved = snapshot.allowance >= needed;
    return (
      <p className={`font-mono text-[10px] ${approved ? 'text-positive' : 'text-amber'}`}>
        {approved
          ? 'USDG approved for the pool ✓'
          : 'USDG approval required first (one wallet signature)'}
      </p>
    );
  }

  const hasPosition =
    snapshot.debtUsdg != null && snapshot.debtUsdg > 0n && snapshot.collateralWei != null;
  const hasLpDeposit = snapshot.lpDeposit != null && snapshot.lpDeposit > 0n;
  const actionsLocked = !canWrite || !walletAddress;
  const buttonClass = (key, variant) =>
    `btn-${variant} !h-11 !px-4 !text-[11px] !font-mono font-medium uppercase tracking-[0.1em] ${
      busy === key ? 'cursor-wait opacity-60' : ''
    }`;

  return (
    <div className="card p-0">
      {/* Header */}
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="kicker">Lending desk</p>
            <h3 className="display mt-2 text-[24px] leading-tight">
              Supply USDG. Borrow against ETH.
            </h3>
          </div>
          <span className="chip chip-accent shrink-0">USDG ⟷ ETH</span>
        </div>
        <p className="mt-1.5 max-w-[60ch] text-[13.5px] leading-relaxed text-ink-2">
          Liquidity and debt are denominated in USDG, collateral is native ETH —
          and your composite score sets the collateral ratio.
        </p>
      </div>

      {/* Pool stats — always visible */}
      <div className="border-b border-line px-5 py-3 sm:px-6">
        <StatRow
          label="Supplied (LP)"
          value={fmtAmount(snapshot.totalDeposits, usdgDecimals, 2)}
          unit="USDG"
        />
        <StatRow
          label="Total debt"
          value={fmtAmount(snapshot.totalDebt, usdgDecimals, 2)}
          unit="USDG"
        />
        <StatRow
          label="Available liquidity"
          value={fmtAmount(snapshot.available, usdgDecimals, 2)}
          unit="USDG"
          accent
        />
        <p
          className="mt-2 cursor-help text-[11px] leading-relaxed text-ink-3"
          title="Deposits are allocated to borrowers by composite score: weak scores post 150% collateral, strong scores post 75%. Every Borrowed event records the score and ratio that priced the loan, so allocation is auditable and recomputable from onchain evidence."
        >
          Deposited capital is allocated by borrower credit score — collateral
          runs 150% ↔ 75% — and every loan records its pricing score + ratio in
          the onchain <span className="font-mono">Borrowed</span> event.
        </p>
      </div>

      {!readPool ? (
        <div className="space-y-2 px-5 py-8 text-center sm:px-6">
          <p className="text-[14px] text-ink-2">Lending pool reads unavailable.</p>
          <p className="font-mono text-[11px] text-ink-3">
            Contracts not configured — deploy them first (see root README).
          </p>
        </div>
      ) : (
        <div className="space-y-5 px-5 py-5 sm:px-6">
          {/* Your position */}
          <div className="rounded-[10px] border border-line bg-surface-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="kicker">
                {walletAddress ? 'Your credit line' : 'Credit line'}
              </span>
              {scoreRatioBps != null && (
                <span className="font-mono text-[10px] tabular-nums text-ink-3">
                  Score requires {(scoreRatioBps / 100).toFixed(0)}% collateral
                </span>
              )}
            </div>

            {/* Serif headline numbers */}
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <span className="kicker block text-[10px]">Collateral</span>
                <div className="display mt-1.5 text-[26px] leading-none tabular-nums">
                  {walletAddress ? fmtAmount(snapshot.collateralWei, 18, 4) : '--'}
                  <span className="ml-1.5 font-sans text-[12px] text-ink-3">ETH</span>
                </div>
              </div>
              <div>
                <span className="kicker block text-[10px]">Debt (drawn)</span>
                <div className="display mt-1.5 text-[26px] leading-none tabular-nums">
                  {walletAddress ? fmtAmount(snapshot.debtUsdg, usdgDecimals, 2) : '--'}
                  <span className="ml-1.5 font-sans text-[12px] text-ink-3">USDG</span>
                </div>
              </div>
            </div>

            <p className="mt-2.5 text-[12px] leading-relaxed text-ink-3">
              Undercollateralized revolving credit — repay to free collateral,
              reborrow any time; every draw re-prices from your composite score.
            </p>

            {/* Health + ratio chips */}
            {(hasPosition || snapshot.loanRatioBps != null) && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
                {hasPosition && (
                  <>
                    <span className={`chip ${healthState(snapshot.healthBps).cls}`}>
                      {healthState(snapshot.healthBps).label}
                    </span>
                    <span
                      className={`font-mono text-[11px] tabular-nums ${healthTone(snapshot.healthBps)}`}
                    >
                      Health {formatHealth(snapshot.healthBps)}
                    </span>
                  </>
                )}
                {snapshot.loanRatioBps != null && (
                  <span className="chip chip-neutral ml-auto">
                    Collateral ratio {(snapshot.loanRatioBps / 100).toFixed(0)}% · at draw
                  </span>
                )}
              </div>
            )}

            {/* Mono helper lines */}
            <div className="mt-2">
              <StatRow
                label="Your USDG"
                value={walletAddress ? fmtAmount(snapshot.balance, usdgDecimals, 2) : '--'}
                unit="USDG"
              />
              <StatRow
                label="Supplied by you"
                value={walletAddress ? fmtAmount(snapshot.lpDeposit, usdgDecimals, 2) : '--'}
                unit="USDG"
              />
            </div>
          </div>

          {/* Write gating */}
          {actionsLocked && (
            <div className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
              {blockedReason || 'Connect a wallet to interact with the lending pool.'}
            </div>
          )}

          <div className="rule" />

          {/* Tabs — mono uppercase pills on a surface-2 track */}
          <div className="flex gap-1 rounded-[12px] border border-line bg-surface-2 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-[8px] px-2 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.12em] transition-colors ${
                  tab === t.id
                    ? 'bg-ink text-bg'
                    : 'text-ink-3 hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Supply */}
          {tab === 'supply' && (
            <LendingSupplyTab
              snapshot={snapshot}
              usdgDecimals={usdgDecimals}
              walletAddress={walletAddress}
              inputs={inputs}
              setField={setField}
              handleDeposit={handleDeposit}
              handleWithdraw={handleWithdraw}
              busy={busy}
              actionsLocked={actionsLocked}
              hasLpDeposit={hasLpDeposit}
              buttonClass={buttonClass}
              approvalNote={approvalNote}
            />
          )}

          {/* Borrow */}
          {tab === 'borrow' && (
            <LendingBorrowTab
              snapshot={snapshot}
              usdgDecimals={usdgDecimals}
              inputs={inputs}
              setField={setField}
              handleBorrow={handleBorrow}
              handleAddCollateral={handleAddCollateral}
              handleWithdrawCollateral={handleWithdrawCollateral}
              busy={busy}
              actionsLocked={actionsLocked}
              hasPosition={hasPosition}
              requiredCollateral={requiredCollateral}
              scoreRatioBps={scoreRatioBps}
              buttonClass={buttonClass}
            />
          )}

          {/* Repay */}
          {tab === 'repay' && (
            <LendingRepayTab
              snapshot={snapshot}
              usdgDecimals={usdgDecimals}
              inputs={inputs}
              setField={setField}
              handleRepay={handleRepay}
              handleRepayAll={handleRepayAll}
              busy={busy}
              actionsLocked={actionsLocked}
              hasPosition={hasPosition}
              buttonClass={buttonClass}
              approvalNote={approvalNote}
            />
          )}

          {/* Liquidate */}
          {tab === 'liquidate' && (
            <LendingLiquidateTab
              inputs={inputs}
              setField={setField}
              targetHealthBps={targetHealthBps}
              targetKey={targetKey}
              targetIsLiquidatable={targetIsLiquidatable}
              handleLiquidate={handleLiquidate}
              busy={busy}
              actionsLocked={actionsLocked}
              buttonClass={buttonClass}
              approvalNote={approvalNote}
            />
          )}

          {/* Feedback */}
          {feedback && (
            <div
              className={`break-words rounded-[10px] border px-3 py-2 font-mono text-[11px] ${
                feedback.type === 'success'
                  ? 'border-positive/30 bg-positive/10 text-positive'
                  : feedback.type === 'error'
                  ? 'border-negative/30 bg-negative/10 text-negative'
                  : 'border-amber/30 bg-amber/10 text-amber'
              }`}
            >
              {feedback.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
