import {
  Chrome as ChromeBar,
  Disclaimer,
  ErrorBoundary,
  FAMILY_DOCS,
  FAMILY_PRODUCTS,
  FAMILY_SIGN_IN,
  Icon,
  NavigateProvider,
  initialsOf,
  Rail as RailList,
  ZoneProvider,
  isPlainClick,
  onOrigin,
  writeErrorText,
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
  createRootRoute,
  createRoute,
  createRouter,
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
import { useAgentMe } from "./lib/queries.js";
import { CONSOLE, appPath } from "./lib/console.js";
import {
  LADDER,
  isLadder,
  ladderHere,
  ladderLegal,
  ladderTitle,
} from "./lib/ladder.js";
import { LadderRail } from "./ladder/LadderRail.jsx";
import { SignIn } from "./views/SignIn.jsx";
import { takeLoginToken } from "./url-hygiene.js";
import { tagPath } from "./lib/tag-url.js";

/**
 * Shell + rail (design handoff 2026-09-09). The three-tier top nav is
 * gone: sections live in a 256px rail down the left, because the console
 * grew past what a horizontal row can hold without truncating or hiding
 * things behind a menu.
 *
 * Two rules shape everything here.
 *
 * The TOP BAR'S SHAPE NEVER VARIES BY SESSION (canvas 2026-09-29). It is
 * the kit's Chrome, the same bar the Eleventy build draws, and its
 * account slot is one fixed width signed in or not. This app fills the
 * slot from the session it already holds (`useMe`): empty while it asks,
 * "Sign in" signed out, the person and the account menu signed in. The
 * static half cannot know the session, so it always shows "Sign in", and
 * the sign-in page below sends a reader who is already signed in on to
 * their console. Nothing on the bar is swapped after load; when the old
 * bar swapped "Sign in" for "Account" it read as a glitch.
 *
 * The RAIL CARRIES STRUCTURE, NEVER USER CONTENT. Sections and
 * sub-pages, never the name of a player or a clan: the rail must not
 * grow when the data does. A count of the reader's own things is the one
 * exception, because it is a number and not a list.
 *
 * This app is the site's DYNAMIC half (2026-09-07 split), and since
 * 2026-09-28 it lives under /console (CONSOLE): the root is the site's.
 * Home, docs, updates (each one its own page) are real documents built
 * by apps/site and served from the same hostname; they are reached with
 * plain hrefs (STATIC_LINKS below), which are full page loads on
 * purpose. Anything the app does not recognise leaves for the static
 * home rather than rendering an empty main.
 */

/** Paths owned by the static site. The edge router in infra/template.yaml
 *  sends everything outside /console to a document; a test pins these to
 *  pages apps/site builds, because a link to a page it does not build is
 *  a dead link. */
export const STATIC_LINKS = {
  home: "/",
  data: "/data",
  examples: "/examples/play",
  docs: "/docs",
  updates: "/updates",
  support: "/support",
};

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
      { slug: "timeline", label: "Timeline" },
      { slug: "tracking", label: "Tracking" },
      { slug: "verify", label: "Verify" },
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
      { slug: "integrations", label: "Integrations" },
      { slug: "connections", label: "Connections" },
      { slug: "feedback", label: "Feedback" },
      { slug: "emails", label: "Emails" },
      { slug: "usage", label: "Usage" },
      { slug: "cards", label: "Cards" },
      { slug: "collectors", label: "Collectors", ownerOnly: true },
      { slug: "service-tokens", label: "Service tokens", ownerOnly: true },
    ],
  },
  // An agent's console (2026-09-23, docs/reviews/2026-09-23-CONSOLE-
  // ACCOUNT-SWITCHER.md): the pages that make sense for an agent, scoped
  // to one you own, at /console/agent/<public_id>/<page>. Verify,
  // Profile and Admin are a person's; Explore and Status are the same for
  // everyone and stay in your console. `scoped` marks the id segment
  // before the page.
  agent: {
    label: "Agent",
    authed: true,
    scoped: true,
    pages: [
      { slug: "overview", label: "Overview" },
      { slug: "timeline", label: "Timeline" },
      { slug: "tracking", label: "Tracking" },
      { slug: "activity", label: "Activity" },
      { slug: "usage", label: "Usage" },
      { slug: "connections", label: "Connections" },
      { slug: "settings", label: "Settings" },
      { slug: "feedback", label: "Feedback" },
    ],
  },
  // The in-app charts. /data is the site's corpus page; under /console
  // the paths no longer collide, so the bare section is just its page.
  data: {
    label: "Data",
    authed: false,
    pages: [{ slug: "dashboard", label: "Charts" }],
  },
};

/**
 * The rails (canvas 2026-09-29, ConsoleRail). Your console is nine items
 * in three groups, with no sub-items open by default; who you are and
 * your account's own pages left the rail for the top bar's account menu,
 * and Admin is a console of its own in the switcher. Where the rest went:
 *
 *   Profile, Email, Devices   the account menu › Account settings
 *   Activity › MCP requests   Usage, under the meters
 *   Activity › Emails         Emails from Elixir › All sent (the item
 *                             opens the switches; the log sits under it)
 *   Activity › Account events Account settings › Sign-ins
 *   Connections › Agents      the switcher, and Connections
 *   Admin                     its own console in the switcher
 *
 * Every address still resolves; only where the rail marks it moved
 * (railPosition below). `subs` render only while their item is current,
 * and no two items the reader can see at once share a label.
 */
export const RAIL = [
  {
    key: "overview",
    label: "Overview",
    icon: "layout-dashboard",
    to: `${CONSOLE}/account/overview`,
  },
  // What happened to what you track, the same items your connections
  // read with elixir_timeline. Its own item beside Overview since
  // 2026-09-23 (Jamie); it was Activity's first view until then.
  {
    key: "timeline",
    label: "Timeline",
    icon: "bell",
    to: `${CONSOLE}/account/timeline`,
  },
  {
    key: "explore",
    label: "Explore",
    icon: "search",
    to: `${CONSOLE}/explore`,
    subs: [
      ["players", "Players", `${CONSOLE}/explore/players`],
      ["clans", "Clans & wars", `${CONSOLE}/explore/clans`],
      ["meta", "Decks", `${CONSOLE}/explore/meta`],
      ["weeks", "War weeks", `${CONSOLE}/explore/weeks`],
    ],
  },
  {
    group: "Your record",
    key: "tracking",
    label: "Tracking",
    icon: "radar",
    to: `${CONSOLE}/account/tracking`,
  },
  // Proving a claim is a step in your record, next to what you track.
  {
    key: "verify",
    label: "Verify",
    icon: "shield-check",
    to: `${CONSOLE}/account/verify`,
  },
  {
    group: "Access",
    key: "connections",
    label: "Connections",
    icon: "plug",
    to: `${CONSOLE}/account/connections`,
  },
  {
    key: "usage",
    label: "Usage",
    icon: "chart-column",
    to: `${CONSOLE}/account/usage`,
  },
  {
    group: "Service",
    key: "status",
    label: "Status",
    icon: "heart-pulse",
    to: `${CONSOLE}/status/service`,
    subs: [
      ["collectors", "Collectors", `${CONSOLE}/status/collectors`],
      ["efficiency", "Efficiency", `${CONSOLE}/status/efficiency`],
    ],
  },
];

/** The foot of your console's rail: feedback is always one click away,
 *  and every item is answered. */
export const RAIL_FOOT = {
  key: "feedback",
  label: "Send feedback",
  icon: "message-square",
  to: `${CONSOLE}/account/feedback`,
};

/** The Admin console's rail: bare labels again, because nothing else is
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

/** Account settings, reached from the top bar's account menu: a rail of
 *  its own with the way back to the console above it (ConsoleEmails
 *  board). Sign-ins is the account log that was Activity › Account
 *  events. */
export const ACCOUNT_RAIL = [
  {
    key: "profile",
    label: "Profile",
    icon: "user-round",
    to: `${CONSOLE}/account/profile`,
  },
  {
    key: "emails",
    label: "Emails from Elixir",
    icon: "mail",
    to: `${CONSOLE}/account/profile/email`,
  },
  {
    key: "devices",
    label: "Sign-in and devices",
    icon: "key-round",
    to: `${CONSOLE}/account/profile/devices`,
  },
  {
    key: "signins",
    label: "Sign-ins",
    icon: "history",
    to: `${CONSOLE}/account/activity/events`,
  },
];

const AGENT_ID = /^[a-z0-9]{8,16}$/;

/** The rail of an agent's console: yours, reshaped to what an agent is.
 *  Same keys as yours where the page is the same page, so the docs strip
 *  and the rail tests read both consoles one way. */
export function agentRail(id) {
  const at = (page) => `${CONSOLE}/agent/${id}/${page}`;
  return [
    {
      key: "overview",
      label: "Overview",
      icon: "layout-dashboard",
      to: at("overview"),
    },
    { key: "timeline", label: "Timeline", icon: "bell", to: at("timeline") },
    {
      group: "Its record",
      key: "tracking",
      label: "Tracking",
      icon: "radar",
      to: at("tracking"),
    },
    {
      key: "activity",
      label: "Activity",
      icon: "activity",
      to: at("activity/requests"),
      subs: [
        ["requests", "MCP requests", at("activity/requests")],
        ["events", "Account events", at("activity/events")],
      ],
    },
    { key: "usage", label: "Usage", icon: "chart-column", to: at("usage") },
    {
      group: "Access",
      key: "connections",
      label: "Connections",
      icon: "plug",
      to: at("connections"),
    },
    {
      key: "settings",
      label: "Settings",
      icon: "settings",
      to: at("settings"),
    },
    {
      key: "feedback",
      label: "Feedback",
      icon: "message-square",
      to: at("feedback"),
    },
  ];
}

/** Which rail item and sub-item a path belongs to. One function, so the
 *  mark in the rail and the docs strip's key can never disagree about
 *  where the reader is. Read on the app path (the prefix off), so the
 *  segments below keep their indexes. */
export function railPosition(path) {
  const app = appPath(path) ?? "";
  const [, section, page, rest] = app.split("/");
  if (section === "agent") {
    // /agent/<public_id>/<page>/<rest>: the same positions as yours, one
    // segment along, with the agent's own strip where the page is its.
    const [, , id, agentPage, agentRest] = app.split("/");
    const scope = { scope: id };
    if (agentPage === "activity")
      return {
        ...scope,
        key: "activity",
        sub: agentRest === "c" ? "requests" : (agentRest ?? "requests"),
        ...(agentRest === "c" ? { doc: "activity:call" } : {}),
      };
    if (agentPage === "connections")
      return { ...scope, key: "connections", doc: "agent:connections" };
    if (agentPage === "overview" || agentPage === undefined)
      return { ...scope, key: "overview", doc: "agent:overview" };
    if (agentPage === "settings")
      return { ...scope, key: "settings", doc: "agent:settings" };
    if (agentPage === "tracking")
      return { ...scope, key: "tracking", doc: "agent:tracking" };
    return { ...scope, key: agentPage };
  }
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
      sub: ["collectors", "efficiency"].includes(page) ? page : undefined,
      // A record and the raise form both read the operators guide.
      ...(page === "collectors" && rest ? { doc: "status:collector" } : {}),
    };
  // Admin is a console of its own: its rail's items are its pages.
  if (section === "admin") {
    const key = page ?? "requests";
    return { rail: "admin", key, doc: `admin:${key}` };
  }
  // The in-app charts are the corpus in detail, reached from the site's
  // /data page. They sit under Explore in the rail rather than nowhere:
  // losing the whole navigation on one route is worse than putting a
  // page under the nearest section that is honestly about reading the
  // record.
  if (section === "data" && page === "dashboard") return { key: "explore" };
  if (section === "account") {
    // Activity's three logs went three ways. MCP requests, and a call
    // record (/activity/c/<request_id>), sit under Usage; Emails, and an
    // email record (/activity/e/<send_id>), are Account settings ›
    // Emails from Elixir; Account events are Account settings ›
    // Sign-ins. `sub` still names the log, for the page that draws it.
    if (page === "activity") {
      const log =
        rest === "c"
          ? "requests"
          : rest === "e"
            ? "emails"
            : (rest ?? "requests");
      if (log === "emails")
        return {
          rail: "account",
          key: "emails",
          sub: "emails",
          doc: rest === "e" ? "activity:email" : "activity:emails",
        };
      if (log === "events")
        return {
          rail: "account",
          key: "signins",
          sub: "events",
          doc: "activity:events",
        };
      return {
        key: "usage",
        sub: "requests",
        doc: rest === "c" ? "activity:call" : "activity:requests",
      };
    }
    // Profile and its two pages are Account settings.
    if (page === "profile") {
      if (rest === "email")
        return { rail: "account", key: "emails", doc: "profile:email" };
      if (rest === "devices")
        return { rail: "account", key: "devices", doc: "profile:devices" };
      return { rail: "account", key: "profile", doc: "profile:profile" };
    }
    if (page === "connections")
      return { key: "connections", doc: "connections:clients" };
    // The agent list is addressable in its own right, but it belongs to
    // Connections in the rail: an agent IS a connection.
    if (page === "agents")
      return { key: "connections", doc: "connections:agents" };
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
  timeline: [
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
  "activity:emails": [
    "The emails Elixir sends",
    [
      ["Email", "/docs/email"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  // The record of one sent email: what it is, and what is counted.
  "activity:email": [
    "One email",
    [
      ["Email", "/docs/email"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
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
  "agent:overview": [
    "Your agent",
    [
      ["Agents", "/docs/agents"],
      ["Tiers & roles", "/docs/roles"],
      ["The timeline", "/docs/timeline"],
    ],
  ],
  "agent:tracking": [
    "What an agent tracks",
    [
      ["What an agent tracks", "/docs/agents#what-an-agent-tracks"],
      ["How recording works", "/docs/recording"],
      ["Tiers & slots", "/docs/roles"],
    ],
  ],
  "agent:settings": [
    "Running an agent",
    [
      ["Agents", "/docs/agents"],
      ["Connections", "/docs/connections"],
      ["Limits", "/docs/limits"],
    ],
  ],
  "agent:connections": [
    "Connecting as an agent",
    [
      ["Agents", "/docs/agents"],
      ["Connections", "/docs/connections"],
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
  "profile:profile": [
    "Your account",
    [
      ["Tiers & roles", "/docs/roles"],
      ["Limits", "/docs/limits"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "profile:email": [
    "The emails Elixir sends",
    [
      ["Email", "/docs/email"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  "profile:devices": [
    "Your sessions",
    [
      ["Connections", "/docs/connections"],
      ["Privacy", "/docs/privacy"],
    ],
  ],
  feedback: [
    "Feedback",
    [
      ["About the project", "/docs/about"],
      ["elixir_send_feedback", "/docs/tools/help#elixir_send_feedback"],
    ],
  ],
  "status:collectors": [
    "Collectors",
    [
      ["Operators guide", "/docs/operators"],
      ["Architecture", "/docs/architecture#collectors-in-depth"],
    ],
  ],
  // The session clock's cost and loss, per day (2026-09-19).
  "status:efficiency": [
    "Efficiency",
    [
      [
        "How often a subject is fetched",
        "/docs/recording#how-often-a-subject-is-fetched",
      ],
      ["Completeness", "/docs/recording#completeness"],
      [
        "Architecture",
        "/docs/architecture#scheduling-how-often-a-player-is-fetched-and-why",
      ],
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
  "admin:feedback": ["Feedback queue", [["About the project", "/docs/about"]]],
  "admin:emails": [
    "What we send",
    [
      ["Email", "/docs/email"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
    ],
  ],
  "admin:usage": [
    "Usage across accounts",
    [
      ["Limits", "/docs/limits"],
      ["Architecture", "/docs/architecture"],
    ],
  ],
  "admin:cards": [
    "The archetype vocabulary",
    [
      ["Deck archetypes", "/docs/archetypes"],
      ["Cards", "/docs/cards"],
    ],
  ],
  // Ladder's pages: the section's own page first, then the tool each
  // page reads.
  "ladder:season": [
    "Ladder",
    [
      ["Ladder", "/docs/ladder"],
      ["battles_performance", "/docs/tools/battles#battles_performance"],
      ["players_summary", "/docs/tools/players#players_summary"],
    ],
  ],
  "ladder:days": [
    "Ladder",
    [
      ["Days played", "/docs/ladder#days-played"],
      ["battles_query", "/docs/tools/battles#battles_query"],
    ],
  ],
  "ladder:decks": [
    "Ladder",
    [
      ["Decks", "/docs/ladder#decks"],
      ["battles_decks", "/docs/tools/battles#battles_decks"],
    ],
  ],
  "ladder:cards": [
    "Ladder",
    [
      ["Cards", "/docs/ladder#cards"],
      ["battles_cards", "/docs/tools/battles#battles_cards"],
      ["battles_opponents", "/docs/tools/battles#battles_opponents"],
    ],
  ],
};

/** Structural redirects: a bare section to its first page, a partial
 *  record path to the lookup. The old addresses at the root are not
 *  aliased (Jamie, 2026-09-28: nobody was using them yet). */
const REDIRECTS = {
  [CONSOLE]: `${CONSOLE}/account/overview`,
  [`${CONSOLE}/`]: `${CONSOLE}/account/overview`,
  [`${CONSOLE}/account`]: `${CONSOLE}/account/overview`,
  [`${CONSOLE}/admin`]: `${CONSOLE}/admin/requests`,
  [`${CONSOLE}/explore/player`]: `${CONSOLE}/explore`,
  [`${CONSOLE}/explore/clan`]: `${CONSOLE}/explore`,
  [`${CONSOLE}/status`]: `${CONSOLE}/status/service`,
  // The bare Activity path WAS the timeline until the timeline became
  // its own rail item (2026-09-23), so a link to it still means that.
  [`${CONSOLE}/account/activity`]: `${CONSOLE}/account/timeline`,
};

/** A battle's public page (2026-10-01): /battle/<short id>, a 12 to 64
 *  character hex prefix of the battle id. */
const BATTLE_PATH = /^\/battle\/[0-9a-f]{12,64}$/;

/** Guard restored/bookmarked routes: a stale path to a removed section
 *  must fall back to a known-good route, never an empty main. Anything
 *  this app does not own (every path outside /console among them)
 *  returns null, and the caller leaves for the static home with a real
 *  navigation. */
/** Which place the bar marks as the one you are in, from the route: the
 *  Console, or Ladder under /ladder. A battle's public page is in no
 *  place (2026-10-02): it is public and reads signed out, so the bar's
 *  places are plain links there and the narrow button says Menu. */
export function barArea(path) {
  if (BATTLE_PATH.test(path)) return undefined;
  if (isLadder(path)) return "ladder";
  return "console";
}

const isClan = (path) =>
  path === "/clan" ||
  path === "/clan/" ||
  /^\/clan\/[A-Za-z0-9/_-]+$/.test(path);

export function legalRoute(path) {
  if (isClan(path)) return path;
  // A battle's public page is the app's too, outside the Console.
  if (BATTLE_PATH.test(path)) return path;
  // Ladder is a section of its own beside the Console (2026-09-28), and
  // resolves its own paths.
  if (isLadder(path)) return ladderLegal(path);
  const app = appPath(path);
  if (app === null) return null;
  const [, section, page] = app.split("/");
  if (app === "/signin") return path;
  const sec = SECTIONS[section];
  if (!sec) return null;
  // Explore's records are addressable, so it resolves its own paths.
  if (section === "explore") return path;
  // An agent's console: a public id, then one of its pages. Whether the
  // agent is yours is the server's answer (a 404 the page says), not a
  // routing question.
  if (sec.scoped) {
    const [, , id, agentPage] = app.split("/");
    if (!AGENT_ID.test(id ?? "")) return null;
    if (sec.pages.some((p) => p.slug === agentPage)) return path;
    return `${CONSOLE}/${section}/${id}/${sec.pages[0].slug}`;
  }
  if (sec.pages.length === 0) return `${CONSOLE}/${section}`;
  if (sec.pages.some((p) => p.slug === page)) return path;
  return `${CONSOLE}/${section}/${sec.pages[0].slug}`;
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
  if (isLadder(path)) return ladderTitle(path, SITE);
  const parts = (appPath(path) ?? "").split("/").filter(Boolean);
  if (parts.length === 0) return SITE;
  if (!sec) return SITE;
  if (sec.scoped) {
    const known = sec.pages.find((p) => p.slug === parts[2])?.label;
    return `${known ?? sec.label} - ${sec.label} - ${SITE}`;
  }
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
      const [pathname, qs] = String(to).split("?");
      if (
        isClan(pathname) &&
        queryClient.getQueryData(["me"])?.data?.features?.clan_internal !== true
      ) {
        window.location.assign(to);
        return;
      }
      return nav({
        to: pathname,
        search: qs ? Object.fromEntries(new URLSearchParams(qs)) : {},
        replace,
      });
    },
    [nav, queryClient],
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

/** The top bar: the kit's Chrome. We are the Console, so that place is
 *  green and routes in-app; the other places are bare paths on this
 *  origin, full page loads into their own apps. The Console button is a
 *  place, not a state: signed out it lands on the sign-in wall, which is
 *  the honest answer. */
const PRODUCTS = FAMILY_PRODUCTS.map((p) => ({ ...p, href: onOrigin(p.href) }));
const DOCS = { ...FAMILY_DOCS, href: onOrigin(FAMILY_DOCS.href) };
const SIGN_IN = { ...FAMILY_SIGN_IN, href: onOrigin(FAMILY_SIGN_IN.href) };

/** The account slot, from the session this app holds. `undefined` while
 *  the session is unknown (pending, or Elixir did not answer): the empty
 *  slot, never a guess. `null` signed out: "Sign in". Signed in: who you
 *  are, your players, the account's own pages, and the way out. */
export function consoleAccount(me, unreachable, signOut) {
  if (me === null || unreachable) return undefined;
  if (!me.authenticated) return null;
  const claims = me.claims ?? [];
  const primary = claims.find((c) => c.is_primary);
  return {
    name: primary?.nickname ?? primary?.name ?? me.email ?? "Your account",
    email: me.email ?? undefined,
    detail: [me.role, me.timezone].filter(Boolean).join(" · ") || undefined,
    // Your players are you: the primary and its alts. A friend or a
    // player you watch is tracked, not yours, and stays on Tracking.
    players: claims
      .filter((c) => c.is_primary || c.relationship === "alt")
      .map((c) => ({
        key: c.player_tag,
        name: c.nickname ?? c.name ?? c.player_tag,
        tag: c.player_tag,
        primary: c.is_primary === true,
        href: `${CONSOLE}/explore/player/${tagPath(c.player_tag)}`,
      })),
    playersFoot: {
      label: "Add or verify a player",
      href: `${CONSOLE}/account/verify`,
    },
    links: [
      {
        key: "settings",
        icon: "user-round",
        label: "Account settings",
        hint: "profile, email, devices",
        href: `${CONSOLE}/account/profile`,
      },
      {
        key: "emails",
        icon: "mail",
        label: "Emails from Elixir",
        href: `${CONSOLE}/account/profile/email`,
      },
      {
        key: "feedback",
        icon: "message-square",
        label: "Feedback",
        hint: "every item is answered",
        href: `${CONSOLE}/account/feedback`,
      },
    ],
    signOut,
  };
}

function Chrome({ navigate, me, unreachable, current }) {
  // A sign-out that did not take says so in the menu, where the button
  // is, instead of leaving for the home page still signed in (review
  // 2026-09-27 §7.5).
  const [signOutFailed, setSignOutFailed] = useState(null);
  const inApp = (to) => (e) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    navigate(to);
  };
  // Console and Ladder are this app: their links route in it rather
  // than reloading the page.
  const IN_APP = {
    console: CONSOLE,
    ladder: LADDER,
    ...(me?.features?.clan_internal === true ? { clan: "/clan" } : {}),
  };
  const products = PRODUCTS.map((p) =>
    IN_APP[p.key]
      ? { ...p, href: IN_APP[p.key], onClick: inApp(IN_APP[p.key]) }
      : p,
  );
  const account = consoleAccount(me, unreachable, {
    label: "Sign out",
    note: "Ends this browser's Elixir session. Drop manages its own sign-in.",
    error: signOutFailed,
    onClick: async () => {
      setSignOutFailed(null);
      const r = await api.signOut();
      if (!r.ok)
        return setSignOutFailed(
          `Not signed out. ${writeErrorText({ status: r.status, transport: r.error, data: r.data })}`,
        );
      window.location.assign(STATIC_LINKS.home);
    },
  });
  return (
    <ChromeBar
      home={STATIC_LINKS.home}
      products={products}
      docs={DOCS}
      current={current}
      account={account}
      signIn={{ ...SIGN_IN, onClick: inApp(SIGN_IN.href) }}
    />
  );
}

/** The consoles the rail head switches between (ConsoleRail board): you,
 *  each agent you own, and Admin for an admin. Each is a place with its
 *  own address, never a mode the app remembers. */
export function railConsoles(me) {
  const primary = (me?.claims ?? []).find((c) => c.is_primary);
  const name = primary?.nickname ?? primary?.name ?? me?.email ?? undefined;
  return [
    {
      key: "me",
      group: "You",
      icon: "gauge",
      label: "Your console",
      detail: [name, me?.role].filter(Boolean).join(" · ") || undefined,
      to: `${CONSOLE}/account/overview`,
    },
    ...(me?.agents ?? []).map((a) => ({
      key: a.public_id,
      group: "Your agents",
      icon: "bot",
      label: a.name ?? a.public_id,
      detail: `agent · ${a.public_id}`,
      to: `${CONSOLE}/agent/${a.public_id}/overview`,
    })),
    ...(me?.is_admin
      ? [
          {
            key: "admin",
            group: "Operate",
            icon: "shield",
            label: "Admin console",
            detail: ["every account", me.role].filter(Boolean).join(" · "),
            to: `${CONSOLE}/admin/requests`,
          },
        ]
      : []),
  ];
}

/** The rail: the kit's, fed the rail this place belongs to (yours, an
 *  agent's, Admin's, or Account settings), filtered by who is looking,
 *  with the reader's counts and the two dots attached by key. Who you
 *  are and the way out are the bar's account menu (canvas 2026-09-29),
 *  never the rail's. */
function Rail({ me, agent, here, navigate, narrow, counts, dots = {} }) {
  const [signOutFailed, setSignOutFailed] = useState(null);
  const consoles = railConsoles(me);
  const settings = here.rail === "account";
  const rail = here.scope
    ? agentRail(here.scope)
    : here.rail === "admin"
      ? ADMIN_RAIL.filter((r) => !r.ownerOnly || me?.is_owner)
      : settings
        ? ACCOUNT_RAIL
        : RAIL;
  const items = rail.map((row) => ({
    key: row.key,
    label: row.label,
    icon: row.icon,
    to: row.to,
    group: row.group,
    meta: row.meta ?? counts[row.key],
    dot: dots[row.key] ?? null,
    subs: (row.subs ?? []).map(([slug, label, to]) => ({ slug, label, to })),
  }));
  const account = here.scope ?? (here.rail === "admin" ? "admin" : "me");
  const current = consoles.find((c) => c.key === account) ?? consoles[0];
  const you = consoles[0];

  if (settings) {
    const primary = (me?.claims ?? []).find((c) => c.is_primary);
    return (
      <RailList
        label="Account sections"
        items={items}
        current={here.key}
        navigate={navigate}
        narrow={narrow}
        title="Your account"
        subtitle="Your account"
        back={{ label: "Console", to: you.to }}
        accounts={[
          {
            key: "account",
            initials: initialsOf(
              primary?.nickname ?? primary?.name ?? me?.email ?? "You",
            ),
            label: "Your account",
            detail: you.detail,
            to: `${CONSOLE}/account/profile`,
          },
        ]}
        account="account"
        foot={{
          label: "Sign out of Elixir",
          icon: "log-out",
          error: signOutFailed,
          onClick: async () => {
            setSignOutFailed(null);
            const r = await api.signOut();
            if (!r.ok)
              return setSignOutFailed(
                `Not signed out. ${writeErrorText({ status: r.status, transport: r.error, data: r.data })}`,
              );
            window.location.assign(STATIC_LINKS.home);
          },
        }}
      />
    );
  }

  return (
    <RailList
      label={
        here.scope
          ? "Agent console sections"
          : here.rail === "admin"
            ? "Admin console sections"
            : "Console sections"
      }
      items={items}
      current={here.key}
      sub={here.sub}
      navigate={navigate}
      narrow={narrow}
      title="Console"
      subtitle={here.scope ? (agent?.name ?? current.label) : current.label}
      accounts={consoles}
      account={account}
      manage={{ label: "Manage agents…", to: `${CONSOLE}/account/agents` }}
      foot={
        here.scope || here.rail === "admin"
          ? undefined
          : { ...RAIL_FOOT, current: here.key === RAIL_FOOT.key }
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

/** Where a signed-out deep link wanted to go, kept across the sign-in
 *  (2026-09-19: the mail footer links straight to an email's record and
 *  to feedback about it, and a phone that opens the link is usually
 *  signed out). localStorage, not sessionStorage: a magic link opens in
 *  a new tab. Console, Ladder and Clan paths only, read once and cleared. */
const SignInProgress = createContext([false, () => {}]);
const AFTER_SIGN_IN = "elixir.after_sign_in";
const signedInPath = (path) =>
  /^\/(account|admin|agent)\//.test(appPath(path) ?? "") ||
  isLadder(String(path ?? "").split("?")[0]) ||
  isClan(String(path ?? "").split("?")[0]);
export function rememberAfterSignIn(path) {
  try {
    if (signedInPath(path)) window.localStorage.setItem(AFTER_SIGN_IN, path);
  } catch {
    // Storage denied: the sign-in lands on Overview, as before.
  }
}
export function takeAfterSignIn() {
  try {
    const path = window.localStorage.getItem(AFTER_SIGN_IN);
    window.localStorage.removeItem(AFTER_SIGN_IN);
    return path && signedInPath(path) ? path : null;
  } catch {
    return null;
  }
}

export function SignInWall({ navigate }) {
  // The path this wall stands in front of, remembered for after.
  rememberAfterSignIn(window.location.pathname + window.location.search);
  return (
    <div className="panel mx-auto mt-12 max-w-[420px]">
      <div className="panel__body text-center">
        <h1 className="page__title mb-2">Sign in first</h1>
        <p className="text-[13px] text-ink-faint">
          This part of Elixir shows your recorded history. Sign in with the
          email on your access request.
        </p>
        <button
          className="btn mt-2"
          onClick={() => navigate(`${CONSOLE}/signin`)}
        >
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
 * replaced), and a partial path is REDIRECTED - the address bar
 * changes with it, which the render-only REDIRECTS never did, so a link
 * to /console/status credits /console/status/service in the report.
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
  path: `${CONSOLE}/signin`,
  component: function SignInPage() {
    const navigate = useNav();
    const { me, refresh } = useMe();
    const queryClient = useQueryClient();
    const [completing, setCompleting] = useContext(SignInProgress);
    // The static site's bar always says "Sign in" (it cannot know the
    // session), so a reader who is signed in arrives here too: send them
    // on to their console. Not when a login link brought a token: that is
    // a sign-in (or a device hand-off) to finish, signed in or not.
    const destination = new URLSearchParams(window.location.search).get(
      "return_to",
    );
    if (destination) rememberAfterSignIn(destination);
    const token = takeLoginToken();
    const forward = me?.authenticated === true && !token && !completing;
    useEffect(() => {
      if (forward)
        navigate(takeAfterSignIn() ?? `${CONSOLE}/account/overview`, {
          replace: true,
        });
    }, [forward, navigate]);
    if (forward || (me === null && !token)) return null;
    return (
      <SignIn
        onAuthed={async () => {
          setCompleting(true);
          const next = takeAfterSignIn() ?? `${CONSOLE}/account/overview`;
          try {
            // A new login can be a different person. Remove the previous
            // account's private data before any next-account view mounts.
            await resetSessionCache(queryClient);
            await refresh();
            await navigate(next);
          } finally {
            setCompleting(false);
          }
        }}
      />
    );
  },
});

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/account/{-$page}/{-$itemId}/{-$recordId}`,
  component: lazyRouteComponent(
    () => import("./pages/AccountPage.jsx"),
    "AccountPage",
  ),
});

const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/agent/$agent/{-$page}/{-$itemId}/{-$recordId}`,
  component: lazyRouteComponent(
    () => import("./pages/AgentPage.jsx"),
    "AgentPage",
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

/** Ladder: a section of Elixir beside the Console, its own rail in the
 *  same shell. Signed in only, like the Console. */
const ladderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${LADDER}/{-$page}`,
  component: lazyRouteComponent(
    () => import("./pages/LadderPage.jsx"),
    "LadderPage",
  ),
});

const dataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/data/{-$page}`,
  component: lazyRouteComponent(() => import("./views/Data.jsx"), "Data"),
});

export const routeTree = rootRoute.addChildren([
  signInRoute,
  accountRoute,
  agentRoute,
  exploreRoute,
  statusRoute,
  adminRoute,
  dataRoute,
  battleRoute,
  ladderRoute,
  createClanRoutes(rootRoute, {
    SharedChrome: SharedClanChrome,
    rememberAfterSignIn,
  }),
]);

/** Where a route is on the rail and in the route table, from its path:
 *  the section, its page (validated against SECTIONS, so a stale slug
 *  falls back to the section's first page), the rail position, the
 *  ids. Route components read this rather than re-deriving it. */
/** Ladder's place in the route table: one section, signed in. */
const LADDER_SECTION = { label: "Ladder", authed: true, pages: [] };

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
  // Segments are read on the app path (the prefix off); `path` stays the
  // real one, since it is what the page keys and titles on.
  const app = appPath(pathname) ?? "";
  const [, section, page, itemId, recordId] = app.split("/");
  const sec = SECTIONS[section];
  if (sec?.scoped) {
    // /agent/<public_id>/<page>/<itemId>/<recordId>: one segment along.
    const [, , scope, agentPage, agentItem, agentRecord] = app.split("/");
    return {
      path: pathname,
      section,
      sec,
      scope,
      activePage: sec.pages.find((p) => p.slug === agentPage)?.slug,
      here: railPosition(pathname),
      itemId: agentItem,
      recordId: agentRecord,
    };
  }
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
  const signInProgress = useState(false);
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
    <SignInProgress.Provider value={signInProgress}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SignInProgress.Provider>
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
    unreachable: query.isError,
    retrying: query.isFetching,
    refresh,
    invalidate,
  };
}

function SharedClanChrome({ navigate }) {
  const { me, unreachable } = useMe();
  return (
    <Chrome
      navigate={navigate}
      me={me}
      unreachable={unreachable}
      current="clan"
    />
  );
}

function Shell() {
  const { pathname } = useLocation();
  return isClan(pathname) ? <SharedClanOutlet /> : <ConsoleShell />;
}

function SharedClanOutlet() {
  const { me } = useMe();
  const navigate = useNav();
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
  const { path: effectivePath, section, sec, here, search } = useHere();

  const authed = me?.authenticated === true;

  useEffect(() => {
    // A battle's page names itself once the battle has loaded.
    if (BATTLE_PATH.test(effectivePath)) return;
    document.title = titleFor(section, sec, effectivePath);
  }, [section, sec, effectivePath]);

  // On an agent's console the rail's counts and dots are the agent's:
  // its own `me`, from the same query its pages read.
  const agentEnvelope = useAgentMe(authed ? here.scope : null).data;
  const agent = here.scope && agentEnvelope?.ok ? agentEnvelope.data : null;
  const subject = here.scope ? agent : me;

  /** Counts on rail items are the reader's own things, derived once here
   *  so two screens cannot disagree about them (house rule: derive
   *  shared numbers once). Omitted rather than guessed while /api/me has
   *  not answered. The Tracking count is what this console's account
   *  tracks (signals.tracking); the slot figures are pooled across you and
   *  your agents, so they are not it. The canvas (2026-09-29) keeps the
   *  one count on your rail; an agent's rail, which still lists its
   *  feedback, keeps that count too. */
  const counts = {};
  if (subject?.signals?.tracking !== undefined)
    counts.tracking = String(subject.signals.tracking);
  if (here.scope && subject?.signals?.feedback > 0)
    counts.feedback = String(subject.signals.feedback);
  /** The two dots the design puts on the rail: unread on Timeline while
   *  the feed holds events no connection has read, and an alert on
   *  Connections while a credential that no longer works is still being
   *  presented — the one thing on this rail that wants you before you
   *  go looking. */
  const dots = {
    timeline:
      subject?.signals?.timeline_pending > 0
        ? { tone: "unread", title: "Unread notifications" }
        : null,
    connections:
      subject?.signals?.refusals_7d > 0
        ? {
            tone: "alert",
            title: "A credential that no longer works is still being presented",
          }
        : null,
  };

  const needsAuth = sec?.authed && !authed && me !== null && !unreachable;
  const showUnavailable = sec?.authed && !authed && unreachable;
  const showRail =
    authed &&
    !needsAuth &&
    effectivePath !== `${CONSOLE}/signin` &&
    Boolean(here.key);

  // Every time the console prints is on the account's clock: the zone
  // set on Profile, or UTC when none is (Jamie, 2026-09-23).
  return (
    <ZoneProvider zone={me?.timezone}>
      <NavigateProvider navigate={navigate}>
        <div className="shell">
          <Chrome
            navigate={navigate}
            me={me}
            unreachable={unreachable}
            current={barArea(effectivePath)}
          />

          <div
            className={`mx-auto flex w-full max-w-page flex-auto items-stretch ${narrow ? "flex-col" : "flex-row"}`}
          >
            {showRail && here.product === "ladder" ? (
              <LadderRail
                me={me}
                search={search}
                here={here}
                navigate={navigate}
                narrow={narrow}
              />
            ) : showRail ? (
              <Rail
                me={me}
                agent={agent}
                here={here}
                navigate={navigate}
                narrow={narrow}
                counts={counts}
                dots={dots}
              />
            ) : null}

            <main className="page">
              <div
                className={`page__inner${showRail ? "" : " page__inner--solo"}`}
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
                {showRail && <DocsStrip here={here} />}
              </div>
            </main>
          </div>

          <Disclaimer />
        </div>
      </NavigateProvider>
    </ZoneProvider>
  );
}
