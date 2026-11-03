import type { CSSProperties } from "react";

/**
 * Topographic contour lines: the mountain of the brand's journey, drawn as a
 * map instead of a photograph. The shapes are computed once from fixed
 * numbers, so the server and the browser draw the same lines.
 */

const RINGS = 9;
const POINTS = 72;
const CENTER: [number, number] = [300, 300];

function ring(level: number): string {
  const base = 34 + level * 30;
  const coords: string[] = [];
  for (let i = 0; i <= POINTS; i++) {
    const angle = (i / POINTS) * Math.PI * 2;
    const wobble =
      1 +
      0.13 * Math.sin(3 * angle + level * 0.55) +
      0.07 * Math.sin(5 * angle - level * 0.8) +
      0.04 * Math.cos(7 * angle + level);
    const radius = base * wobble;
    const x = CENTER[0] + radius * Math.cos(angle) * 1.15;
    const y = CENTER[1] + radius * Math.sin(angle) * 0.85 + level * 4;
    coords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${coords.join(" L")}Z`;
}

const rings = Array.from({ length: RINGS }, (_, level) => ring(level));

export function Contours({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`contours ${className}`}
      viewBox="0 0 600 600"
      aria-hidden="true"
      focusable="false"
    >
      {rings.map((d, level) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: the rings are a fixed sequence
          key={level}
          d={d}
          pathLength={1}
          data-index-line={level % 4 === 0 || undefined}
          style={{ "--ring": level } as CSSProperties}
        />
      ))}
    </svg>
  );
}
