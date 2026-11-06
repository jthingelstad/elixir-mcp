import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { isPlainClick, Link } from "./Link.tsx";
import { useScrollHint } from "./scrollHint.ts";

export interface TabItem {
  key: string;
  label: ReactNode;
  /** A count badge after the label: "Timeline 3". Nothing at null or 0. */
  count?: number | null;
  /** What the count counts, read aloud after it: "2 waiting for you". */
  countLabel?: string;
  /** A plain mark after the label, for "something new here" when no honest
   *  count exists. Read aloud as `markLabel`. */
  mark?: boolean;
  markLabel?: string;
  /** A tab that is an address renders as a link; otherwise a button. */
  href?: string;
  /** The tab's name when its label alone would not say all of it. */
  ariaLabel?: string;
  id?: string;
  /** The id of the tabpanel this tab opens. */
  controls?: string;
}

/**
 * A row of tabs: `role="tablist"`, one tab in the Tab order, arrow keys,
 * Home and End move between them, Enter or Space opens the one focused.
 * Opening stays a separate key press, because a tab here is often an
 * address. On a phone the row scrolls itself, never the page, and keeps
 * the open tab in view.
 */
export function Tabs({
  label,
  items,
  value,
  onSelect,
  wrap = false,
  className,
}: {
  label: string;
  items: TabItem[];
  value: string;
  onSelect?: (key: string) => void;
  /** Too many tabs to hide any: wrap onto a second line instead of scrolling. */
  wrap?: boolean;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  useScrollHint(list);

  useEffect(() => {
    const row = list.current;
    if (!row || row.scrollWidth <= row.clientWidth) return;
    const open = row.querySelector<HTMLElement>('[aria-selected="true"]');
    if (open)
      row.scrollLeft =
        open.offsetLeft - (row.clientWidth - open.offsetWidth) / 2;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [
      ...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
    ];
    const at = tabs.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    if (e.key === " " && tabs[at]?.tagName === "A") {
      e.preventDefault();
      tabs[at]?.click();
      return;
    }
    const to =
      e.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : e.key === "ArrowLeft"
          ? (at - 1 + tabs.length) % tabs.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? tabs.length - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    tabs[to]?.focus();
  };

  return (
    // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- its tabs hold the focus
    <div
      ref={list}
      className={["kit-tabs", wrap ? "kit-tabs--wrap" : "", className]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {items.map((t) => {
        const open = t.key === value;
        const props = {
          id: t.id,
          role: "tab",
          className: "kit-tabs__tab",
          "aria-selected": open,
          "aria-controls": t.controls,
          "aria-label": t.ariaLabel,
          tabIndex: open ? 0 : -1,
        };
        const body = (
          <>
            {t.label}
            {t.count && t.countLabel ? " " : null}
            {t.count ? (
              <em className="kit-tabs__count">
                {t.count}
                {t.countLabel ? (
                  <span className="sr-only"> {t.countLabel}</span>
                ) : null}
              </em>
            ) : null}
            {t.mark ? (
              <em className="kit-tabs__mark">
                <span className="sr-only">{t.markLabel ?? "New"}</span>
              </em>
            ) : null}
          </>
        );
        return t.href ? (
          <Link
            key={t.key}
            to={t.href}
            {...props}
            onClick={(e) => {
              if (isPlainClick(e)) onSelect?.(t.key);
            }}
          >
            {body}
          </Link>
        ) : (
          <button
            key={t.key}
            type="button"
            {...props}
            onClick={() => onSelect?.(t.key)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
