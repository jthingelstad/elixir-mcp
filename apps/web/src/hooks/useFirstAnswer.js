import { useEffect, useState } from "react";
import { api } from "../api.js";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { recordJourney } from "../lib/record-journey.js";

/** The first minutes after an add, when the first capture (or the game's
 * "not found") usually lands: poll every few seconds, then once a minute.
 * A first-answer read is one account query, no tool and no quota. */
const FAST_WINDOW_MS = 3 * 60_000;
export const FAST_POLL_MS = 5_000;
export const SLOW_POLL_MS = 60_000;

/** How long until the next check, or null for none: while recording is
 * active and the profile or battles are missing (or a connection is
 * watched), fast while the tag is new and its answer is still open. */
export function nextPoll(
  data,
  { watchConnection = false, now = Date.now() } = {},
) {
  const p = data?.player;
  if (!p) return null;
  const waiting =
    (p.recording_status === "active" &&
      (!p.profile_available || !hasBattleEvidence(p))) ||
    (watchConnection && !data.connection?.last_data_read_at);
  if (!waiting) return null;
  const age = now - Date.parse(p.tracked_since ?? "");
  // A "not found" is the answer for a day (the game is asked again then).
  return age >= 0 && age < FAST_WINDOW_MS && !recordJourney(data).notFound
    ? FAST_POLL_MS
    : SLOW_POLL_MS;
}

export function useFirstAnswer(
  claimsKey,
  { playerTag, watchConnection = false, enabled = true } = {},
) {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const key = `${claimsKey ?? ""}:${playerTag ?? ""}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    // A page that reads the status itself passes it down instead.
    if (!enabled) return undefined;
    let active = true;
    let timer;
    setLoading(true);
    setError(false);
    api
      .firstAnswer(playerTag)
      .then((r) => {
        if (!r.ok || !r.data.connection || !("player" in r.data))
          throw new Error("unavailable");
        if (!active) return;
        setData(r.data);
        setLoadedKey(key);
        const wait = nextPoll(r.data, { watchConnection });
        if (wait != null)
          timer = setTimeout(() => {
            if (document.visibilityState === "visible")
              setAttempt((n) => n + 1);
          }, wait);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const onFocus = () => setAttempt((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [key, playerTag, watchConnection, attempt, enabled]);

  return {
    data: loadedKey === key ? data : null,
    loading,
    error,
    refresh: () => setAttempt((n) => n + 1),
  };
}
