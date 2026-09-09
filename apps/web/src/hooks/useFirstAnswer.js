import { useEffect, useState } from "react";
import { api } from "../api.js";

export function useFirstAnswer(claimsKey) {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let timer;
    setLoading(true);
    setError(false);
    setData(null);
    api
      .firstAnswer()
      .then((r) => {
        if (!r.ok || !r.data.connection || !("player" in r.data))
          throw new Error("unavailable");
        if (!active) return;
        setData(r.data);
        if (
          r.data.player &&
          (!(
            r.data.player.profile_available ||
            r.data.player.last_battle_at ||
            r.data.player.battles_30d > 0
          ) ||
            !r.data.connection.last_data_read_at)
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
  }, [claimsKey, attempt]);

  return { data, loading, error, refresh: () => setAttempt((n) => n + 1) };
}
