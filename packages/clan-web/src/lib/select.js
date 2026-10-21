import { useCallback, useRef, useState } from "react";
import { api } from "../api.js";
import { landingPath } from "./landing.js";

/**
 * Selecting a clan: remember it on the server, then, unless the address
 * already names where to go (`keepPath`), go straight to the clan's
 * landing. The answer carries what waits for the person there, so the
 * roster never shows first and no redirect follows.
 *
 * One selection at a time. `selecting` holds until the address is the
 * new clan's: the Clan picker picks from another clan's page, which the
 * shell's gate would otherwise select back. A choice made while one is
 * pending is ignored, whoever makes it (the picker, the chooser, the
 * gate): two selections answered out of order would each set the
 * session and navigate, and the earlier could land last (Codex on #610,
 * 2026-10-20).
 */
export function useSelectClan({ navigate, setMe }) {
  const [selecting, setSelecting] = useState(false);
  const pending = useRef(false);
  const select = useCallback(
    async (tag, { keepPath = false } = {}) => {
      if (pending.current) return;
      pending.current = true;
      setSelecting(true);
      try {
        const r = await api.select(tag);
        if (r.ok) {
          setMe(r.data);
          if (!keepPath) await navigate(landingPath(r.data, tag));
        } else if (r.status === 401) {
          setMe({ signed_in: false, expired: true });
        }
      } finally {
        pending.current = false;
        setSelecting(false);
      }
    },
    [navigate, setMe],
  );
  return { select, selecting };
}
