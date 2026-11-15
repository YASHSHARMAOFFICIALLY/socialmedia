// Life in the hero sky, like Ribbon's birds: a small flock glides slowly across the top, wings
// flapping out of step. SMIL in one SVG, no client JS. Hidden for reduced motion (landing.css).
//
// Storyboard (seconds after load):
//   0+   flock crosses left to right every 46s, between the nav and the headline

const TIMING = { flockLap: 46 } as const;

// Flock offsets (x, y) and wing-beat phase, so the birds don't flap in sync.
const flock = [
  [0, 0, 0], [26, -9, 0.15], [44, 6, 0.3], [70, -4, 0.05], [92, 10, 0.4], [118, -2, 0.25],
] as const;

const WING_UP = "M-7 0 Q-3.5 -4.5 0 0 Q3.5 -4.5 7 0";
const WING_DOWN = "M-7 0 Q-3.5 2 0 0 Q3.5 2 7 0";

export function SkyLife() {
  return (
    <svg aria-hidden viewBox="0 0 1000 600" preserveAspectRatio="xMidYMin slice" className="sky-life pointer-events-none absolute inset-0 size-full">
      {/* Flock: whole group drifts across with a gentle rise and fall. */}
      <g>
        <animateTransform attributeName="transform" type="translate" values="-160 60; 1160 40" dur={`${TIMING.flockLap}s`} repeatCount="indefinite" />
        {flock.map(([x, y, phase]) => (
          <g key={x} transform={`translate(${x} ${y}) scale(1.4)`}>
            <path d={WING_UP} fill="none" stroke="#0d2a4a" strokeWidth={1.6} strokeLinecap="round" opacity={0.75}>
              <animate attributeName="d" values={`${WING_UP};${WING_DOWN};${WING_UP}`} dur="0.9s" begin={`${phase}s`} repeatCount="indefinite" />
            </path>
          </g>
        ))}
      </g>

    </svg>
  );
}
