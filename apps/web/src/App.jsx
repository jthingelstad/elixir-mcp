import {
  InitialTimeProvider,
  ErrorBoundary,
  FeedbackSheet,
  Icon,
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
import { FEEDBACK_CATEGORIES } from "@elixir-mcp/contracts";
import { api } from "./api.js";
import { keys, useAgentMe, useInvalidate } from "./lib/queries.js";
import { CardArtSource } from "./components/CardArtSource.jsx";
import { CONSOLE, appPath } from "./lib/console.js";
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
import { LadderRail } from "./ladder/LadderRail.jsx";
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
  // An agent's own pages (2026-09-23): the pages that make sense for an agent, scoped
  // to one you own, at /console/agent/<public_id>/<page>. Verify,
  // Profile and Admin are a person's; Explore and Status are the same for
  // everyone and stay yours. `scoped` marks the id segment
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
 * The rails. Every address still resolves; only where the rail marks it moved
 * (railPosition below). `subs` render only while their item is current, and no
 * two items the reader can see at once share a label.
 *
 * Settings is one rail for the account's own pages, reached from the avatar's
 * menu; the pages keep their addresses until step 6. Explore has its own,
 * reached from Search. Agents and Admin stay in the switcher at Settings' head.
 */
export const SETTINGS_RAIL = [
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
    group: "Collectors",
    key: "collectors",
    label: "Collectors",
    icon: "server",
    to: `${CONSOLE}/status/collectors`,
  },
  {
    key: "efficiency",
    label: "Efficiency",
    icon: "heart-pulse",
    to: `${CONSOLE}/status/efficiency`,
  },
  // What you have filed, and its answers. The foot's sheet files a new one.
  {
    group: "Feedback",
    key: "feedback",
    label: "Your feedback",
    icon: "message-square",
    to: `${CONSOLE}/account/feedback`,
  },
];

/** Explore, where Search leads until the search sheet exists. */
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

/** The foot of Settings' and Explore's rails: feedback is always one click away,
 *  and every item is answered. It opens the kit's sheet in place, as
 *  Ladder's and Clan's do (2026-10-20), with the page you are on riding
 *  along; `history` is where what you have filed is read, linked from
 *  the sheet and from the account menu. */
export const RAIL_FOOT = {
  key: "feedback",
  label: "Send feedback",
  icon: "message-square",
  history: `${CONSOLE}/account/feedback`,
};

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

const AGENT_ID = /^[a-z0-9]{8,16}$/;

/** The rail of an agent's pages: yours, reshaped to what an agent is.
 *  Same keys as yours where the page is the same page, so the docs strip
 *  and the rail tests read both one way. */
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
    const explore = { rail: "explore", doc: "explore" };
    const kinds = ["players", "clans", "meta", "weeks"];
    if (kinds.includes(page)) return { ...explore, key: page };
    if (page === "player" && rest)
      return { ...explore, key: "players", doc: "explore:player" };
    if (page === "clan" && rest)
      return { ...explore, key: "clans", doc: "explore:record" };
    if (page === "week" && rest)
      return { ...explore, key: "weeks", doc: "explore:record" };
    if (page && rest)
      return { ...explore, key: "lookup", doc: "explore:record" };
    return { ...explore, key: "lookup" };
  }
  if (section === "status" && ["collectors", "efficiency"].includes(page))
    return {
      rail: "settings",
      key: page,
      doc:
        page === "efficiency"
          ? "status:efficiency"
          : rest
            ? // A record and the raise form both read the operators guide.
              "status:collector"
            : "status:collectors",
    };
  // Admin's rail's items are its pages.
  if (section === "admin") {
    const key = page ?? "requests";
    return { rail: "admin", key, doc: `admin:${key}` };
  }
  // The in-app charts are the corpus in detail, reached from the site's
  // /data page and the service page. They sit under Explore's rail with no
  // item marked: losing the whole navigation on one route is worse.
  if (section === "data" && page === "dashboard")
    return { rail: "explore", key: "charts", doc: "explore" };
  if (section === "account") {
    const settings = { rail: "settings" };
    // Activity's three logs went three ways. MCP requests, and a call
    // record (/activity/c/<request_id>), sit under Usage; Emails, and an
    // email record (/activity/e/<send_id>), under Emails from Elixir;
    // Account events are Sign-ins. `sub` still names the log, for the page
    // that draws it.
    if (page === "activity") {
      const log =
        rest === "c"
          ? "requests"
          : rest === "e"
            ? "emails"
            : (rest ?? "requests");
      if (log === "emails")
        return {
          ...settings,
          key: "emails",
          sub: "emails",
          doc: rest === "e" ? "activity:email" : "activity:emails",
        };
      if (log === "events")
        return {
          ...settings,
          key: "signins",
          sub: "events",
          doc: "activity:events",
        };
      return {
        ...settings,
        key: "usage",
        sub: "requests",
        doc: rest === "c" ? "activity:call" : "activity:requests",
      };
    }
    if (page === "profile") {
      if (rest === "email")
        return { ...settings, key: "emails", doc: "profile:email" };
      if (rest === "devices")
        return { ...settings, key: "devices", doc: "profile:devices" };
      return { ...settings, key: "profile", doc: "profile:profile" };
    }
    if (page === "connections")
      return { ...settings, key: "connections", doc: "connections:clients" };
    // The agent list is addressable in its own right, but it belongs to
    // Connections in the rail: an agent IS a connection.
    if (page === "agents")
      return { ...settings, key: "connections", doc: "connections:agents" };
    // /account/tracking/<tag> is a record of a tracked thing, which
    // belongs to Tracking rather than being a section of its own.
    if (page === "tracking" && rest)
      return { ...settings, key: "tracking", doc: "tracking:record" };
    return { ...settings, key: page };
  }
  return {};
}

/**
 * One doc map for every page with a rail, keyed by rail item or `item:sub`.
 * Every such page has an entry — the strip is only consistent if
 * nothing falls through to a generic index link, which is exactly what
 * it replaced.
 */
export const DOC_LINKS = {
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
      ["How collectors get work", "/docs/architecture#collectors-in-depth"],
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
      ["How collectors get work", "/docs/architecture#collectors-in-depth"],
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
  "admin:pulse": [
    "What is counted",
    [
      ["Privacy", "/docs/privacy"],
      ["What the mail counts", "/docs/email#what-the-mail-counts"],
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
  "admin:discord": [
    "What Elixir posts to Discord",
    [
      ["Timeline cross-post", "/docs/timeline#cross-posting-to-discord"],
      ["Actions in Discord", "/docs/clan-actions#actions-in-the-clans-discord"],
      [
        "The clan's activity",
        "/docs/clan-policy#the-clans-activity-in-discord",
      ],
      ["Privacy", "/docs/privacy"],
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

/** A battle's public page (2026-10-01): /battle/<short id>, a 12 to 64
 *  character hex prefix of the battle id. */
const BATTLE_PATH = /^\/battle\/[0-9a-f]{12,64}$/;

/** Which place the bar marks as the one you are in, from the route. A battle's
 *  public page is in no place, nor are Settings' pages: the bar's Search tab
 *  stands for Explore. */
export function barArea(path) {
  if (isHome(path)) return "home";
  if (isLadder(path)) return "ladder";
  if (isClan(path)) return "clan";
  const section = (appPath(path) ?? "").split("/")[1];
  return section === "explore" || section === "data" ? "search" : undefined;
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
  // A battle's public page is the app's too.
  if (BATTLE_PATH.test(path)) return path;
  // Ladder resolves its own paths.
  if (isLadder(path)) return ladderLegal(path);
  const app = appPath(path);
  if (app === null) return null;
  const [, section, page] = app.split("/");
  const sec = SECTIONS[section];
  if (!sec) return null;
  // Explore's records are addressable, so it resolves its own paths.
  if (section === "explore") return path;
  // An agent's pages: a public id, then one of its pages. Whether the
  // agent is yours is the server's answer (a 404 the page says), not a
  // routing question.
  if (sec.scoped) {
    const [, , id, agentPage] = app.split("/");
    if (!AGENT_ID.test(id ?? "")) return null;
    if (sec.pages.some((p) => p.slug === agentPage)) return path;
    return `${CONSOLE}/${section}/${id}/${sec.pages[0].slug}`;
  }
  if (sec.pages.some((p) => p.slug === page)) return path;
  if (section === "account") return HOME;
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

/** What the rail head switches between: you, each agent you own, and Admin
 *  for an admin. Each is a place with its own address, never a mode the app
 *  remembers. */
export function railConsoles(me, openAgent = null) {
  const primary = (me?.claims ?? []).find((c) => c.is_primary);
  const name = primary?.nickname ?? primary?.name ?? me?.email ?? undefined;
  return [
    {
      key: "me",
      group: "You",
      icon: "gauge",
      label: "Your account",
      detail: [name, me?.role].filter(Boolean).join(" · ") || undefined,
      to: `${CONSOLE}/account/profile`,
    },
    // A removed agent (0215) is left out unless it is the one open now.
    ...(me?.agents ?? [])
      .filter((a) => !a.removed_at || a.public_id === openAgent)
      .map((a) => ({
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
            label: "Admin",
            detail: ["every account", me.role].filter(Boolean).join(" · "),
            to: `${CONSOLE}/admin/requests`,
          },
        ]
      : []),
  ];
}

/** The rail: the kit's, fed the rail this place belongs to (Settings, Explore,
 *  an agent's or Admin's), filtered by who is looking, with the reader's counts
 *  and the two dots attached by key. Who you are and the way out are the bar's
 *  account menu, never the rail's. */
function Rail({ me, agent, here, navigate, narrow, counts, dots = {} }) {
  const [feedback, setFeedback] = useState(false);
  const invalidate = useInvalidate();
  const consoles = railConsoles(me, here.scope);
  const admin = here.rail === "admin";
  const explore = here.rail === "explore";
  const rail = here.scope
    ? agentRail(here.scope)
    : admin
      ? ADMIN_RAIL.filter((r) => !r.ownerOnly || me?.is_owner)
      : explore
        ? EXPLORE_RAIL
        : SETTINGS_RAIL;
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
  const account = here.scope ?? (admin ? "admin" : "me");
  const current = consoles.find((c) => c.key === account) ?? consoles[0];

  // Feedback is filed as you, from your own pages (2026-09-23): an agent's
  // pages and Admin have no foot.
  const files = !here.scope && !admin;
  const name = here.scope
    ? "Agent"
    : admin
      ? "Admin"
      : explore
        ? "Explore"
        : "Settings";
  return (
    <>
      <RailList
        label={`${name} sections`}
        items={items}
        current={here.key}
        sub={here.sub}
        navigate={navigate}
        narrow={narrow}
        title={name}
        subtitle={
          explore
            ? undefined
            : here.scope
              ? (agent?.name ?? current.label)
              : current.label
        }
        // Explore reads the same for everyone, so it has no one to switch to.
        accounts={explore ? undefined : consoles}
        account={account}
        manage={
          explore
            ? undefined
            : { label: "Manage agents…", to: `${CONSOLE}/account/agents` }
        }
        foot={
          files
            ? {
                label: RAIL_FOOT.label,
                icon: RAIL_FOOT.icon,
                onClick: () => setFeedback(true),
              }
            : undefined
        }
      />
      {files && feedback && (
        <FeedbackSheet
          area="console"
          categories={FEEDBACK_CATEGORIES}
          about="About Elixir. The page you are on rides along."
          context={{ page: here.key, ...(here.sub ? { sub: here.sub } : {}) }}
          send={async (body) => {
            const r = await api.sendFeedback(body);
            // Your feedback page and the rail's counts read it next.
            if (r.ok) invalidate(keys.me);
            return r;
          }}
          onClose={() => setFeedback(false)}
          itemHref={(id) => `${RAIL_FOOT.history}/${id}`}
          historyHref={RAIL_FOOT.history}
        />
      )}
    </>
  );
}

/** The foot of every page with a rail: one slot, one shape, one map. An
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
      url.pathname === SERVICE_STATUS ||
      BATTLE_PATH.test(url.pathname)
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
          This part of Elixir shows your recorded history. Verify your email to
          create an account or sign in.
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
  /^\/(home|signin|console|ladder|clan|battle|data\/service)(\/|$)/;

const rootRoute = createRootRoute({
  beforeLoad: ({ location }) => {
    const path = location.pathname;
    const owned = legalRoute(movedTo(path) ?? path);
    if (owned === null) {
      // CloudFront only sends this app's own paths here, so anything else
      // got here by a link inside the page and is a site document: load it.
      if (typeof window !== "undefined" && !APP_PATHS.test(path))
        window.location.replace(path);
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

const dataRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: `${CONSOLE}/data/{-$page}`,
  component: lazyRouteComponent(() => import("./views/Data.jsx"), "Data"),
});

export const routeTree = rootRoute.addChildren([
  homeRoute,
  signInRoute,
  accountRoute,
  agentRoute,
  exploreRoute,
  statusRoute,
  serviceRoute,
  adminRoute,
  dataRoute,
  battleRoute,
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
      search: search ?? {},
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
  const { pathname } = useLocation();
  // Nothing at this address brings its own shell (MissingPage).
  if (legalRoute(movedTo(pathname) ?? pathname) === null) return <Outlet />;
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
  /** The two dots the design puts on the rail: unread on an agent's Timeline
   *  while the feed holds news since those pages last showed it (its own
   *  place, never a connection's read pointer: Jamie, 2026-10-20), and
   *  an alert on Connections while a credential that no longer works is
   *  still being presented — the one thing on this rail that wants you
   *  before you go looking. */
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
  const showRail = authed && !needsAuth && Boolean(here.key);

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
        </ShellFrame>
      </NavigateProvider>
    </ZoneProvider>
  );
}
