import { getScoreColor } from '../../config/contract-addresses.js';

const RADIUS = 80;
const STROKE = 12;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_FRACTION = 270 / 360; // 270-degree arc
const ARC_LENGTH = CIRCUMFERENCE * ARC_FRACTION;

export default function ScoreGauge({ score = 0, label }) {
  const clampedScore = Math.max(0, Math.min(100, score));
  const color = getScoreColor(clampedScore);
  const offset = ARC_LENGTH * (1 - clampedScore / 100);

  // Rotate so the gap sits at the bottom center.
  // A 270-degree arc leaves a 90-degree gap; rotating -225 degrees
  // (from 3-o'clock default) places the start at 7:30 and end at 4:30,
  // centering the gap at 6-o'clock.
  const rotation = -225;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width={200}
        height={200}
        viewBox="0 0 200 200"
        className="overflow-visible"
      >
        {/* Background arc */}
        <circle
          cx={100}
          cy={100}
          r={RADIUS}
          fill="none"
          stroke="var(--color-gauge-track)"
          strokeWidth={STROKE}
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          strokeLinecap="round"
          transform={`rotate(${rotation} 100 100)`}
        />

        {/* Foreground arc — animated via CSS class */}
        <circle
          cx={100}
          cy={100}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
          strokeLinecap="round"
          transform={`rotate(${rotation} 100 100)`}
          className="gauge-arc"
          style={{
            '--gauge-circumference': ARC_LENGTH,
            '--gauge-offset': offset,
            strokeDashoffset: ARC_LENGTH, // initial state before animation
          }}
        />

        {/* Score number — serif, ~56px */}
        <text
          x={100}
          y={104}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: '56px',
            fill: 'var(--color-ink)',
            fontFamily: 'var(--font-display)',
            letterSpacing: '-0.02em',
          }}
        >
          {clampedScore}
        </text>
      </svg>

      <span className="kicker text-center">
        {label || 'Composite score / 100'}
      </span>
    </div>
  );
}
