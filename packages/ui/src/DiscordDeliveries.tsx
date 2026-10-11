import { Fresh } from "./Fresh.tsx";

/** One delivery as the relay or Clan recorded it (contracts
 *  `DiscordDelivery`). */
export interface DiscordDeliveryRow {
  at: string;
  outcome: "posted" | "edited" | "refused" | "unknown" | "not_delivered";
  ref?: string | null;
  http_status?: number;
  reason?: string | null;
  excerpt?: string | null;
  /** The clan's own model wrote the line (a clan's activity channel). */
  rewritten?: boolean;
}

const SAID: Record<DiscordDeliveryRow["outcome"], string> = {
  posted: "Posted",
  edited: "Edited",
  refused: "Refused",
  unknown: "No answer",
  not_delivered: "Not delivered",
};
const MISSED = new Set(["refused", "unknown", "not_delivered"]);

/**
 * The last deliveries to a Discord channel (2026-10-11), the same on the
 * timeline's cross-post, Clan's Actions and the clan's activity channel:
 * what happened to each, when, and in Discord's own words when it
 * refused one, with the count of what did not arrive in the last 30
 * days. "No answer" is a call Discord never answered: it may be in the
 * channel, and it is never sent again (a duplicate is worse).
 */
export function DiscordDeliveries({
  entries,
  notDelivered = 0,
  // Every entry the history keeps (contracts DISCORD_HISTORY_MAX): the
  // pages promise the last 20.
  show = 20,
  whole = false,
}: {
  entries: DiscordDeliveryRow[] | null | undefined;
  notDelivered?: number;
  show?: number;
  /** Show each line whole rather than its first words (the clan's
   *  activity channel, where leaders read what was posted). */
  whole?: boolean;
}) {
  const rows = (entries ?? []).slice(0, show);
  if (!rows.length && !notDelivered) return null;
  return (
    <div className="grid gap-1">
      <p className="m-0 font-semibold">
        Last deliveries
        {notDelivered ? (
          <span className="hint">
            {" "}
            · {notDelivered} not delivered in 30 days
          </span>
        ) : null}
      </p>
      <ul className="m-0 grid list-none gap-1 p-0" aria-label="Last deliveries">
        {rows.map((r, i) => (
          <li
            key={`${r.at}-${i}`}
            className={`flex flex-wrap gap-x-2 ${MISSED.has(r.outcome) ? "text-warn" : ""}`}
          >
            <span className="font-semibold">
              {SAID[r.outcome] ?? r.outcome}
            </span>
            {/* An Action's number; a timeline item's id says nothing. */}
            {r.ref?.startsWith("#") ? (
              <span className="mono">{r.ref}</span>
            ) : null}
            <Fresh ts={r.at} />
            {r.rewritten ? <span className="hint">rewritten</span> : null}
            {r.excerpt ? (
              <span
                className={`min-w-0 flex-[1_1_12rem] text-ink-faint ${whole ? "w-full break-words" : "truncate"}`}
              >
                {r.excerpt}
              </span>
            ) : null}
            {r.outcome === "refused" && (r.reason || r.http_status) ? (
              <span className="w-full text-ink-faint">
                Discord: {r.http_status ? `HTTP ${r.http_status}` : ""}
                {r.http_status && r.reason ? ", " : ""}
                {r.reason ?? ""}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
