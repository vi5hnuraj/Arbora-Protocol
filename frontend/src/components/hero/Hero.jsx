/**
 * Hero — editorial two-column stage.
 *
 * Left: headline, body copy, CTAs and the serif stats row.
 * Right: static browser-chrome mock panel showing the composite feed.
 * The panel is decorative — it performs no network calls.
 */

const RECORDS = [
  {
    chip: 'ATTESTED',
    tone: 'chip-accent',
    wallet: '0xa629…2f91',
    hash: '0x47c9…adeef4',
    time: '08:33:00 UTC',
  },
  {
    chip: 'DEMO',
    tone: 'chip-info',
    wallet: '0x8d27…6d26',
    hash: '0x3c88…f8fb06',
    time: '08:32:47 UTC',
  },
  {
    chip: 'SCORED',
    tone: 'chip-positive',
    wallet: '0xa629…2f91',
    hash: '0xb6bd…40423a',
    time: '08:32:39 UTC',
  },
];

const STATS = [
  {
    value: '100',
    tone: 'text-negative',
    caption: 'points of composite score, readable by any contract.',
  },
  {
    value: '75%',
    tone: 'text-ink',
    caption: 'collateral for a perfect score, against 150% baseline.',
  },
  {
    value: '115,687',
    tone: 'text-positive',
    caption: 'DeFi borrowers trained the model (AUC 0.818).',
  },
];

function scrollToScore(e) {
  e.preventDefault();
  const section = document.getElementById('score');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.setTimeout(() => {
    const input = document.getElementById('wallet-address-input');
    if (input) input.focus({ preventScroll: true });
  }, 550);
}

function FeedPanel() {
  return (
    <div className="card overflow-hidden p-0">
      {/* Browser chrome */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex min-w-0 flex-1 justify-center">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 truncate rounded-md border border-line bg-surface-2 px-3 py-1 font-mono text-[10px] text-ink-3">
            <span aria-hidden="true">🔒</span>
            <span className="truncate">
              arbora.protocol/score
              {/* The chain suffix would inflate the panel's min-content width
                  past the viewport on phones — show it from sm up. */}
              <span className="hidden sm:inline"> · arbitrum sepolia</span>
            </span>
          </span>
        </div>
        {/* Spacer keeps the URL pill optically centred on desktop only —
            on narrow screens it would inflate the panel's min-content width. */}
        <span className="hidden w-12 shrink-0 sm:block" />
      </div>

      {/* Panel body */}
      <div className="space-y-5 p-5">
        <div>
          <p className="kicker">
            <span className="text-positive">●</span> Live · Composite feed
          </p>
          <h3 className="display mt-3 text-[26px] leading-[1.1]">
            Every score, and how it was built.
          </h3>
          <p className="mt-2.5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-2">
            Computed onchain from two independent signals — then written to the
            CreditOracle.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="chip chip-positive">128 Scored</span>
          <span className="chip chip-accent">41 Attested</span>
          <span className="chip chip-info">9 Pooled</span>
        </div>

        <div className="space-y-2.5">
          {RECORDS.map((record) => (
            <div
              key={record.hash}
              className="rounded-[10px] border border-line bg-surface-2 px-3.5 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className={`chip ${record.tone}`}>{record.chip}</span>
                <span className="font-mono text-[11px] tabular-nums text-ink">
                  {record.wallet}
                </span>
              </div>
              {/* flex-wrap: the mono label + hash + timestamp must stack on
                  narrow screens, otherwise the row's min-content widens the
                  whole hero grid beyond the viewport. */}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="kicker shrink-0 text-[9px]">
                  Arbitrum sepolia tx
                </span>
                <span className="truncate font-mono text-[11px] text-ink-2">
                  {record.hash}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
                  {record.time}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto flex min-h-[85vh] max-w-7xl items-center px-5 pb-20 pt-16 sm:px-6 sm:pb-24 sm:pt-24">
        <div className="grid w-full items-center gap-12 lg:grid-cols-12 lg:gap-16">
          {/* Left: headline + copy + CTAs + stats */}
          <div className="lg:col-span-7">
            <p className="kicker">
              <span className="text-positive">●</span> Live on Arbitrum Sepolia
              <span className="text-ink-3/50"> · </span>Lending in USDG
              <span className="text-ink-3/50"> · </span>Score 0–100
            </p>

            <h1 className="display mt-7 text-[clamp(2.5rem,5.6vw,4.5rem)] leading-[0.98]">
              <span className="block">Loans priced by proof,</span>
              <span className="block">not just by</span>
              <span className="block">collateral.</span>
            </h1>

            <p className="mt-7 max-w-[60ch] text-[16.5px] leading-[1.75] text-ink-2">
              Arbora blends onchain behavior across five chains with offchain
              credit attestations into a single composite score that sets your
              collateral requirement on a continuous curve — from 150% for an
              unknown wallet down to 75% for a proven one. Liquidity, debt and
              repayment are all denominated in{' '}
              <strong className="font-semibold text-ink">USDG</strong> on
              Arbitrum Sepolia; collateral is ETH.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#score" onClick={scrollToScore} className="btn-primary">
                Score a wallet
              </a>
              <a href="#lending" className="btn-secondary">
                Open the lending desk
              </a>
            </div>

            {/* Stats row — serif numerals, hairline dividers */}
            <div className="mt-12 grid grid-cols-1 gap-7 border-t border-line pt-8 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-line">
              {STATS.map((stat) => (
                <div
                  key={stat.value}
                  className="sm:px-6 sm:first:pl-0 sm:last:pr-0"
                >
                  <div className={`stat-number ${stat.tone}`}>{stat.value}</div>
                  <p className="mt-3 max-w-[24ch] text-[13px] leading-snug text-ink-3">
                    {stat.caption}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: browser-chrome mock panel */}
          <div className="lg:col-span-5">
            <FeedPanel />
          </div>
        </div>
      </div>
    </section>
  );
}
