import {
  FieldLabel,
  INPUT_WRAP,
  INPUT_CLASS,
  SUFFIX_CLASS,
  formatHealth,
  healthTone,
} from './lending-pool-helpers.jsx';

export default function LendingLiquidateTab({
  inputs,
  setField,
  targetHealthBps,
  targetKey,
  targetIsLiquidatable,
  handleLiquidate,
  busy,
  actionsLocked,
  buttonClass,
  approvalNote,
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <FieldLabel
          hint={
            targetHealthBps != null
              ? `Health ${formatHealth(targetHealthBps)}`
              : 'Health --'
          }
        >
          Borrower Address
        </FieldLabel>
        <input
          type="text"
          value={inputs.liquidateAddr}
          onChange={setField('liquidateAddr')}
          placeholder="0x…"
          className="field"
        />
        {targetKey && (
          <p className={`font-mono text-[10px] ${healthTone(targetHealthBps)}`}>
            {targetIsLiquidatable
              ? 'Position is below 100% health — liquidatable'
              : targetHealthBps != null
              ? 'Position is healthy — liquidation would revert'
              : 'Reading health factor…'}
          </p>
        )}
      </div>

      <div className="space-y-2.5">
        <FieldLabel hint="USDG you repay on the borrower's behalf">Liquidation Amount</FieldLabel>
        <div className="flex gap-2">
          <div className={INPUT_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              value={inputs.liquidateAmt}
              onChange={setField('liquidateAmt')}
              placeholder="0.0"
              className={INPUT_CLASS}
            />
            <span className={SUFFIX_CLASS}>USDG</span>
          </div>
          <button
            onClick={handleLiquidate}
            disabled={
              !!busy || actionsLocked || !targetKey || !targetIsLiquidatable || !inputs.liquidateAmt
            }
            className={buttonClass('liquidate', 'primary')}
          >
            {busy === 'liquidate' ? '…' : 'Liquidate'}
          </button>
        </div>
        {approvalNote(inputs.liquidateAmt)}
        <p className="font-mono text-[10px] leading-relaxed text-ink-3">
          Liquidators repay USDG and seize ETH collateral plus the
          liquidation bonus.
        </p>
      </div>
    </div>
  );
}
