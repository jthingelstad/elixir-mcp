/**
 * A count out of a whole, one bar per period (the design canvas's war-deck
 * spark, 2026-10-01): a member's war decks in each of the last races, out
 * of the decks asked. Bars only, no axes; a full bar is the whole asked,
 * and a bar is never taller than that. A period the record could not read
 * is a flat dash, never a zero. The label says it in words, so a screen
 * reader hears every number the bars draw; hovering one names its period.
 */
export type SparkPoint = {
  /** The period, as people read it ("135/3"). */
  label: string;
  /** The count, or null when the record could not read the period. */
  value: number | null;
  /** The whole the count is out of. */
  of: number;
};

const BAR = 10;
const GAP = 3;
const H = 22;

export function Spark({
  points,
  label,
}: {
  points: SparkPoint[];
  label: string;
}) {
  if (!points.length) return null;
  const width = points.length * BAR + (points.length - 1) * GAP;
  const words = points
    .map((p) =>
      p.value === null
        ? `${p.label} not read`
        : `${p.label} ${p.value} of ${p.of}`,
    )
    .join(", ");
  return (
    <svg
      className="spark"
      role="img"
      aria-label={`${label}: ${words}`}
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
    >
      {points.map((p, i) => {
        const x = i * (BAR + GAP);
        if (p.value === null || !(p.of > 0))
          return (
            <rect
              key={`${p.label}-${i}`}
              className="spark__nil"
              x={x}
              y={H - 2}
              width={BAR}
              height={2}
            />
          );
        const share = Math.min(1, Math.max(0, p.value / p.of));
        const h = Math.max(2, Math.round(H * share));
        const tone =
          share >= 0.75
            ? "spark__bar"
            : share >= 0.375
              ? "spark__bar spark__bar--mid"
              : "spark__bar spark__bar--low";
        return (
          <rect
            key={`${p.label}-${i}`}
            className={tone}
            x={x}
            y={H - h}
            width={BAR}
            height={h}
            rx={2}
          >
            <title>{`${p.label}: ${p.value} of ${p.of}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
