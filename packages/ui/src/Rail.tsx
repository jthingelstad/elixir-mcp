import { useState, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { isPlainClick } from "./Link.tsx";

export interface RailDot {
  tone: "unread" | "alert" | string;
  title: string;
}

export interface RailItem {
  key: string;
  label: string;
  icon: string;
  to: string;
  /** The group this item is in. Its heading is drawn once, above the
   *  first item of a run in that group, so an item may name its group
   *  even when the one before it does too: which heading an item sits
   *  under never depends on what happens to precede it. */
  group?: string;
  /** A count beside the label: the reader's own things, a number and
   *  never a list. */
  meta?: string;
  dot?: RailDot | null;
}

/** What waits for the reader in an item other than the current one: its
 *  dots (an alert beats unread), folded into the one mark the narrow row
 *  shows while the list is closed. Null when nothing does. */
function waiting(
  items: RailItem[],
  current: string | null | undefined,
): RailDot | null {
  const rows = items.filter((r) => r.key !== current && r.dot);
  if (!rows.length) return null;
  return {
    tone: rows.some((r) => r.dot?.tone === "alert") ? "alert" : "unread",
    title: rows.map((r) => `${r.label}: ${r.dot?.title}`).join("; "),
  };
}

/**
 * The rail. THE RAIL CARRIES STRUCTURE, NEVER USER CONTENT: sections,
 * never the name of a player or a clan, so it cannot grow when the data
 * does. A count of the reader's own things is the one exception in the
 * list, because it is a number and not a list. The title is the other:
 * it names what the rail belongs to.
 *
 * The current item is a gold left rule, weight, brighter ink and a quiet
 * fill (canvas 2026-09-29). Two items the reader can see at once never
 * share a label.
 *
 * Above the breakpoint the column runs the page's height and what is in
 * it sticks: it starts under the top bar, stays in view as the page
 * scrolls, and scrolls on its own when it is taller than the window
 * (2026-10-20).
 *
 * Below the one breakpoint it becomes a DISCLOSURE ABOVE THE CONTENT:
 * a 44px row naming the section, expanding to the same head and list in
 * the same order. Not a drawer over the content - a drawer hides the
 * page you are reading in order to show you a list of pages. While it
 * is closed, ONE mark on the row says that something in another section
 * waits for you (an alert or unread), so folding the list never hides
 * it.
 *
 * `title` is the plain desktop head (the product); `subtitle` is what
 * the narrow row shows beside the current section.
 */
export function Rail({
  items,
  current,
  navigate,
  narrow,
  title,
  subtitle,
  label = "Sections",
}: {
  items: RailItem[];
  current: string | null | undefined;
  navigate: (to: string) => void;
  narrow: boolean;
  title: string;
  subtitle?: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = items.find((r) => r.key === current);

  // A modified or middle click is the browser's (a new tab, a copied
  // link); only a plain one routes in-app.
  const go = (to: string) => (e: MouseEvent<HTMLElement>) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    setOpen(false);
    navigate(to);
  };

  const list = (
    <nav aria-label={label} className="flex flex-col gap-[2px]">
      {items.map((row, i) => {
        const on = row.key === current;
        const dot = row.dot;
        return (
          <div key={row.key}>
            {row.group && row.group !== items[i - 1]?.group && (
              <div className="rail__group">{row.group}</div>
            )}
            <a
              className={"rail__item" + (on ? " rail__item--on" : "")}
              href={row.to}
              aria-current={on ? "page" : undefined}
              onClick={go(row.to)}
            >
              <Icon name={row.icon} />
              {row.label}
              {(row.meta !== undefined || dot) && (
                <span className="rail__meta">
                  {dot && (
                    <span
                      className={`rail__dot rail__dot--${dot.tone}`}
                      title={dot.title}
                      role="img"
                      aria-label={dot.title}
                    />
                  )}
                  {row.meta}
                </span>
              )}
            </a>
          </div>
        );
      })}
    </nav>
  );

  const shown = !narrow || open;
  const top = narrow ? null : (
    <div className="mb-[6px] flex h-10 items-center gap-[9px] px-[11px]">
      <span className="truncate text-body-sm font-semibold" title={title}>
        {title}
      </span>
    </div>
  );

  const mark = narrow && !open ? waiting(items, current) : null;

  const body = (
    <>
      {shown && top}
      {shown && list}
    </>
  );

  return (
    <aside className="rail">
      {narrow && (
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {active && <Icon name={active.icon} size={17} />}
          <span className="text-body-sm font-semibold">
            {active?.label ?? title}
          </span>
          <span className="truncate text-small text-ink-faint">
            {subtitle ?? ""}
          </span>
          <span className="ml-auto flex items-center gap-[10px]">
            {mark && (
              <span
                className={`rail__dot rail__dot--${mark.tone}`}
                title={mark.title}
                role="img"
                aria-label={mark.title}
              />
            )}
            <Icon name={open ? "chevron-up" : "chevron-down"} size={17} />
          </span>
        </button>
      )}
      {/* Wide, the column runs the page's height and this sticks in it
          (components.css, .rail__pin); narrow, the disclosure's open
          list flows above the page as it always has. */}
      {narrow ? body : <div className="rail__pin">{body}</div>}
    </aside>
  );
}
