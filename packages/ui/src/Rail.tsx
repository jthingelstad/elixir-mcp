import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
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

/** One account the rail can be the console of: the person, or an agent
 *  they own. `to` is where choosing it goes, because an account's console
 *  is a PLACE with its own address, never a mode the app remembers. */
export interface RailAccount {
  key: string;
  label: string;
  /** A second line in the menu: the clan an agent acts for. */
  detail?: string;
  /** The mono aside: the role, or "agent · leader". */
  aside?: string;
  to: string;
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
 *
 * `accounts` turns the head into the ACCOUNT SELECTOR (2026-09-23): the
 * console belongs to one of them (`account` names which), and the head
 * shows that one with the others a click away. The first is the person;
 * any other is an agent, and the head is tinted while it is current, so
 * whose console this is never has to be read off a label. It stays in
 * the narrow layout's closed row, where a phone could otherwise be acting
 * as an agent without showing it. With one account or none the head is
 * the plain title, as it always was.
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
  accounts,
  account,
  manage,
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
  accounts?: RailAccount[];
  /** The key of the account this console belongs to. */
  account?: string;
  /** The last line of the selector: where accounts are managed. */
  manage?: { label: string; to: string };
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
  const switcher =
    accounts && accounts.length > 1 ? (
      <AccountSwitcher
        accounts={accounts}
        current={account}
        manage={manage}
        navigate={(to) => {
          setOpen(false);
          navigate(to);
        }}
      />
    ) : null;

  return (
    <aside className="rail">
      {narrow && switcher}
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
      ) : switcher ? (
        switcher
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
 * The rail head as a selector: the current account, and a disclosure
 * listing the others. A list of links, not an ARIA menu: choosing one is
 * navigation to another console's address. Escape and a click outside
 * close it, the way the top bar's sheet closes on Escape.
 */
function AccountSwitcher({
  accounts,
  current,
  manage,
  navigate,
}: {
  accounts: RailAccount[];
  current?: string | undefined;
  manage?: { label: string; to: string } | undefined;
  navigate: (to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Rendered only with two or more accounts; the first is the person.
  const person = accounts[0] as RailAccount;
  const here = accounts.find((a) => a.key === current) ?? person;
  const scoped = here.key !== person.key;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: Event) => {
      if (box.current && !box.current.contains(e.target as Node))
        setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const go = (to: string) => (e: MouseEvent) => {
    e.preventDefault();
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="rail__switch" ref={box} data-scoped={scoped}>
      <button
        type="button"
        className="rail__switch-head"
        aria-expanded={open}
        aria-controls="rail-accounts"
        title={`Console: ${here.label}. Switch account`}
        onClick={() => setOpen(!open)}
      >
        <span className="flex min-w-0 items-center gap-[7px]">
          <span className="min-w-0 truncate text-[13.5px] font-semibold">
            {here.label}
          </span>
          <Icon name={open ? "chevron-up" : "chevron-down"} size={15} />
        </span>
        {here.aside && (
          <span className="mono ml-auto shrink-0 whitespace-nowrap text-ink-faint">
            {here.aside}
          </span>
        )}
      </button>
      {open && (
        <div id="rail-accounts" className="rail__switch-list">
          {accounts.map((a) => (
            <a
              key={a.key}
              href={a.to}
              className="rail__switch-item"
              aria-current={a.key === here.key ? "true" : undefined}
              onClick={go(a.to)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-semibold">{a.label}</span>
                {a.detail && (
                  <span className="truncate text-[12px] text-ink-faint">
                    {a.detail}
                  </span>
                )}
              </span>
              {a.aside && (
                <span className="mono ml-auto shrink-0 text-[12px] text-ink-faint">
                  {a.aside}
                </span>
              )}
            </a>
          ))}
          {manage && (
            <a
              href={manage.to}
              className="rail__switch-item rail__switch-manage"
              onClick={go(manage.to)}
            >
              {manage.label}
            </a>
          )}
        </div>
      )}
    </div>
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
