import { fmtAmount } from '../../lib/ethers-helpers.js';
import {
  FieldLabel,
  INPUT_WRAP,
  INPUT_CLASS,
  SUFFIX_CLASS,
} from './lending-pool-helpers.jsx';

export default function LendingSupplyTab({
  snapshot,
  usdgDecimals,
  walletAddress,
  inputs,
  setField,
  handleDeposit,
  handleWithdraw,
  busy,
  actionsLocked,
  hasLpDeposit,
  buttonClass,
  approvalNote,
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <FieldLabel hint={`Balance: ${walletAddress ? fmtAmount(snapshot.balance, usdgDecimals, 2) : '--'} USDG`}>
          Deposit USDG
        </FieldLabel>
        <div className="flex gap-2">
          <div className={INPUT_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              value={inputs.deposit}
              onChange={setField('deposit')}
              placeholder="0.0"
              className={INPUT_CLASS}
            />
            <span className={SUFFIX_CLASS}>USDG</span>
          </div>
          <button
            onClick={handleDeposit}
            disabled={!!busy || actionsLocked || !inputs.deposit}
            className={buttonClass('deposit', 'primary')}
          >
            {busy === 'deposit' ? '…' : 'Deposit'}
          </button>
        </div>
        {approvalNote(inputs.deposit)}
      </div>

      <div className="rule" />

      <div className="space-y-2.5">
        <FieldLabel hint={`Your supply: ${walletAddress ? fmtAmount(snapshot.lpDeposit, usdgDecimals, 2) : '--'} USDG`}>
          Withdraw USDG
        </FieldLabel>
        <div className="flex gap-2">
          <div className={INPUT_WRAP}>
            <input
              type="text"
              inputMode="decimal"
              value={inputs.withdraw}
              onChange={setField('withdraw')}
              placeholder="0.0"
              className={INPUT_CLASS}
            />
            <span className={SUFFIX_CLASS}>USDG</span>
          </div>
          <button
            onClick={handleWithdraw}
            disabled={!!busy || actionsLocked || !inputs.withdraw || !hasLpDeposit}
            className={buttonClass('withdraw', 'secondary')}
          >
            {busy === 'withdraw' ? '…' : 'Withdraw'}
          </button>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-ink-3">
          Un-lent liquidity only: {fmtAmount(snapshot.available, usdgDecimals, 2)} USDG
          available.
        </p>
      </div>
    </div>
  );
}
