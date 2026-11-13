import { useState, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { isPlainClick } from "./Link.tsx";

export interface RailDot {
  tone: "unread" | "alert" | string;
  title: string;
}

export interface RailSub {
  slug: string;
  label: string;
  to: string;
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
  /** Something in this item waits for the reader to act on, in words
   *  the item's label leads ("Actions: 2 waiting for you"). Drawn
   *  nowhere on the wide rail, where the item's own count shows it; the
   *  narrow row's mark counts it. A plain count (what you track) is not
   *  attention. */
  attention?: string;
  /** Rendered only while this item is current. */
  subs?: RailSub[];
}

/** What waits for the reader in an item other than the current one: a
 *  dot (an alert beats unread) or an item's `attention`, folded into the
 *  one mark the narrow row shows while the list is closed. Null when
 *  nothing does. */
function waiting(
  items: RailItem[],
  current: string | null | undefined,
): RailDot | null {
  const rows = items.filter((r) => r.key !== current && (r.dot || r.attention));
  if (!rows.length) return null;
  return {
    tone: rows.some((r) => r.dot?.tone === "alert") ? "alert" : "unread",
    title: rows
      .map((r) => `${r.label}: ${r.dot?.title ?? r.attention}`)
      .join("; "),
  };
}

/** The line at the rail's foot: a place ("Send feedback") or an action
 *  ("Sign out of Elixir"). An action is a button, never a link, because
 *  signing out is not a destination: a `/signout` href once landed on
 *  the app shell, bounced to the home page STILL SIGNED IN, and looked
 *  exactly like a sign-out. */
export interface RailFoot {
  label: string;
  icon: string;
  to?: string;
  onClick?: () => void;
  current?: boolean;
  /** An action that did not take, said under its button. */
  error?: ReactNode;
}

/**
 * The rail. THE RAIL CARRIES STRUCTURE, NEVER USER CONTENT: sections
 * and sub-pages, never the name of a player or a clan, so it cannot
 * grow when the data does. A count of the reader's own things is the
 * one exception in the list, because it is a number and not a list. The
 * title is the other: it names what the rail belongs to.
 *
 * The current item is a gold left rule, weight, brighter ink and a quiet
 * fill (canvas 2026-09-29). Two items the reader can see at once never
 * share a label; `subs` render only while their item is current, which
 * is how two sections can each have a "Collectors" without ever showing
 * both.
 *
 * Above the breakpoint the column runs the page's height and what is in
 * it sticks: it starts under the top bar, stays in view as the page
 * scrolls, and scrolls on its own when it is taller than the window, so
 * the foot is always in reach (2026-10-20).
 *
 * Below the one breakpoint it becomes a DISCLOSURE ABOVE THE CONTENT:
 * a 44px row naming the section and whose console it is, expanding to
 * the same head, list and foot in the same order. Not a drawer over the
 * content - a drawer hides the page you are reading in order to show
 * you a list of pages. While it is closed, ONE mark on the row says
 * that something in another section waits for you (an alert, unread,
 * an item's `attention`), so folding the list never hides it.
 *
 * `title` and `aside` are the plain desktop head (the product, and a
 * mono aside such as the role or the clan tag); `subtitle` is what the
 * narrow row shows beside the current section, defaulting to the
 * current sub-page's label. `back` is a link above the head (a settings
 * rail's way back to its console); `foot` is the line at the bottom.
 */
export function Rail({
  items,
  current,
  sub,
  navigate,
  narrow,
  title,
  aside,
  subtitle,
  label = "Sections",
  back,
  foot,
}: {
  items: RailItem[];
  current: string | null | undefined;
  sub?: string | null;
  navigate: (to: string) => void;
  narrow: boolean;
  title: string;
  aside?: ReactNode;
  subtitle?: ReactNode;
  label?: string;
  back?: { label: string; to: string };
  foot?: RailFoot;
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
            {on &&
              (row.subs ?? []).map((s) => {
                const subOn = sub === s.slug;
                return (
                  <a
                    key={s.slug}
                    className={
                      "rail__child" + (subOn ? " rail__child--on" : "")
                    }
                    href={s.to}
                    aria-current={subOn ? "page" : undefined}
                    onClick={go(s.to)}
                  >
                    {s.label}
                  </a>
                );
              })}
          </div>
        );
      })}
    </nav>
  );

  const subLabel = (active?.subs ?? []).find((s) => s.slug === sub)?.label;
  const shown = !narrow || open;
  const top = narrow ? null : (
    <div className="mb-[6px] flex h-10 items-center gap-[9px] px-[11px]">
      <span className="truncate text-[13.5px] font-semibold" title={title}>
        {title}
      </span>
      {aside && <span className="mono ml-auto text-ink-faint">{aside}</span>}
    </div>
  );

  const mark = narrow && !open ? waiting(items, current) : null;

  const body = (
    <>
      {shown && back && (
        <a className="rail__back" href={back.to} onClick={go(back.to)}>
          <Icon name="chevron-left" size={15} />
          {back.label}
        </a>
      )}
      {shown && top}
      {shown && list}

      {shown && foot && (
        <div className="rail__foot">
          {foot.to ? (
            <a
              className={
                "rail__item rail__item--foot" +
                (foot.current ? " rail__item--on" : "")
              }
              href={foot.to}
              aria-current={foot.current ? "page" : undefined}
              onClick={go(foot.to)}
            >
              <Icon name={foot.icon} />
              {foot.label}
            </a>
          ) : (
            <button
              type="button"
              className="rail__item rail__item--foot"
              onClick={() => foot.onClick?.()}
            >
              <Icon name={foot.icon} />
              {foot.label}
            </button>
          )}
          {foot.error && (
            <p className="field-error mx-[11px] mt-2 mb-0" role="alert">
              {foot.error}
            </p>
          )}
        </div>
      )}
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
          <span className="text-[13.5px] font-semibold">
            {active?.label ?? foot?.label ?? title}
          </span>
          <span className="truncate text-[13px] text-ink-faint">
            {subtitle ?? subLabel ?? ""}
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
