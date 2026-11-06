import { useEffect, useRef, useState } from "react";
import {
  AccountMenu,
  Disclaimer,
  FAMILY_LOGO,
  FAMILY_PRODUCTS,
  Link,
  initialsOf,
  writeErrorText,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { CONSOLE } from "../lib/console.js";
import { ladderHref } from "../ladder/ladder.js";
import { forgetSession, rememberSession } from "../lib/session-hint.js";

/**
 * The redesign's shell: the top bar, the avatar's menu, the phone's tabs and
 * the footer. Only /home wears it for now; nothing here knows that, so the
 * next step can put it on every page by rendering `AppShell` around them.
 *
 * Search and Help are plain links until the search sheet and help drawer
 * exist: Search opens Explore and Help opens the docs.
 */
const PLACES = {
  home: "/home",
  ladder: "/ladder",
  clan: "/clan",
  search: `${CONSOLE}/explore`,
  help: "/docs",
  signIn: `${CONSOLE}/signin`,
  verify: `${CONSOLE}/account/verify`,
  settings: `${CONSOLE}/account/profile`,
  admin: `${CONSOLE}/admin`,
};

const DROP =
  FAMILY_PRODUCTS.find((p) => p.key === "drop")?.href ??
  "https://drop.poapkings.com/";

const SIGN_OUT_NOTE =
  "Ends this browser's Elixir session. Drop manages its own sign-in.";

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
      href: ladderHref("season", { player: c.player_tag }),
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
      // A35: the phone's bar has no room for it.
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

function Glyph({ d, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
      {(d ?? []).map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

const GLYPHS = {
  home: <Glyph d={["M3 11l9-8 9 8", "M5 10v10h14V10"]} />,
  ladder: <Glyph d={["M4 4v16h16", "M8 15l4-4 3 3 5-6"]} />,
  clan: (
    <Glyph
      d={[
        "M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5",
        "M16 4.8a3.5 3.5 0 0 1 0 6.4",
        "M18.5 14.9c1.6.8 2.7 2.4 3 5.1",
      ]}
    >
      <circle cx="9" cy="8" r="3.5" />
    </Glyph>
  ),
  search: (
    <Glyph d={["M20 20l-4-4"]}>
      <circle cx="11" cy="11" r="7" />
    </Glyph>
  ),
  help: (
    <Glyph
      d={["M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.1 1-1.1 1.8", "M12 17h.01"]}
    >
      <circle cx="12" cy="12" r="9" />
    </Glyph>
  ),
  drop: <Glyph d={["M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12z"]} />,
};

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

/** Sign out, as the bar has always done it: a failure says so in the menu,
 *  and the browser stays where it is. */
function useSignOut() {
  const [failed, setFailed] = useState(null);
  return {
    label: "Sign out",
    note: SIGN_OUT_NOTE,
    error: failed,
    onClick: async () => {
      setFailed(null);
      const r = await api.signOut();
      if (!r.ok)
        return setFailed(
          `Not signed out. ${writeErrorText({ status: r.status, transport: r.error, data: r.data })}`,
        );
      forgetSession();
      window.location.assign("/");
    },
  };
}

function Avatar({ me }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const signOut = useSignOut();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
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
        type="button"
        className="kit-top__avatar"
        aria-label={`Account: ${name}`}
        aria-expanded={open}
        aria-controls="account-menu"
        onClick={() => setOpen((v) => !v)}
      >
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
function TopBar({ me, area }) {
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
            <a href="/">Home</a>
            <a href="/cards">Cards</a>
            <a href="/docs">Docs</a>
            <a href="/updates">Updates</a>
          </nav>
          <span className="kit-top__gap" />
          <Link to={PLACES.signIn} className="kit-top__link">
            Sign in
          </Link>
          <Link to={PLACES.signIn} className="btn btn--sm btn--primary">
            Create account
          </Link>
        </div>
      </header>
    );
  return (
    <header className="kit-top">
      <div className="kit-top__row">
        <Brand />
        <nav className="kit-top__nav" aria-label="Main">
          {["home", "ladder", "clan"].map((place) => (
            <Link key={place} to={PLACES[place]} {...here(place, area)}>
              {place === "home"
                ? "Home"
                : place === "ladder"
                  ? "Ladder"
                  : "Clan"}
            </Link>
          ))}
        </nav>
        <Link to={PLACES.search} className="kit-top__search">
          {GLYPHS.search}
          <span>Search players, clans, cards, help</span>
        </Link>
        <span className="kit-top__gap" />
        <a
          href={PLACES.help}
          className="kit-top__icon"
          aria-label="Help for this page"
        >
          {GLYPHS.help}
        </a>
        <a
          href={DROP}
          target="_blank"
          rel="noopener noreferrer"
          className="kit-top__drop"
          aria-label="Play Drop, the elixir-cost game, opens in a new window"
        >
          {GLYPHS.drop}
          Play Drop
        </a>
        <Avatar me={me} />
      </div>
    </header>
  );
}

/** The phone's tabs, under the page. Signed in only. */
function BottomTabs({ area }) {
  return (
    <nav className="kit-bottom" aria-label="Main, phone">
      {[
        ["home", "Home"],
        ["ladder", "Ladder"],
        ["clan", "Clan"],
        ["search", "Search"],
      ].map(([place, label]) => (
        <Link key={place} to={PLACES[place]} {...here(place, area)}>
          {GLYPHS[place]}
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}

const FOOT_LINKS = [
  ["Cards", "/cards"],
  ["Docs", "/docs"],
  ["Updates", "/updates"],
  ["Status and data", "/data"],
  ["Support Elixir", "/support"],
  ["Privacy", "/docs/privacy"],
  ["Terms", "/docs/terms"],
];

/** The footer: places, A7's short support line (the full promise stays on
 *  Support), and the disclaimer word for word. */
function SiteFoot() {
  return (
    <div className="kit-foot">
      <nav aria-label="Elixir" className="kit-foot__links">
        {FOOT_LINKS.map(([label, href]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
        <a href={DROP} target="_blank" rel="noopener noreferrer">
          Play Drop
        </a>
      </nav>
      <p className="kit-foot__support">
        Elixir is free and sponsor-supported.{" "}
        <a href="/support">Support Elixir</a>
      </p>
      <Disclaimer />
    </div>
  );
}

/** A page in the shell: the bar, its own main, the footer, the phone's tabs. */
export function AppShell({ me, unreachable = false, area, children }) {
  // The static half's first paint reads this (lib/session-hint.js). An
  // unreachable session is not an answer, so it changes nothing.
  useEffect(() => {
    if (!unreachable) rememberSession(me);
  }, [me, unreachable]);
  const signedIn = me?.authenticated === true;
  return (
    <div className={`kit-shell${signedIn ? " kit-shell--in" : ""}`}>
      <TopBar me={me} area={area} />
      <main className="kit-shell__main">{children}</main>
      <SiteFoot />
      {signedIn ? <BottomTabs area={area} /> : null}
    </div>
  );
}
