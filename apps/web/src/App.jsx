import {
  Chrome as ChromeBar,
  Disclaimer,
  ErrorBoundary,
  FAMILY_PRODUCTS,
  FAMILY_WORDMARK,
  Icon,
  Rail as RailList,
  RailIdentity,
  familyTabs,
} from "@elixir-mcp/ui";
import { useEffect, useState, useCallback } from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  notFound,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { answered, createQueryClient } from "@elixir-mcp/client";
import { api } from "./api.js";
import { SignIn } from "./views/SignIn.jsx";

/**
 * Shell + rail (design handoff 2026-09-09). The three-tier top nav is
 * gone: sections live in a 256px rail down the left, because the console
 * grew past what a horizontal row can hold without truncating or hiding
 * things behind a menu.
 *
 * Two rules from the handoff shape everything here.
 *
 * The TOP BAR CARRIES NO SIGNED-IN STATE. It must render identically in
 * the Eleventy build and in this app — the two halves are cached
 * differently and cannot agree on a shape that varies by session, and
 * when they tried, the "same" nav kept arriving with different items in
 * it and read as a glitch. Session identity lives at the foot of the
 * rail, which only this half renders.
 *
 * The RAIL CARRIES STRUCTURE, NEVER USER CONTENT. Sections and
 * sub-pages, never the name of a player or a clan: the rail must not
 * grow when the data does. A count of the reader's own things is the one
 * exception, because it is a number and not a list.
 *
 * This app is the site's DYNAMIC half (2026-09-07 split). Home, docs,
 * updates (each one its own page) are real documents built by apps/site
 * and served from the same hostname; they are reached with plain hrefs
 * (STATIC_LINKS below), which are full page loads on purpose. Anything
 * the app does not recognise leaves for the static home rather than
 * rendering an empty main.
 */

/** Paths owned by the static site. The edge router in infra/template.yaml
 *  holds the same list; a test pins the two together, because a path in
 *  one and not the other is either a dead link or an app shell served
 *  where a document was expected. */
export const STATIC_LINKS = {
  home: "/",
  data: "/data",
  examples: "/examples/play",
  docs: "/docs",
  updates: "/updates",
  family: "/family",
  support: "/support",
};

/** The top bar's tabs: the kit's family list, on this host as bare paths.
 *  Identical in both builds by construction: every one is a document
 *  apps/site builds, and a test pins them to STATIC_LINKS. */
const CHROME_TABS = familyTabs();

/**
 * Sections and their pages — the app's route table.
 *
 * The rail is built from RAIL below rather than from this, because the
 * two answer different questions: this one says which paths resolve,
 * that one says what the reader is offered and in what order.
 */
export const SECTIONS = {
  account: {
    label: "Account",
    authed: true,
    pages: [
      { slug: "overview", label: "Overview" },
      { slug: "tracking", label: "Tracking" },
      { slug: "verify", label: "Verify" },
      { slug: "collections", label: "Collections" },
      { slug: "activity", label: "Activity" },
      { slug: "usage", label: "Usage" },
      { slug: "connections", label: "Connections" },
      { slug: "agents", label: "Agents" },
      { slug: "profile", label: "Profile" },
      { slug: "feedback", label: "Feedback" },
    ],
  },
  explore: { label: "Explore", authed: true, pages: [] },
  status: {
    label: "Status",
    authed: true,
    pages: [
      { slug: "service", label: "Status" },
      { slug: "collectors", label: "Collectors" },
    ],
  },
  admin: {
    label: "Admin",
    authed: true,
    adminOnly: true,
    pages: [
      { slug: "requests", label: "Requests" },
      { slug: "accounts", label: "Accounts" },
      { slug: "integrations", label: "Integrations" },
      { slug: "connections", label: "Connections" },
      { slug: "collections", label: "Collections" },
      { slug: "feedback", label: "Feedback" },
      { slug: "usage", label: "Across accounts" },
      { slug: "collectors", label: "Collectors", ownerOnly: true },
      { slug: "service-tokens", label: "Service tokens", ownerOnly: true },
    ],
  },
  data: {
    label: "Data",
    authed: false,
    // /data itself is the site's corpus page now, not this section's
    // index: it is a real document, crawlable and readable with no
    // session, so the app must hand the bare path back.
    staticIndex: true,
    pages: [{ slug: "dashboard", label: "Charts" }],
  },
};

/**
 * The rail, top to bottom, in four groups — the reading order the design
 * specifies, which is not the same as the route table's shape.
 *
 * `subs` render only while their section is current, which is why
 * Service ▸ Collectors and Admin ▸ Collectors can share a label without
 * ever being visible at once: the house rule is that no two items the
 * reader can see at the same moment share one.
 */
const ADMIN_SUBS = [
  ["requests", "Requests", "/admin/requests"],
  ["accounts", "Accounts", "/admin/accounts"],
  // Bare "Connections" and "Collections" here, though Account has items
  // by those names too (Jamie, 2026-09-10: "crazy long and odd"). The
  // house rule against two identical labels on screen at once is about
  // AMBIGUITY, and these are not ambiguous: admin sub-items render
  // indented under the Admin row that is one line above them, so the
  // qualifier the long label was carrying is already on screen. The
  // page's own crumb says Admin as well.
  ["connections", "Connections", "/admin/connections"],
  ["collectors", "Collectors", "/admin/collectors", "owner"],
  ["service-tokens", "Service tokens", "/admin/service-tokens", "owner"],
  ["integrations", "Integrations", "/admin/integrations"],
  ["collections", "Collections", "/admin/collections"],
  // "Feedback queue", not "Feedback": Access > Feedback is a top-level
  // item and stays visible while Admin is open, so the bare word would
  // put two identical labels on screen at once — the thing that broke
  // navigation twice during design. The design's own remedy for the
  // same clash on Usage was to name whose it is ("Across accounts"),
  // and its docs map already calls this page the feedback queue.
  ["feedback", "Feedback queue", "/admin/feedback"],
  ["usage", "Across accounts", "/admin/usage"],
];

export const RAIL = [
  {
    key: "overview",
    label: "Overview",
    icon: "layout-dashboard",
    to: "/account/overview",
  },
  {
    key: "explore",
    label: "Explore",
    icon: "search",
    to: "/explore",
    subs: [
      ["players", "Players", "/explore/players"],
      ["clans", "Clans & wars", "/explore/clans"],
      ["meta", "Meta & decks", "/explore/meta"],
      ["weeks", "War weeks", "/explore/weeks"],
    ],
  },
  {
    group: "Your record",
    key: "tracking",
    label: "Tracking",
    icon: "radar",
    to: "/account/tracking",
  },
  // Proving a claim is a step in your record, next to what you track.
  {
    key: "verify",
    label: "Verify",
    icon: "shield-check",
    to: "/account/verify",
  },
  {
    key: "collections",
    label: "Collections",
    icon: "bookmark",
    to: "/account/collections",
  },
  {
    key: "activity",
    label: "Activity",
    icon: "activity",
    to: "/account/activity",
    subs: [
      ["timeline", "Timeline", "/account/activity"],
      ["requests", "MCP requests", "/account/activity/requests"],
      ["events", "Account events", "/account/activity/events"],
    ],
  },
  { key: "usage", label: "Usage", icon: "chart-column", to: "/account/usage" },
  {
    group: "Access",
    key: "connections",
    label: "Connections",
    icon: "plug",
    to: "/account/connections",
    subs: [
      ["clients", "Clients", "/account/connections"],
      ["agents", "Agents", "/account/agents"],
    ],
  },
  {
    key: "profile",
    label: "Profile",
    icon: "user-round",
    to: "/account/profile",
  },
  {
    key: "feedback",
    label: "Feedback",
    icon: "message-square",
    to: "/account/feedback",
  },
  {
    group: "Service",
    key: "status",
    label: "Status",
    icon: "heart-pulse",
    to: "/status/service",
    subs: [["collectors", "Collectors", "/status/collectors"]],
  },
  {
    key: "admin",
    label: "Admin",
    icon: "shield-check",
    to: "/admin/requests",
    meta: "owner",
    adminOnly: true,
    subs: ADMIN_SUBS,
  },
];

/** Which rail item and sub-item a path belongs to. One function, so the
 *  mark in the rail and the docs strip's key can never disagree about
 *  where the reader is. */
export function railPosition(path) {
  const [, section, page, rest] = path.split("/");
  // `doc` names the docs-strip entry when a RECORD page sits under a rail
  // item: the rail still marks the item (and sub-item) the record belongs
  // to, but the strip at its foot is the record's own, because "how do I
  // read this" is a different question from "what is this section".
  if (section === "explore") {
    const kinds = ["players", "clans", "meta", "weeks"];
    if (kinds.includes(page)) return { key: "explore", sub: page };
    if (page === "player" && rest)
      return { key: "explore", doc: "explore:player" };
    if (page && rest) return { key: "explore", doc: "explore:record" };
    return { key: "explore" };
  }
  if (section === "status")
    return {
      key: "status",
      sub: page === "collectors" ? "collectors" : undefined,
      // A record and the raise form both read the operators guide.
      ...(page === "collectors" && rest ? { doc: "status:collector" } : {}),
    };
  if (section === "admin") return { key: "admin", sub: page ?? "requests" };
  // The in-app charts are the corpus in detail, reached from the site's
  // /data page. They sit under Explore in the rail rather than nowhere:
  // losing the whole navigation on one route is worse than putting a
  // page under the nearest section that is honestly about reading the
  // record.
  if (section === "data" && page === "dashboard") return { key: "explore" };
  if (section === "account") {
    // /account/activity/c/<request_id> is a call record and belongs to
    // MCP requests rather than being a sub-page of its own.
    if (page === "activity")
      return {
        key: "activity",
        sub: rest === "c" ? "requests" : (rest ?? "timeline"),
        ...(rest === "c" ? { doc: "activity:call" } : {}),
      };
    if (page === "connections") return { key: "connections", sub: "clients" };
    // The agent record is addressable in its own right, but it belongs
    // to Connections in the rail: an agent IS a connection.
    if (page === "agents") return { key: "connections", sub: "agents" };
    // /account/tracking/<tag> is a record of a tracked thing, which
    // belongs to Tracking rather than being a section of its own.
    if (page === "tracking" && rest)
      return { key: "tracking", doc: "tracking:record" };
    return { key: page ?? "overview" };
  }
  return {};
}

/**
 * One doc map for the whole console, keyed by rail item or `item:sub`.
 * Every console page has an entry — the strip is only consistent if
 * nothing falls through to a generic index link, which is exactly what
 * it replaced.
 */
export const DOC_LINKS = {
  overview: [
    "Getting started",
    [
      ["Quickstart", "/docs/quickstart"],
      ["Tiers & roles", "/docs/roles"],
      ["How recording works", "/docs/recording"],
    ],
  ],
  explore: [
    "Reading the record",
    [
      ["Methodology", "/docs/methodology"],
      ["Tool reference", "/docs/tools"],
      ["Responses", "/docs/responses"],
    ],
  ],
  // A record page names the tool that produced it; its strip points at
  // how to read what came back.
  "explore:player": [
    "Player records",
    [
      ["players_summary", "/docs/tools/players#players_summary"],
      ["Methodology", "/docs/methodology"],
    ],
  ],
  "explore:record": [
    "Reading a record",
    [
      ["Responses", "/docs/responses"],
      ["Coverage", "/docs/responses#coverage-and-result-limits"],
      ["Methodology", "/docs/methodology"],
    ],
  ],
  collections: [
    "Collections",
    [
      ["How recording works", "/docs/recording"],
      ["collections_edit", "/docs/tools/collections"],
      ["Tiers & slots", "/docs/roles"],
    ],
  ],
  tracking: [
    "What we record for you",
    [
      ["How recording works", "/docs/recording"],
      ["Scopes", "/docs/recording#scope-what-is-actually-polled"],
      ["Tiers & slots", "/docs/roles"],
    ],
  ],
  verify: [
    "Proving a claim",
    [
      ["Verify", "/docs/verify"],
      [
        "Claims and relationships",
        "/docs/recording#relationships-primary-nicknames",
      ],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  // The record of one tracked thing: the page with the notify switch on
  // it links to what a notification is.
  "tracking:record": [
    "What we record for you",
    [
      ["How recording works", "/docs/recording"],
      ["Battle activity", "/docs/activity"],
      ["Timeline", "/docs/timeline"],
    ],
  ],
  "activity:timeline": [
    "Timeline",
    [
      ["The timeline", "/docs/timeline"],
      ["elixir_timeline", "/docs/tools/timeline#elixir_timeline"],
    ],
  ],
  "activity:requests": [
    "The MCP surface",
    [
      ["Protocol", "/docs/protocol"],
      ["Limits", "/docs/limits"],
      ["Responses", "/docs/responses"],
    ],
  ],
  // The record of one call: what the request and response mean, and
  // how long the body is kept.
  "activity:call": [
    "One call",
    [
      ["Response envelope", "/docs/responses#the-fields"],
      ["Retention", "/docs/limits#retention-windows"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "activity:events": [
    "Your account log",
    [
      ["Privacy", "/docs/privacy"],
      ["Tiers & roles", "/docs/roles"],
    ],
  ],
  usage: [
    "Budgets",
    [
      ["Limits", "/docs/limits"],
      ["Live fetch", "/docs/tools/live"],
      ["Run a collector", "/docs/operators"],
    ],
  ],
  "connections:clients": [
    "Connections",
    [
      ["Connections", "/docs/connections"],
      ["Protocol & auth", "/docs/protocol"],
      ["Scopes", "/docs/protocol#scopes"],
    ],
  ],
  "connections:agents": [
    "Agents",
    [
      ["Agents", "/docs/agents"],
      ["Key lifecycle", "/docs/agents#key-lifecycle"],
      ["Identity map", "/docs/agents#knowing-which-human-is-asking"],
    ],
  ],
  profile: [
    "Your account",
    [
      ["Tiers & roles", "/docs/roles"],
      ["Limits", "/docs/limits"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  feedback: [
    "Feedback",
    [
      ["About the project", "/docs/about"],
      ["elixir_feedback", "/docs/tools/help#elixir_feedback"],
    ],
  ],
  "status:collectors": [
    "Collectors",
    [
      ["Operators guide", "/docs/operators"],
      ["Architecture", "/docs/architecture#collectors-in-depth"],
    ],
  ],
  // One collector's record: the page an operator reads while running one.
  "status:collector": [
    "Running a collector",
    [
      ["Operators guide", "/docs/operators"],
      ["The job ledger", "/docs/architecture#collectors-in-depth"],
      ["Budgets", "/docs/limits"],
    ],
  ],
  status: [
    "How the service runs",
    [
      ["Architecture", "/docs/architecture"],
      ["Collectors", "/docs/operators"],
      ["Limits", "/docs/limits"],
    ],
  ],
  "admin:requests": [
    "Admission",
    [
      ["Tiers & roles", "/docs/roles"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "admin:accounts": [
    "Accounts & tiers",
    [
      ["Tiers & roles", "/docs/roles"],
      ["Limits", "/docs/limits"],
    ],
  ],
  "admin:collectors": [
    "Collector fleet",
    [
      ["Operators guide", "/docs/operators"],
      ["Architecture", "/docs/architecture#collectors-in-depth"],
      ["The job ledger", "/docs/architecture#collectors-in-depth"],
    ],
  ],
  "admin:connections": [
    "Connections",
    [
      ["Connections", "/docs/connections"],
      ["Protocol & auth", "/docs/protocol"],
      ["Tiers & roles", "/docs/roles"],
    ],
  ],
  "admin:service-tokens": [
    "Service keys",
    [
      ["Connections", "/docs/connections"],
      ["Protocol & auth", "/docs/protocol"],
    ],
  ],
  "admin:integrations": [
    "Integrations",
    [
      ["Integrations", "/docs/integrations"],
      ["Integration API", "/docs/integrations#provisioning-and-administration"],
    ],
  ],
  "admin:collections": [
    "Collections",
    [
      ["Collections", "/docs/recording#collections"],
      ["How recording works", "/docs/recording"],
    ],
  ],
  "admin:feedback": ["Feedback queue", [["About the project", "/docs/about"]]],
  "admin:usage": [
    "Usage across accounts",
    [
      ["Limits", "/docs/limits"],
      ["Architecture", "/docs/architecture"],
    ],
  ],
};

const REDIRECTS = {
  "/dashboard": "/account/overview",
  "/clan": "/explore",
  "/account": "/account/overview",
  // Settings & tier folded into the profile (2026-09-10).
  "/account/settings": "/account/profile",
  "/admin": "/admin/requests",
  "/explore/player": "/explore",
  "/explore/clan": "/explore",
  "/explore/collections": "/explore",
  // Moved by the 2026-09-09 IA: Status left the Data section for its own
  // Service group, the collector record left Account for the fleet, and
  // two Admin pages took their product names.
  "/status": "/status/service",
  "/data/status": "/status/service",
  "/account/collector": "/status/collectors",
  "/admin/gateways": "/admin/collectors",
  "/admin/tokens": "/admin/service-tokens",
};

/** Guard restored/bookmarked routes: a stale path to a removed section
 *  must fall back to a known-good route, never an empty main. Anything
 *  this app no longer owns returns null, and the caller leaves for the
 *  static home with a real navigation. */
export function legalRoute(path) {
  const [, section, page] = path.split("/");
  if (path === "/signin") return path;
  const sec = SECTIONS[section];
  if (!sec) return null;
  // Explore's records are addressable, so it resolves its own paths.
  if (section === "explore") return path;
  // A static page can sit inside an app section (Data > Changelog). It
  // belongs to the other half, so hand it back rather than quietly
  // substituting the section's default page.
  if (sec.pages.some((p) => p.slug === page && p.static)) return null;
  if (!page && sec.staticIndex) return null;
  const appPages = sec.pages.filter((p) => !p.static);
  if (appPages.length === 0) return `/${section}`;
  if (appPages.some((p) => p.slug === page)) return path;
  return `/${section}/${appPages[0].slug}`;
}

/** Tab titles. The distinguishing word goes FIRST, because a browser
 *  tab truncates from the right - "Elixir MCP - Status" is useless at
 *  tab width, "Status - Elixir MCP" is not. Sections that own their own
 *  sub-pages (explore records, docs) name the record instead. */
const SITE = "Elixir MCP";
const prettify = (seg) =>
  /^[#%]/.test(seg)
    ? decodeURIComponent(seg)
    : decodeURIComponent(seg)
        .replace(/-/g, " ")
        .replace(/^./, (c) => c.toUpperCase());

export function titleFor(section, sec, path) {
  const parts = path.split("/").filter(Boolean);
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
  return useCallback(
    (to) => {
      const [pathname, qs] = String(to).split("?");
      return nav({
        to: pathname,
        search: qs ? Object.fromEntries(new URLSearchParams(qs)) : {},
      });
    },
    [nav],
  );
}

/** True below the one breakpoint the whole product uses. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.("(max-width: 900px)").matches ?? false,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 900px)");
    if (!mq?.addEventListener) return;
    const on = (e) => setNarrow(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** The top bar: the kit's Chrome with the family's tabs and product
 *  buttons; we are the Console, so that one is green and routes in-app.
 *  The Console button is a place, not a state: signed out it lands on
 *  the sign-in wall, which is the honest answer. Never inside the menu,
 *  at any width: burying it behind a button costs a tap on the one
 *  thing most people came for. */
const PRODUCTS = FAMILY_PRODUCTS.map((p) =>
  p.key === "console" ? { ...p, href: "/account/overview" } : p,
);
function Chrome({ navigate }) {
  const products = PRODUCTS.map((p) =>
    p.key === "console"
      ? {
          ...p,
          onClick: (e) => {
            e.preventDefault();
            navigate("/account/overview");
          },
        }
      : p,
  );
  return (
    <ChromeBar
      wordmark={FAMILY_WORDMARK}
      home={STATIC_LINKS.home}
      tabs={CHROME_TABS}
      products={products}
      current="console"
      menu
    />
  );
}

/** The rail: the kit's, fed the console's route table. Items are the
 *  RAIL config filtered by who is looking (admin pages for admins,
 *  owner pages for the owner), with the reader's counts and the two
 *  dots attached by key; the identity block is the way to the profile
 *  and the way out. */
function Rail({ me, here, navigate, narrow, counts, dots = {} }) {
  const items = RAIL.filter((r) => !r.adminOnly || me?.is_admin).map((row) => ({
    key: row.key,
    label: row.label,
    icon: row.icon,
    to: row.to,
    group: row.group,
    meta: row.meta ?? counts[row.key],
    dot: dots[row.key] ?? null,
    subs: (row.subs ?? [])
      .filter(([, , , ownerOnly]) => !ownerOnly || me?.is_owner)
      .map(([slug, label, to]) => ({ slug, label, to })),
  }));
  return (
    <RailList
      label="Console sections"
      items={items}
      current={here.key}
      sub={here.sub}
      navigate={navigate}
      narrow={narrow}
      title="Console"
      aside={me?.role ?? ""}
      identity={
        <RailIdentity
          href="/account/profile"
          onClick={(e) => {
            e.preventDefault();
            navigate("/account/profile");
          }}
          // The address, as the design draws it: account.email has held
          // it since 0046. An account from before that fills in at its
          // next sign-in and reads "Signed in" until then.
          name={me?.email ?? "Signed in"}
          title={me?.email ?? undefined}
          detail={[me?.role, me?.timezone].filter(Boolean).join(" · ")}
          action={
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              className="btn btn--sm"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await api.signOut();
                window.location.assign(STATIC_LINKS.home);
              }}
            >
              <Icon name="log-out" size={16} />
            </button>
          }
        />
      }
    />
  );
}

/** The foot of every console page: one slot, one shape, one map. An
 *  ad-hoc "learn more" in a different place on each screen is what this
 *  replaced, so a page with no entry is a bug rather than a fallback. */
function DocsStrip({ here }) {
  const entry =
    (here.doc && DOC_LINKS[here.doc]) ??
    DOC_LINKS[here.sub ? `${here.key}:${here.sub}` : here.key] ??
    DOC_LINKS[here.key];
  if (!entry) return null;
  const [topic, links] = entry;
  return (
    <footer className="page__docs">
      <span className="flex items-center gap-[9px] text-ink-faint">
        <Icon name="book-open" size={16} />
        <span className="label">Docs · {topic}</span>
      </span>
      <span className="flex flex-wrap gap-2">
        {links.map(([label, href]) => (
          <a className="btn btn--sm" key={href} href={href}>
            {label}
          </a>
        ))}
      </span>
      <a className="ml-auto text-[13px]" href={STATIC_LINKS.docs}>
        All docs ›
      </a>
    </footer>
  );
}

export function SignInWall({ navigate }) {
  return (
    <div className="panel mx-auto mt-12 max-w-[420px]">
      <div className="panel__body text-center">
        <h1 className="page__title mb-2">Sign in first</h1>
        <p className="text-[13px] text-ink-faint">
          This part of Elixir MCP shows your recorded history. Sign in with the
          email on your access request.
        </p>
        <button className="btn mt-2" onClick={() => navigate("/signin")}>
          Sign in
        </button>
      </div>
    </div>
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
 * The route tree. The root's beforeLoad is the old route guard as a
 * real one: a path this app does not own leaves for the static site
 * (Back never bounces between the halves because the entry is
 * replaced), and a legacy or partial path is REDIRECTED - the address
 * bar changes with it, which the render-only REDIRECTS never did, so a
 * bookmark to /data/status now credits /status/service in the report.
 *
 * Sections are split by route: Admin, Explore, Status and the Account
 * pages each arrive as their own chunk, so the sign-in wall does not
 * carry the admin console with it.
 */
const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    const path = location.pathname;
    const owned = legalRoute(REDIRECTS[path] ?? path);
    if (owned === null) {
      window.location.replace(STATIC_LINKS.home);
      throw notFound();
    }
    if (owned !== path)
      throw redirect({ to: owned, search: location.search, replace: true });
  },
  component: Shell,
  notFoundComponent: () => null,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signin",
  component: function SignInPage() {
    const navigate = useNav();
    const { refresh } = useMe();
    return (
      <SignIn
        onAuthed={async () => {
          await refresh();
          navigate("/account/overview");
        }}
      />
    );
  },
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account/{-$page}/{-$itemId}/{-$recordId}",
  component: lazyRouteComponent(
    () => import("./pages/AccountPage.jsx"),
    "AccountPage",
  ),
});

const exploreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/explore/$",
  component: lazyRouteComponent(
    () => import("./pages/ExplorePage.jsx"),
    "ExplorePage",
  ),
});

const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status/{-$page}/{-$itemId}",
  component: lazyRouteComponent(
    () => import("./pages/StatusPage.jsx"),
    "StatusPage",
  ),
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/{-$page}/{-$itemId}",
  component: lazyRouteComponent(
    () => import("./pages/AdminPage.jsx"),
    "AdminPage",
  ),
});

const dataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/data/{-$page}",
  component: lazyRouteComponent(() => import("./views/Data.jsx"), "Data"),
});

export const routeTree = rootRoute.addChildren([
  signInRoute,
  accountRoute,
  exploreRoute,
  statusRoute,
  adminRoute,
  dataRoute,
]);

/** Where a route is on the rail and in the route table, from its path:
 *  the section, its page (validated against SECTIONS, so a stale slug
 *  falls back to the section's first page), the rail position, the
 *  ids. Route components read this rather than re-deriving it. */
export function useHere() {
  const { pathname } = useLocation();
  const [, section, page, itemId, recordId] = pathname.split("/");
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
  };
}

/** The app is its own providers: one query cache and one router per
 *  mount, so a test that renders <App /> gets a fresh one and the
 *  session and address it sets up are the ones it sees. */
export function App() {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() =>
    createRouter({
      routeTree,
      history: createBrowserHistory(),
      defaultPreload: false,
      scrollRestoration: true,
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
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
    return r.data?.data ?? null;
  }, [refetch]);
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
    unreachable: query.isError,
    retrying: query.isFetching,
    refresh,
    invalidate,
  };
}

function Shell() {
  const navigate = useNav();
  const { me, unreachable, retrying, refresh } = useMe();
  const narrow = useNarrow();
  const { path: effectivePath, section, sec, here } = useHere();

  const authed = me?.authenticated === true;

  useEffect(() => {
    document.title = titleFor(section, sec, effectivePath);
  }, [section, sec, effectivePath]);

  /** Counts on rail items are the reader's own things, derived once here
   *  so two screens cannot disagree about them (house rule: derive
   *  shared numbers once). Omitted rather than guessed while /api/me has
   *  not answered. */
  const counts = {};
  if (Array.isArray(me?.claims))
    counts.tracking = String(
      me.claims.length +
        (me.entitlements?.activity_clans?.used ?? 0) +
        (me.entitlements?.comprehensive_clans?.used ?? 0),
    );
  // A tier with no collections shows no count: "0" would invite a click
  // the page then refuses.
  if (me?.entitlements?.collections && me.entitlements.collections.limit !== 0)
    counts.collections = String(me.entitlements.collections.used ?? 0);
  if (me?.signals) {
    counts.connections = String(me.signals.connections ?? 0);
    if (me.signals.feedback > 0) counts.feedback = String(me.signals.feedback);
  }
  /** The two dots the design puts on the rail: unread on Activity while
   *  the feed holds events no connection has read, and an alert on
   *  Connections while a credential that no longer works is still being
   *  presented — the one thing on this rail that wants you before you
   *  go looking. */
  const dots = {
    activity:
      me?.signals?.timeline_pending > 0
        ? { tone: "unread", title: "Unread notifications" }
        : null,
    connections:
      me?.signals?.refusals_7d > 0
        ? {
            tone: "alert",
            title: "A credential that no longer works is still being presented",
          }
        : null,
  };

  const needsAuth = sec?.authed && !authed && me !== null && !unreachable;
  const showUnavailable = sec?.authed && !authed && unreachable;
  const showRail =
    authed && !needsAuth && effectivePath !== "/signin" && Boolean(here.key);

  return (
    <div className="shell">
      <Chrome navigate={navigate} />

      <div
        className={`mx-auto flex w-full max-w-page flex-auto items-stretch ${narrow ? "flex-col" : "flex-row"}`}
      >
        {showRail && (
          <Rail
            me={me}
            here={here}
            navigate={navigate}
            narrow={narrow}
            counts={counts}
            dots={dots}
          />
        )}

        <main className="page">
          <div className={`page__inner${showRail ? "" : " page__inner--solo"}`}>
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
            {showRail && <DocsStrip here={here} />}
          </div>
        </main>
      </div>

      <Disclaimer />
    </div>
  );
}
