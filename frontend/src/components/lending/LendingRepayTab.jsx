import { fmtAmount } from '../../lib/ethers-helpers.js';
import {
  FieldLabel,
  INPUT_WRAP,
  INPUT_CLASS,
  SUFFIX_CLASS,
} from './lending-pool-helpers.jsx';

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
        </>
      ) : (
        <div className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-6 text-center text-[13px] text-ink-2">
          No open loan — borrow first to repay.
        </div>
      )}
    </div>
  );
}
