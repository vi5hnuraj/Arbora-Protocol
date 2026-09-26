export default function Header({
  account,
  onConnect,
  onDisconnect,
  isConnecting,
  onReset,
  wrongNetwork = false,
}) {
  const truncate = (addr) => (addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '');

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 sm:px-6">
        {/* Wordmark */}
        <button
          onClick={onReset}
          className="group flex items-center gap-2.5 text-left"
          title="Return to home"
        >
          <img
            src="/arbora.png"
            alt="Arbora"
            className="h-7 w-7 rounded-md object-contain transition-opacity group-hover:opacity-80"
          />
          <span className="display text-[26px] leading-none transition-opacity group-hover:opacity-70">
            Arbora
          </span>
          <span className="kicker hidden text-[9px] sm:inline">Protocol</span>
        </button>

        {/* Mono nav */}
        <nav className="hidden items-center gap-7 md:flex">
          <a href="#score" className="kicker transition-colors hover:text-ink">
            Score
          </a>
          <a href="#lending" className="kicker transition-colors hover:text-ink">
            Lending
          </a>
          <a href="#attestations" className="kicker transition-colors hover:text-ink">
            Attestations
          </a>
        </nav>

        {/* Network pill + wallet */}
        <div className="flex items-center gap-3">
          <span
            className={`hidden items-center gap-2 rounded-full border bg-surface px-3 py-1.5 sm:inline-flex ${
              wrongNetwork ? 'border-amber/40' : 'border-line'
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                wrongNetwork ? 'bg-amber' : 'bg-positive'
              }`}
            />
            <span className="kicker text-[10px] text-ink-2">Arbitrum Sepolia</span>
          </span>

          {account ? (
            <>
              <span className="chip font-normal tabular-nums">
                {truncate(account)}
              </span>
              <button
                onClick={onDisconnect}
                className="kicker hidden transition-colors hover:text-ink sm:inline"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={onConnect}
              disabled={isConnecting}
              className="btn-primary !h-9 !px-4 !text-[13px]"
            >
              {isConnecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
