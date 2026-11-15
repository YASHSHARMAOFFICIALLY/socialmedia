// Ragged paper edge where the sky-coloured hero meets the canvas below.
const points = [22, 14, 26, 18, 30, 12, 24, 20, 10, 26, 16, 28, 12, 22, 18, 30, 14, 24, 20, 12, 26, 16, 22, 10, 28, 18, 14, 24, 20, 16];

const path =
  `M0 ${points[0]} ` +
  points.map((y, i) => `L${Math.round((i / (points.length - 1)) * 1440)} ${y}`).join(" ") +
  " L1440 40 L0 40 Z";

export function TornEdge() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1440 40"
      preserveAspectRatio="none"
      className="absolute inset-x-0 -bottom-px h-6 w-full fill-canvas sm:h-10"
    >
      <path d={path} />
    </svg>
  );
}
