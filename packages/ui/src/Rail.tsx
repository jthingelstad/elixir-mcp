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
 * head is the other: it names what the rail belongs to (the account
 * whose console it is, Ladder's player, Clan's clan), and a switcher
 * there lists the reader's own, a click away and never in the list.
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
 * it reads, Clan's the clan you are in (a RailSwitcher, Jamie
 * 2026-10-20). It stays in the narrow layout's closed row, so which
 * player or clan a phone is reading is never hidden.
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

/** The console switcher: the accounts as a RailSwitcher. The first is
 *  the person; any other tints the head while it is current. */
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
  const person = accounts[0] as RailAccount;
  const here = accounts.find((a) => a.key === current) ?? person;
  return (
    <RailSwitcher
      id="rail-accounts"
      title={`${here.label}: switch console`}
      face={<ConsoleName a={here} />}
      choices={accounts.map((a) => ({
        key: a.key,
        to: a.to,
        group: a.group,
        body: <ConsoleName a={a} />,
      }))}
      current={here.key}
      manage={manage}
      navigate={navigate}
      scoped={here.key !== person.key}
    />
  );
}

/** One place a rail switcher goes: a console, a clan. `to` is its
 *  address, and choosing it goes there. */
export interface RailChoice {
  key: string;
  to: string;
  /** What the entry shows: its name and second line. */
  body: ReactNode;
  /** At the entry's end, before the current one's check (a role). */
  end?: ReactNode;
  /** A heading in the open list above this entry ("You", "Your
   *  agents"); repeated headings are drawn once. */
  group?: string | undefined;
}

/**
 * The rail head as a switcher: what the rail belongs to now (`face`),
 * and a disclosure listing the choices under their headings, the
 * current one checked, with `manage` as the last line. A list of links,
 * not an ARIA menu: choosing one is navigation to its address. Escape
 * and a click outside close it, the way the top bar's menus close, and
 * Escape hands focus back to the head. With one choice there is nothing
 * to open: the head is the same tile without the chevrons.
 *
 * `choose` takes a plain click on a choice in place of `navigate`, for a
 * section that does something first (Clan remembers the clan, then goes
 * to its landing); a modified or middle click is still the browser's,
 * to the choice's own address. `head` marks it as the rail's `head`,
 * which the narrow layout draws beside the row's toggle. `busy` while a
 * choice is still being made: the list closes and the head will not
 * open it again until the choice lands, so a second choice never races
 * the first.
 */
export function RailSwitcher({
  id,
  title,
  face,
  choices,
  current,
  manage,
  navigate,
  choose,
  scoped = false,
  head = false,
  busy = false,
}: {
  /** The open list's id, which the head's button controls. */
  id: string;
  /** The head button's title ("Example Clan: switch clan"). */
  title: string;
  face: ReactNode;
  choices: RailChoice[];
  /** The key of the current choice. */
  current?: string | undefined;
  /** The list's last line: where the choices are managed or listed. */
  manage?: { label: string; to: string } | undefined;
  navigate: (to: string) => void;
  choose?: (choice: RailChoice) => void;
  scoped?: boolean;
  head?: boolean;
  /** A choice is being made: the face says which; nothing opens. */
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Closed while busy, and still closed once the choice lands.
  const shown = open && !busy;
  useEffect(() => {
    if (busy) setOpen(false);
  }, [busy]);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const single = choices.length <= 1;

  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
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
  }, [shown]);

  // A modified or middle click is the browser's (a new tab, a copied
  // link); only a plain one routes in-app.
  const go =
    (to: string, then?: () => void) => (e: MouseEvent<HTMLElement>) => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      setOpen(false);
      if (then) then();
      else navigate(to);
    };

  return (
    <div
      className={"rail__switch" + (head ? " rail__switch--head" : "")}
      ref={box}
      data-scoped={scoped}
      aria-busy={busy || undefined}
    >
      {single ? (
        <div className="rail__switch-head">{face}</div>
      ) : (
        <button
          ref={button}
          type="button"
          className="rail__switch-head"
          aria-expanded={shown}
          aria-controls={id}
          aria-disabled={busy || undefined}
          title={title}
          onClick={() => setOpen(busy ? false : !open)}
        >
          {face}
          <span className="ml-auto flex shrink-0 text-ink-faint">
            <Icon name="chevrons-up-down" size={16} />
          </span>
        </button>
      )}
      {shown && (
        <div id={id} className="rail__switch-list">
          {choices.map((c, i) => {
            const on = c.key === current;
            return (
              <div key={c.key}>
                {c.group && c.group !== choices[i - 1]?.group && (
                  <div className="rail__switch-group">{c.group}</div>
                )}
                <a
                  href={c.to}
                  className="rail__switch-item"
                  aria-current={on ? "true" : undefined}
                  onClick={go(c.to, choose && (() => choose(c)))}
                >
                  {c.body}
                  {(c.end || on) && (
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      {c.end}
                      {on && (
                        <span className="flex text-ok">
                          <Icon name="check" size={16} />
                        </span>
                      )}
                    </span>
                  )}
                </a>
              </div>
            );
          })}
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
