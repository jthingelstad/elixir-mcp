import { sparkWords } from "./logic.js";

const BAR = 5;
const GAP = 2;
const UNIT = 5;
const MID = 3 * UNIT + 1;
const HEIGHT = 2 * MID;
/** Past this many battles the mark narrows rather than running wide. */
const WIDEST = 280;

/**
 * A sitting's sparkline (slice 7, #765; Jamie, 2026-11-11: "some sparkline
 * that indicates win and loss as well as magnitude"): one bar per battle in
 * the order they were played, up for a win and down for a loss, its height
 * the crown margin, one to three. A draw is a flat tick on the line, and a
 * battle whose crowns the record lacks is a short, faint bar: its direction
 * is known, its margin is not. Flat marks, no frame; the words beside it are
 * the same facts for a screen reader.
 */
export function Sparkline({ spark }) {
  if (!Array.isArray(spark) || spark.length === 0) return null;
  const width = spark.length * (BAR + GAP) - GAP;
  return (
    <svg
      className="kit-spark"
      role="img"
      aria-label={sparkWords(spark)}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={Math.min(width, WIDEST)}
      height={HEIGHT}
      preserveAspectRatio="none"
    >
      <line className="kit-spark__base" x1="0" x2={width} y1={MID} y2={MID} />
      {spark.map((b, i) => {
        const x = i * (BAR + GAP);
        if (b.r === "d")
          return (
            <rect
              key={i}
              className="kit-spark__draw"
              x={x}
              y={MID - 1}
              width={BAR}
              height={2}
            />
          );
        const h = (b.m ?? 1) * UNIT;
        return (
          <rect
            key={i}
            className={`kit-spark__${b.r === "w" ? "win" : "loss"}${b.m == null ? " kit-spark__unknown" : ""}`}
            x={x}
            y={b.r === "w" ? MID - h : MID}
            width={BAR}
            height={h}
            rx="1"
          />
        );
      })}
    </svg>
  );
}
