import { useEffect, type RefObject } from "react";

/**
 * Marks a row that scrolls sideways with what is out of view, so its edge can
 * fade and say so (`data-more-left`, `data-more-right`). A row that fits gets
 * neither, and so no fade. `focusable` is for a row of things that take no
 * focus themselves (facts, not buttons): while it scrolls it is a tab stop,
 * so a keyboard can scroll it, and while it fits it is not.
 */
export function useScrollHint(
  ref: RefObject<HTMLElement | null>,
  { focusable = false }: { focusable?: boolean | undefined } = {},
) {
  useEffect(() => {
    const row = ref.current;
    if (!row) return undefined;
    const mark = () => {
      const right = row.scrollWidth - row.clientWidth - row.scrollLeft;
      row.toggleAttribute("data-more-left", row.scrollLeft > 1);
      row.toggleAttribute("data-more-right", right > 1);
      if (!focusable) return;
      if (row.scrollWidth - row.clientWidth > 1)
        row.setAttribute("tabindex", "0");
      else row.removeAttribute("tabindex");
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
  }, [ref, focusable]);
}
