/**
 * FactorBreakdown — model coefficient rows for each score factor.
 * Feature name in sans, bin in mono, coefficient right-aligned in mono,
 * a thin magnitude bar, and a REFERENCE chip for baseline rows.
 */
export default function FactorBreakdown({ factors = [] }) {
  const maxCoeff = factors.reduce(
    (max, f) => Math.max(max, Math.abs(f.coefficient || 0)),
    0,
  );

  return (
    <div className="card p-0">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <p className="kicker">Model · Coefficients</p>
        <h3 className="display mt-2 text-[22px] leading-tight">
          Score factor breakdown
        </h3>
      </div>

      {factors.length === 0 ? (
        <p className="px-5 py-8 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 sm:px-6">
          No factor data available
        </p>
      ) : (
        <div className="px-5 sm:px-6">
          {factors.map((f) => {
            const width = maxCoeff > 0
              ? Math.min(100, (Math.abs(f.coefficient || 0) / maxCoeff) * 100)
              : 0;
            const positive = (f.coefficient || 0) >= 0;

            return (
              <div
                key={f.feature}
                className="flex items-center gap-4 border-b border-line py-3.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5">
                    <span className="truncate text-[14px] text-ink">
                      {f.display_name}
                    </span>
                    {f.is_reference && (
                      <span className="chip chip-neutral !px-1.5 !py-1 !text-[9px]">
                        Reference
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center gap-3">
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
                      {f.bin}
                    </span>
                    {!f.is_reference && (
                      <span className="h-px flex-1 bg-line">
                        <span
                          className={`block h-px ${positive ? 'bg-positive' : 'bg-negative'}`}
                          style={{ width: `${width}%` }}
                        />
                      </span>
                    )}
                  </div>
                </div>

                <span
                  className={`shrink-0 font-mono text-[13px] tabular-nums ${
                    f.is_reference
                      ? 'text-ink-3'
                      : positive
                      ? 'text-positive'
                      : 'text-negative'
                  }`}
                >
                  {f.is_reference
                    ? '—'
                    : `${f.coefficient > 0 ? '+' : ''}${f.coefficient.toFixed(3)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
