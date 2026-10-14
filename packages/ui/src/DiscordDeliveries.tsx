import { useState } from "react";
import { Fresh } from "./Fresh.tsx";
import { Markdown } from "./Markdown.tsx";
import { Disclosure } from "./DetailSheet.tsx";

/** One delivery as the relay or Clan recorded it (contracts
 *  `DiscordDelivery`). */
export interface DiscordDeliveryRow {
  at: string;
  outcome:
    "posted" | "edited" | "refused" | "unknown" | "not_delivered" | "skipped";
  ref?: string | null;
  http_status?: number;
  reason?: string | null;
  excerpt?: string | null;
  /** The clan's own model wrote the line (a clan's activity channel). */
  rewritten?: boolean;
  /** The quality ledger's row (0222): what a rating names. */
  ledger_id?: string;
}

export type DiscordRating = "up" | "down";

/** The viewer's own ratings, by ledger_id. */
export type DiscordRatings = Record<string, { rating: DiscordRating }>;

/** Sends one rating; `{ ok }`, or the refusal's words. */
export type RateDiscordPost = (body: {
  ledger_id: string;
  rating: DiscordRating;
  note?: string;
}) => Promise<{ ok: boolean; data?: { message?: string } | null }>;

/** contracts DISCORD_RATING_NOTE_MAX */
const NOTE_MAX = 1000;
const THUMB: Record<DiscordRating, string> = {
  up: "\u{1F44D}",
  down: "\u{1F44E}",
};

const SAID: Record<DiscordDeliveryRow["outcome"], string> = {
  posted: "Posted",
  edited: "Edited",
  refused: "Refused",
  unknown: "No answer",
  not_delivered: "Not delivered",
  // A clan's activity channel chose not to post it (2026-10-11): never
  // sent, and never counted as not delivered.
  skipped: "Skipped",
};
const MISSED = new Set(["refused", "unknown", "not_delivered"]);
// Only a line that reached the channel is rated (the door holds the same).
const RATEABLE = new Set(["posted", "edited"]);

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
  ratings = null,
  onRate = null,
}: {
  entries: DiscordDeliveryRow[] | null | undefined;
  notDelivered?: number;
  show?: number;
  /** Show each line whole rather than its first words (the clan's
   *  activity channel, where leaders read what was posted). */
  whole?: boolean;
  /** The viewer's ratings so far (2026-10-11). */
  ratings?: DiscordRatings | null;
  /** Rate a post: thumbs up or down and a note, sent to Elixir as
   *  feedback. Without it no row offers a rating. */
  onRate?: RateDiscordPost | null;
}) {
  const rows = (entries ?? []).slice(0, show);
  if (!rows.length && !notDelivered) return null;
  return (
    <Disclosure
      title={`Delivery history${notDelivered ? ` · ${notDelivered} not delivered` : ""}`}
    >
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
            className={`delivery-row flex flex-wrap gap-x-2 ${MISSED.has(r.outcome) ? "text-warn" : ""}`}
          >
            <span className="font-semibold">
              {SAID[r.outcome] ?? r.outcome}
            </span>
            {/* An Action's number; a timeline item's id says nothing. */}
            {r.ref?.startsWith("#") ? (
              <span className="mono">{r.ref}</span>
            ) : null}
            <Fresh ts={r.at} />
            {r.rewritten ? (
              <span className="hint">by the clan&rsquo;s model</span>
            ) : null}
            {r.excerpt ? (
              <Markdown
                className={`delivery-preview ${whole ? "" : "line-clamp-3"}`}
                text={r.excerpt}
              />
            ) : null}
            {r.outcome === "skipped" && r.reason ? (
              <span className="w-full text-ink-faint">{r.reason}</span>
            ) : null}
            {r.outcome === "refused" && (r.reason || r.http_status) ? (
              <span className="w-full text-ink-faint">
                Discord: {r.http_status ? `HTTP ${r.http_status}` : ""}
                {r.http_status && r.reason ? ", " : ""}
                {r.reason ?? ""}
              </span>
            ) : null}
            {onRate && r.ledger_id && RATEABLE.has(r.outcome) ? (
              <RateRow
                ledgerId={r.ledger_id}
                rated={ratings?.[r.ledger_id]?.rating ?? null}
                onRate={onRate}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/**
 * A thumbs up or down on one post, and a note if there is more to say
 * (2026-10-11): it reaches Elixir as feedback about that post, which is
 * how Elixir judges posts in channels it cannot see. Rating again
 * follows the first.
 */
function RateRow({
  ledgerId,
  rated,
  onRate,
}: {
  ledgerId: string;
  rated: DiscordRating | null;
  onRate: RateDiscordPost;
}) {
  const [choice, setChoice] = useState<DiscordRating | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<DiscordRating | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const current = sent ?? rated;
  const send = async () => {
    if (!choice) return;
    setBusy(true);
    setFailed(null);
    const words = note.trim();
    try {
      const r = await onRate({
        ledger_id: ledgerId,
        rating: choice,
        ...(words ? { note: words } : {}),
      });
      if (r.ok) {
        setSent(choice);
        setChoice(null);
        setNote("");
      } else setFailed(r.data?.message ?? "That rating was not sent.");
    } catch {
      setFailed("That rating was not sent.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex w-full flex-wrap items-center gap-1">
      {(["up", "down"] as const).map((v) => (
        <button
          key={v}
          type="button"
          className={`btn btn--quiet btn--sm ${choice === v || (!choice && current === v) ? "btn--selected" : ""}`}
          aria-pressed={choice === v || (!choice && current === v)}
          aria-label={v === "up" ? "A good post" : "A poor post"}
          onClick={() => setChoice(choice === v ? null : v)}
        >
          {THUMB[v]}
        </button>
      ))}
      {current && !choice ? (
        <span className="hint">
          {sent ? "Thanks: Elixir reads every rating." : "Your rating"}
        </span>
      ) : null}
      {choice ? (
        <>
          <input
            className="input min-w-0 flex-[1_1_12rem]"
            aria-label="A note (optional)"
            placeholder="What was good or wrong about it? (optional)"
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy}
            onClick={() => void send()}
          >
            Send
          </button>
        </>
      ) : null}
      {failed ? <span className="w-full text-warn">{failed}</span> : null}
    </span>
  );
}
