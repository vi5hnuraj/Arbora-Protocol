import { CONTRACT_ENV_VARS } from '../../config/contract-addresses.js';

/**
 * Shown when any contract address is missing from the environment —
 * read-only / demo UI keeps working, writes stay disabled.
 */
export default function ContractsNotice({ missing = [] }) {
  if (missing.length === 0) return null;

  return (
    <div className="bar bar-warning">
      <p>
        <span className="mr-1.5" aria-hidden="true">
          ●
        </span>
        Contracts not configured — run{' '}
        <span className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5">
          forge script script/Deploy.s.sol
        </span>{' '}
        and paste the addresses
      </p>
      <p className="normal-case tracking-normal text-ink-2">
        Missing:{' '}
        <span className="text-amber">
          {missing.map((key) => CONTRACT_ENV_VARS[key] || key).join(', ')}
        </span>{' '}
        — set them in frontend/.env. Scoring and demo panels keep working;
        onchain actions are disabled.
      </p>
    </div>
  );
}
