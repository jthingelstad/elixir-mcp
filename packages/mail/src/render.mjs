/** The renderer: facts in, {subject, preheader, html} out, for the six
 *  product kinds. The shell and the components are the transactional
 *  templates' idiom (services/email-relay/src/templates.mjs) grown for
 *  report mail: packages/design tokens inline, tables, 600 px, a 2x2
 *  tile grid at every width (a 4-up row cramps a phone and media
 *  queries are not honoured everywhere), names as links into Browse,
 *  the coverage note last, the switch and the disclaimer in the footer.
 *  Dark only, by decision (Jamie, 2026-09-18, from the gallery). */
import { DISCLAIMER } from "@elixir-mcp/contracts";
import { pixelPath, pixelTag } from "./pixel.mjs";

const SITE = "https://elixir.poapkings.com";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

// packages/design/src/tokens.css, the 2026-09-09 handoff. Values are
// copied, not imported: mail cannot read a stylesheet.
const DARK = {
  ground: "#0c0920",
  chrome: "#100c26",
  panel: "#1a1440",
  raised: "#221a52",
  head: "#181135",
  line: "#3a3175",
  lineSoft: "#2d2560",
  lineRow: "#241d4e",
  ink: "#faf8ff",
  body: "#ddd7f5",
  dim: "#bdb4e2",
  faint: "#a29ad0",
  link: "#b49dfb",
  gold: "#f5c84c",
  goldOn: "#2a1500",
  ok: "#4ade80",
  bad: "#fb7185",
  warn: "#fcd34d",
  accent: "#8b5cf6",
  tile: "#221a52",
};
const C = DARK;

export const KIND_LABELS = {
  clan_report: "Clan report",
  arena_week: "Your week in the Arena",
  tracking_report: "Tracking report",
  top_100: "Top 100",
  collector_activity: "Collector activity",
  milestone: "Milestones",
};

const esc = (v) =>
  String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const n = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US"));
const signed = (v) =>
  v == null ? "—" : v > 0 ? `+${n(v)}` : v < 0 ? `−${n(-v)}` : "0";
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
// Browse record pages: /explore/player/<tag without #> (apps/web
// views/Explore.jsx, tagPath). Names in mail are always these links.
const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));
const playerUrl = (tag) => `${SITE}/explore/player/${tagPath(tag)}`;
const clanUrl = (tag) => `${SITE}/explore/clan/${tagPath(tag)}`;

/** Links into the site carry the campaign tag Tinylytics reads
 *  (utm_source=email, utm_medium=<kind>, utm_campaign=<kind>-<period>),
 *  so the site's own cookieless analytics can say which mail brought
 *  someone in and to what. No pixel, no redirector: the tag is on the
 *  link, the count happens on the page (docs/email). */
export function tagLink(url, campaign) {
  if (!campaign || !url.startsWith(SITE)) return url;
  const u = new URL(url);
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_medium", campaign.kind);
  u.searchParams.set("utm_campaign", `${campaign.kind}-${campaign.period}`);
  return u.toString();
}

function make(campaign = null, { pixel = true } = {}) {
  const T = (url) => tagLink(url, campaign);
  const P = (tag, name) =>
    `<a href="${T(playerUrl(tag))}" title="${esc(tag)}" style="color:${C.link};text-decoration:underline;text-decoration-color:${C.lineSoft};text-underline-offset:2px;">${esc(name)}</a>`;
  const K = (tag, name) =>
    `<a href="${T(clanUrl(tag))}" title="${esc(tag)}" style="color:${C.link};text-decoration:underline;text-decoration-color:${C.lineSoft};text-underline-offset:2px;">${esc(name)}</a>`;
  const delta = (v) =>
    v == null
      ? `<span style="color:${C.faint}">—</span>`
      : v > 0
        ? `<span style="color:${C.ok}">+${n(v)}</span>`
        : v < 0
          ? `<span style="color:${C.bad}">−${n(-v)}</span>`
          : `<span style="color:${C.faint}">0</span>`;
  const p = (html, extra = "") =>
    `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.55;color:${C.body};${extra}">${html}</p>`;
  const h2 = (text, sub = "") =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 10px;"><tr>
      <td style="font-family:${FONT};font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:${C.gold};padding-bottom:6px;border-bottom:1px solid ${C.line};">${esc(text)}${sub ? `<span style="float:right;font-weight:400;letter-spacing:0;text-transform:none;color:${C.faint};">${esc(sub)}</span>` : ""}</td></tr></table>`;
  const h3 = (html) =>
    `<div style="font-family:${FONT};font-size:16px;font-weight:700;color:${C.ink};margin:18px 0 6px;">${html}</div>`;
  const small = (html) =>
    `<div style="font-family:${FONT};font-size:12.5px;line-height:1.5;color:${C.faint};margin:6px 0 0;">${html}</div>`;
  // Tiles: inline-block cells, two per row at every width. A 4-up row is
  // cramped on a phone and a media query is not reliably honoured, so the
  // 2x2 grid is the one layout every client gets.
  const tiles = (items) =>
    `<div style="margin:10px -4px 4px;font-size:0;">${items
      .map(
        ([label, value, hint]) =>
          `<div style="display:inline-block;vertical-align:top;width:50%;box-sizing:border-box;padding:4px;"><div bgcolor="${C.tile}" style="background-color:${C.tile};border:1px solid ${C.lineSoft};border-radius:10px;padding:10px 12px 9px;">
          <div style="font-family:${FONT};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.faint};">${esc(label)}</div>
          <div style="font-family:${FONT};font-size:22px;font-weight:700;color:${C.ink};line-height:1.2;margin-top:2px;">${value}</div>
          ${hint ? `<div style="font-family:${FONT};font-size:12px;color:${C.dim};margin-top:2px;">${hint}</div>` : `<div style="font-size:12px;line-height:1.35;">&nbsp;</div>`}
        </div></div>`,
      )
      .join("")}</div>`;
  const table = (cols, rows, { align = [], mono = [] } = {}) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px;">
      <tr>${cols.map((c, i) => `<th align="${align[i] ?? "left"}" style="font-family:${FONT};font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${C.faint};padding:6px 6px 6px 0;border-bottom:1px solid ${C.line};white-space:nowrap;">${esc(c)}</th>`).join("")}</tr>
      ${rows.map((r) => `<tr>${r.map((cell, i) => `<td align="${align[i] ?? "left"}" style="font-family:${mono[i] ? MONO : FONT};font-size:${mono[i] ? 13 : 14}px;line-height:1.35;color:${C.body};padding:7px 6px 7px 0;border-bottom:1px solid ${C.lineRow};${align[i] === "right" ? "white-space:nowrap;" : ""}">${cell}</td>`).join("")}</tr>`).join("")}
    </table>`;
  const list = (items) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">${items
      .map(
        (it) =>
          `<tr><td valign="top" style="font-family:${FONT};font-size:14px;color:${C.gold};padding:3px 8px 3px 0;">•</td><td style="font-family:${FONT};font-size:14.5px;line-height:1.5;color:${C.body};padding:3px 0;">${it}</td></tr>`,
      )
      .join("")}</table>`;
  const button = (label, url) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 6px;"><tr><td bgcolor="${DARK.gold}" style="background-color:${DARK.gold};border-radius:8px;">
      <a href="${T(url)}" style="display:inline-block;padding:11px 18px;font-family:${FONT};font-size:14px;font-weight:700;color:${DARK.goldOn};text-decoration:none;">${esc(label)}</a></td></tr></table>
      <div style="font-family:${FONT};font-size:12px;color:${C.faint};word-break:break-all;">${esc(url)}</div>`;
  const cov = (text) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td bgcolor="${C.head}" style="background-color:${C.head};border-left:3px solid ${C.accent};padding:10px 12px;font-family:${FONT};font-size:12.5px;line-height:1.5;color:${C.dim};"><strong style="color:${C.ink};">Coverage.</strong> ${text}</td></tr></table>`;

  function shell({
    kind,
    title,
    subtitle,
    preheader,
    body,
    unsubscribeKind,
    extraFooter = "",
    links,
  }) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background-color:${DARK.ground};-webkit-text-size-adjust:100%;">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${DARK.ground}" style="background-color:${DARK.ground};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
  <tr><td style="padding:2px 4px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${FONT};font-size:18px;font-weight:800;letter-spacing:.18em;color:${DARK.ink};">ELIXIR</td>
      <td align="right" style="font-family:${FONT};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${DARK.faint};">${esc(kind)}</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${C.panel}" style="background-color:${C.panel};border:1px solid ${C.line};border-radius:16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="height:4px;background-color:${DARK.gold};border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:24px 22px 22px;">
        <div style="font-family:${FONT};font-size:24px;font-weight:800;line-height:1.2;color:${C.ink};">${title}</div>
        ${subtitle ? `<div style="font-family:${FONT};font-size:14px;color:${C.dim};margin-top:4px;">${subtitle}</div>` : ""}
        ${body}
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:18px 8px 0;font-family:${FONT};font-size:11.5px;line-height:1.6;color:${DARK.faint};">
    ${extraFooter}
    You get this because it is on for your Elixir account. <a href="${T(links.manage)}" style="color:${DARK.link};">Manage your emails</a> · <a href="${links.unsubscribe}" style="color:${DARK.link};">Turn off ${esc(unsubscribeKind)}</a><br>
    ${esc(DISCLAIMER)}
  </td></tr>
</table></td></tr></table>${campaign && pixel ? pixelTag(pixelPath(campaign.kind, campaign.period)) : ""}</body></html>`;
  }
  return {
    T,
    P,
    K,
    delta,
    p,
    h2,
    h3,
    small,
    tiles,
    table,
    list,
    button,
    cov,
    shell,
  };
}

// ---------------------------------------------------------------- kinds

const ordinal = (k) =>
  k == null
    ? ""
    : `${k}${["th", "st", "nd", "rd"][k % 100 > 10 && k % 100 < 14 ? 0 : Math.min(k % 10, 4) % 4] ?? "th"}`;
const rec = (x) => `${x.wins}–${x.losses}`;
const wr = (x) => pct(x.wins + x.losses ? x.wins / (x.wins + x.losses) : null);

function arena(f, c) {
  const pr = f.primary;
  const t = pr.totals;
  const modes =
    pr.modes.length === 0
      ? c.small("No battles recorded this week.")
      : c.table(
          ["Mode", "Battles", "W–L", "Win rate"],
          pr.modes.map((m) => [esc(m.label), n(m.battles), rec(m), wr(m)]),
          { align: ["left", "right", "right", "right"] },
        ) +
        c.small(
          pr.modes
            .filter((m) => m.note)
            .map((m) => `${esc(m.label)}: ${esc(m.note)}.`)
            .join(" "),
        );
  const decks = pr.decks.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${pr.decks
        .map(
          (
            d,
          ) => `<tr><td style="padding:8px 0;border-bottom:1px solid ${C.lineRow};">
      <div style="font-family:${FONT};font-size:14px;color:${C.body};line-height:1.45;">${d.cards.map(esc).join(" · ")}</div>
      <div style="font-family:${FONT};font-size:12.5px;color:${C.faint};margin-top:2px;">${esc(d.mode)} · ${d.battles} battle${d.battles === 1 ? "" : "s"} · ${rec(d)}${d.level_gap == null ? "" : ` · level gap ${signed(Number(d.level_gap.toFixed(1)))}`}</div></td></tr>`,
        )
        .join("")}</table>`
    : c.small("No decks recorded this week.");
  const opp = pr.opponents.rows.length
    ? c.table(
        ["Opponent", "Mode", "", "Day"],
        pr.opponents.rows.map((o) => [
          c.P(o.tag, o.name),
          esc(o.mode),
          `<span style="color:${o.result === "W" ? C.ok : o.result === "L" ? C.bad : C.faint};font-weight:700;">${esc(o.result)}</span>`,
          esc(o.when),
        ]),
        { align: ["left", "left", "center", "right"] },
      ) +
      c.small(
        `${pr.opponents.rows.length < pr.opponents.distinct ? `Showing ${pr.opponents.rows.length} of ${pr.opponents.distinct}. ` : ""}${pr.opponents.repeats ? `${pr.opponents.repeats} met more than once.` : "Every opponent this week was new."}`,
      )
    : c.small("No head-to-head battles recorded this week.");
  const alts = f.alts
    .map(
      (a) =>
        `${c.h3(c.P(a.tag, a.name))}${c.tiles([
          ["Battles", n(a.battles)],
          ["Record", rec(a)],
          ["Sessions", n(a.sessions)],
          ["Win rate", wr(a)],
        ])}${a.modes.length ? c.small(a.modes.map((m) => `${esc(m.label)} ${rec(m)}`).join(" · ")) : ""}`,
    )
    .join("");
  const floor = pr.trophies?.floored
    ? c.small(
        `${c.P(pr.tag, pr.name)} stood on the ${n(pr.trophies.floor)} floor${pr.trophies.arena ? ` (${esc(pr.trophies.arena)})` : ""} this week: a loss there costs nothing, so read the record, not the trophy line.`,
      )
    : "";
  const body = `
    ${c.tiles([
      [
        "Battles",
        n(t.battles),
        `${t.sessions} session${t.sessions === 1 ? "" : "s"}`,
      ],
      ["Record", rec(t), pct(t.win_rate)],
      [
        "Trophies",
        n(pr.trophies?.to),
        pr.trophies ? c.delta(pr.trophies.to - pr.trophies.from) : "",
      ],
      [
        "Crowns",
        `${t.crowns_for}–${t.crowns_against}`,
        t.three_crown_rate == null
          ? ""
          : `${pct(t.three_crown_rate)} three-crown`,
      ],
    ])}
    ${floor}
    ${c.h2("By mode")}${modes}
    ${c.h2("Decks")}${decks}
    ${c.h2("Who you battled", pr.opponents.distinct ? `${pr.opponents.distinct} opponent${pr.opponents.distinct === 1 ? "" : "s"}` : "")}${opp}
    ${f.alts.length ? `${c.h2("Your alts")}${alts}` : ""}
    ${c.cov(esc(pr.coverage))}`;
  const altsNote = f.alts.length
    ? ` and ${f.alts.length} alt${f.alts.length === 1 ? "" : "s"}`
    : "";
  return {
    subject: `Your week in the Arena: ${rec(t)}, ${f.week.label}`,
    preheader: `${t.battles} battles, ${rec(t)}${pr.trophies ? `, ${signed(pr.trophies.to - pr.trophies.from)} trophies` : ""}.`,
    html: (links) =>
      c.shell({
        kind: KIND_LABELS.arena_week,
        title: "Your week in the Arena",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${c.P(pr.tag, pr.name)}${altsNote}`,
        preheader: `${t.battles} battles, ${rec(t)}.`,
        body,
        unsubscribeKind: "Your week in the Arena",
        links,
      }),
  };
}

function tracking(f, c) {
  const pr = f.primary;
  const rel = (label) =>
    `<span style="font-family:${FONT};font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${C.faint};margin-left:8px;">${label}</span>`;
  const moments = (ms) =>
    ms?.length
      ? c.list(
          ms.map(
            (m) =>
              `<span style="color:${C.faint};font-family:${MONO};font-size:12px;">${esc(m.when)}</span>&nbsp; ${esc(m.text)}`,
          ),
        )
      : c.small("No moments this week.");
  const you = pr
    ? `${c.h3(`${c.P(pr.tag, pr.name)}${rel("you")}`)}
    ${c.tiles([
      [
        "Trophies",
        n(pr.trophies?.to),
        pr.trophies ? c.delta(pr.trophies.to - pr.trophies.from) : "",
      ],
      [
        "Battles",
        n(pr.battles),
        `${rec(pr)}, ${pr.sessions} session${pr.sessions === 1 ? "" : "s"}`,
      ],
      ["War", n(pr.war_battles), "battles this week"],
      [
        "Clan",
        pr.clan ? c.K(pr.clan.tag, pr.clan.name) : "—",
        pr.clan?.rank ? `rank #${pr.clan.rank}` : "",
      ],
    ])}
    ${moments(pr.moments)}`
    : c.small("No primary player is claimed on this account.");
  const alts = f.alts
    .map(
      (a) =>
        `${c.h3(`${c.P(a.tag, a.name)}${rel("alt")}`)}${c.tiles([
          [
            "Battles",
            n(a.battles),
            `${a.sessions} session${a.sessions === 1 ? "" : "s"}`,
          ],
          ["Record", rec(a), a.battles && a.losses === 0 ? "unbeaten" : wr(a)],
        ])}${moments(a.moments)}`,
    )
    .join("");
  const friends = f.friends
    .map(
      (
        a,
      ) => `${c.h3(`${c.P(a.tag, a.name)}${a.nickname ? ` <span style="font-weight:400;color:${C.dim};">(${esc(a.nickname)})</span>` : ""}${rel("friend")}`)}
    ${c.p(`${n(a.battles)} battle${a.battles === 1 ? "" : "s"} in ${a.sessions} session${a.sessions === 1 ? "" : "s"}, ${rec(a)}${a.modes ? `; ${esc(a.modes)}` : ""}.${a.trophies ? ` Trophies ${n(a.trophies.from)} → ${n(a.trophies.to)} (${c.delta(a.trophies.to - a.trophies.from)}).` : ""}`)}${a.moments?.length ? moments(a.moments) : ""}`,
    )
    .join("");
  const watching = f.watching.length
    ? c.table(
        ["Watching", "This week", "Trophies"],
        f.watching.map((w) => [
          c.P(w.tag, w.name),
          esc(w.line),
          c.delta(w.delta),
        ]),
        { align: ["left", "left", "right"] },
      )
    : "";
  const clans = f.clans.length
    ? c.list(
        f.clans.map(
          (k) =>
            `<strong style="color:${C.ink};">${c.K(k.tag, k.name)}</strong> — ${esc(k.line)}`,
        ),
      )
    : "";
  const quiet = f.quiet?.length
    ? c.small(
        `Quiet all week: ${f.quiet.map((q) => `${c.P(q.tag, q.name)} (${q.days} days)`).join(", ")}.`,
      )
    : "";
  const body = `${c.h2("You")}${you}${f.alts.length ? `${c.h2("Your alts")}${alts}` : ""}${f.friends.length ? `${c.h2("Friends")}${friends}` : ""}${f.watching.length ? `${c.h2("Watching")}${watching}` : ""}${quiet}${f.clans.length ? `${c.h2("Clans you track")}${clans}` : ""}${c.cov(esc(f.coverage))}`;
  const players =
    1 +
    f.alts.length +
    f.friends.length +
    f.watching.length +
    (f.quiet?.length ?? 0);
  return {
    subject: `Tracking report, ${f.week.label}`,
    preheader: f.preheader ?? `${players} players, ${f.clans.length} clans.`,
    html: (links) =>
      c.shell({
        kind: KIND_LABELS.tracking_report,
        title: "Tracking report",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${players} player${players === 1 ? "" : "s"}, ${f.clans.length} clan${f.clans.length === 1 ? "" : "s"}`,
        preheader: f.preheader ?? "",
        body,
        unsubscribeKind: "the Tracking report",
        links,
      }),
  };
}

function clan(f, c) {
  const war = f.war?.present
    ? `${c.h2("War", `Season ${f.war.season}, week ${f.war.week}`)}
    ${c.tiles([
      ["Place", f.war.rank ? `#${f.war.rank}` : "—", "of 5 boats"],
      [
        "Fame",
        n(f.war.fame),
        f.war.finished_early ? "crossed the line early" : "boat fame",
      ],
      [
        "War trophies",
        signed(f.war.trophy_change),
        f.war.clan_score ? `clan score ${n(f.war.clan_score)}` : "",
      ],
      [
        "Battled",
        f.war.participants == null ? "—" : n(f.war.participants),
        "members with points",
      ],
    ])}`
    : "";
  const names = (xs, extra) =>
    c.list(
      xs.map(
        (m) =>
          `${c.P(m.tag, m.name)} <span style="color:${C.faint};">${extra(m)}</span>`,
      ),
    );
  const mem = `${c.h2("Membership", `${f.clan.members_from} → ${f.clan.members}`)}
    ${f.membership.joined.length ? `${c.h3("Joined")}${names(f.membership.joined, (m) => `${esc(m.when)}${m.note ? ` · ${esc(m.note)}` : ""}`)}` : ""}
    ${f.membership.left.length ? `${c.h3("Left")}${names(f.membership.left, (m) => `${esc(m.when)}${m.role ? ` · was ${esc(m.role)}` : ""}`)}` : ""}
    ${f.membership.roles.length ? `${c.h3("Roles")}${names(f.membership.roles, (m) => `${esc(m.from)} → ${esc(m.to)}`)}` : ""}
    ${!f.membership.joined.length && !f.membership.left.length && !f.membership.roles.length ? c.small("No joins, departures or role changes.") : ""}`;
  const stand = f.standouts.length
    ? `${c.h2("Standouts")}${c.list(f.standouts.map((s) => `<strong style="color:${C.ink};">${c.P(s.tag, s.name)}</strong> — ${esc(s.text)}`))}`
    : "";
  const notes = [];
  if (f.badges?.length)
    notes.push(
      `Badges: ${f.badges.map((b) => `${esc(b.name)} (${esc(b.badge)})`).join(", ")}.`,
    );
  if (f.presence?.returned?.length)
    notes.push(
      `Back: ${f.presence.returned.map((r) => `${esc(r.name)} after ${r.days} days`).join(", ")}.`,
    );
  if (f.presence?.quiet?.length)
    notes.push(
      `Quiet: ${f.presence.quiet.map((r) => `${esc(r.name)} (${r.days} days)`).join(", ")}.`,
    );
  const roster = c.table(
    ["#", "Member", "Role", "Trophies", "Week", "Battles"],
    f.roster.map((r, i) => [
      `<span style="color:${C.faint};">${i + 1}</span>`,
      c.P(r.tag, r.name),
      `<span style="color:${r.role === "member" ? C.faint : C.dim};font-size:12.5px;">${esc(r.role)}</span>`,
      n(r.trophies),
      c.delta(r.delta),
      r.battles == null
        ? `<span style="color:${C.faint};">—</span>`
        : n(r.battles),
    ]),
    { align: ["right", "left", "left", "right", "right", "right"] },
  );
  const h = f.headline;
  const body = `
    ${c.tiles([
      ["Battles", n(h.battles), `${h.active} of ${h.of} members`],
      ["Sessions", n(h.sessions), ""],
      [
        "Donations",
        n(h.donations),
        h.donations_leader
          ? `led by ${c.P(h.donations_leader.tag, h.donations_leader.name)} (${h.donations_leader.n})`
          : "",
      ],
      [
        "Members",
        n(f.clan.members),
        c.delta(f.clan.members - f.clan.members_from),
      ],
    ])}
    ${war}${mem}${stand}${notes.length ? c.small(notes.join(" ")) : ""}
    ${c.h2("Roster", `${f.roster.length} members, by trophies`)}${roster}
    ${f.roster_note ? c.small(esc(f.roster_note)) : ""}
    ${c.cov(esc(f.coverage))}`;
  const warBit =
    f.war?.present && f.war.rank ? `${ordinal(f.war.rank)} in war, ` : "";
  return {
    subject: `${f.clan.name}, ${f.week.label}: ${warBit}${f.membership.left.length} left, ${f.membership.joined.length} joined`,
    preheader: `${warBit}${n(h.battles)} battles by ${h.active} members; ${n(h.donations)} donations.`,
    html: (links) =>
      c.shell({
        kind: KIND_LABELS.clan_report,
        title: c.K(f.clan.tag, f.clan.name),
        subtitle: `${esc(f.week.label)} · Season ${f.week.season}${f.week.war_week != null ? `, war week ${f.week.war_week}` : ""}`,
        preheader: `${warBit}${n(h.battles)} battles.`,
        body,
        unsubscribeKind: "the Clan report",
        links,
      }),
  };
}

/** A small markdown for the Top 100 body: headings, paragraphs, bold,
 *  bullet lists, pipe tables, links; player names in `players_index`
 *  become Browse links wherever they appear as text. */
function markdownToMail(md, c, index = []) {
  const link = (text) => {
    let out = esc(text);
    for (const { name, tag } of index) {
      if (!name) continue;
      const needle = esc(name);
      if (out.includes(needle)) out = out.split(needle).join(c.P(tag, name));
    }
    return out
      .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.ink};">$1</strong>`)
      .replace(
        /\[([^\]]+)\]\((https?:[^)]+)\)/g,
        (m, text, url) =>
          `<a href="${c.T(url)}" style="color:${C.link};">${text}</a>`,
      );
  };
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      out.push(
        h[1].length <= 2 ? c.h2(h[2].replace(/\*\*/g, "")) : c.h3(link(h[2])),
      );
      i++;
      continue;
    }
    if (/^\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        rows.push(lines[i]);
        i++;
      }
      const cells = (r) =>
        r
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((x) => x.trim());
      const head = cells(rows[0]);
      const bodyRows = rows
        .slice(1)
        .filter((r) => !/^\|\s*:?-+/.test(r))
        .map(cells);
      const align = head.map((_, k) => (k === 0 ? "left" : "right"));
      out.push(
        c.table(
          head,
          bodyRows.map((r) =>
            r.map((x, k) =>
              k === 0
                ? link(x)
                : `<span style="font-family:${MONO};font-size:13px;">${link(x)}</span>`,
            ),
          ),
          { align },
        ),
      );
      continue;
    }
    if (/^[-*]\s+/.test(l)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push(c.list(items.map(link)));
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#|\||[-*]\s)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(c.p(link(para.join(" "))));
  }
  return out.join("\n");
}

function top100(f, c) {
  const body = `
    ${markdownToMail(f.body_markdown, c, f.players_index ?? [])}
    ${f.cta ? `${c.h2(f.cta.head)}${c.p(esc(f.cta.text))}${c.button(f.cta.button, f.cta.url)}` : ""}
    ${f.players_index?.length ? `${c.h2("Players in this issue")}<div style="font-family:${MONO};font-size:11.5px;line-height:1.7;color:${C.faint};">${f.players_index.map((x) => `${esc(x.name)} ${esc(x.tag)}`).join(" · ")}</div>` : ""}
    ${c.cov(esc(f.coverage))}`;
  const share = f.share_url
    ? `Forward this, or share <a href="${c.T(f.share_url)}" style="color:${DARK.link};">${esc(f.share_url)}</a><br>`
    : "";
  return {
    subject: f.subject,
    preheader: f.preheader ?? "",
    html: (links) =>
      c.shell({
        kind: f.masthead,
        title: esc(f.masthead),
        subtitle: `${esc(f.strap)} · ${esc(f.issue.label)} · Season ${f.issue.season}, day ${f.issue.day_of_season}`,
        preheader: f.preheader ?? "",
        body,
        unsubscribeKind: f.masthead,
        extraFooter: share,
        links,
      }),
  };
}

function collector(f, c) {
  const t = f.totals;
  const k = f.collectors.length;
  const mb = (b) => (b == null ? "—" : `${(b / 1e6).toFixed(0)} MB`);
  const rows = c.table(
    ["Collector", "Fetches", "Share", "Errors", "Uptime"],
    f.collectors.map((x) => [
      `<strong style="color:${C.ink};">${esc(x.name)}</strong>${x.version ? ` <span style="color:${C.faint};font-size:12px;">${esc(x.version)}</span>` : ""}${x.note ? `<div style="color:${C.faint};font-size:12px;">${esc(x.note)}</div>` : ""}`,
      n(x.fetches),
      pct(t.fetches ? x.fetches / t.fetches : null),
      x.errors ? n(x.errors) : `<span style="color:${C.faint};">0</span>`,
      x.status !== "active"
        ? `<span style="color:${C.warn};">${esc(x.status)}</span>`
        : x.quiet_hours
          ? `<span style="color:${C.warn};">${x.quiet_hours} h quiet</span>`
          : `<span style="color:${C.ok};">full</span>`,
    ]),
    { align: ["left", "right", "right", "right", "right"] },
  );
  const endpoints = f.by_endpoint.length
    ? c.table(
        ["Endpoint", "Fetches", "Share"],
        f.by_endpoint.map(([e, v]) => [
          esc(e),
          n(v),
          pct(t.fetches ? v / t.fetches : null),
        ]),
        { align: ["left", "right", "right"] },
      )
    : c.small("No fetches recorded this week.");
  const body = `
    ${c.p(`<strong style="color:${C.ink};">Thank you.</strong> Your ${k === 1 ? "collector" : `${k} collectors`} made ${n(t.fetches)} fetches this week, ${pct(t.of_fleet)} of everything the fleet recorded. Every battle, roster and board in the record came through a machine somebody chose to run.`, "margin-top:16px;")}
    ${c.tiles([
      ["Fetches", n(t.fetches), `${k} collector${k === 1 ? "" : "s"}`],
      [
        "Sent",
        mb(t.submitted_bytes),
        t.saved_share == null
          ? ""
          : `${pct(t.saved_share)} filtered at the edge`,
      ],
      [
        "Errors",
        n(t.errors),
        `${t.breaker_trips} breaker trip${t.breaker_trips === 1 ? "" : "s"}`,
      ],
      [
        "Quiet",
        t.quiet_hours ? `${t.quiet_hours} h` : "None",
        t.quiet_hours ? "across your collectors" : "every collector, all week",
      ],
    ])}
    ${c.h2("Your collectors")}${rows}
    ${c.h2("What they fetched")}${endpoints}
    ${c.h2("What you earned")}${c.tiles([
      ["Credits", `+${n(f.credits.earned)}`, "1 per 10 fetches, pooled"],
      [
        "Daily calls",
        n(f.credits.applied),
        f.credits.capped
          ? `base ${n(f.credits.base)}; the 4× cap binds`
          : `base ${n(f.credits.base)}`,
      ],
      [
        "Bonus slots",
        `+${f.credits.slots.players} / +${f.credits.slots.clans}`,
        "players / clan watch, once per account",
      ],
      [
        "Lifetime",
        n(f.lifetime.points),
        `points · ${n(f.lifetime.credits)} credits`,
      ],
    ])}
    ${f.fleet_note ? c.small(esc(f.fleet_note)) : ""}
    ${c.cov(esc(f.coverage))}`;
  return {
    subject: `Your collectors, ${f.week.label}: ${n(t.fetches)} fetches`,
    preheader: `${n(t.fetches)} fetches across ${k} collector${k === 1 ? "" : "s"}, +${n(f.credits.earned)} credits. Thank you.`,
    html: (links) =>
      c.shell({
        kind: KIND_LABELS.collector_activity,
        title: "Your collectors this week",
        subtitle: `${esc(f.week.label)} · ${k} Elixir Collector${k === 1 ? "" : "s"} on your account`,
        preheader: `${n(t.fetches)} fetches. Thank you.`,
        body,
        unsubscribeKind: "Collector activity",
        links,
      }),
  };
}

function milestone(f, c) {
  const card = (
    m,
  ) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;"><tr><td bgcolor="${C.tile}" style="background-color:${C.tile};border:1px solid ${C.lineSoft};border-left:4px solid ${DARK.gold};border-radius:12px;padding:16px 16px 14px;">
      <div style="font-family:${FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${C.faint};">${m.subject.relationship === "alt" ? `your alt ${c.P(m.subject.tag, m.subject.name)}` : c.P(m.subject.tag, m.subject.name)} · ${esc(m.at)}</div>
      <div style="font-family:${FONT};font-size:22px;font-weight:800;line-height:1.2;color:${C.ink};margin-top:4px;">${esc(m.headline)}</div>
      ${m.big ? `<div style="font-family:${FONT};font-size:34px;font-weight:800;color:${DARK.gold};line-height:1.1;margin-top:10px;">${esc(m.big)}</div><div style="font-family:${FONT};font-size:12.5px;color:${C.faint};">${esc(m.big_label ?? "")}</div>` : ""}
      ${m.lines?.length ? c.list(m.lines.map(esc)) : ""}
      ${m.next ? c.small(`<strong style="color:${C.dim};">Next:</strong> ${esc(m.next)}`) : ""}
    </td></tr></table>`;
  const body = `${f.milestones.map(card).join("")}
    ${f.also?.length ? `${c.h2("Also")}${c.list(f.also.map((a) => `${c.P(a.tag, a.name)} — ${esc(a.text)}`))}` : ""}
    ${c.cov("Milestones come from the record as it is polled, usually within the hour. A move down never mails; only firsts do.")}`;
  const first = f.milestones[0];
  const more = f.milestones.length - 1;
  return {
    subject: more > 0 ? `${first.headline} (+${more} more)` : first.headline,
    preheader: first.lines?.[0] ?? first.headline,
    html: (links) =>
      c.shell({
        kind: "Milestone",
        title: `Congratulations, ${esc(f.account.name)}`,
        subtitle: esc(first.headline),
        preheader: first.headline,
        body,
        unsubscribeKind: "Milestone emails",
        links,
      }),
  };
}

const RENDERERS = {
  arena_week: arena,
  tracking_report: tracking,
  clan_report: clan,
  top_100: top100,
  collector_activity: collector,
  milestone,
};

/** {subject, preheader, html} for a kind's facts. `links.unsubscribe`
 *  is the signed one-click URL for this recipient and kind;
 *  `links.manage` the account page; `links.period` (a week key, an
 *  issue date, a day) names the issue in the campaign tag on every link
 *  into the site and in the pixel's path. */
export function renderMail(kind, facts, links) {
  const fn = RENDERERS[kind];
  if (!fn) throw new Error(`renderMail: unknown kind ${kind}`);
  if (!links?.unsubscribe || !links?.manage)
    throw new Error(
      "renderMail: links.unsubscribe and links.manage are required",
    );
  const campaign = links.period ? { kind, period: String(links.period) } : null;
  const out = fn(facts, make(campaign));
  return {
    subject: out.subject,
    preheader: out.preheader,
    html: out.html(links),
  };
}
