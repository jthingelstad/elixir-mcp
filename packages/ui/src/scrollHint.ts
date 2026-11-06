import { useEffect, type RefObject } from "react";

/**
 * Marks a row that scrolls sideways with what is out of view, so its edge can
 * fade and say so (`data-more-left`, `data-more-right`). A row that fits gets
 * neither, and so no fade.
 */
export function useScrollHint(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const row = ref.current;
    if (!row) return undefined;
    const mark = () => {
      const right = row.scrollWidth - row.clientWidth - row.scrollLeft;
      row.toggleAttribute("data-more-left", row.scrollLeft > 1);
      row.toggleAttribute("data-more-right", right > 1);
    };
    mark();
    row.addEventListener("scroll", mark, { passive: true });
    const seen =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    seen?.observe(row);
    return () => {
      row.removeEventListener("scroll", mark);
      seen?.disconnect();
    };
  }, [ref]);
}
