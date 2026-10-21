import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A flag that turns itself off again: the "Copied" a copy button shows
 * for a moment. `flash()` sets it and starts the clock; a second flash
 * restarts it. The timer is cleared when the component unmounts, so a
 * flash never sets state on a view that has gone, or after a test's
 * DOM has been torn down (the Clan copy-link flake on main, CI run
 * 39538492981, 2026-10-20: "window is not defined" from a 1.5 s timer
 * that outlived jsdom).
 */
export function useFlash(ms = 1500): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = useCallback(() => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, flash];
}
