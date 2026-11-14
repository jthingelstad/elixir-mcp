import { useEffect, useRef, useState } from "react";
import {
  AccountMenu,
  Disclaimer,
  FAMILY_FOOT,
  FAMILY_LOGO,
  FAMILY_PLACES,
  FAMILY_PRODUCTS,
  FAMILY_SIGNED_OUT,
  FAMILY_TABS,
  Icon,
  Link,
  initialsOf,
} from "@elixir-mcp/ui";
import { ADMIN, SETTINGS } from "../lib/settings.js";
import { statsHref } from "../stats/stats.js";
import { rememberSession } from "../lib/session-hint.js";
import { BellButton, BellSheet, useBell } from "./Bell.jsx";
import { HelpDrawer } from "./HelpDrawer.jsx";
import { SearchSheet } from "./SearchSheet.jsx";
import { SheetContext } from "./sheet.js";
import { useSignOut } from "./sign-out.js";

/**
 * The shell on every page of the app: the top bar, the avatar's menu, the
 * phone's tabs, the footer, the search sheet and the help drawer. The words and
 * addresses are the kit's manifest (packages/ui/src/family.json), the list
 * apps/site draws the same bar from. A static page has no app under it: its
 * Help is a small drawer of its own (assets/site-help.js) and its Search comes
 * here as `/home?search`.
 */
const PLACES = {
  ...Object.fromEntries(FAMILY_TABS.map((t) => [t.key, t.path])),
  signIn: FAMILY_PLACES.signIn.path,
  createAccount: FAMILY_PLACES.createAccount.path,
  verify: `${SETTINGS}/players/verify`,
  settings: FAMILY_PLACES.settings,
  admin: `${ADMIN}/accounts`,
};

/** The places a signed-in reader moves between (slice 7, #765): Home, Find,
 *  Clan and You, from the manifest. The phone draws all four and the bell;
 *  the top bar all but You, which is its avatar. */
const TABS = FAMILY_TABS;

const DROP =
  FAMILY_PRODUCTS.find((p) => p.key === "drop")?.href ??
  "https://drop.poapkings.com/";

/** The primary player's name, otherwise "Your account". */
function barName(me) {
  const primary = (me?.claims ?? []).find((c) => c.is_primary);
  return primary?.nickname ?? primary?.name ?? "Your account";
}

/** What the avatar's menu holds, for the kit's AccountMenu. */
export function barAccount(me, signOut) {
  const claims = me?.claims ?? [];
  const players = claims
    .filter((c) => c.is_primary || c.relationship === "alt")
    .map((c) => ({
      key: c.player_tag,
      name: c.nickname ?? c.name ?? c.player_tag,
      note: c.is_primary === true ? "Your main player" : "Also you",
      href: statsHref("season", { player: c.player_tag }),
    }));
  const add = {
    label: "Add or verify a player",
    href: PLACES.verify,
  };
  return {
    name: barName(me),
    email: me?.email ?? undefined,
    players,
    playersFoot: add,
    links: [
      {
        key: "you",
        icon: "user-round",
        label: "You",
        href: PLACES.you,
      },
      // The player group, and the line under it, only draw with a player.
      ...(players.length === 0
        ? [{ key: "add", icon: "user-round", ...add }]
        : []),
      {
        key: "settings",
        icon: "user-round",
        label: "Settings",
        href: PLACES.settings,
      },
      // Play Drop's place on a wide screen too since 2026-11-12: the bar
      // has Home, Find, Clan, search, help, the bell and you.
      {
        key: "drop",
        icon: "droplet",
        label: "Play Drop",
        hint: "opens in a new window",
        href: DROP,
      },
      ...(me?.is_admin === true
        ? [
            {
              key: "admin",
              icon: "shield",
              label: "Admin",
              hint: "staff only",
              href: PLACES.admin,
            },
          ]
        : []),
    ],
    signOut,
  };
}

const here = (place, area) =>
  place === area ? { "aria-current": "page" } : {};

function Brand() {
  return (
    <Link
      to={PLACES.home}
      className="kit-top__brand"
      aria-label="Elixir, go to Home"
    >
      <img src={FAMILY_LOGO} alt="" width="28" height="28" />
      <span>Elixir</span>
    </Link>
  );
}

function Avatar({ me }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const button = useRef(null);
  const signOut = useSignOut();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onClick = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  const name = barName(me);
  return (
    <div className="kit-top__account" ref={box}>
      <button
        ref={button}
        type="button"
        className="kit-top__avatar"
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sr-only">Account: </span>
        <span className="chrome__avatar" aria-hidden="true">
          {initialsOf(name)}
        </span>
        <span className="kit-top__name">{name}</span>
      </button>
      {open ? (
        <AccountMenu
          account={barAccount(me, signOut)}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

/** The top bar. `me` is the session, null while it has not answered and for
 *  an address nobody has signed in to see. */
function TopBar({ me, area, open, bell }) {
  const signedIn = me?.authenticated === true;
  // Not answered yet, or no answer: the bar claims neither state.
  if (me === null || me === undefined)
    return (
      <header className="kit-top">
        <div className="kit-top__row">
          <Brand />
        </div>
      </header>
    );
  if (!signedIn)
    return (
      <header className="kit-top">
        <div className="kit-top__row">
          <Brand />
          <nav className="kit-top__out" aria-label="Main">
            {FAMILY_SIGNED_OUT.map((p) => (
              <a key={p.key} href={p.path}>
                {p.label}
              </a>
            ))}
          </nav>
          <span className="kit-top__gap" />
          <Link to={PLACES.signIn} className="kit-top__link">
            Sign in
          </Link>
          <Link to={PLACES.createAccount} className="btn btn--sm btn--primary">
            {FAMILY_PLACES.createAccount.label}
          </Link>
        </div>
      </header>
    );
  return (
    <header className="kit-top">
      <div className="kit-top__row">
        <Brand />
        <nav className="kit-top__nav" aria-label="Main">
          {TABS.filter((t) => t.bar !== false).map((t) => (
            <Link
              key={t.key}
              to={PLACES[t.key]}
              aria-label={tabName(t, me)}
              {...here(t.key, area)}
            >
              <TabIcon tab={t} me={me} size={18} />
              {t.label}
            </Link>
          ))}
        </nav>
        <button
          type="button"
          className="kit-top__search"
          aria-haspopup="dialog"
          onClick={() => open("search")}
        >
          <Icon name={FAMILY_PLACES.search.icon} size={18} />
          <span>{FAMILY_PLACES.search.prompt}</span>
        </button>
        <span className="kit-top__gap" />
        <button
          type="button"
          className="kit-top__icon"
          aria-label={FAMILY_PLACES.help.label}
          aria-haspopup="dialog"
          onClick={() => open("help")}
        >
          <Icon name={FAMILY_PLACES.help.icon} size={18} />
        </button>
        <BellButton bell={bell} onOpen={() => open("bell")} />
        {/* Play Drop is in the avatar's menu and the footer, not the bar
            (Structure "Proposed", 2026-11-12). */}
        <Avatar me={me} />
      </div>
    </header>
  );
}

/** Home's mark (#765): the old Timeline tab's, moved to Home. It is lit
 *  while the recorder has learned something since Home's own place, which
 *  `me` already carries, so it costs no read [engineering, 2026-11-12]. */
const homeNews = (tab, me) =>
  tab.key === "home" && (me?.signals?.timeline_pending ?? 0) > 0;

function TabIcon({ tab, me, size }) {
  return (
    <span className="kit-bell__mark">
      <Icon name={tab.icon} size={size} />
      {homeNews(tab, me) ? (
        <span className="kit-bell__dot" aria-hidden="true" />
      ) : null}
    </span>
  );
}

/** The dot in words, as the tab's name: an sr-only span would be read as a
 *  block of its own ("Home , new items"). Undefined keeps the label. */
const tabName = (tab, me) =>
  homeNews(tab, me) ? `${tab.label}, new items` : undefined;

/** The phone's tabs, under the page. Signed in only. */
function BottomTabs({ me, area, open, bell }) {
  return (
    <nav className="kit-bottom" aria-label="Main, phone">
      {TABS.map((t) => (
        <Link
          key={t.key}
          to={PLACES[t.key]}
          aria-label={tabName(t, me)}
          {...here(t.key, area)}
        >
          <TabIcon tab={t} me={me} size={22} />
          <span>{t.label}</span>
        </Link>
      ))}
      <BellButton bell={bell} onOpen={() => open("bell")} phone />
    </nav>
  );
}

/** The footer: places and the disclaimer word for word. */
function SiteFoot() {
  return (
    <footer className="kit-foot">
      <nav aria-label="Elixir" className="kit-foot__links">
        {FAMILY_FOOT.map((l) => (
          <a key={l.path} href={l.path}>
            {l.label}
          </a>
        ))}
        <a href={DROP} target="_blank" rel="noopener noreferrer">
          Play Drop
        </a>
      </nav>
      <Disclaimer as="div" />
    </footer>
  );
}

/** The bar, whatever the page puts between it and the footer, the footer and
 *  the phone's tabs. Clan and the rail pages bring their own main. */
export function ShellFrame({ me, unreachable = false, area, children }) {
  // The static half's first paint reads this (lib/session-hint.js). An
  // unreachable session is not an answer, so it changes nothing.
  useEffect(() => {
    if (!unreachable) rememberSession(me);
  }, [me, unreachable]);
  const signedIn = me?.authenticated === true;
  // One sheet at a time, and mounted only when asked for: nothing is read
  // for search until someone opens it.
  const [sheet, setSheet] = useState(null);
  const close = () => setSheet(null);
  // The static half's Search and bell land here as ?search and ?bell, since a
  // static page has no sheet of its own. [engineering, 2026-11-06]
  useEffect(() => {
    if (!signedIn) return;
    const url = new URL(window.location.href);
    const asked = ["search", "bell"].find((k) => url.searchParams.has(k));
    if (!asked) return;
    url.searchParams.delete(asked);
    window.history.replaceState(null, "", url);
    setSheet(asked);
  }, [signedIn]);
  const bell = useBell(me, signedIn);
  return (
    <SheetContext.Provider value={signedIn ? setSheet : () => {}}>
      <div className={`kit-shell${signedIn ? " kit-shell--in" : ""}`}>
        <TopBar me={me} area={area} open={setSheet} bell={bell} />
        {children}
        <SiteFoot />
        {signedIn ? (
          <BottomTabs me={me} area={area} open={setSheet} bell={bell} />
        ) : null}
        {signedIn && sheet === "search" ? (
          <SearchSheet me={me} onClose={close} />
        ) : null}
        {signedIn && sheet === "help" ? <HelpDrawer onClose={close} /> : null}
        {signedIn && sheet === "bell" ? (
          <BellSheet me={me} onClose={close} />
        ) : null}
      </div>
    </SheetContext.Provider>
  );
}

/** A page in the shell with no rail: the bar, one main, the footer, the tabs. */
export function AppShell({ me, unreachable = false, area, children }) {
  return (
    <ShellFrame me={me} unreachable={unreachable} area={area}>
      <main className="kit-shell__main">{children}</main>
    </ShellFrame>
  );
}
