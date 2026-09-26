import { ARBITRUM_SEPOLIA_EXPLORER } from '../../config/contract-addresses.js';

const REPO = 'https://github.com/vi5hnuraj/Arbora-Protocol';

export default function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div>
          <span className="display text-2xl leading-none">Arbora</span>
          <p className="kicker mt-3 text-[10px]">
            Onchain credit, priced by proof
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <a
            href={`${REPO}#readme`}
            target="_blank"
            rel="noopener noreferrer"
            className="kicker transition-colors hover:text-ink"
          >
            Docs
          </a>
          <a
            href={ARBITRUM_SEPOLIA_EXPLORER}
            target="_blank"
            rel="noopener noreferrer"
            className="kicker transition-colors hover:text-ink"
          >
            Arbiscan
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="kicker transition-colors hover:text-ink"
          >
            Github
          </a>
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-7xl px-5 py-5 sm:px-6">
          <p className="kicker text-[10px] text-ink-3">
            Built for Arbitrum Open House Singapore · 2026
          </p>
        </div>
      </div>
    </footer>
  );
}
