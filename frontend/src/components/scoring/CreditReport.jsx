/**
 * CreditReport — Expandable full credit report panel.
 *
 * For each of the 10 model features, shows:
 *   - Display name with tier badge (Poor / Fair / Good / Excellent)
 *   - Wallet's value (derived from bin label)
 *   - Qualitative impact level (Very High / High / Moderate / Low / Minimal)
 *   - Top-decile benchmark comparison
 *   - Action item for improvement
 *
 * Tier direction is domain-informed:
 *   - "experience_positive": more activity = better (flipped from model direction)
 *   - "model_aligned": model reference bin = best (default)
 *   - "boolean": positive = Good, negative = Fair
 *
 * Editorial dark aesthetic, Tailwind v4 classes.
 */

// ---------------------------------------------------------------------------
// Feature metadata: benchmarks, action items, tier direction
// ---------------------------------------------------------------------------

const FEATURE_META = {
  lending_active_days: {
    tier_direction: 'experience_positive',
    benchmark_display: '15+ active days',
    action_item: 'Build a longer track record of borrowing activity on supported lending protocols',
  },
  borrow_repay_ratio: {
    tier_direction: 'model_aligned',
    benchmark_display: '~1.0 (balanced)',
    action_item: 'Keep repayments closely matched to borrows for a ratio near 1.0',
  },
  repay_count: {
    tier_direction: 'experience_positive',
    benchmark_display: '10+ repayments',
    action_item: 'Demonstrate reliability through consistent loan repayments over time',
  },
  unique_borrow_tokens: {
    tier_direction: 'experience_positive',
    benchmark_display: '3+ distinct assets',
    action_item: 'Diversify borrowing across multiple asset types to demonstrate range',
  },
  current_total_usd: {
    tier_direction: 'experience_positive',
    benchmark_display: '$1,000+ portfolio',
    action_item: 'Maintain a larger onchain portfolio to demonstrate financial capacity',
  },
  stablecoin_ratio: {
    tier_direction: 'model_aligned',
    benchmark_display: '50%+ stablecoins',
    action_item: 'Allocate a majority of your portfolio to stablecoins for risk reduction',
  },
  crosschain_total_tx_count: {
    tier_direction: 'experience_positive',
    benchmark_display: '1,000+ transactions',
    action_item: 'Expand crosschain activity to demonstrate sophisticated portfolio management',
  },
  crosschain_dex_trade_count: {
    tier_direction: 'experience_positive',
    benchmark_display: '100+ DEX trades',
    action_item: 'Increase crosschain DEX trading activity to signal market sophistication',
  },
  chains_active_on: {
    tier_direction: 'experience_positive',
    benchmark_display: '4 chains active',
    action_item: 'Expand activity across more blockchain networks',
  },
  has_used_bridge: {
    tier_direction: 'boolean',
    benchmark_display: 'Bridge experience',
    action_item: 'Use a crosschain bridge at least once to demonstrate crosschain capability',
  },
  net_flow_direction: {
    tier_direction: 'boolean',
    benchmark_display: 'Accumulating',
    action_item: 'Maintain a positive net flow (accumulating rather than depleting) over 90 days',
  },
};

// Feature display order (lending -> financial -> crosschain)
const FEATURE_ORDER = [
  'lending_active_days',
  'borrow_repay_ratio',
  'repay_count',
  'unique_borrow_tokens',
  'current_total_usd',
  'stablecoin_ratio',
  'net_flow_direction',
  'crosschain_total_tx_count',
  'crosschain_dex_trade_count',
  'chains_active_on',
  'has_used_bridge',
];

// Category labels for section headers
const FEATURE_CATEGORIES = {
  lending_active_days: 'Lending Behavior',
  current_total_usd: 'Financial Profile',
  crosschain_total_tx_count: 'Cross-Chain Activity',
};

// ---------------------------------------------------------------------------
// Bin ordering for tier assignment
// ---------------------------------------------------------------------------
// For experience_positive features, bins are ordered from least to most activity.
// For model_aligned features, bins are ordered from reference (best) outward.

const BIN_ORDERS = {
  lending_active_days: ['[1, 1]', '[2, 4]', '[5, 14]', '[15, inf)'],
  borrow_repay_ratio: ['(0.9, 1.1]', '[0, 0.9]', '(1.1, 2.0]', '(2.0, inf)'],
  repay_count: ['[0, 3]', '[4, 9]', '[10, inf)'],
  unique_borrow_tokens: ['[1, 1]', '[2, 2]', '[3, inf)'],
  current_total_usd: ['[0, 10]', '(10, 100]', '(100, 1000]', '(1000, inf)'],
  stablecoin_ratio: ['(0.5, 1.0]', '(0.05, 0.5]', '[0, 0.05]'],
  crosschain_total_tx_count: ['[0, 0]', '[1, 100]', '[101, 1000]', '[1001, inf)'],
  crosschain_dex_trade_count: ['[0, 0]', '[1, 100]', '[101, inf)'],
  chains_active_on: ['0', '1-3', '4'],
  has_used_bridge: ['0', '1'],
  net_flow_direction: ['0', '1'],
};

// ---------------------------------------------------------------------------
// Tier assignment
// ---------------------------------------------------------------------------

function getTier(feature, bin) {
  const meta = FEATURE_META[feature];
  if (!meta) return 'Fair';

  const direction = meta.tier_direction;
  const bins = BIN_ORDERS[feature];
  if (!bins) return 'Fair';

  const idx = bins.indexOf(bin);
  if (idx === -1) return 'Fair';

  if (direction === 'boolean') {
    // Positive value (last bin) = Good, negative = Fair
    return idx === bins.length - 1 ? 'Good' : 'Fair';
  }

  const n = bins.length;

  if (direction === 'experience_positive') {
    // More activity = better. Last bin = Excellent, first = Poor/Insufficient
    if (n <= 2) return idx === n - 1 ? 'Good' : 'Poor';
    if (n === 3) return ['Poor', 'Fair', 'Excellent'][idx];
    // 4 bins
    return ['Poor', 'Fair', 'Good', 'Excellent'][idx];
  }

  // model_aligned: reference bin (idx 0) = Excellent, furthest = Poor
  if (n <= 2) return idx === 0 ? 'Excellent' : 'Fair';
  if (n === 3) return ['Excellent', 'Good', 'Poor'][idx];
  // 4+ bins
  if (idx === 0) return 'Excellent';
  if (idx === n - 1) return 'Poor';
  if (idx <= n / 2) return 'Good';
  return 'Fair';
}

// ---------------------------------------------------------------------------
// Qualitative impact level (replaces raw coefficient numbers)
// ---------------------------------------------------------------------------

function getImpactLevel(coefficient, isReference) {
  if (isReference) return { label: 'Baseline', style: 'text-ink-3' };

  const abs = Math.abs(coefficient);
  if (abs >= 0.8) return { label: 'Very High Impact', style: 'text-negative' };
  if (abs >= 0.4) return { label: 'High Impact', style: 'text-amber' };
  if (abs >= 0.15) return { label: 'Moderate Impact', style: 'text-info' };
  if (abs >= 0.05) return { label: 'Low Impact', style: 'text-ink-2' };
  return { label: 'Minimal Impact', style: 'text-ink-3' };
}

// ---------------------------------------------------------------------------
// Human-readable bin value strings
// ---------------------------------------------------------------------------

function formatBinValue(feature, bin) {
  const formatters = {
    lending_active_days: {
      '[1, 1]': '1 day',
      '[2, 4]': '2-4 days',
      '[5, 14]': '5-14 days',
      '[15, inf)': '15+ days',
    },
    borrow_repay_ratio: {
      '[0, 0.9]': 'Ratio under 0.9 (under-repaid)',
      '(0.9, 1.1]': 'Ratio 0.9-1.1 (balanced)',
      '(1.1, 2.0]': 'Ratio 1.1-2.0 (over-repaid)',
      '(2.0, inf)': 'Ratio over 2.0 (excess repayment)',
    },
    repay_count: {
      '[0, 3]': '0-3 repayments',
      '[4, 9]': '4-9 repayments',
      '[10, inf)': '10+ repayments',
    },
    unique_borrow_tokens: {
      '[1, 1]': '1 token',
      '[2, 2]': '2 tokens',
      '[3, inf)': '3+ tokens',
    },
    current_total_usd: {
      '[0, 10]': '$0-$10',
      '(10, 100]': '$10-$100',
      '(100, 1000]': '$100-$1,000',
      '(1000, inf)': '$1,000+',
    },
    stablecoin_ratio: {
      '[0, 0.05]': 'Under 5%',
      '(0.05, 0.5]': '5%-50%',
      '(0.5, 1.0]': 'Over 50%',
    },
    crosschain_total_tx_count: {
      '[0, 0]': 'None',
      '[1, 100]': '1-100 transactions',
      '[101, 1000]': '101-1,000 transactions',
      '[1001, inf)': '1,000+ transactions',
    },
    crosschain_dex_trade_count: {
      '[0, 0]': 'None',
      '[1, 100]': '1-100 trades',
      '[101, inf)': '101+ trades',
    },
    chains_active_on: {
      '0': 'Arbitrum Native',
      '1-3': '1-3 external chains',
      '4': '4+ external chains',
    },
    has_used_bridge: {
      '1': 'Yes',
      '0': 'No',
    },
    net_flow_direction: {
      '1': 'Accumulating',
      '0': 'Depleting',
    },
  };

  return formatters[feature]?.[bin] ?? bin;
}

// ---------------------------------------------------------------------------
// Tier badge component
// ---------------------------------------------------------------------------

const TIER_STYLES = {
  Poor: 'chip-negative',
  Insufficient: 'chip-negative',
  Fair: 'chip-warning',
  Good: 'chip-positive',
  Excellent: 'chip-positive',
};

function TierBadge({ tier }) {
  const style = TIER_STYLES[tier] || TIER_STYLES.Fair;
  return <span className={`chip ${style}`}>{tier}</span>;
}

// ---------------------------------------------------------------------------
// Single feature card
// ---------------------------------------------------------------------------

function FeatureCard({ factor }) {
  const { feature, display_name, bin, coefficient, is_reference } = factor;
  const meta = FEATURE_META[feature];
  const tier = getTier(feature, bin);
  const walletValue = formatBinValue(feature, bin);
  const impact = getImpactLevel(coefficient, is_reference);

  if (!meta) return null;

  return (
    <div className="rounded-[10px] border border-line bg-surface-2 p-4 sm:p-5">
      {/* Header row: name + tier badge */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-[15px] font-medium leading-tight text-ink">
          {display_name}
        </h4>
        <TierBadge tier={tier} />
      </div>

      {/* Wallet value */}
      <div className="mt-3.5 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="kicker">Your value</span>
        <span className="font-mono text-[12px] text-ink">{walletValue}</span>
      </div>

      {/* Qualitative impact level */}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="kicker">Impact</span>
        <span className={`font-mono text-[11px] uppercase tracking-[0.1em] ${impact.style}`}>
          {impact.label}
        </span>
      </div>

      {/* Benchmark */}
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="kicker">Top wallets</span>
        <span className="font-mono text-[12px] text-info">
          {meta.benchmark_display}
        </span>
      </div>

      {/* Action item */}
      <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-relaxed text-ink-3">
        To improve: {meta.action_item}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CreditReport({ factors = [], isExpanded, onToggle }) {
  // Build a lookup from feature name to factor data
  const factorMap = {};
  for (const f of factors) {
    factorMap[f.feature] = f;
  }

  // Order by FEATURE_ORDER; drop features the API didn't return
  const orderedFactors = FEATURE_ORDER.map((feat) => factorMap[feat]).filter(
    Boolean
  );

  if (orderedFactors.length === 0) return null;

  return (
    <div className="card overflow-hidden p-0">
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2 sm:px-6"
      >
        <div className="flex items-center gap-3">
          <span className="kicker">Full credit report</span>
          <span className="text-[14px] font-medium text-ink">
            {isExpanded ? 'Hide details' : 'View details'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="kicker hidden text-[10px] sm:inline">
            {orderedFactors.length} factors
          </span>
          <svg
            className={`h-4 w-4 text-ink-3 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-line px-5 pb-6 pt-5 sm:px-6">
          {/* Preamble */}
          <p className="mb-6 max-w-[70ch] text-[13px] leading-relaxed text-ink-3">
            Detailed breakdown of all credit factors. Each factor shows your
            assessed tier, its impact on the overall score, how top-scoring
            wallets compare, and specific steps to improve.
          </p>

          {/* Render cards grouped by category */}
          <div className="space-y-6">
            {FEATURE_ORDER.map((feat) => {
              const factor = factorMap[feat];
              if (!factor) return null;

              const categoryLabel = FEATURE_CATEGORIES[feat];

              return (
                <div key={feat}>
                  {categoryLabel && (
                    <p className="kicker mb-3">{categoryLabel}</p>
                  )}
                  <FeatureCard factor={factor} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
