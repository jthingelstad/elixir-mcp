/**
 * Where Settings lives (redesign step 6): every page of your account under one
 * prefix, the route table's shape in one place. The left rail stays here and
 * only here; Home, Stats and Clan have none of it.
 */
export const SETTINGS = "/settings";

/** Admin, for Elixir's staff, under Settings since 2026-11-12 (the Console
 *  folded). The client only hides it; every read behind it is gated on the
 *  server. */
export const ADMIN = `${SETTINGS}/admin`;

/** Admin's pages, by slug; the ones that open a record take an id. */
export const ADMIN_PAGES = {
  accounts: "Accounts",
  feedback: "Feedback",
  emails: "Emails",
  discord: "Discord",
  comments: "Comments",
  connections: "Connections",
  usage: "Usage",
  service: "Service",
  fleet: "Fleet",
  efficiency: "Efficiency",
  cards: "Cards",
  collectors: "Collectors",
  "service-tokens": "Service tokens",
};
const ADMIN_RECORDS = new Set(["accounts", "feedback", "emails", "discord"]);

export const isSettings = (path) =>
  path === SETTINGS || path.startsWith(`${SETTINGS}/`);

/** The rail. "Collectors" draws only for someone who runs one. */
export const SETTINGS_RAIL = [
  {
    key: "profile",
    label: "Profile",
    icon: "user-round",
    to: `${SETTINGS}/profile`,
  },
  {
    key: "seen",
    label: "What members see",
    icon: "eye",
    to: `${SETTINGS}/what-members-see`,
  },
  // Comments' setting and your blocks (2026-11-16): drawn only while
  // comments are on (`/api/me` features.comments).
  {
    key: "comments",
    label: "Comments & blocks",
    icon: "message-circle",
    to: `${SETTINGS}/comments`,
    commentsOnly: true,
  },
  {
    key: "players",
    label: "Players & following",
    icon: "radar",
    to: `${SETTINGS}/players`,
  },
  { key: "emails", label: "Emails", icon: "mail", to: `${SETTINGS}/emails` },
  {
    key: "notifications",
    label: "Notifications",
    icon: "bell",
    to: `${SETTINGS}/notifications`,
  },
  {
    key: "connections",
    label: "Connections",
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
  // Staff only: the client hides it, the server gates every read behind it.
  {
    key: "admin",
    label: "Admin",
    icon: "shield",
    to: `${ADMIN}/accounts`,
    adminOnly: true,
  },
];

/** The parts of a Settings path: `key` is the rail item it belongs to, `page`
 *  names the frame to draw, and `id` the record it opens. Null when the address is not a page. Segments are as the
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
    case "what-members-see":
      return second ? null : at("seen", "seen");
    case "comments":
      return second ? null : at("comments", "comments");
    case "players":
      if (!second) return at("players", "players");
      if (second === "verify") return third ? null : at("players", "verify");
      if (third === "verify")
        return fourth ? null : at("players", "verify", { id: second });
      return third ? null : at("players", "player", { id: second });
    case "notifications":
      return second ? null : at("notifications", "notifications");
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
    case "admin":
      // Admin keeps its own rail: `key` is its page there.
      if (!second)
        return at("accounts", "admin", { rail: "admin", admin: "accounts" });
      if (!ADMIN_PAGES[second] || fourth) return null;
      if (third && !ADMIN_RECORDS.has(second)) return null;
      return at(second, "admin", {
        rail: "admin",
        admin: second,
        ...(third ? { id: third } : {}),
      });
    default:
      return null;
  }
}

/** The address itself when it is a page, the bare prefixes' landing when it
 *  is partial, null when it was never a page. */
export function settingsLegal(path) {
  const clean = path.length > 1 ? path.replace(/\/$/, "") : path;
  if (clean === SETTINGS) return `${SETTINGS}/profile`;
  if (clean === ADMIN) return `${ADMIN}/accounts`;
  // A page Admin never had, or no longer has (Requests and Beta pulse went
  // with the approval era, 2026-11-12), lands on its first one.
  if (clean.startsWith(`${ADMIN}/`) && !settingsHere(clean))
    return `${ADMIN}/accounts`;
  return settingsHere(clean) ? path : null;
}

const TITLES = {
  profile: "Profile",
  seen: "What members see",
  players: "Players & following",
  player: "Player",
  verify: "Verify",
  emails: "Emails",
  notifications: "Notifications",
  comments: "Comments & blocks",
  sent: "Sent to you",
  email: "Email",
  connections: "Connections",
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
};

/** The tab title's lead for a Settings path. */
export const settingsTitle = (path) => {
  const here = settingsHere(path);
  if (here?.page === "admin") return ADMIN_PAGES[here.admin];
  return TITLES[here?.page] ?? "Settings";
};
