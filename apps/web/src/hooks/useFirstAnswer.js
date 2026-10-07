import { useEffect, useState } from "react";
import { api } from "../api.js";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";

export function useFirstAnswer(
  claimsKey,
  { playerTag, watchConnection = false } = {},
) {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [loadedKey, setLoadedKey] = useState(null);
  const key = `${claimsKey ?? ""}:${playerTag ?? ""}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
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
        if (
          r.data.player &&
          ((r.data.player.recording_status === "active" &&
            (!r.data.player.profile_available ||
              !hasBattleEvidence(r.data.player))) ||
            (watchConnection && !r.data.connection.last_data_read_at))
        ) {
          timer = setTimeout(() => {
            if (document.visibilityState === "visible")
              setAttempt((n) => n + 1);
          }, 60_000);
        }
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
  }, [key, playerTag, watchConnection, attempt]);

  return {
    data: loadedKey === key ? data : null,
    loading,
    error,
    refresh: () => setAttempt((n) => n + 1),
  };
}
