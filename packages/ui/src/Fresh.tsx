import { useInitialTime } from "./InitialTime.tsx";
import { useEffect, useState, type ReactNode } from "react";
import { agoPlain, agoSeconds, freshCls, secsSince } from "./time.ts";
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
  const [now] = useInitialTime();
  const { when } = useClock();
  const age = seconds ?? secsSince(ts, now);
  if (age == null)
    return (
      <span className="freshness freshness--never">
        {seconds === undefined && ts === undefined ? "never" : "never read"}
      </span>
    );
  return (
    <span className={freshCls(age)} title={ts ? when(ts) : undefined}>
      {label ? `${label} ` : ""}
      {agoSeconds(age)}
    </span>
  );
}

/** How often the chip's "N min ago" moves on while the page is open. */
export const FRESH_TICK_MS = 30_000;

/** The clock, moved on every `everyMs` while mounted, and at once when the
 *  instant it is measured against changes. The first render reads the
 *  shared initial time, so the server and the first client render agree. */
function useTicking(everyMs: number, against: number | null) {
  const [initial] = useInitialTime();
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  const [seen, setSeen] = useState(against);
  if (seen !== against) {
    setSeen(against);
    setNow(Date.now());
  }
  return now;
}

/**
 * The folded freshness chip: "Battle log read 15 min ago", and under it the
 * plain explanation of what that means for the numbers on the page. A
 * native `details`, so it opens with a key and needs no script. The dot is
 * the age, as in `Fresh`; never read is said, not left blank. The age
 * ticks while the page is open (FRESH_TICK_MS). `checking` says the page
 * is asking for a new read now; `onOpen` runs when the chip is opened.
 */
export function FreshChip({
  ts,
  seconds,
  label = "Battle log read",
  checking = false,
  onOpen,
  children,
  className,
}: {
  ts?: string | number | Date | null;
  seconds?: number | null;
  label?: string;
  checking?: boolean;
  onOpen?: () => void;
  children: ReactNode;
  className?: string;
}) {
  // Measured against the instant itself, never a Date's identity.
  const now = useTicking(
    FRESH_TICK_MS,
    ts == null ? (seconds ?? null) : new Date(ts).getTime(),
  );
  const { when } = useClock();
  const age = seconds ?? secsSince(ts, now);
  const state =
    age == null ? "never" : age < 900 ? "live" : age < 86400 ? "stale" : "old";
  return (
    <details
      className={["kit-fresh", `kit-fresh--${state}`, className]
        .filter(Boolean)
        .join(" ")}
      onToggle={
        onOpen
          ? (e) => {
              if ((e.currentTarget as HTMLDetailsElement).open) onOpen();
            }
          : undefined
      }
    >
      <summary title={ts ? when(ts) : undefined} aria-live="polite">
        {checking
          ? "Checking for new battles…"
          : age == null
            ? `${label}: never`
            : `${label} ${agoPlain(age)}`}
      </summary>
      <div className="kit-fresh__pop">
        {children}
        <span className="kit-fresh__key">
          A green dot means read in the last 15 minutes, amber in the last day,
          and grey anything older.
        </span>
      </div>
    </details>
  );
}
