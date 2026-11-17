/**
 * A page's shape while its read is on the way (2026-11-16): grey blocks
 * where the head, the tabs and the first rows will be, so the page does not
 * jump when it lands and a slow read still looks like the page it is.
 * `profile` is a player's or an account's page (avatar, name, counts,
 * tabs, rows); `rows` is a list. One status for assistive tech, said once.
 */
export function Skeleton({
  shape = "rows",
  rows = 3,
  label = "Loading",
}: {
  shape?: "profile" | "rows";
  rows?: number;
  label?: string;
}) {
  return (
    <div
      className={`kit-skel kit-skel--${shape}`}
      role="status"
      aria-busy="true"
    >
      <span className="kit-skel__said">{label}</span>
      {shape === "profile" ? (
        <div className="kit-skel__head" aria-hidden="true">
          <span className="kit-skel__av" />
          <span className="kit-skel__lines">
            <span className="kit-skel__bar kit-skel__bar--title" />
            <span className="kit-skel__bar kit-skel__bar--mid" />
            <span className="kit-skel__bar kit-skel__bar--short" />
          </span>
        </div>
      ) : null}
      {shape === "profile" ? (
        <span
          className="kit-skel__bar kit-skel__bar--tabs"
          aria-hidden="true"
        />
      ) : null}
      <div className="kit-skel__rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="kit-skel__row" />
        ))}
      </div>
    </div>
  );
}
