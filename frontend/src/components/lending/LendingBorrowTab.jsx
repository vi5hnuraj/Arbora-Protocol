import { fmtAmount } from '../../lib/ethers-helpers.js';
import {
  FieldLabel,
  INPUT_WRAP,
  INPUT_CLASS,
  SUFFIX_CLASS,
} from './lending-pool-helpers.jsx';

export default function LendingBorrowTab({
  snapshot,
  usdgDecimals,
  inputs,
  setField,
  handleBorrow,
  handleAddCollateral,
  handleWithdrawCollateral,
  busy,
  actionsLocked,
  hasPosition,
  requiredCollateral,
  scoreRatioBps,
  buttonClass,
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <FieldLabel hint={`Available: ${fmtAmount(snapshot.available, usdgDecimals, 2)} USDG`}>
          Borrow USDG
        </FieldLabel>
        <div className="flex gap-2">
          <div className={INPUT_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              value={inputs.borrow}
              onChange={setField('borrow')}
              placeholder="0.0"
              className={INPUT_CLASS}
            />
            <span className={SUFFIX_CLASS}>USDG</span>
          </div>
          <button
            onClick={handleBorrow}
            disabled={!!busy || actionsLocked || !inputs.borrow || requiredCollateral == null}
            className={buttonClass('borrow', 'primary')}
          >
            {busy === 'borrow' ? '…' : 'Borrow'}
          </button>
        </div>
        <p className="font-mono text-[12px] tabular-nums text-ink-2">
          ETH collateral required:{' '}
          <span className="text-ink">
            {requiredCollateral != null
              ? `${fmtAmount(requiredCollateral, 18, 5)} ETH`
              : '--'}
          </span>
          {scoreRatioBps != null && (
            <span className="ml-2 text-ink-3">
              ({(scoreRatioBps / 100).toFixed(0)}% ratio)
            </span>
          )}
        </p>
        <p className="font-mono text-[10px] leading-relaxed text-ink-3">
          The full ETH amount sent becomes your collateral; extra ETH
          improves your health factor.
        </p>
      </div>

      <div className="rule" />

      <div className="space-y-2.5">
        <FieldLabel hint={hasPosition ? 'Improves health factor' : 'Open a loan first'}>
          Add ETH Collateral
        </FieldLabel>
        <div className="flex gap-2">
          <div className={INPUT_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              value={inputs.collateral}
              onChange={setField('collateral')}
              placeholder="0.0"
              disabled={!hasPosition}
              className={INPUT_CLASS}
            />
            <span className={SUFFIX_CLASS}>ETH</span>
          </div>
          <button
            onClick={handleAddCollateral}
            disabled={!!busy || actionsLocked || !hasPosition || !inputs.collateral}
            className={buttonClass('addCollateral', 'secondary')}
          >
            {busy === 'addCollateral' ? '…' : 'Add'}
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        <FieldLabel hint={hasPosition ? `Collateral: ${fmtAmount(snapshot.collateralWei, 18, 4)} ETH` : 'Open a loan first'}>
          Withdraw ETH Collateral
        </FieldLabel>
        <div className="flex gap-2">
          <div className={INPUT_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              value={inputs.withdrawCollateral}
              onChange={setField('withdrawCollateral')}
              placeholder="0.0"
              disabled={!hasPosition}
              className={INPUT_CLASS}
            />
            <span className={SUFFIX_CLASS}>ETH</span>
          </div>
          <button
            onClick={handleWithdrawCollateral}
            disabled={!!busy || actionsLocked || !hasPosition || !inputs.withdrawCollateral}
            className={buttonClass('withdrawCollateral', 'secondary')}
          >
            {busy === 'withdrawCollateral' ? '…' : 'Withdraw'}
          </button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-ink-3">
          Only free collateral — the health factor must stay ≥ 100%.
        </p>
      </div>
    </div>
  );
}
