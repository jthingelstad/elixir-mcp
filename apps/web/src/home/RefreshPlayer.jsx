import { useEffect, useState } from "react";
import { useOwnRefresh, usePlayerRefresh } from "../lib/own-refresh.js";

/**
 * Check for new battles (2026-11-14): one button on every player page that
 * asks for a fresh read of that player's battle log. On your own player it
 * is the freshness chip's action (your own verified players, under your
 * own limits); on anyone else's, one read of theirs, never the start of
 * recording them (services/web-api/src/own-refresh.mjs, refreshPlayer).
 * When the read lands the page's battles are read again, no reload. A
 * limit says when to try again, quietly, on the button itself.
 */

/** "Updated just now" shows this long after a read landed. */
export const UPDATED_SHOWN_S = 120;

/** The button's words for a refresher's state at `now` (ms). */
export function refreshLabel(state, now) {
  if (state.checking) return "Checking…";
  const since = state.at == null ? Infinity : (now - state.at) / 1000;
  if (state.outcome === "updated" && since < UPDATED_SHOWN_S)
    return "Updated just now";
  if (state.outcome === "limited" && since < (state.retryAfterS ?? 0)) {
    const min = Math.max(
      1,
      Math.ceil(((state.retryAfterS ?? 0) - Math.max(0, since)) / 60),
    );
    return `Try again in ${min} min`;
  }
  return "Check for new battles";
}

function OwnButton() {
  return <RefreshButton state={useOwnRefresh()} />;
}

function OtherButton({ tag }) {
  return <RefreshButton state={usePlayerRefresh(tag)} />;
}

function RefreshButton({ state }) {
  // The label moves on without a tap ("Try again in 2 min", then 1, then
  // the button again): the clock is read in an effect, never in render.
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
  return (
    <div className="kit-player__refresh" aria-live="polite">
      <button
        type="button"
        className="btn"
        onClick={state.ask}
        disabled={state.checking}
        aria-busy={state.checking || undefined}
      >
        {label}
      </button>
    </div>
  );
}

/** The player page's button: yours or theirs. */
export function RefreshPlayer({ tag, own }) {
  return own ? <OwnButton /> : <OtherButton tag={tag} />;
}
