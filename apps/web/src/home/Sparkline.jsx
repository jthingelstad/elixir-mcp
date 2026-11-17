import { sparkWords } from "./logic.js";

/**
 * A sitting's sparkline (slice 7, #765; Jamie, 2026-11-11: "some sparkline
 * that indicates win and loss as well as magnitude"; drawn as the canvas's
 * .spark since 2026-11-13): one bar per battle in the order they were
 * played, up and green for a win, down and red for a loss, its height the
 * crown margin, one to three. A draw is a flat tick on the line, and a
 * battle whose crowns the record lacks is a short, faint bar: its direction
 * is known, its margin is not. The whole is one image whose name says the
 * same facts in words. `slim` is the session card's strip (2026-11-16):
 * half the height, beside the figures.
 */
export function Sparkline({ spark, slim = false }) {
  if (!Array.isArray(spark) || spark.length === 0) return null;
  // A long sitting closes the gaps so its bars keep their width.
  const density =
    spark.length > 60
      ? " kit-spark--packed"
      : spark.length > 30
        ? " kit-spark--dense"
        : "";
  return (
    <div
      className={`kit-spark${density}${slim ? " kit-spark--slim" : ""}`}
      role="img"
      aria-label={sparkWords(spark)}
    >
      {spark.map((b, i) => {
        const kind = b.r === "d" ? "draw" : b.r === "w" ? "win" : "loss";
        const unknown = b.r !== "d" && b.m == null;
        // The margin, one to three, is the bar's height (a class, so the
        // page carries no inline style).
        const m = b.r === "d" ? "" : ` kit-spark__m${Math.min(3, b.m ?? 1)}`;
        return (
          <i
            key={i}
            className={`kit-spark__${kind}${m}${unknown ? " kit-spark__unknown" : ""}`}
          >
            <b />
          </i>
        );
      })}
    </div>
  );
}
