import { useEffect, useState } from "react";
import { noun, useClock } from "@elixir-mcp/ui";
import { usePlayerRefresh } from "../lib/own-refresh.js";

/**
 * Check for new battles (2026-11-14): one button on every player page that
 * asks for a fresh read of that player's battle log. On your own player it
 * is your own refresh (your own verified players, under your own limits);
 * on anyone else's, one read of theirs, never the start of recording them
 * (services/web-api/src/own-refresh.mjs, refreshPlayer). When the read
 * lands the page's battles are read again, no reload. A limit says when to
 * try again, quietly, on the button itself.
 *
 * Since 2026-11-23 the tap also reads the page player's profile, and the
 * lines under the button say what the check found: how many battles are
 * new to Elixir, when the last one was, and what moved on the profile. A
 * slow read says so and keeps reading for a few minutes; a refusal with no
 * wait to name says so too.
 */

/** The result shows this long after a check finished. */
export const RESULT_SHOWN_S = 120;

const sinceS = (state, now) =>
  state.at == null ? Infinity : (now - state.at) / 1000;
const showing = (state, now) => sinceS(state, now) < RESULT_SHOWN_S;

/** The button's words for a refresher's state at `now` (ms). */
export function refreshLabel(state, now) {
  if (state.checking || state.outcome === "slow") return "Checking…";
  const since = sinceS(state, now);
  if (state.outcome === "limited" && since < (state.retryAfterS ?? 0)) {
    const min = Math.max(
      1,
      Math.ceil(((state.retryAfterS ?? 0) - Math.max(0, since)) / 60),
    );
    return `Try again in ${min} min`;
  }
  if (
    (state.outcome === "updated" || state.outcome === "unavailable") &&
    since < RESULT_SHOWN_S
  )
    return "Check again";
  return "Check for new battles";
}

const count = (n) => new Intl.NumberFormat("en-US").format(n);

/** One profile change in game words, or null for one it cannot say. */
function changeWords(c) {
  switch (c.field) {
    case "trophies":
      return `Trophies ${count(c.from)} → ${count(c.to)}`;
    case "best_trophies":
      return `New best ${count(c.to)}`;
    case "arena":
      return `${c.from} → ${c.to}`;
    case "league":
      return `League ${c.from} → ${c.to}`;
    case "clan":
      if (c.from && c.to) return `Left ${c.from.name}, joined ${c.to.name}`;
      if (c.to) return `Joined ${c.to.name}`;
      if (c.from) return `Left ${c.from.name}`;
      return null;
    case "name":
      return `Now named ${c.to}`;
    default:
      return null;
  }
}

/**
 * The lines under the button for a refresher's state at `now` (ms):
 * `when` words an instant (useClock's), `own` says "you" rather than
 * "them". Pure: the clock comes in.
 */
export function refreshLines(state, now, { when, own = false }) {
  const them = own ? "you" : "them";
  if (state.checking)
    return [
      `Asking Clash Royale for ${own ? "your" : "their"} latest battles and profile. This takes a few seconds.`,
    ];
  if (state.outcome === "slow")
    return ["Still checking. New battles show up here shortly."];
  if (!showing(state, now)) return [];
  if (state.outcome === "unavailable")
    return ["Couldn't check right now. Try again in a bit."];
  if (state.outcome !== "updated") return [];
  const r = state.result;
  if (!r || typeof r.new_battles !== "number") return ["Up to date."];
  const last = r.newest_battle_at
    ? ` Last battle ${when(r.newest_battle_at)}.`
    : "";
  const lines = [];
  const n = r.new_battles;
  if (!r.newest_battle_at) lines.push(`Elixir has no battles for ${them} yet.`);
  else if (n > 0 && r.latest_is_new)
    lines.push(`${n} new ${noun(n, "battle")}.${last}`);
  else if (n > 0) lines.push(`Found ${n} older ${noun(n, "battle")}.${last}`);
  else lines.push(`No new battles.${last}`);
  const moved = (r.profile_changes ?? []).map(changeWords).filter(Boolean);
  if (moved.length) lines.push(moved.join(" · "));
  return lines;
}

function RefreshButton({ state, own }) {
  const { when } = useClock();
  // The words move on without a tap ("Try again in 2 min", then 1, then
  // the button again; a result fades after two minutes): the clock is read
  // in an effect, never in render.
  const [now, setNow] = useState(state.at ?? 0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = state.outcome ? setInterval(tick, 15_000) : undefined;
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [state.outcome, state.at]);
  const label = refreshLabel(state, now);
  const lines = refreshLines(state, now, { when, own });
  const busy = state.checking || state.outcome === "slow";
  return (
    <div className="kit-player__refresh" aria-live="polite">
      <button
        type="button"
        className="btn btn--sm"
        onClick={state.ask}
        disabled={busy}
        aria-busy={busy || undefined}
      >
        {label}
      </button>
      {lines.map((line) => (
        <p key={line} className="kit-player__refresh-note">
          {line}
        </p>
      ))}
    </div>
  );
}

/** The player page's button: yours or theirs. */
export function RefreshPlayer({ tag, own }) {
  const state = usePlayerRefresh(tag, { own: own === true });
  return <RefreshButton state={state} own={own === true} />;
}
