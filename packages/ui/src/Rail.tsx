import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
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
  /** A group heading above this item. */
  group?: string;
  /** A count beside the label: the reader's own things, a number and
   *  never a list. */
  meta?: string;
  dot?: RailDot | null;
  /** Rendered only while this item is current. */
  subs?: RailSub[];
}

/** One account the rail can be the console of: the person, one of their
 *  agents, or an operating console such as Admin. `to` is where choosing
 *  it goes, because a console is a PLACE with its own address, never a
 *  mode the app remembers. */
export interface RailAccount {
  key: string;
  label: string;
  /** The second line: whose it is and the role ("King Thing · owner",
   *  "agent · f43c60e8f5bd", "every account · owner"). */
  detail?: string;
  /** A mono aside, appended to the second line. */
  aside?: string;
  /** The glyph in the head's tile; `initials` draws an avatar instead. */
  icon?: string;
  initials?: string;
  /** A heading in the open list above this entry ("You", "Your agents",
   *  "Operate"); repeated headings are drawn once. */
  group?: string;
  to: string;
}

/** The line at the rail's foot: a place ("Send feedback") or an action
 *  ("Sign out of Elixir"). An action is a button, never a link: signing
 *  out is not a destination (see RailIdentity). */
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
 * one exception, because it is a number and not a list.
 *
 * The current item is a gold left rule, weight, brighter ink and a quiet
 * fill (canvas 2026-09-29). Two items the reader can see at once never
 * share a label; `subs` render only while their item is current, which
 * is how two sections can each have a "Collectors" without ever showing
 * both.
 *
 * Below the one breakpoint it becomes a DISCLOSURE ABOVE THE CONTENT:
 * a 44px row naming the section and whose console it is, expanding to
 * the same head, list and foot in the same order. Not a drawer over the
 * content - a drawer hides the page you are reading in order to show
 * you a list of pages.
 *
 * `title` and `aside` are the plain desktop head (the product, and a
 * mono aside such as the role or the clan tag); `subtitle` is what the
 * narrow row shows beside the current section, defaulting to the
 * current sub-page's label. `back` is a link above the head (a settings
 * rail's way back to its console); `foot` is the line at the bottom;
 * `identity` is the older identity block (RailIdentity).
 *
 * `accounts` turns the head into the CONSOLE SWITCHER (2026-09-23,
 * redrawn 2026-09-29): the console belongs to one of them (`account`
 * names which), and the head shows that one, with the others a click
 * away. The first is the person; any other (an agent, Admin) tints the
 * head while it is current, and the narrow row is tinted and names it
 * too, so whose console a phone is showing never has to be guessed.
 * With one account the head is the same tile with nothing to open.
 *
 * `head` replaces the head outright, for a section whose rail belongs to
 * something other than an account: Ladder's is the player whose season
 * it reads. It stays in the narrow layout's closed row, so which player a
 * phone is reading is never hidden.
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
  head,
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
  identity?: ReactNode;
  label?: string;
  accounts?: RailAccount[];
  /** The key of the account this console belongs to. */
  account?: string;
  /** The last line of the switcher: where accounts are managed. */
  manage?: { label: string; to: string };
  /** A head of the section's own, in place of the title or switcher. */
  head?: ReactNode;
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
  const here =
    accounts && accounts.length > 0
      ? (accounts.find((a) => a.key === account) ?? accounts[0])
      : undefined;
  const scoped = Boolean(here && accounts && here.key !== accounts[0]?.key);

  const top = head ? (
    narrow ? null : (
      head
    )
  ) : accounts && accounts.length > 0 ? (
    <AccountSwitcher
      accounts={accounts}
      current={account}
      manage={manage}
      navigate={(to) => {
        setOpen(false);
        navigate(to);
      }}
    />
  ) : narrow ? null : (
    <div className="mb-[6px] flex h-10 items-center gap-[9px] border-0 border-b border-solid border-line-soft px-[11px]">
      <span className="truncate text-[13.5px] font-semibold" title={title}>
        {title}
      </span>
      {aside && <span className="mono ml-auto text-ink-faint">{aside}</span>}
    </div>
  );

  return (
    <aside className="rail">
      {narrow && head}
      {narrow && (
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={open}
          data-scoped={scoped}
          onClick={() => setOpen(!open)}
        >
          {active && <Icon name={active.icon} size={17} />}
          <span className="text-[13.5px] font-semibold">
            {active?.label ?? foot?.label ?? title}
          </span>
          <span className="truncate text-[13px] text-ink-faint">
            {subtitle ?? subLabel ?? ""}
          </span>
          <span className="ml-auto flex">
            <Icon name={open ? "chevron-up" : "chevron-down"} size={17} />
          </span>
        </button>
      )}

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
      {shown && identity && <div className="mt-auto pt-4">{identity}</div>}
    </aside>
  );
}

/** The tile and two lines that name a console, in the head and the list. */
function ConsoleName({ a }: { a: RailAccount }) {
  const line2 = [a.detail, a.aside].filter(Boolean).join(" · ");
  return (
    <>
      <span className="rail__switch-mark" aria-hidden="true">
        {a.initials ? (
          <span className="chrome__avatar">{a.initials}</span>
        ) : (
          <Icon name={a.icon ?? "gauge"} size={17} />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13.5px] font-semibold text-ink">
          {a.label}
        </span>
        {line2 && (
          <span className="truncate text-[12px] text-ink-faint">{line2}</span>
        )}
      </span>
    </>
  );
}

/**
 * The rail head as the console switcher: the current console, and a
 * disclosure listing the others under their headings. A list of links,
 * not an ARIA menu: choosing one is navigation to another console's
 * address. Escape and a click outside close it, the way the top bar's
 * menus close. With one console there is nothing to open, and the head
 * is the same tile without the chevrons.
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
  const person = accounts[0] as RailAccount;
  const here = accounts.find((a) => a.key === current) ?? person;
  const scoped = here.key !== person.key;
  const single = accounts.length === 1;

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

  // A modified or middle click is the browser's (a new tab, a copied
  // link); only a plain one routes in-app.
  const go = (to: string) => (e: MouseEvent<HTMLElement>) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    setOpen(false);
    navigate(to);
  };

  return (
    <div className="rail__switch" ref={box} data-scoped={scoped}>
      {single ? (
        <div className="rail__switch-head">
          <ConsoleName a={here} />
        </div>
      ) : (
        <button
          type="button"
          className="rail__switch-head"
          aria-expanded={open}
          aria-controls="rail-accounts"
          title={`${here.label}: switch console`}
          onClick={() => setOpen(!open)}
        >
          <ConsoleName a={here} />
          <span className="ml-auto flex shrink-0 text-ink-faint">
            <Icon name="chevrons-up-down" size={16} />
          </span>
        </button>
      )}
      {open && (
        <div id="rail-accounts" className="rail__switch-list">
          {accounts.map((a, i) => (
            <div key={a.key}>
              {a.group && a.group !== accounts[i - 1]?.group && (
                <div className="rail__switch-group">{a.group}</div>
              )}
              <a
                href={a.to}
                className="rail__switch-item"
                aria-current={a.key === here.key ? "true" : undefined}
                onClick={go(a.to)}
              >
                <ConsoleName a={a} />
                {a.key === here.key && (
                  <span className="ml-auto flex shrink-0 text-ok">
                    <Icon name="check" size={16} />
                  </span>
                )}
              </a>
            </div>
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
