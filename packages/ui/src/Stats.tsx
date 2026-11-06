import type { ReactNode } from "react";

/** A row of `Stat`s; give it a `label` when the row needs a name. */
export function Stats({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className ? `kit-stats ${className}` : "kit-stats"}
      {...(label ? { role: "group", "aria-label": label } : null)}
    >
      {children}
    </div>
  );
}

/**
 * One number with its label and an optional note under it: a count the
 * record returned, never a derived score. `of` is the whole it is out of.
 * `tone` colours a count that is itself a state (ok, warn, bad).
 */
export function Stat({
  label,
  value,
  of,
  note,
  tone,
  small = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  of?: ReactNode;
  note?: ReactNode;
  tone?: "ok" | "warn" | "bad";
  /** A value that is words or a record rather than one number. */
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={className ? `kit-stat ${className}` : "kit-stat"}>
      <span className="kit-stat__label">{label}</span>
      <span
        className={[
          "kit-stat__value",
          small ? "kit-stat__value--sm" : "",
          tone ? `kit-stat__value--${tone}` : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {value}
        {of ? <span className="kit-stat__of"> {of}</span> : null}
      </span>
      {note != null ? <span className="kit-stat__note">{note}</span> : null}
    </div>
  );
}
