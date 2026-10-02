/** The one mail shell, for every kind Elixir sends: the weekly reports,
 *  the milestone and actions mail, and the transactional sign-in code,
 *  welcome and operator notices the relay renders (2026-10-01, the
 *  redesign boards). A login and a clan report are recognisably the same
 *  sender: the logo and the wordmark "Elixir", a pill naming the product
 *  and the day, a panel with a gold top bar, and one footer that says why
 *  the mail came, how to stop it (bulk kinds only), the send's own id,
 *  the sponsor line and the Fan Content disclaimer.
 *
 *  Mail is not a browser. Tables and inline styles only: no flex, no
 *  grid, no background images, no stylesheet, no SVG. Images are https
 *  PNGs on Elixir's own origin, never data URIs and never Supercell's
 *  CDN, and each says what it is in its alt text. Dark only, by decision
 *  (Jamie, 2026-09-18, from the gallery). */
import { DISCLAIMER } from "@elixir-mcp/contracts";

export const SITE = "https://elixir.poapkings.com";
export const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** The mail palette, from the boards (gen/email.py, after the relay's
 *  own): values are copied, not imported, because mail cannot read a
 *  stylesheet. A win is blue and a loss rose, everywhere Elixir draws a
 *  record; gold is the brand and the button, never a data value. */
export const M = {
  bg: "#0b0920",
  panel: "#120f2a",
  edge: "#2a2450",
  ink: "#f7f4ff",
  muted: "#c8c1e6",
  faint: "#a99fce",
  dim: "#7d74ad",
  gold: "#f5c84c",
  goldOn: "#241a02",
  row: "#221c44",
  box: "#19143a",
  well: "#17123a",
  pill: "#1d1840",
  raised: "#221a52",
  ring: "#4c4193",
  link: "#c4b5fd",
  win: "#7fb6f8",
  loss: "#fb7185",
  ok: "#4ade80",
  accent: "#8b5cf6",
  warn: "#fcd34d",
};

/** Mode colours, as the console's mode dots draw them. Modes are never
 *  pooled: each record in a mail sits beside its own mode's colour. */
export const MODE_COLOR = {
  ladder: "#a78bfa",
  ranked: "#7fb6f8",
  war: "#f472b6",
  casual: "#94a3b8",
  event: "#2dd4bf",
  challenge: "#2dd4bf",
  tournament: "#2dd4bf",
};

/** Jamie's logo, rendered at 48 and 96 px (apps/site/src/assets/mail),
 *  drawn at 44: the 96 file keeps it sharp on a 2x screen. */
const LOGO_URL = `${SITE}/assets/mail/elixir-96.png`;

export const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** The pill at the top right: the product a mail belongs to, and when it
 *  comes. The sources are the console's (Clan, Ladder, Friends, Cards,
 *  Collectors, Account). */
const MAIL_SOURCE = {
  clan_report: { product: "Clan", when: "Monday" },
  arena_week: { product: "Ladder", when: "Tuesday" },
  tracking_report: { product: "Friends", when: "Wednesday" },
  top_100: { product: "Cards", when: "Thursday" },
  card_of_week: { product: "Cards", when: "Friday" },
  collector_activity: { product: "Collectors", when: "Sunday" },
  milestone: { product: "Ladder", when: "Milestone" },
  clan_actions_waiting: { product: "Clan", when: "Actions" },
  login: { product: "Account", when: "Sign in" },
  welcome: { product: "Account", when: "Welcome" },
  owner_notify: { product: "Console", when: "Notice" },
};

/** When each weekly kind is sent: the EventBridge crons in
 *  infra/template.yaml (pinned by test), every one at 14:00 UTC. A
 *  footer says it in the reader's own zone. day is 0 = Sunday. */
export const MAIL_SCHEDULE = {
  clan_report: { day: 1, hour: 14, minute: 0 },
  arena_week: { day: 2, hour: 14, minute: 0 },
  tracking_report: { day: 3, hour: 14, minute: 0 },
  top_100: { day: 4, hour: 14, minute: 0 },
  card_of_week: { day: 5, hour: 14, minute: 0 },
  collector_activity: { day: 0, hour: 14, minute: 0 },
};

/** "Central", "Eastern", "UTC": a zone's everyday name. */
function zoneName(timezone, at) {
  if (!timezone || /^(UTC|Etc\/(UTC|GMT|Zulu)|GMT)$/i.test(timezone))
    return "UTC";
  try {
    const part = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longGeneric",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!part) return timezone;
    if (/^GMT$|^GMT\+00:00$/.test(part)) return "UTC";
    return part.replace(/ Standard Time$| Time$/, "");
  } catch {
    return "UTC";
  }
}

/** A weekly kind's send in the reader's zone, this week: {weekday,
 *  time, zone}, e.g. {weekday: "Monday", time: "9:00 am", zone:
 *  "Central"}. The weekday is the reader's (14:00 UTC on a Monday is
 *  already Tuesday in Sydney), and the hour follows daylight time. */
function sendTime(kind, timezone = "UTC", now = new Date()) {
  const slot = MAIL_SCHEDULE[kind];
  if (!slot) return null;
  const at = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + (slot.day - now.getUTCDay()),
      slot.hour,
      slot.minute,
    ),
  );
  const tz = zoneName(timezone, at) === "UTC" ? "UTC" : timezone;
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
    }).formatToParts(at);
  }
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`,
    zone: zoneName(tz, at),
  };
}

/** The footer's first words: why this mail came, and when the next one
 *  does. The facts behind each line are the kind's recipients and its
 *  schedule (docs/email); this only says them. */
function whyLine(kind, timezone = "UTC", now = new Date()) {
  const t = sendTime(kind, timezone, now);
  const on = t ? `on ${t.weekday}s at ${t.time} ${t.zone}` : "";
  switch (kind) {
    case "clan_report":
      return `You get this ${on}, for each clan you track.`;
    case "arena_week":
      return `You get this ${on}, in a week you or one of your players battled.`;
    case "collector_activity":
      return `You get this ${on}, while you run a collector.`;
    case "tracking_report":
    case "top_100":
    case "card_of_week":
      return `You get this ${on}.`;
    case "milestone":
      return "You get this when you or one of your players reaches something. Elixir checks every hour.";
    case "clan_actions_waiting":
      return "You get this when an action in your clan waits for your decision.";
    case "login":
      return "You get this because someone asked to sign in to Elixir with this address.";
    case "welcome":
      return "You get this once, when your access is approved.";
    case "owner_notify":
      return "You get this because you run this Elixir.";
    default:
      return "You get this because it is on for your Elixir account.";
  }
}

// The footer's hrefs are Elixir's own URLs (the manage page, the signed
// one-click link, the send's record), printed as built.
const footLink = (href, text, extra = "") =>
  `<a href="${href}" style="color:${M.muted};${extra}">${text}</a>`;

/**
 * The page around a mail's body.
 *
 *  - kind: names the pill (MAIL_SOURCE) and the footer's why-line.
 *  - title/subtitle: html (the caller escapes); a mail with no title
 *    (the sign-in code) leads with its body.
 *  - preheader: the hidden inbox preview, the same string the renderer
 *    returns as `preheader`. Its span's style starts `display:none`,
 *    which is how htmlToText drops it from the text part.
 *  - why: the footer's first line; defaults to whyLine(kind, timezone).
 *  - manage: {url, unsubscribe, turnOff} on a bulk kind: the manage page
 *    and the one-click turn-off, already tagged as the caller wants.
 *    Transactional mail has none, and never an unsubscribe.
 *  - send: {id, record, report, list} when the send has an id.
 *  - support: the sponsor line's link.
 *  - pixel: the open pixel's tag, or "".
 */
export function mailShell({
  kind,
  docTitle,
  title = "",
  subtitle = "",
  preheader = "",
  body,
  why = null,
  timezone = "UTC",
  manage = null,
  send = null,
  support = `${SITE}/support`,
  pixel = "",
}) {
  const src = MAIL_SOURCE[kind] ?? { product: "Elixir", when: "" };
  const pill = src.when ? `${src.product} · ${src.when}` : src.product;
  const head = title
    ? `<h1 style="margin:0;font-family:${FONT};font-size:26px;line-height:1.2;font-weight:800;color:${M.ink};">${title}</h1>
        ${subtitle ? `<p style="margin:6px 0 22px;font-family:${FONT};font-size:14px;line-height:1.5;color:${M.faint};">${subtitle}</p>` : `<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>`}`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>${esc(docTitle ?? "Elixir")}</title></head>
<body style="margin:0;padding:0;background-color:${M.bg};-webkit-text-size-adjust:100%;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${M.bg}" style="background-color:${M.bg};"><tr><td align="center" style="padding:24px 12px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  <tr><td style="padding:0 4px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="44" valign="middle" style="width:44px;"><img src="${LOGO_URL}" alt="" width="44" height="44" style="display:block;width:44px;height:44px;border:0;outline:none;text-decoration:none;" /></td>
      <td valign="middle" style="padding-left:10px;font-family:${FONT};font-size:24px;line-height:1;font-weight:800;color:${M.gold};">Elixir</td>
      <td align="right" valign="middle"><span style="display:inline-block;padding:5px 11px;border-radius:999px;background-color:${M.pill};border:1px solid ${M.edge};font-family:${FONT};font-size:12.5px;font-weight:600;color:${M.muted};white-space:nowrap;">${esc(pill)}</span></td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${M.panel}" style="background-color:${M.panel};border:1px solid ${M.edge};border-radius:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="${M.gold}" style="height:4px;background-color:${M.gold};border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 24px 26px;">
        ${head}
        ${body}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:20px 6px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${M.faint};">
    <p style="margin:0 0 8px;">${esc(why ?? whyLine(kind, timezone))}${manage ? ` ${footLink(manage.url, "Manage your emails")} · ${footLink(manage.unsubscribe, `Turn off ${esc(manage.turnOff)}`)}` : ""}</p>
    ${send ? `<p style="margin:0 0 8px;">This email is ${footLink(send.record, esc(send.id), `font-family:${MONO};font-size:11.5px;`)} · Something not right? ${footLink(send.report, "Send feedback about this email")} · ${footLink(send.list, "Every email sent to you")}</p>` : ""}
    <p style="margin:0 0 8px;">Elixir is free and sponsor-supported; sponsorship changes nothing about your account. ${footLink(support, "Support Elixir")}</p>
    <p style="margin:0;font-size:11.5px;">${esc(DISCLAIMER)}</p>
  </td></tr>
</table></td></tr></table>${pixel}</body></html>`;
}

/** Inline components every kind draws from. `T` tags a link into the
 *  site with the mail's campaign (render.mjs); the relay's transactional
 *  mail passes none and its links stay bare. */
export function mailParts(T = (u) => u) {
  const p = (
    html,
    { color = M.muted, size = 14.5, mb = 12, extra = "" } = {},
  ) =>
    `<p style="margin:0 0 ${mb}px;font-family:${FONT};font-size:${size}px;line-height:1.6;color:${color};${extra}">${html}</p>`;
  const small = (html, extra = "") =>
    `<p style="margin:8px 0 0;font-family:${FONT};font-size:12.5px;line-height:1.55;color:${M.faint};${extra}">${html}</p>`;
  const h2 = (text, right = "") =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 10px;"><tr>
      <td style="font-family:${FONT};font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:${M.muted};">${esc(text)}</td>
      ${right ? `<td align="right" style="font-family:${FONT};font-size:12.5px;color:${M.faint};white-space:nowrap;">${right}</td>` : ""}</tr></table>`;
  const link = (url, text, extra = "") =>
    `<a href="${esc(T(url))}" style="color:${M.link};text-decoration:none;${extra}">${text}</a>`;
  /** The gold button, with its address printed beneath it: buttons get
   *  stripped, and a link nobody can copy is a dead end. */
  const button = (label, url, { shown = null, tag = true } = {}) => {
    const href = tag ? T(url) : url;
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px;"><tr><td bgcolor="${M.gold}" style="background-color:${M.gold};border-radius:10px;">
      <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:${FONT};font-size:15px;font-weight:700;color:${M.goldOn};text-decoration:none;border-radius:10px;">${esc(label)}</a></td></tr></table>
      <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;color:${M.faint};word-break:break-all;">or open <a href="${esc(href)}" style="font-family:${MONO};color:${M.muted};text-decoration:none;">${esc(shown ?? url.replace(/^https:\/\//, ""))}</a></p>`;
  };
  /** A rounded box on the panel (a deck, a battle, an action). */
  const box = (inner, { pad = "12px 14px", mt = 0 } = {}) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${mt}px;"><tr><td bgcolor="${M.box}" style="background-color:${M.box};border:1px solid ${M.edge};border-radius:12px;padding:${pad};">${inner}</td></tr></table>`;
  /** The coverage note: what the mail could and could not see. */
  const cov = (html) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td bgcolor="${M.well}" style="background-color:${M.well};border:1px solid ${M.edge};border-radius:10px;padding:11px 13px;font-family:${FONT};font-size:12.5px;line-height:1.55;color:${M.faint};">${html}</td></tr></table>`;
  /** Rows: a title, a line under it, an optional right-hand cell; a
   *  hairline between them. `mark` is a small coloured square, the
   *  mail's stand-in for the board's icons (no SVG in mail). */
  const rows = (items) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items
      .map(
        (it, i) =>
          `<tr>${it.mark ? `<td width="18" valign="top" style="width:18px;padding:${i ? 14 : 4}px 0 0;"><div style="width:10px;height:10px;border-radius:3px;background-color:${it.mark};font-size:0;line-height:0;">&nbsp;</div></td>` : ""}<td valign="top" style="padding:${i ? 10 : 0}px 0 10px;${i < items.length - 1 ? `border-bottom:1px solid ${M.row};` : ""}">
        <div style="font-family:${FONT};font-size:14.5px;font-weight:600;line-height:1.4;color:${M.ink};">${it.title}</div>
        ${it.text ? `<div style="font-family:${FONT};font-size:13px;line-height:1.5;color:${M.muted};margin-top:2px;">${it.text}</div>` : ""}</td>${it.right != null ? `<td align="right" valign="top" style="padding:${i ? 10 : 0}px 0 10px 10px;white-space:nowrap;font-family:${FONT};font-size:13px;color:${M.muted};${i < items.length - 1 ? `border-bottom:1px solid ${M.row};` : ""}">${it.right}</td>` : ""}</tr>`,
      )
      .join("")}</table>`;
  return { p, small, h2, link, button, box, cov, rows };
}
