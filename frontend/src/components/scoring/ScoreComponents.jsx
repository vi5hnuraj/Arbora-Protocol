/**
 * Score Components card: shows the two inputs that feed into the composite
 * score (onchain score + offchain attestation status). Visually communicates
 * that these are inputs, not standalone metrics. When no attestation exists,
 * nudges the user toward the attestation simulator.
 */
export default function ScoreComponents({
  onchainScore = 0,
  chainsUsed = 1,
  dataCompleteness = 'Base chain only',
  hasAttestation = false,
  offchainScore = 0,
  isUsingInheritedScore = false,
}) {
  const isMultiChain = dataCompleteness.toLowerCase().includes('5-chain')
    || dataCompleteness.toLowerCase().includes('chain history');

  return (
    <div className="card flex flex-col gap-4">
      <div>
        <p className="kicker">Signal 01 · Inputs</p>
        <h3 className="display mt-2.5 text-[22px] leading-tight">
          Two signals, one number.
        </h3>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">
          The composite blends onchain behavior with an offchain attestation.
          Both are read straight from the CreditOracle.
        </p>
      </div>

      {/* Onchain score */}
      <div className="flex items-end justify-between gap-3 border-t border-line pt-4">
        <div>
          <span className="kicker block">Onchain score</span>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="display text-[34px] leading-none tabular-nums">
              {onchainScore}
            </span>
            <span className="font-mono text-[11px] text-ink-3">/100</span>
          </div>
        </div>
        <div className="text-right">
          <span
            className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] ${
              isMultiChain ? 'text-positive' : 'text-amber'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isMultiChain ? 'bg-positive' : 'bg-amber'
              }`}
            />
            {dataCompleteness}
          </span>
          {isUsingInheritedScore && (
            <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.12em] text-amber">
              Inherited from prior wallet
            </span>
          )}
          <span className="mt-1 block font-mono text-[10px] tabular-nums text-ink-3">
            {chainsUsed} chain{chainsUsed === 1 ? '' : 's'} analyzed
          </span>
        </div>
      </div>

      {/* Offchain attestation status */}
      <div className="border-t border-line pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="kicker">Offchain attestation</span>
          <span className={`chip ${hasAttestation ? 'chip-accent' : 'chip-neutral'}`}>
            {hasAttestation ? 'Attested' : 'None'}
          </span>
        </div>

        <div className="mt-3">
          {hasAttestation ? (
            <p className="font-mono text-[12px] text-ink-2">
              Verified · score{' '}
              <span className="text-ink">{offchainScore}</span>/100 pushed to
              the registry
            </p>
          ) : (
            <div className="rounded-[10px] border border-line bg-surface-2 p-3.5">
              <p className="text-[13px] font-medium text-ink">
                No offchain attestation
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
                Add offchain credit verification below to unlock
                undercollateralized lending terms. Your onchain score alone is
                capped at 50% of its raw value.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
