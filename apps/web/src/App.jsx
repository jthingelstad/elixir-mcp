import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import { Icon } from "./components/Icon.jsx";
import { SignIn } from "./views/SignIn.jsx";
import { Dashboard } from "./views/Dashboard.jsx";
import { Admin } from "./views/Admin.jsx";
import { Data } from "./views/Data.jsx";
import { Explore } from "./views/Explore.jsx";
import { Status } from "./views/Status.jsx";
import { Fleet } from "./views/Collectors.jsx";
import { CollectorPage } from "./views/CollectorDetail.jsx";
import { RaiseCollector } from "./views/RaiseCollector.jsx";
import { ErrorBoundary } from "./ErrorBoundary.jsx";

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

/** The top bar. Identical in both builds by construction: it names only
 *  pages that exist on both sides of the split and carries no session.
 *  The design's Examples and Family tabs arrive with those pages. */
const CHROME_TABS = [
  ["Home", "/"],
  ["Data", "/data"],
  ["Examples", "/examples/play"],
  ["Updates", "/updates"],
  ["Docs", "/docs"],
  ["Family", "/family"],
  ["Support", "/support"],
];

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
      ["notifications", "Notifications", "/account/activity"],
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
    // /account/activity/n/<id> is a notification record, which belongs
    // to the Notifications sub-page rather than being one of its own;
    // /account/activity/c/<request_id> is a call record and belongs to
    // MCP requests the same way.
    if (page === "activity")
      return {
        key: "activity",
        sub:
          rest === "n"
            ? "notifications"
            : rest === "c"
              ? "requests"
              : (rest ?? "notifications"),
        ...(rest === "n" ? { doc: "activity:notification" } : {}),
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
  // The record of one tracked thing: the page with the notify switch on
  // it links to what a notification is.
  "tracking:record": [
    "What we record for you",
    [
      ["How recording works", "/docs/recording"],
      ["Notifications", "/docs/events"],
    ],
  ],
  "activity:notifications": [
    "Notifications",
    [
      ["Events & the feed", "/docs/events"],
      ["elixir_events", "/docs/tools/feed#elixir_events"],
    ],
  ],
  "activity:notification": [
    "Notifications",
    [
      ["Events & the feed", "/docs/events"],
      ["Response envelope", "/docs/responses#the-fields"],
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

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to) => {
    window.history.pushState({}, "", to);
    // The route is the path; a query string rides along in the URL for
    // the page to read (a feedback prefill) and never reaches the
    // section/page/id split.
    setPath(to.split("?")[0]);
  }, []);
  return { path, navigate };
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

/** The top bar. No session, by design — see the note at the head of the
 *  file. The Console button is a place, not a state: signed out it lands
 *  on the sign-in wall, which is the honest answer. */
function Chrome({ navigate }) {
  const [menu, setMenu] = useState(false);

  // Escape closes it, because a sheet you can only dismiss by finding
  // the same small button again is a trap on a phone.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <header className="chrome">
      <div className="chrome__inner">
        <a className="wordmark" href={STATIC_LINKS.home}>
          {SITE}
        </a>

        {/* The SAME markup at every width — which width is showing is a
            media query's decision, not this component's. That is what
            keeps this bar and the Eleventy one the same bar. */}
        <nav className="chrome__nav" aria-label={SITE}>
          {CHROME_TABS.map(([label, href]) => (
            <a className="chrome__tab" key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>

        {/* Never inside the menu, at any width: it is the way into the
            product, and burying it behind a button costs a tap on the
            one thing most people came for. */}
        <a
          className="chrome__console"
          href="/account/overview"
          onClick={(e) => {
            e.preventDefault();
            setMenu(false);
            navigate("/account/overview");
          }}
        >
          <Icon name="gauge" size={17} />
          Console
        </a>

        <button
          type="button"
          className="chrome__menu"
          aria-label="Menu"
          aria-expanded={menu}
          aria-controls="chrome-sheet"
          onClick={() => setMenu((v) => !v)}
        >
          <Icon name={menu ? "x" : "menu"} size={20} />
        </button>
      </div>

      <nav
        className="chrome__sheet"
        id="chrome-sheet"
        aria-label={`${SITE} menu`}
        data-open={menu ? "true" : "false"}
      >
        {CHROME_TABS.map(([label, href]) => (
          <a key={href} href={href} onClick={() => setMenu(false)}>
            {label}
          </a>
        ))}
      </nav>
    </header>
  );
}

/**
 * The rail. The current item is a gold left rule plus weight and
 * brighter ink — never a filled block, because background is reserved
 * for hover, and once a fill means "selected" hover has nowhere to go.
 *
 * Below 900px it becomes a DISCLOSURE ABOVE THE CONTENT: a 44px row
 * naming the section and where you are in it, expanding to the same list
 * in the same order. Not a drawer over the content — a drawer hides the
 * page you are reading in order to show you a list of pages.
 */
function Rail({ me, here, navigate, narrow, counts, dots = {} }) {
  const [open, setOpen] = useState(false);
  const items = RAIL.filter((r) => !r.adminOnly || me?.is_admin);
  const current = items.find((r) => r.key === here.key);

  const go = (to) => (e) => {
    e.preventDefault();
    setOpen(false);
    navigate(to);
  };

  const list = (
    <nav
      aria-label="Console sections"
      style={{ display: "flex", flexDirection: "column", gap: "2px" }}
    >
      {items.map((row) => {
        const on = row.key === here.key;
        const meta = row.meta ?? counts[row.key];
        const dot = dots[row.key];
        const subs = (row.subs ?? []).filter(
          ([, , , ownerOnly]) => !ownerOnly || me?.is_owner,
        );
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
              {(meta !== undefined || dot) && (
                <span className="rail__meta">
                  {dot && (
                    <span
                      className={`rail__dot rail__dot--${dot.tone}`}
                      title={dot.title}
                      role="img"
                      aria-label={dot.title}
                    />
                  )}
                  {meta}
                </span>
              )}
            </a>
            {on &&
              subs.map(([slug, label, to]) => {
                const subOn = here.sub === slug;
                return (
                  <a
                    key={slug}
                    className={
                      "rail__child" + (subOn ? " rail__child--on" : "")
                    }
                    href={to}
                    aria-current={subOn ? "page" : undefined}
                    onClick={go(to)}
                  >
                    {label}
                  </a>
                );
              })}
          </div>
        );
      })}
    </nav>
  );

  const subLabel = (current?.subs ?? []).find(([s]) => s === here.sub)?.[1];

  return (
    <aside className="rail">
      {narrow ? (
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span style={{ fontSize: "13.5px", fontWeight: 600 }}>
            {current?.label ?? "Console"}
          </span>
          <span
            style={{
              fontSize: "13px",
              color: "var(--ink-faint)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subLabel ?? ""}
          </span>
          <span style={{ marginLeft: "auto", display: "flex" }}>
            <Icon name={open ? "chevron-up" : "chevron-down"} size={17} />
          </span>
        </button>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "9px",
            height: "40px",
            padding: "0 11px",
            marginBottom: "6px",
            borderBottom: "1px solid var(--line-soft)",
          }}
        >
          <span style={{ fontSize: "13.5px", fontWeight: 600 }}>Console</span>
          <span
            className="mono"
            style={{ marginLeft: "auto", color: "var(--ink-faint)" }}
          >
            {me?.role ?? ""}
          </span>
        </div>
      )}

      {(!narrow || open) && list}

      {(!narrow || open) && (
        <div style={{ marginTop: "auto", paddingTop: "16px" }}>
          {/* The site's links used to be repeated here at narrow
              widths, because the top bar dropped them. The bar keeps
              them in its own menu now, so this was two answers to one
              question. */}
          {/* The identity block is the way to the profile: who you are
              signed in as, at which tier, in which timezone - and the
              page where the address and timezone live. */}
          <a
            className="rail__identity"
            href="/account/profile"
            onClick={go("/account/profile")}
            style={{ color: "inherit" }}
          >
            <span
              style={{
                width: "34px",
                height: "34px",
                borderRadius: "10px",
                background: "var(--line-soft)",
                border: "1px solid var(--line-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ink-body)",
                flex: "0 0 auto",
              }}
            >
              <Icon name="user-round" size={17} />
            </span>
            <span style={{ minWidth: 0, flex: "1 1 auto" }}>
              {/* The address, as the design draws it: account.email has
                  held it since 0046 (the earlier note that only a hash
                  was stored was wrong). An account from before that
                  fills in at its next sign-in and reads "Signed in"
                  until then. */}
              <span
                style={{
                  display: "block",
                  fontSize: "13px",
                  color: "var(--ink)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={me?.email ?? undefined}
              >
                {me?.email ?? "Signed in"}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: "var(--ink-faint)",
                }}
              >
                {[me?.role, me?.timezone].filter(Boolean).join(" · ")}
              </span>
            </span>
            {/* A button, not a link. `/signout` is not a route: anything
                that followed that href — a middle-click, a cmd-click, a
                handler that threw, a click before hydration — landed on
                the app shell, failed to resolve, and bounced to the home
                page STILL SIGNED IN, having looked exactly like a
                sign-out. Signing out is an action; giving it a
                destination invented a way to believe you had done it
                when you had not. */}
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
              style={{ flex: "0 0 auto" }}
            >
              <Icon name="log-out" size={16} />
            </button>
          </a>
        </div>
      )}
    </aside>
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
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: "9px",
          color: "var(--ink-faint)",
        }}
      >
        <Icon name="book-open" size={16} />
        <span className="label">Docs · {topic}</span>
      </span>
      <span style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {links.map(([label, href]) => (
          <a className="btn btn--sm" key={href} href={href}>
            {label}
          </a>
        ))}
      </span>
      <a
        style={{ marginLeft: "auto", fontSize: "13px" }}
        href={STATIC_LINKS.docs}
      >
        All docs ›
      </a>
    </footer>
  );
}

function Disclaimer() {
  return (
    <footer className="disclaimer">
      <span className="disclaimer__tag">UNOFFICIAL</span>
      <span className="disclaimer__text">
        This material is unofficial and is not endorsed by Supercell. For more
        information see Supercell&rsquo;s Fan Content Policy:{" "}
        <a href="https://www.supercell.com/fan-content-policy">
          www.supercell.com/fan-content-policy
        </a>
        .
      </span>
      <span className="disclaimer__family">a POAP KINGS product</span>
    </footer>
  );
}

function SignInWall({ navigate }) {
  return (
    <div className="panel" style={{ maxWidth: "420px", margin: "48px auto 0" }}>
      <div className="panel__body" style={{ textAlign: "center" }}>
        <h1 className="page__title" style={{ marginBottom: "8px" }}>
          Sign in first
        </h1>
        <p style={{ color: "var(--ink-faint)", fontSize: "13px" }}>
          This part of Elixir MCP shows your recorded history. Sign in with the
          email on your access request.
        </p>
        <button
          className="btn"
          onClick={() => navigate("/signin")}
          style={{ marginTop: "8px" }}
        >
          Sign in
        </button>
      </div>
    </div>
  );
}

export function App() {
  const { path, navigate } = useRoute();
  const [me, setMe] = useState(null); // null = loading
  const narrow = useNarrow();

  const refresh = useCallback(async () => {
    const { data } = await api.me();
    setMe(data);
    return data;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const authed = me?.authenticated === true;
  const owned = legalRoute(REDIRECTS[path] ?? path);

  // A path this app does not own belongs to the static site. Replace
  // the entry so Back does not bounce between the two halves.
  useEffect(() => {
    if (owned === null) window.location.replace(STATIC_LINKS.home);
  }, [owned]);

  const effectivePath = owned ?? "/account/overview";
  const [, section, page, itemId, recordId] = effectivePath.split("/");
  const sec = SECTIONS[section];
  const activePage = sec?.pages.find((p) => p.slug === page)?.slug;
  const here = railPosition(effectivePath);

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
      me?.signals?.events_unseen > 0
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

  const needsAuth = sec?.authed && !authed && me !== null;
  const showRail =
    authed && !needsAuth && effectivePath !== "/signin" && Boolean(here.key);

  return (
    <div className="shell">
      <Chrome navigate={navigate} />

      <div
        style={{
          maxWidth: "var(--page-max)",
          margin: "0 auto",
          width: "100%",
          display: "flex",
          alignItems: "stretch",
          flexDirection: narrow ? "column" : "row",
          flex: "1 1 auto",
        }}
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
              {owned === null ? null : effectivePath === "/signin" ? (
                <SignIn
                  onAuthed={async () => {
                    await refresh();
                    navigate("/account/overview");
                  }}
                />
              ) : needsAuth ? (
                <SignInWall navigate={navigate} />
              ) : section === "data" ? (
                <Data />
              ) : section === "explore" ? (
                <Explore me={me} navigate={navigate} path={effectivePath} />
              ) : section === "status" ? (
                activePage === "collectors" ? (
                  itemId === "new" ? (
                    <RaiseCollector navigate={navigate} />
                  ) : itemId ? (
                    // Keyed on the name: a re-picked card moves the
                    // record's address, and the page reloads under it.
                    <CollectorPage
                      key={itemId}
                      id={itemId}
                      navigate={navigate}
                      me={me}
                    />
                  ) : (
                    <Fleet navigate={navigate} />
                  )
                ) : (
                  <Status navigate={navigate} />
                )
              ) : section === "account" ? (
                <Dashboard
                  me={me}
                  refresh={refresh}
                  navigate={navigate}
                  page={activePage ?? "overview"}
                  sub={here.sub}
                  itemId={itemId}
                  recordId={recordId}
                />
              ) : section === "admin" ? (
                me?.is_admin ? (
                  <Admin
                    me={me}
                    page={activePage ?? "requests"}
                    navigate={navigate}
                    itemId={itemId}
                  />
                ) : (
                  <SignInWall navigate={navigate} />
                )
              ) : null}
            </ErrorBoundary>
            {showRail && <DocsStrip here={here} />}
          </div>
        </main>
      </div>

      <Disclaimer />
    </div>
  );
}
