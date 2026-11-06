/**
 * Where Settings lives (redesign step 6): every page of your account under one
 * prefix, the route table's shape in one place. The left rail stays here and
 * only here; Home, Ladder and Clan have none of it.
 *
 * Every old address reaches these through lib/moved.js.
 */
export const SETTINGS = "/settings";

export const isSettings = (path) =>
  path === SETTINGS || path.startsWith(`${SETTINGS}/`);

/** An agent's five tabs. Its timeline and feedback are pages linked from
 *  Overview, and its logs sit under Usage. */
export const AGENT_TABS = [
  { slug: "overview", label: "Overview" },
  { slug: "reads", label: "What it reads" },
  { slug: "usage", label: "Usage" },
  { slug: "connections", label: "Connections" },
  { slug: "settings", label: "Settings" },
];
const AGENT_LINKED = ["timeline", "feedback"];

/** The rail. "Collectors" draws only for someone who runs one. */
export const SETTINGS_RAIL = [
  {
    key: "profile",
    label: "Profile",
    icon: "user-round",
    to: `${SETTINGS}/profile`,
  },
  {
    key: "players",
    label: "Players & tracking",
    icon: "radar",
    to: `${SETTINGS}/players`,
  },
  { key: "emails", label: "Emails", icon: "mail", to: `${SETTINGS}/emails` },
  {
    key: "connections",
    label: "Connections & agents",
    icon: "plug",
    to: `${SETTINGS}/connections`,
  },
  {
    key: "sign-ins",
    label: "Sign-ins & devices",
    icon: "key-round",
    to: `${SETTINGS}/sign-ins`,
  },
  {
    key: "usage",
    label: "Usage and limits",
    icon: "chart-column",
    to: `${SETTINGS}/usage`,
  },
  {
    key: "feedback",
    label: "Feedback",
    icon: "message-square",
    to: `${SETTINGS}/feedback`,
  },
  {
    key: "collectors",
    label: "Collectors",
    icon: "server",
    to: `${SETTINGS}/collectors`,
    runsOne: true,
  },
];

/** The parts of a Settings path: `key` is the rail item it belongs to, `page`
 *  names the frame to draw, `agent` the agent it is scoped to, and `id` the
 *  record it opens. Null when the address is not a page. Segments are as the
 *  address has them, still encoded. */
export function settingsHere(path) {
  const clean = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (!isSettings(clean)) return null;
  const [first, second, third, fourth] = clean
    .slice(SETTINGS.length + 1)
    .split("/");
  const at = (key, page, more = {}) => ({ key, page, ...more });
  switch (first) {
    case undefined:
    case "":
      return at("profile", "profile");
    case "profile":
    case "sign-ins":
      return second ? null : at(first, first);
    case "players":
      if (!second) return at("players", "players");
      if (second === "verify") return third ? null : at("players", "verify");
      if (third === "verify")
        return fourth ? null : at("players", "verify", { id: second });
      return third ? null : at("players", "player", { id: second });
    case "emails":
      if (!second) return at("emails", "emails");
      if (second === "sent") return third ? null : at("emails", "sent");
      return third ? null : at("emails", "email", { id: second });
    case "connections":
      if (!second) return at("connections", "connections");
      return second === "discord" && !third
        ? at("connections", "discord")
        : null;
    case "usage":
      if (!second) return at("usage", "usage");
      if (second !== "requests" || fourth) return null;
      return third
        ? at("usage", "call", { id: third })
        : at("usage", "requests");
    case "feedback":
      if (third) return null;
      return second
        ? at("feedback", "feedback-item", { id: second })
        : at("feedback", "feedback");
    case "collectors":
      if (third) return null;
      if (second === "new") return at("collectors", "raise");
      return second
        ? at("collectors", "collector", { id: second })
        : at("collectors", "collectors");
    case "agents":
      return agentHere(second, third, fourth, clean);
    default:
      return null;
  }
}

function agentHere(agent, tab, item, clean) {
  if (!agent) return null;
  const parts = clean.split("/");
  const rest = parts[6];
  const base = { agent };
  const at = (page, more = {}) => ({
    key: "connections",
    page,
    tab,
    ...base,
    ...more,
  });
  if (tab === undefined) return at("agent", { tab: "overview" });
  if (tab === "usage") {
    if (!item) return rest ? null : at("agent");
    if (item === "events") return rest ? null : at("agent-events");
    if (item !== "requests" || parts[7]) return null;
    return rest ? at("call", { id: rest }) : at("requests");
  }
  if (tab === "feedback") {
    if (rest) return null;
    return item ? at("feedback-item", { id: item }) : at("feedback");
  }
  if (item) return null;
  if (AGENT_LINKED.includes(tab)) return at(tab);
  return AGENT_TABS.some((t) => t.slug === tab) ? at("agent") : null;
}

/** The address itself when it is a page, the bare prefixes' landing when it
 *  is partial, null when it was never a page. */
export function settingsLegal(path) {
  const clean = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (clean === SETTINGS) return `${SETTINGS}/profile`;
  if (clean === `${SETTINGS}/agents`) return `${SETTINGS}/connections`;
  const here = settingsHere(clean);
  if (!here) return null;
  if (here.agent && clean.split("/").length === 4) return `${clean}/overview`;
  return path;
}

const TITLES = {
  profile: "Profile",
  players: "Players & tracking",
  player: "Player",
  verify: "Verify",
  emails: "Emails",
  sent: "Sent to you",
  email: "Email",
  connections: "Connections & agents",
  discord: "Discord",
  "sign-ins": "Sign-ins & devices",
  usage: "Usage and limits",
  requests: "Requests",
  call: "Call",
  feedback: "Feedback",
  "feedback-item": "Feedback",
  collectors: "Collectors",
  collector: "Collector",
  raise: "Run a collector",
  agent: "Agent",
  "agent-events": "Account events",
  timeline: "Timeline",
};

/** The tab title's lead for a Settings path. */
export const settingsTitle = (path) =>
  TITLES[settingsHere(path)?.page] ?? "Settings";
