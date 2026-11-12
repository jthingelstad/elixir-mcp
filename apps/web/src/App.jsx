import {
  InitialTimeProvider,
  ErrorBoundary,
  Link,
  NavigateProvider,
  Rail as RailList,
  ZoneProvider,
} from "@elixir-mcp/ui";
import {
  useEffect,
  useState,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  defaultParseSearch,
  lazyRouteComponent,
  notFound,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import {
  answered,
  createQueryClient,
  resetSessionCache,
} from "@elixir-mcp/client";
import { createClanRoutes } from "@elixir-mcp/clan-web/routes";
import { api } from "./api.js";
import { useMyGateways } from "./lib/queries.js";
import { CardArtSource } from "./components/CardArtSource.jsx";
import { CONSOLE, appPath } from "./lib/console.js";
import {
  SETTINGS,
  SETTINGS_RAIL,
  isSettings,
  settingsHere,
  settingsLegal,
  settingsTitle,
} from "./lib/settings.js";
import {
  LADDER,
  isLadder,
  ladderHere,
  ladderLegal,
  ladderTitle,
} from "./ladder/ladder.js";
import { HOME, SERVICE_STATUS, SIGN_IN, movedTo } from "./lib/moved.js";
import { AppShell, ShellFrame } from "./shell/Shell.jsx";
import { LadderInvite } from "./ladder/Invite.jsx";
import { SignIn } from "./views/SignIn.jsx";
import { takeLoginToken } from "./url-hygiene.js";

/**
 * The route table and the rails. The shell itself, the same top bar, phone
 * tabs and footer on every page (redesign step 3b, 2026-11-06), is
 * shell/Shell.jsx; this file puts pages in it.
 *
 * The RAIL CARRIES STRUCTURE, NEVER USER CONTENT. Sections and sub-pages,
 * never the name of a player or a clan: the rail must not grow when the data
 * does. A count of the reader's own things is the one exception, because it
 * is a number and not a list.
 *
 * This app is the site's DYNAMIC half (2026-09-07 split): Home, Ladder, Clan,
 * Settings pages and Explore. The root is the site's. Docs, updates and the
 * public pages are real documents built by apps/site and served from the same
 * hostname; they are reached with plain hrefs (STATIC_LINKS below), which are
 * full page loads on purpose.
 */

/** Paths owned by the static site. The edge router in infra/template.yaml
 *  sends everything outside the app's paths to a document; a test pins these to
 *  pages apps/site builds, because a link to a page it does not build is
 *  a dead link. */
export const STATIC_LINKS = {
  home: "/",
  data: "/data",
  examples: "/examples/play",
  docs: "/docs",
  updates: "/updates",
};

/**
 * Sections and their pages — the app's route table.
 *
 * The rail is built from RAIL below rather than from this, because the
 * two answer different questions: this one says which paths resolve,
 * that one says what the reader is offered and in what order.
 */
export const SECTIONS = {
  explore: { label: "Explore", authed: true, pages: [] },
  status: {
    label: "Status",
    authed: true,
    pages: [
      { slug: "collectors", label: "Collectors" },
      { slug: "efficiency", label: "Efficiency" },
    ],
  },
  admin: {
    label: "Admin",
    authed: true,
    adminOnly: true,
    pages: [
      { slug: "requests", label: "Requests" },
      { slug: "accounts", label: "Accounts" },
      { slug: "pulse", label: "Beta pulse" },
      { slug: "integrations", label: "Integrations" },
      { slug: "connections", label: "Connections" },
      { slug: "feedback", label: "Feedback" },
      { slug: "emails", label: "Emails" },
      { slug: "discord", label: "Discord" },
      { slug: "usage", label: "Usage" },
      { slug: "cards", label: "Cards" },
      { slug: "collectors", label: "Collectors", ownerOnly: true },
      { slug: "service-tokens", label: "Service tokens", ownerOnly: true },
    ],
  },
};

/**
 * The rails. Settings' is lib/settings.js. Explore has its own, reached from
 * search; Admin has its own, reached from the avatar's menu.
 */
export const EXPLORE_RAIL = [
  {
    key: "lookup",
    label: "Look up",
    icon: "search",
    to: `${CONSOLE}/explore`,
  },
  {
    key: "players",
    label: "Players",
    icon: "user-round",
    to: `${CONSOLE}/explore/players`,
  },
  {
    key: "clans",
    label: "Clans & wars",
    icon: "users",
    to: `${CONSOLE}/explore/clans`,
  },
  {
    key: "meta",
    label: "Decks",
    icon: "layout-grid",
    to: `${CONSOLE}/explore/meta`,
  },
  {
    key: "weeks",
    label: "War weeks",
    icon: "calendar-days",
    to: `${CONSOLE}/explore/weeks`,
  },
];

/** Admin's rail: bare labels again, because nothing else is
 *  on screen beside them. Collectors and Service tokens are the owner's. */
export const ADMIN_RAIL = [
  {
    group: "People",
    key: "requests",
    label: "Requests",
    icon: "inbox",
    to: `${CONSOLE}/admin/requests`,
  },
  {
    key: "accounts",
    label: "Accounts",
    icon: "users",
    to: `${CONSOLE}/admin/accounts`,
  },
  // Counts by signup week only; Accounts is the page that names people.
  {
    key: "pulse",
    label: "Beta pulse",
    icon: "chart-line",
    to: `${CONSOLE}/admin/pulse`,
  },
  {
    key: "feedback",
    label: "Feedback",
    icon: "message-square",
    to: `${CONSOLE}/admin/feedback`,
  },
  {
    key: "emails",
    label: "Emails",
    icon: "mail",
    to: `${CONSOLE}/admin/emails`,
  },
  // What Elixir posted to Discord, across clans and timelines, and how
  // it fared: the quality ledger (2026-10-11), never the channels.
  {
    key: "discord",
    label: "Discord",
    icon: "megaphone",
    to: `${CONSOLE}/admin/discord`,
  },
  {
    group: "Access",
    key: "connections",
    label: "Connections",
    icon: "plug",
    to: `${CONSOLE}/admin/connections`,
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: "wrench",
    to: `${CONSOLE}/admin/integrations`,
  },
  {
    key: "usage",
    label: "Usage",
    icon: "chart-column",
    to: `${CONSOLE}/admin/usage`,
  },
  // Read-only: the archetype vocabulary in force and the unattested
  // queue; the file is edited in cr-agent-api-docs.
  {
    group: "Record",
    key: "cards",
    label: "Cards",
    icon: "layout-grid",
    to: `${CONSOLE}/admin/cards`,
  },
  {
    key: "collectors",
    label: "Collectors",
    icon: "server",
    to: `${CONSOLE}/admin/collectors`,
    meta: "owner",
    ownerOnly: true,
  },
  {
    key: "service-tokens",
    label: "Service tokens",
    icon: "key-round",
    to: `${CONSOLE}/admin/service-tokens`,
    meta: "owner",
    ownerOnly: true,
  },
];

/** Which rail item a path belongs to. Read on the app path (the prefix off),
 *  so the segments keep their indexes. Settings' pages say it themselves
 *  (lib/settings.js). */
export function railPosition(path) {
  const app = appPath(path) ?? "";
  const [, section, page, rest] = app.split("/");
  if (section === "explore") {
    const explore = { rail: "explore" };
    const kinds = ["players", "clans", "meta", "weeks"];
    if (kinds.includes(page)) return { ...explore, key: page };
    if (page === "player" && rest) return { ...explore, key: "players" };
    if (page === "clan" && rest) return { ...explore, key: "clans" };
    if (page === "week" && rest) return { ...explore, key: "weeks" };
    return { ...explore, key: "lookup" };
  }
  // Admin's rail's items are its pages.
  if (section === "admin") return { rail: "admin", key: page ?? "requests" };
  return {};
}

/** A battle's public page (2026-10-01): /battle/<short id>, a 12 to 64
 *  character hex prefix of the battle id. */
const BATTLE_PATH = /^\/battle\/[0-9a-f]{12,64}$/;

/** A shared post's public page (#762): /h/<share id>, 15 base32
 *  characters (POST_ID_PATTERN in @elixir-mcp/contracts). */
const POST_PATH = /^\/h\/[a-z2-7]{15}$/;

/** Which place the bar marks as the one you are in, from the route. A battle's
 *  public page is in no place, nor are Settings' pages: the Search tab opens
 *  a sheet over whichever page you are on, and stands for Explore's records
 *  while you are reading one. */
export function barArea(path) {
  if (isHome(path)) return "home";
  if (isLadder(path)) return "ladder";
  if (isClan(path)) return "clan";
  const section = (appPath(path) ?? "").split("/")[1];
  return section === "explore" ? "search" : undefined;
}

const HOME_PATHS = new Set([HOME, `${HOME}/timeline`, `${HOME}/friends`]);
const isHome = (path) => HOME_PATHS.has(path.replace(/(.)\/$/, "$1"));

const isClan = (path) =>
  path === "/clan" ||
  path === "/clan/" ||
  /^\/clan\/[A-Za-z0-9/_-]+$/.test(path);

/** Guard restored and bookmarked routes: a stale path to a removed page falls
 *  back to a known-good route. An address the app has never had returns null,
 *  and the root route says "Nothing at this address". */
export function legalRoute(path) {
  if (isClan(path)) return path;
  if (isHome(path)) return path;
  if (path === SIGN_IN || path === SERVICE_STATUS) return path;
  if (isSettings(path)) return settingsLegal(path);
  // A battle's public page is the app's too.
  if (BATTLE_PATH.test(path)) return path;
  if (POST_PATH.test(path)) return path;
  // Ladder resolves its own paths.
  if (isLadder(path)) return ladderLegal(path);
  const app = appPath(path);
  if (app === null) return null;
  const [, section, page] = app.split("/");
  const sec = SECTIONS[section];
  if (!sec) return null;
  // Explore's records are addressable, so it resolves its own paths.
  if (section === "explore") return path;
  if (sec.pages.some((p) => p.slug === page)) return path;
  if (section === "status") return SERVICE_STATUS;
  return `${CONSOLE}/${section}/${sec.pages[0].slug}`;
}

/** Tab titles. The distinguishing word goes FIRST, because a browser
 *  tab truncates from the right - "Elixir - Status" is useless at tab
 *  width, "Status - Elixir" is not. Sections that own their own
 *  sub-pages (explore records, docs) name the record instead. The site
 *  is "Elixir" on every surface, the same suffix apps/site's pages and
 *  a battle's page wear. */
const SITE = "Elixir";
const CLAN_PAGES = new Set([
  "clans",
  "you",
  "verify",
  "feedback",
  "maintain",
  "refused",
]);
const prettify = (seg) =>
  /^[#%]/.test(seg)
    ? decodeURIComponent(seg)
    : decodeURIComponent(seg)
        .replace(/-/g, " ")
        .replace(/^./, (c) => c.toUpperCase());

export function titleFor(section, sec, path) {
  if (path === SIGN_IN) return `Sign in - ${SITE}`;
  if (path === SERVICE_STATUS) return `Status - ${SITE}`;
  if (isSettings(path)) return `${settingsTitle(path)} - Settings - ${SITE}`;
  if (isHome(path)) {
    const tab = path.split("/")[2];
    const name =
      tab === "timeline" ? "Timeline" : tab === "friends" ? "Friends" : "Today";
    return `${name} - Home - ${SITE}`;
  }
  if (isLadder(path)) return ladderTitle(path, SITE);
  if (isClan(path)) {
    // Clan's own pages (/clan/you, /clan/verify...) lead with their
    // name, a clan's section (/clan/<tag>/<section>) with the section.
    const [, , first, second] = path.split("/");
    const lead = CLAN_PAGES.has(first) ? first : first && second;
    return lead ? `${prettify(lead)} - Clan - ${SITE}` : `Clan - ${SITE}`;
  }
  const parts = (appPath(path) ?? "").split("/").filter(Boolean);
  if (parts.length === 0) return SITE;
  if (!sec) return SITE;
  const pageSlug = parts[1];
  const known = sec.pages?.find((p) => p.slug === pageSlug)?.label;
  // A record deeper than the page slug is the most specific thing on
  // screen, so it wins the front of the title.
  const record = parts[2] ? prettify(parts[2]) : null;
  const lead = record ?? known ?? (pageSlug ? prettify(pageSlug) : null);
  if (!lead || lead === sec.label) return `${sec.label} - ${SITE}`;
  return `${lead} - ${sec.label} - ${SITE}`;
}

/** `navigate(to)` for the views: a path, with a query string riding
 *  along for the page to read (a feedback prefill). The router owns
 *  history; this is the one shape every view already calls. */
export function useNav() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  return useCallback(
    (to, { replace = false } = {}) => {
      // A fragment names a place on the page (Overview's "Fix the tag"
      // lands on TrackedRecord's #fix-tag): the router carries it apart.
      const [path, hash] = String(to).split("#");
      const [pathname, qs] = path.split("?");
      if (
        isClan(pathname) &&
        queryClient.getQueryData(["me"])?.data?.features?.clan_internal !== true
      ) {
        window.location.assign(to);
        return;
      }
      return nav({
        to: pathname,
        search: qs ? defaultParseSearch(`?${qs}`) : {},
        ...(hash ? { hash } : {}),
        replace,
      });
    },
    [nav, queryClient],
  );
}

/** True below the one breakpoint the whole product uses. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => false);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq?.addEventListener) return;
    setNarrow(mq.matches);
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** The rail: the kit's, fed the rail this place belongs to (Settings, Explore
 *  or Admin), filtered by who is looking, with the reader's counts and the one
 *  dot attached by key. Who you are and the way out are the bar's account menu,
 *  never the rail's; feedback and help are the bar's Help drawer. */
function Rail({
  me,
  here,
  navigate,
  narrow,
  counts,
  dots = {},
  runsCollector,
}) {
  const admin = here.rail === "admin";
  const explore = here.rail === "explore";
  const rail = admin
    ? ADMIN_RAIL.filter((r) => !r.ownerOnly || me?.is_owner)
    : explore
      ? EXPLORE_RAIL
      : SETTINGS_RAIL.filter((r) => !r.runsOne || runsCollector);
  const items = rail.map((row) => ({
    key: row.key,
    label: row.label,
    icon: row.icon,
    to: row.to,
    group: row.group,
    meta: row.meta ?? counts[row.key],
    dot: dots[row.key] ?? null,
  }));
  const name = admin ? "Admin" : explore ? "Explore" : "Settings";
  return (
    <RailList
      label={`${name} sections`}
      items={items}
      current={here.key}
      navigate={navigate}
      narrow={narrow}
      title={name}
      subtitle={`All ${name.toLowerCase()}`}
    />
  );
}

/** Where a signed-out deep link wanted to go, kept across the sign-in
 *  (2026-09-19: the mail footer links straight to an email's record and
 *  to feedback about it, and a phone that opens the link is usually
 *  signed out). Shared localStorage supports a magic link in a new tab.
 *  A per-tab copy keeps the requesting screen's destination
 *  when the link tab consumes the shared copy. Owned paths only. */
const SignInProgress = createContext([false, () => {}]);
const AFTER_SIGN_IN = "elixir.after_sign_in";
const signedInPath = (path) => {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    return false;
  try {
    const url = new URL(path, window.location.origin);
    // Refuse external, backslash and traversal spellings before navigation
    // can normalize them. Credentials and fragments are never return paths.
    if (
      url.origin !== window.location.origin ||
      url.pathname !== path.split("?")[0] ||
      url.hash
    )
      return false;
    return (
      /^\/(account|admin|agent|explore|status)(\/|$)/.test(
        appPath(url.pathname) ?? "",
      ) ||
      isLadder(url.pathname) ||
      isClan(url.pathname) ||
      isHome(url.pathname) ||
      isSettings(url.pathname) ||
      url.pathname === SERVICE_STATUS ||
      BATTLE_PATH.test(url.pathname) ||
      POST_PATH.test(url.pathname)
    );
  } catch {
    return false;
  }
};
export function rememberAfterSignIn(path) {
  if (!signedInPath(path)) return;
  for (const storage of ["sessionStorage", "localStorage"]) {
    try {
      window[storage].setItem(AFTER_SIGN_IN, path);
    } catch {
      // Either storage can be denied independently.
    }
  }
}
export function takeAfterSignIn() {
  let path = null;
  try {
    const saved = window.sessionStorage.getItem(AFTER_SIGN_IN);
    window.sessionStorage.removeItem(AFTER_SIGN_IN);
    if (signedInPath(saved)) path = saved;
  } catch {
    // The shared copy still supports a browser without per-tab storage.
  }
  try {
    const shared = window.localStorage.getItem(AFTER_SIGN_IN);
    if (!path || shared === path) window.localStorage.removeItem(AFTER_SIGN_IN);
    if (!path && signedInPath(shared)) path = shared;
  } catch {
    // The requesting tab can still use its own copy.
  }
  return path;
}

export function SignInWall({ navigate }) {
  // The path this wall stands in front of, remembered for after.
  const { pathname, searchStr } = useLocation();
  const here = pathname + searchStr;
  useEffect(() => rememberAfterSignIn(here), [here]);
  // The protected URL is already saved above. Replace its wall so
  // completing proof does not leave a second automatic return in
  // history (notably an email's ?report=1 feedback redirect).
  const signIn = () => navigate(SIGN_IN, { replace: true });
  // Ladder says what it is first: a visitor may not know yet.
  if (isLadder(pathname))
    return <LadderInvite returnTo={here} onSignIn={signIn} />;
  return (
    <div className="panel mx-auto mt-12 max-w-[420px]">
      <div className="panel__body text-center">
        <h1 className="page__title mb-2">Sign in first</h1>
        <p className="text-[13px] text-ink-faint">
          Elixir&rsquo;s record opens to members: every player, clan and
          timeline needs an account. Verify your email to sign in, or to create
          an account if you are new.
        </p>
        <button className="btn btn--primary mt-2" onClick={signIn}>
          Sign in
        </button>
      </div>
    </div>
  );
}

/** A signed-in person on a page for Elixir's staff: not a sign-in problem, and
 *  it does not say whether the page holds anything. The gate is the server's. */
export function StaffOnly() {
  return (
    <div className="panel mx-auto mt-12 max-w-[420px]">
      <div className="panel__body text-center">
        <h1 className="page__title mb-2">
          This page is for Elixir&rsquo;s staff
        </h1>
        <p className="text-[13px] text-ink-faint">
          You&rsquo;re signed in, and your account is fine. Your own pages are
          on Home.
        </p>
        <Link to={HOME} className="btn btn--primary mt-2">
          Go to Home
        </Link>
      </div>
    </div>
  );
}

/** An address the app has never had. Its own shell, because the root route
 *  renders this in place of everything under it. */
function MissingPage() {
  const navigate = useNav();
  const { me, unreachable } = useMe();
  useEffect(() => {
    document.title = `Nothing at this address - ${SITE}`;
  }, []);
  return (
    <ZoneProvider zone={me?.timezone}>
      <NavigateProvider navigate={navigate}>
        <AppShell me={unreachable ? null : me} unreachable={unreachable}>
          <div className="panel mx-auto mt-12 max-w-[420px]">
            <div className="panel__body text-center">
              <h1 className="page__title mb-2">Nothing at this address</h1>
              <p className="text-[13px] text-ink-faint">
                It may have moved, or it was never a page.
              </p>
              <Link to={HOME} className="btn btn--primary mt-2">
                Go to Home
              </Link>
            </div>
          </div>
        </AppShell>
      </NavigateProvider>
    </ZoneProvider>
  );
}

/**
 * /api/me could not be reached: a timeout, a dropped connection, an edge
 * error page, a 5xx. Distinct from "not signed in", which is what this
 * used to render as. The session was fine; the wall said otherwise; the
 * person signed in again and a second session was minted beside the
 * first. The census of 2026-09-12 showed exactly that: seven sessions
 * for one person in one day, none expired.
 */
function Unavailable({ onRetry, busy }) {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-[400px] text-center">
        <h1 className="page__title text-[24px]">Elixir didn&rsquo;t answer</h1>
        <p className="text-[13px] text-ink-faint">
          The page could not check who you are. You are not signed out; the
          request did not get through. Try again in a moment.
        </p>
        <button className="btn mt-2" onClick={onRetry} disabled={busy}>
          {busy ? "Trying…" : "Try again"}
        </button>
      </div>
    </div>
  );
}

/**
 * The route tree. The root's beforeLoad is the old route guard as a real one:
 * an address the app has never had is "Nothing at this address", and a moved
 * or partial one is REDIRECTED (lib/moved.js, the one map), so the address bar
 * changes with it and the query and fragment ride along.
 *
 * Sections are split by route: Admin, Explore, Status and the Account pages
 * each arrive as their own chunk, so the sign-in wall does not carry Admin
 * with it.
 */
/** What the distribution routes to this app; the rest is the static site. */
const APP_PATHS =
  /^\/(home|signin|settings|console|ladder|clan|battle|h|data\/service)(\/|$)/;

const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    const path = location.pathname;
    const target = movedTo(path, location.hash) ?? path;
    const owned = legalRoute(target);
    if (owned === null) {
      // CloudFront only sends this app's own paths here, so anything else
      // got here by a link inside the page, or moved onto the site (the old
      // charts), and is a site document: load it.
      if (typeof window !== "undefined" && !APP_PATHS.test(target))
        window.location.replace(
          target === path
            ? path
            : `${target}${location.searchStr ?? ""}${location.hash ? `#${location.hash}` : ""}`,
        );
      throw notFound();
    }
    if (owned !== path)
      throw redirect({
        to: owned,
        search: location.search,
        ...(location.hash ? { hash: location.hash } : {}),
        replace: true,
      });
  },
  component: Shell,
  notFoundComponent: MissingPage,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SIGN_IN,
  component: function SignInPage() {
    const navigate = useNav();
    const { me, refresh } = useMe();
    const queryClient = useQueryClient();
    const [completing, setCompleting] = useContext(SignInProgress);
    // The static site's bar always says "Sign in" (it cannot know the
    // session), so a reader who is signed in arrives here too: send them
    // on to Home. Not when a login link brought a token: that is
    // a sign-in (or a device hand-off) to finish, signed in or not.
    const location = useLocation();
    const destination = new URLSearchParams(location.searchStr).get(
      "return_to",
    );
    if (destination && typeof window !== "undefined")
      rememberAfterSignIn(destination);
    const token = typeof window === "undefined" ? null : takeLoginToken();
    const forward = me?.authenticated === true && !token && !completing;
    useEffect(() => {
      if (forward) navigate(takeAfterSignIn() ?? HOME, { replace: true });
    }, [forward, navigate]);
    if (forward || (me === null && !token)) return null;
    return (
      <SignIn
        search={location.searchStr}
        discordLogin={me?.features?.discord_login === true}
        onAuthed={async () => {
          setCompleting(true);
          // A new account's first sign-in lands on Home's first steps too.
          const next = takeAfterSignIn() ?? HOME;
          try {
            // A new login can be a different person. Remove the previous
            // account's private data before any next-account view mounts.
            await resetSessionCache(queryClient);
            await refresh();
            // Proof consumes the sign-in step. Back returns to the page
            // before the sign-in journey instead of forwarding once more.
            await navigate(next, { replace: true });
          } finally {
            setCompleting(false);
          }
        }}
      />
    );
  },
});

/** Settings: one route, and the page reads the address (lib/settings.js). */
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${SETTINGS}/$`,
  component: lazyRouteComponent(
    () => import("./pages/SettingsPage.jsx"),
    "SettingsPage",
  ),
});

const exploreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/explore/$`,
  component: lazyRouteComponent(
    () => import("./pages/ExplorePage.jsx"),
    "ExplorePage",
  ),
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/status/{-$page}/{-$itemId}`,
  component: lazyRouteComponent(
    () => import("./pages/StatusPage.jsx"),
    "StatusPage",
  ),
});

/** The service detail: signed in only, linked from the public /data. */
const serviceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: SERVICE_STATUS,
  component: lazyRouteComponent(
    () => import("./pages/StatusPage.jsx"),
    "StatusPage",
  ),
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/admin/{-$page}/{-$itemId}`,
  component: lazyRouteComponent(
    () => import("./pages/AdminPage.jsx"),
    "AdminPage",
  ),
});

const battleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/battle/$ref",
  component: lazyRouteComponent(
    () => import("./views/Battle.jsx"),
    "BattlePage",
  ),
});

const postRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/h/$id",
  component: lazyRouteComponent(() => import("./views/Post.jsx"), "PostPage"),
});

/** Ladder: its own rail in the shell. Signed in only. */
const ladderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${LADDER}/{-$page}`,
  component: lazyRouteComponent(
    () => import("./pages/LadderPage.jsx"),
    "LadderPage",
  ),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/home/{-$tab}",
  component: lazyRouteComponent(
    () => import("./pages/HomePage.jsx"),
    "HomePage",
  ),
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  signInRoute,
  settingsRoute,
  exploreRoute,
  statusRoute,
  serviceRoute,
  adminRoute,
  battleRoute,
  postRoute,
  ladderRoute,
  createClanRoutes(rootRoute, {
    Frame: ClanFrame,
    rememberAfterSignIn,
  }),
]);

/** Where a route is on the rail and in the route table, from its path:
 *  the section, its page (validated against SECTIONS, so a stale slug
 *  falls back to the section's first page), the rail position, the
 *  ids. Route components read this rather than re-deriving it. */
/** Ladder's place in the route table: one section, signed in. */
const LADDER_SECTION = { label: "Ladder", authed: true, pages: [] };
const SETTINGS_SECTION = { label: "Settings", authed: true, pages: [] };

export function useHere() {
  const { pathname, search } = useLocation();
  if (isLadder(pathname))
    return {
      path: pathname,
      section: "ladder",
      sec: LADDER_SECTION,
      here: ladderHere(pathname),
      search: search ?? {},
    };
  if (isSettings(pathname))
    return {
      path: pathname,
      section: "settings",
      sec: SETTINGS_SECTION,
      here: { rail: "settings", ...settingsHere(pathname) },
      search: search ?? {},
    };
  if (pathname === SERVICE_STATUS)
    return {
      path: pathname,
      section: "status",
      sec: SECTIONS.status,
      activePage: "service",
      here: {},
      search: search ?? {},
    };
  // Segments are read on the app path (the prefix off); `path` stays the
  // real one, since it is what the page keys and titles on.
  const app = appPath(pathname) ?? "";
  const [, section, page, itemId, recordId] = app.split("/");
  const sec = SECTIONS[section];
  const activePage = sec?.pages.find((p) => p.slug === page)?.slug;
  const here = railPosition(pathname);
  return {
    path: pathname,
    section,
    sec,
    activePage,
    here,
    itemId,
    recordId,
    search: search ?? {},
  };
}

/** The app is its own providers: one query cache and one router per
 *  mount, so a test that renders <App /> gets a fresh one and the
 *  session and address it sets up are the ones it sees. */
export function createAppRuntime({
  url = null,
  me = null,
  clanMe = null,
  renderedAt = Date.now(),
} = {}) {
  const queryClient = createQueryClient();
  if (me) queryClient.setQueryData(["me"], me);
  if (clanMe) queryClient.setQueryData(["me", "clan"], clanMe);
  const router = createRouter({
    routeTree,
    origin:
      typeof window === "undefined"
        ? "https://elixir.poapkings.com"
        : window.location.origin,
    history: url
      ? createMemoryHistory({ initialEntries: [url] })
      : createBrowserHistory(),
    // The same universal route tree is rendered on each side. We serialize
    // only our query data, avoiding the router's experimental streaming API.
    isServer: false,
    defaultPreload: false,
    scrollRestoration: !url,
  });
  return { queryClient, router, renderedAt };
}

export function App({ runtime = null }) {
  const signInProgress = useState(false);
  const [state] = useState(() => runtime ?? createAppRuntime());
  const { queryClient, router } = state;
  return (
    <InitialTimeProvider at={state.renderedAt}>
      <SignInProgress.Provider value={signInProgress}>
        <QueryClientProvider client={queryClient}>
          <CardArtSource>
            <RouterProvider router={router} />
          </CardArtSource>
        </QueryClientProvider>
      </SignInProgress.Provider>
    </InitialTimeProvider>
  );
}

/** The session, as a query. `answered` makes a stall in front of the
 *  edge the ONE thing that rejects, so the client's retry rule - one
 *  quiet retry after 1.5 s - applies to it and to nothing else: if the
 *  API answered "not signed in", that is the answer. A view that
 *  changes the session (sign in, a claim, a timezone) invalidates
 *  ["me"] and every rail count follows. */
export function useMe() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["me"],
    queryFn: answered(api.me),
  });
  const { refetch } = query;
  const refresh = useCallback(async () => {
    const r = await refetch();
    await queryClient.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "me" && q.queryKey.length > 1,
    });
    return r.data?.data ?? null;
  }, [refetch, queryClient]);
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["me"] }),
    [queryClient],
  );
  // While the first answer is pending the session is unknown (null);
  // after a failed first answer it reads as signed out AND unreachable,
  // and the page says Elixir did not answer rather than "sign in first"
  // about a session it could not check. A failed REFETCH keeps the last
  // known session, which is what the old code's `prev ??` did.
  const me =
    query.data?.data ?? (query.isError ? { authenticated: false } : null);
  return {
    me,
    unreachable: query.isError || (query.data?.status ?? 0) >= 500,
    retrying: query.isFetching,
    refresh,
    invalidate,
  };
}

/** Clan's rail and pages in the shell, with its own session query beside this
 *  one for the bar. */
function ClanFrame({ children }) {
  const { me, unreachable } = useMe();
  return (
    <ShellFrame
      me={unreachable ? null : me}
      unreachable={unreachable}
      area="clan"
    >
      {children}
    </ShellFrame>
  );
}

function Shell() {
  const { pathname, hash } = useLocation();
  // Nothing at this address brings its own shell (MissingPage).
  if (legalRoute(movedTo(pathname, hash) ?? pathname) === null)
    return <Outlet />;
  if (isHome(pathname)) return <HomeOutlet />;
  return isClan(pathname) ? <SharedClanOutlet /> : <ConsoleShell />;
}

/** Home's shell. Signed out it is the wall, which returns here after sign-in. */
function HomeOutlet() {
  const navigate = useNav();
  const { pathname } = useLocation();
  const { me, unreachable, retrying, refresh } = useMe();
  useEffect(() => {
    document.title = titleFor("home", null, pathname);
  }, [pathname]);
  const authed = me?.authenticated === true;
  return (
    <ZoneProvider zone={me?.timezone}>
      <NavigateProvider navigate={navigate}>
        <AppShell
          me={unreachable ? null : me}
          unreachable={unreachable}
          area="home"
        >
          <ErrorBoundary key={pathname}>
            {authed ? (
              <Outlet />
            ) : unreachable ? (
              <Unavailable busy={retrying} onRetry={refresh} />
            ) : me === null ? (
              <div className="kit-skeleton" aria-busy="true" />
            ) : (
              <SignInWall navigate={navigate} />
            )}
          </ErrorBoundary>
        </AppShell>
      </NavigateProvider>
    </ZoneProvider>
  );
}

function SharedClanOutlet() {
  const { me } = useMe();
  const navigate = useNav();
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = titleFor("clan", null, pathname);
  }, [pathname]);
  return (
    <ZoneProvider zone={me?.timezone}>
      <NavigateProvider navigate={navigate}>
        <Outlet />
      </NavigateProvider>
    </ZoneProvider>
  );
}

function ConsoleShell() {
  const navigate = useNav();
  const { me, unreachable, retrying, refresh } = useMe();
  const narrow = useNarrow();
  const { path: effectivePath, section, sec, here } = useHere();

  const authed = me?.authenticated === true;

  useEffect(() => {
    // A battle's page and a post's name themselves once they have loaded.
    if (BATTLE_PATH.test(effectivePath) || POST_PATH.test(effectivePath))
      return;
    document.title = titleFor(section, sec, effectivePath);
  }, [section, sec, effectivePath]);

  // Counts on the rail are the reader's own things, derived once here so two
  // screens cannot disagree (house rule). Omitted while /api/me has not
  // answered. The one dot is an alert on Connections while a credential that
  // no longer works is still being presented: the one thing on this rail that
  // wants you before you go looking.
  const counts = {};
  if (me?.signals?.tracking !== undefined)
    counts.players = String(me.signals.tracking);
  const dots = {
    connections:
      me?.signals?.refusals_7d > 0
        ? {
            tone: "alert",
            title: "A credential that no longer works is still being presented",
          }
        : null,
  };
  const inSettings = section === "settings";
  const gateways = useMyGateways({ enabled: authed && inSettings });
  const runsCollector = (gateways.data?.gateways ?? []).length > 0;

  const needsAuth = sec?.authed && !authed && me !== null && !unreachable;
  const showUnavailable = sec?.authed && !authed && unreachable;
  const showRail = authed && !needsAuth && Boolean(here.key);
  // Ladder has a scope bar and tabs in the page, and no rail (step 5).
  const railed = showRail && here.product !== "ladder";

  // Every time a page prints is on the account's clock: the zone
  // set on Profile, or UTC when none is (Jamie, 2026-09-23). A new
  // account opens on its signup browser's zone (Jamie, 2026-10-08).
  return (
    <ZoneProvider zone={me?.timezone}>
      <NavigateProvider navigate={navigate}>
        <ShellFrame
          me={unreachable ? null : me}
          unreachable={unreachable}
          area={barArea(effectivePath)}
        >
          <div
            className={`kit-frame mx-auto flex w-full max-w-page flex-auto items-stretch ${narrow ? "flex-col" : "flex-row"}`}
          >
            {railed ? (
              <Rail
                me={me}
                here={here}
                navigate={navigate}
                narrow={narrow}
                counts={counts}
                dots={dots}
                runsCollector={runsCollector}
              />
            ) : null}

            <main className="page">
              <div
                className={`page__inner${railed ? "" : " page__inner--solo"}`}
              >
                {/* Keyed on the route: a boundary that has caught stays caught, so
                without this a single bad page would keep showing its error after
                you navigated away from it. */}
                <ErrorBoundary key={effectivePath}>
                  {showUnavailable ? (
                    <Unavailable busy={retrying} onRetry={refresh} />
                  ) : needsAuth ? (
                    <SignInWall navigate={navigate} />
                  ) : (
                    <Outlet />
                  )}
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </ShellFrame>
      </NavigateProvider>
    </ZoneProvider>
  );
}
