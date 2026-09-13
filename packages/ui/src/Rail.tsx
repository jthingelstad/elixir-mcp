import { useState, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

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
  /** A group heading above this item. */
  group?: string;
  /** A count beside the label: the reader's own things, a number and
   *  never a list. */
  meta?: string;
  dot?: RailDot | null;
  /** Rendered only while this item is current. */
  subs?: RailSub[];
}

/**
 * The rail. THE RAIL CARRIES STRUCTURE, NEVER USER CONTENT: sections
 * and sub-pages, never the name of a player or a clan, so it cannot
 * grow when the data does. A count of the reader's own things is the
 * one exception, because it is a number and not a list.
 *
 * The current item is a gold left rule plus weight and brighter ink —
 * never a filled block, because background is reserved for hover, and
 * once a fill means "selected" hover has nowhere to go. Two items the
 * reader can see at once never share a label; `subs` render only while
 * their item is current, which is how two sections can each have a
 * "Collectors" without ever showing both.
 *
 * Below the one breakpoint it becomes a DISCLOSURE ABOVE THE CONTENT:
 * a 44px row naming the section and where you are in it, expanding to
 * the same list in the same order. Not a drawer over the content — a
 * drawer hides the page you are reading in order to show you a list of
 * pages.
 *
 * `title` and `aside` are the desktop head (the product, and a mono
 * aside such as the role or the clan tag); `subtitle` is what the
 * narrow toggle shows beside the current section, defaulting to the
 * current sub-page's label. `identity` is the block at the foot: who
 * you are and the way out (RailIdentity).
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
  identity,
  label = "Sections",
}: {
  items: RailItem[];
  current: string | null | undefined;
  sub?: string | null;
  navigate: (to: string) => void;
  narrow: boolean;
  title: string;
  aside?: ReactNode;
  subtitle?: ReactNode;
  identity?: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const active = items.find((r) => r.key === current);

  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    navigate(to);
  };

  const list = (
    <nav aria-label={label} className="flex flex-col gap-[2px]">
      {items.map((row) => {
        const on = row.key === current;
        const dot = row.dot;
        return (
          <div key={row.key}>
            {row.group && <div className="rail__group">{row.group}</div>}
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

  return (
    <aside className="rail">
      {narrow ? (
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="text-[13.5px] font-semibold">
            {active?.label ?? title}
          </span>
          <span className="truncate text-[13px] text-ink-faint">
            {subtitle ?? subLabel ?? ""}
          </span>
          <span className="ml-auto flex">
            <Icon name={open ? "chevron-up" : "chevron-down"} size={17} />
          </span>
        </button>
      ) : (
        <div className="mb-[6px] flex h-10 items-center gap-[9px] border-0 border-b border-solid border-line-soft px-[11px]">
          <span className="truncate text-[13.5px] font-semibold" title={title}>
            {title}
          </span>
          {aside && (
            <span className="mono ml-auto text-ink-faint">{aside}</span>
          )}
        </div>
      )}

      {shown && list}

      {shown && identity && <div className="mt-auto pt-4">{identity}</div>}
    </aside>
  );
}

/**
 * The identity block at the foot of the rail: the way to the profile —
 * who you are signed in as, and where — with the way out beside it.
 * `action` is a button or a form, never a link: signing out is an
 * action, and giving it a destination invents a way to believe you
 * have done it when you have not (a `/signout` href once landed on the
 * app shell, bounced to the home page STILL SIGNED IN, and looked
 * exactly like a sign-out).
 */
export function RailIdentity({
  href,
  onClick,
  name,
  title,
  detail,
  action,
}: {
  href: string;
  onClick: (e: MouseEvent) => void;
  name: ReactNode;
  title?: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <a className="rail__identity text-inherit" href={href} onClick={onClick}>
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-solid border-line-strong bg-line-soft text-ink-body">
        <Icon name="user-round" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink" title={title}>
          {name}
        </span>
        <span className="block text-[12px] text-ink-faint">{detail}</span>
      </span>
      {action && <span className="shrink-0">{action}</span>}
    </a>
  );
}
