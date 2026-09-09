import { useState } from "react";
import { ago, freshCls, secsSince } from "../lib/time.js";

export function Fresh({ ts }) {
  // Render-time clock read is deliberate but the linter is right that
  // it must be stable per mount: capture once.
  const [now] = useState(() => Date.now());
  if (!ts) return <span className="freshness freshness--never">never</span>;
  return <span className={freshCls(secsSince(ts, now))}>{ago(ts, now)}</span>;
}
