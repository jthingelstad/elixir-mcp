import { useState } from "react";
import { agoSeconds, freshCls, secsSince } from "./time.ts";
import { useClock } from "./Zone.tsx";

/** How current a number is, the way Elixir says it: "4m ago" in a
 *  freshness pill whose colour is the age. `seconds` is a tool's own
 *  meta.freshness_seconds when it has one; `ts` is the instant
 *  otherwise. `label` puts "as of" (or anything) in front. The clock is
 *  read once per mount, deliberately: a render-time read makes every
 *  re-render a new answer. */
export function Fresh({
  ts,
  seconds,
  label,
}: {
  ts?: string | number | Date | null;
  seconds?: number | null;
  label?: string;
}) {
  const [now] = useState(() => Date.now());
  const { stamp } = useClock();
  const age = seconds ?? secsSince(ts, now);
  if (age == null)
    return (
      <span className="freshness freshness--never">
        {seconds === undefined && ts === undefined ? "never" : "never polled"}
      </span>
    );
  return (
    <span
      className={freshCls(age)}
      title={ts ? stamp(ts, { year: true, seconds: true }) : undefined}
    >
      {label ? `${label} ` : ""}
      {agoSeconds(age)}
    </span>
  );
}
