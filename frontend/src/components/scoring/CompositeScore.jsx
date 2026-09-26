import ScoreGauge from './ScoreGauge.jsx';
import { getCollateralLabel } from '../../config/contract-addresses.js';

/**
 * Hero element: Composite Credit Score as a large radial gauge with
 * the collateral ratio and tier badge below. This is what determines
 * lending terms — the number the user cares about most.
 */
export default function CompositeScore({
  compositeScore = 0,
  collateralRatioBps = 15000,
}) {
  const collateral = getCollateralLabel(collateralRatioBps);
  const collateralPct = (collateralRatioBps / 100).toFixed(0);

  return (
    <div className="card flex flex-col items-center text-center">
      <p className="kicker self-start">Composite credit score</p>

      <div className="mt-4">
        <ScoreGauge score={compositeScore} />
      </div>

      {/* Collateral ratio + tier badge */}
      <div className="mt-6 flex items-center justify-center gap-4 border-t border-line pt-5">
        <div className="text-left">
          <span className="kicker block">Collateral required</span>
          <div className="display mt-1 text-[32px] leading-none tabular-nums">
            {collateralPct}%
          </div>
        </div>
        <span className={`chip ${collateral.color}`}>{collateral.text}</span>
      </div>
    </div>
  );
}
