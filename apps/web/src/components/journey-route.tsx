/**
 * The four steps drawn as one climbing route: diagnose, profile, train,
 * reassess. It is the brand's mountain journey as a line instead of a photo.
 * The stops sit at the inline start of each quarter (the right, in RTL), and
 * the path is a Catmull-Rom curve through them, so the two stay aligned at
 * any width.
 */

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 200;
const STOP_INSET = 22;
/** Heights of the four stops, from the first step (lowest) to the last. */
const STOP_LEVELS = [0.78, 0.56, 0.34, 0.12];

type Point = [number, number];

const stops: Point[] = STOP_LEVELS.map((level, index) => [
  VIEW_WIDTH - (index * VIEW_WIDTH) / STOP_LEVELS.length - STOP_INSET,
  level * VIEW_HEIGHT,
]);

const through: Point[] = [[VIEW_WIDTH, 0.96 * VIEW_HEIGHT], ...stops, [0, 0.02 * VIEW_HEIGHT]];

function smoothPath(points: Point[]): string {
  const [first] = points;
  if (!first) return "";
  let d = `M${first[0]},${first[1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

const ROUTE = smoothPath(through);

export function JourneyRoute() {
  return (
    <div className="route" aria-hidden="true">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path className="route__shadow" d={ROUTE} pathLength={1} />
        <path className="route__line" d={ROUTE} pathLength={1} />
      </svg>
      {STOP_LEVELS.map((level, index) => (
        <span
          key={level}
          className="route__stop"
          style={{
            insetInlineStart: `calc(${index * 25}% + ${(STOP_INSET / VIEW_WIDTH) * 100}%)`,
            top: `${level * 100}%`,
            ["--stop" as string]: index,
          }}
        >
          {index + 1}
        </span>
      ))}
    </div>
  );
}
