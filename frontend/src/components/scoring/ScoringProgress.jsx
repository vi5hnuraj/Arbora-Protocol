import { useState, useEffect, useRef } from 'react';

/**
 * ScoringProgress — terminal-style step list driven by SSE events from the
 * backend /score/stream endpoint.
 *
 * Props:
 *   isActive: boolean — whether scoring is in progress
 *   progress: object — map of completed event names from the SSE stream
 *     e.g. { arbitrum_start: true, arbitrum_done: true, crosschain_start: true, ... }
 *   key (from parent) — remounts the component per scoring run so the
 *     elapsed timer starts fresh each time.
 */

const CHAINS = [
  { id: 'arbitrum',  short: 'Arbitrum', color: '#28A0F0', startEvent: 'arbitrum_start', doneEvent: 'arbitrum_done' },
  { id: 'ethereum',  short: 'ETH',      color: '#627EEA', startEvent: 'crosschain_start', doneEvent: 'crosschain_done' },
  { id: 'optimism',  short: 'OP',       color: '#FF0420', startEvent: 'crosschain_start', doneEvent: 'crosschain_done' },
  { id: 'polygon',   short: 'POLY',     color: '#8247E5', startEvent: 'crosschain_start', doneEvent: 'crosschain_done' },
  { id: 'base',      short: 'BASE',     color: '#0052FF', startEvent: 'crosschain_start', doneEvent: 'crosschain_done' },
];

const STEPS = [
  { label: 'Querying Arbitrum lending history (Aave v3 / Radiant)...', doneEvent: 'arbitrum_done' },
  { label: 'Scanning multichain DeFi & bridge activity...', doneEvent: 'crosschain_done' },
  { label: 'Computing credit score & risk breakdown...', doneEvent: 'model_done' },
  { label: 'Publishing attestation to Arbitrum Sepolia...', doneEvent: 'push_done' },
];

export default function ScoringProgress({ isActive, progress = {} }) {
  // { elapsed, stepTimes } — elapsed resets via the per-run `key` from the
  // parent, so no state is set synchronously inside an effect.
  const [run, setRun] = useState({ elapsed: 0, stepTimes: {} });
  const { elapsed, stepTimes } = run;

  // Determine which step is currently active based on real events
  let activeStepIdx = 0;
  for (let i = 0; i < STEPS.length; i++) {
    const isStepDone = progress[STEPS[i].doneEvent];
    if (isStepDone) {
      activeStepIdx = i + 1;
    }
  }
  // If result arrived, all steps are done
  if (progress.result) activeStepIdx = STEPS.length;

  // Mirror the active step for the timer callback (updated after render).
  const activeRef = useRef(activeStepIdx);
  useEffect(() => {
    activeRef.current = activeStepIdx;
  }, [activeStepIdx]);

  // Timer — stamps the elapsed second at which each step completed.
  useEffect(() => {
    if (!isActive) return undefined;
    const interval = setInterval(() => {
      setRun((prev) => {
        const elapsedNext = prev.elapsed + 1;
        const idx = activeRef.current;
        const stepTimesNext =
          idx > 0 && prev.stepTimes[idx - 1] == null
            ? { ...prev.stepTimes, [idx - 1]: elapsedNext }
            : prev.stepTimes;
        return { elapsed: elapsedNext, stepTimes: stepTimesNext };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="card">
        <p className="kicker">
          <span className="text-amber pulse-dot">●</span> Scoring run · Live
        </p>
        <h3 className="display mt-3 text-[26px] leading-tight">Analyzing wallet</h3>
        <p className="mt-1.5 text-[14px] text-ink-2">
          Querying Arbitrum and EVM networks to evaluate credit risk…
        </p>

        {/* Live network map — mono status strip */}
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[10px] border border-line bg-surface-2 px-4 py-3">
          {CHAINS.map((chain) => {
            const hasStarted = progress[chain.startEvent];
            const hasDone = progress[chain.doneEvent];
            const isScanning = hasStarted && !hasDone;
            const isDone = !!hasDone;
            const isPending = !hasStarted;

            return (
              <span key={chain.id} className="inline-flex items-center gap-2">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isPending ? 'bg-ink-3/40' : isScanning ? 'pulse-dot' : ''
                  }`}
                  style={{ backgroundColor: isPending ? undefined : chain.color }}
                />
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.16em] ${
                    isPending ? 'text-ink-3/50' : isScanning ? 'text-ink' : 'text-ink-2'
                  }`}
                >
                  {chain.short}
                </span>
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.14em] ${
                    isDone
                      ? 'text-positive'
                      : isScanning
                      ? 'text-amber'
                      : 'text-transparent'
                  }`}
                >
                  {isDone ? 'done' : isScanning ? 'scanning' : '·'}
                </span>
              </span>
            );
          })}
        </div>

        {/* Pipeline steps */}
        <div className="mt-5">
          {STEPS.map((step, i) => {
            const isComplete = i < activeStepIdx;
            const isCurrent = i === activeStepIdx && i < STEPS.length;
            const doneAt = stepTimes[i];

            return (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
              >
                <span
                  className={`w-4 shrink-0 text-center font-mono text-[12px] ${
                    isComplete
                      ? 'check-in text-positive'
                      : isCurrent
                      ? 'pulse-dot text-amber'
                      : 'text-ink-3/40'
                  }`}
                >
                  {isComplete ? '✓' : isCurrent ? '●' : '○'}
                </span>

                <span
                  className={`font-mono text-[11px] uppercase leading-tight tracking-[0.12em] ${
                    isComplete
                      ? 'text-ink-2'
                      : isCurrent
                      ? 'text-ink'
                      : 'text-ink-3/50'
                  }`}
                >
                  {step.label}
                </span>

                <span
                  className={`ml-auto shrink-0 font-mono text-[11px] tabular-nums ${
                    isComplete ? 'text-ink-3' : isCurrent ? 'text-amber' : 'text-ink-3/40'
                  }`}
                >
                  {isComplete
                    ? `+${doneAt ?? 0}s`
                    : isCurrent
                    ? `${elapsed}s`
                    : 'queued'}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
          <span className="kicker text-[10px]">Elapsed</span>
          <span className="font-mono text-[11px] tabular-nums text-ink-2">
            {elapsed}s
          </span>
        </div>
      </div>
    </div>
  );
}
