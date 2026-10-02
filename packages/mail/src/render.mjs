/** The renderer: facts in, {subject, preheader, html} out, for the eight
 *  product kinds. Every kind sits in the one mail shell (shell.mjs), the
 *  same one the relay's sign-in code and welcome use: the logo and the
 *  wordmark, the product pill, a panel with a gold top bar, and the
 *  footer that carries the turn-off link, the send id, the sponsor line
 *  and the disclaimer. Tables and inline styles only; names are links
 *  into Explore; the coverage note comes last. Dark only, by decision
 *  (Jamie, 2026-09-18, from the gallery). Each renderer hands the shell
 *  the same preheader it returns, so the inbox preview and the record of
 *  the send are one string. */
import family from "@elixir-mcp/ui/family.json" with { type: "json" };
import { pixelPath, pixelTag } from "./pixel.mjs";
import {
  SITE,
  FONT,
  MONO,
  M,
  MODE_COLOR,
  esc,
  mailShell,
  mailParts,
} from "./shell.mjs";

/** A mode group's reader-facing name (contracts MODE_GROUPS). */
const FAMILY_LABEL = {
  ladder: "Ladder",
  ranked: "Path of Legends",
  war: "War",
  casual: "Casual",
  event: "Events",
  challenge: "Challenges",
  tournament: "Tournaments",
};

// The renderers' older colour names, on the shell's palette.
const C = {
  ground: M.bg,
  panel: M.panel,
  raised: M.raised,
  head: M.well,
  line: M.edge,
  lineSoft: M.edge,
  lineRow: M.row,
  ink: M.ink,
  body: M.muted,
  dim: M.muted,
  faint: M.faint,
  link: M.link,
  gold: M.gold,
  goldOn: M.goldOn,
  ok: M.ok,
  bad: M.loss,
  warn: M.warn,
  accent: M.accent,
  tile: M.box,
};

export const KIND_LABELS = {
  clan_report: "Clan report",
  arena_week: "Your week in the Arena",
  tracking_report: "Your friends this week",
  top_100: "Top 100",
  card_of_week: "Card of the Week",
  collector_activity: "Collector activity",
  milestone: "Milestones",
  clan_actions_waiting: "Clan actions waiting",
};

/** The family's apps: a family app's own mail links back to it, and
 *  those links carry the campaign tag too (2026-09-25). Read from the
 *  kit's product manifest, the list the top bar draws: the family origin
 *  (the Console, and Elixir Clan at /clan since 2026-09-28) and every
 *  product's own, so a product added there is tagged here too. */
const FAMILY_ORIGINS = [
  ...new Set([
    family.origin,
    ...family.products.map(
      (p) => new URL(p.href ?? p.path, family.origin).origin,
    ),
  ]),
];

const n = (v) => (v == null ? "—" : Number(v).toLocaleString("en-US"));
const signed = (v) =>
  v == null ? "—" : v > 0 ? `+${n(v)}` : v < 0 ? `−${n(-v)}` : "0";
const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
// Browse record pages: /explore/player/<tag without #> (apps/web
// views/Explore.jsx, tagPath). Names in mail are always these links.
const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));
const playerUrl = (tag) => `${SITE}/console/explore/player/${tagPath(tag)}`;
const clanUrl = (tag) => `${SITE}/console/explore/clan/${tagPath(tag)}`;
// The console's record of one sent email (apps/web views/account/
// EmailRecord.jsx) and its list (views/Activity.jsx, Emails). The
// footer links the record by its id, and with ?report=1 the record
// opens straight into feedback with the email attached (Jamie,
// 2026-09-19: "something not right? send feedback", one click). The
// send id is a product identifier, not a tracking one (ENGINEERING,
// "Product identifiers versus measurement"), so these links are tagged
// like every other link into the site; the console reports the record
// page to analytics as its kind, never which record.
const SENT_MAIL_LIST_URL = `${SITE}/console/account/activity/emails`;
// The same line to everyone, in every product email (Jamie, 2026-09-19,
// the settled policy): free, sponsor-supported, sponsorship buys nothing.
const SUPPORT_URL = `${SITE}/support`;
const sentMailUrl = (sendId, { report = false } = {}) =>
  `${SITE}/console/account/activity/e/${encodeURIComponent(sendId)}${report ? "?report=1" : ""}`;

/** Links into the site carry the campaign tag Tinylytics reads
 *  (utm_source=email, utm_medium=<kind>, utm_campaign=<kind>-<period>),
 *  so the site's own cookieless analytics can say which mail brought
 *  someone in and to what. No pixel, no redirector: the tag is on the
 *  link, the count happens on the page (docs/email). */
export function tagLink(url, campaign) {
  if (!campaign || !FAMILY_ORIGINS.some((o) => url.startsWith(`${o}/`)))
    return url;
  const u = new URL(url);
  u.searchParams.set("utm_source", "email");
  u.searchParams.set("utm_medium", campaign.kind);
  u.searchParams.set("utm_campaign", `${campaign.kind}-${campaign.period}`);
  return u.toString();
}

/** A weekday in the reader's zone ("Tue"). A report composed once for
 *  everyone (the clan report) carries instants, and each recipient's
 *  render names the day in their own timezone (review 2026-09-27 §6.7:
 *  it had been composed in the first tracker's zone). */
function weekdayIn(iso, timezone = "UTC") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      weekday: "short",
    }).format(d);
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  }
}

function make(campaign = null, { pixel = true, timezone = "UTC" } = {}) {
  // An entry's day: its instant in the reader's zone, or the label an
  // issue composed before 2026-09-27 stored.
  const day = (m) => (m?.at ? weekdayIn(m.at, timezone) : (m?.when ?? ""));
  // Free text carrying {{day:<instant>}}, the same idea as the Card of
  // the Week's {{deck:N}}: the composer places the day, the render names it.
  const days = (text) =>
    String(text ?? "").replace(/\{\{day:([^}]+)\}\}/g, (_, iso) =>
      weekdayIn(iso, timezone),
    );
  const T = (url) => tagLink(url, campaign);
  const P = (tag, name) =>
    `<a href="${T(playerUrl(tag))}" title="${esc(tag)}" style="color:${M.link};text-decoration:none;font-weight:600;">${esc(name)}</a>`;
  const K = (tag, name) =>
    `<a href="${T(clanUrl(tag))}" title="${esc(tag)}" style="color:${M.link};text-decoration:none;font-weight:600;">${esc(name)}</a>`;
  const delta = (v) =>
    v == null
      ? `<span style="color:${C.faint}">—</span>`
      : v > 0
        ? `<span style="color:${C.ok}">+${n(v)}</span>`
        : v < 0
          ? `<span style="color:${C.bad}">−${n(-v)}</span>`
          : `<span style="color:${C.faint}">0</span>`;
  const parts = mailParts(T);
  const p = (html, extra = "") => parts.p(html, { extra });
  const { h2, small, box, rows } = parts;
  const h3 = (html) =>
    `<div style="font-family:${FONT};font-size:15.5px;font-weight:700;color:${M.ink};margin:18px 0 6px;">${html}</div>`;
  // Tiles: a row of up to three (the boards' row), four as two by two.
  // Table cells, not inline blocks: a phone client is not a browser.
  const tiles = (items) => {
    const per = items.length === 4 ? 2 : Math.min(3, items.length || 1);
    const out = [];
    for (let i = 0; i < items.length; i += per) {
      const row = items.slice(i, i + per);
      out.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin:${i ? 10 : 0}px 0 0;"><tr>${row
          .map(
            ([label, value, hint, mode], k) =>
              `<td valign="top" width="${Math.floor(100 / per)}%" style="padding:0 ${k < per - 1 ? 5 : 0}px 0 ${k ? 5 : 0}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${M.box}" style="background-color:${M.box};border:1px solid ${M.edge};border-radius:12px;padding:13px 14px;">
          <div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${M.faint};">${mode ? `${dot(mode)}&nbsp;` : ""}${esc(label)}</div>
          <div style="font-family:${FONT};font-size:22px;font-weight:700;color:${M.ink};line-height:1.2;margin-top:5px;">${value}</div>
          ${hint ? `<div style="font-family:${FONT};font-size:12.5px;line-height:1.45;color:${M.faint};margin-top:4px;">${hint}</div>` : ""}
        </td></tr></table></td>`,
          )
          .join(
            "",
          )}${Array.from({ length: per - row.length }, () => `<td width="${Math.floor(100 / per)}%"></td>`).join("")}</tr></table>`,
      );
    }
    return `<div style="margin:4px 0 0;">${out.join("")}</div>`;
  };
  const table = (cols, rows, { align = [], mono = [] } = {}) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px;">
      <tr>${cols.map((c, i) => `<th align="${align[i] ?? "left"}" style="font-family:${FONT};font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${M.faint};padding:6px 6px 6px 0;border-bottom:1px solid ${M.edge};white-space:nowrap;">${esc(c)}</th>`).join("")}</tr>
      ${rows.map((r) => `<tr>${r.map((cell, i) => `<td align="${align[i] ?? "left"}" style="font-family:${mono[i] ? MONO : FONT};font-size:${mono[i] ? 13 : 14}px;line-height:1.35;color:${M.muted};padding:7px 6px 7px 0;border-bottom:1px solid ${M.row};${align[i] === "right" ? "white-space:nowrap;" : ""}">${cell}</td>`).join("")}</tr>`).join("")}
    </table>`;
  const list = (items) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">${items
      .map(
        (it) =>
          `<tr><td valign="top" style="font-family:${FONT};font-size:14px;color:${M.faint};padding:3px 8px 3px 0;">•</td><td style="font-family:${FONT};font-size:14px;line-height:1.5;color:${M.muted};padding:3px 0;">${it}</td></tr>`,
      )
      .join("")}</table>`;
  const button = (label, url) => parts.button(label, url);
  const cov = (text) => parts.cov(text);

  /** The shell, with this mail's links: the manage page and the one-click
   *  turn-off, the send's record, the support page, the open pixel. */
  function shell({ kind, title, subtitle, preheader, body, turnOff, links }) {
    const id = links.send_id;
    return mailShell({
      kind,
      docTitle: String(title ?? "").replace(/<[^>]+>/g, ""),
      title,
      subtitle,
      preheader,
      body,
      timezone,
      manage: {
        url: T(links.manage),
        unsubscribe: links.unsubscribe,
        turnOff,
      },
      send: id
        ? {
            id,
            record: T(sentMailUrl(id)),
            report: T(sentMailUrl(id, { report: true })),
            list: T(SENT_MAIL_LIST_URL),
          }
        : null,
      support: T(SUPPORT_URL),
      pixel:
        campaign && pixel
          ? pixelTag(pixelPath(campaign.kind, campaign.period))
          : "",
    });
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
    box,
    rows,
    shell,
    day,
    days,
  };
}

/** A mode's small coloured square, as the console draws it. */
const dot = (mode) =>
  `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background-color:${MODE_COLOR[mode] ?? M.faint};"></span>`;

/** A record: wins blue, losses rose, everywhere Elixir draws one. */
const recHtml = (w, l) =>
  `<span style="font-family:${MONO};font-weight:700;white-space:nowrap;"><span style="color:${M.win};">${n(w)}</span><span style="color:${M.faint};">–</span><span style="color:${M.loss};">${n(l)}</span></span>`;

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
          pr.modes.map((m) => [
            esc(m.label),
            n(m.battles),
            recHtml(m.wins, m.losses),
            wr(m),
          ]),
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
          `<span style="color:${o.result === "W" ? M.win : o.result === "L" ? M.loss : C.faint};font-weight:700;">${esc(o.result)}</span>`,
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
      // One record per mode family played (DECISIONS: mode discipline);
      // a single family, or an older facts file, reads as one record.
      ...((t.by_family?.length ?? 0) > 1
        ? t.by_family
            .slice(0, 3)
            .map((m) => [
              `${FAMILY_LABEL[m.mode] ?? m.mode} record`,
              `${n(m.wins)}–${n(m.losses)}`,
              pct(m.win_rate),
            ])
        : [["Record", rec(t), pct(t.win_rate)]]),
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
  const preheader = `${t.battles} battles, ${rec(t)}${pr.trophies ? `, ${signed(pr.trophies.to - pr.trophies.from)} trophies` : ""}.`;
  return {
    subject: `Your week in the Arena: ${rec(t)}, ${f.week.label}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "arena_week",
        title: "Your week in the Arena",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${c.P(pr.tag, pr.name)}${altsNote}`,
        preheader,
        body,
        turnOff: "the Arena week",
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
  const preheader =
    f.preheader ?? `${players} players, ${f.clans.length} clans.`;
  return {
    subject: `Your friends this week, ${f.week.label}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "tracking_report",
        title: "Your friends this week",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${players} player${players === 1 ? "" : "s"}, ${f.clans.length} clan${f.clans.length === 1 ? "" : "s"}`,
        preheader,
        body,
        turnOff: "Your friends this week",
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
        f.war.war_trophies != null
          ? `${n(f.war.war_trophies)} going into the race`
          : "",
      ],
      [
        "Battled",
        f.war.battled == null ? "—" : n(f.war.battled),
        "members who used a war deck",
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
    ${f.membership.joined.length ? `${c.h3("Joined")}${names(f.membership.joined, (m) => `${esc(c.day(m))}${m.note ? ` · ${esc(m.note)}` : ""}`)}` : ""}
    ${f.membership.left.length ? `${c.h3("Left")}${names(f.membership.left, (m) => `${esc(c.day(m))}${m.role ? ` · was ${esc(m.role)}` : ""}`)}` : ""}
    ${f.membership.roles.length ? `${c.h3("Roles")}${names(f.membership.roles, (m) => `${esc(m.from)} → ${esc(m.to)}`)}` : ""}
    ${!f.membership.joined.length && !f.membership.left.length && !f.membership.roles.length ? c.small("No joins, departures or role changes.") : ""}`;
  const stand = f.standouts.length
    ? `${c.h2("Standouts")}${c.list(f.standouts.map((s) => `<strong style="color:${C.ink};">${c.P(s.tag, s.name)}</strong> — ${esc(c.days(s.text))}`))}`
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
  const preheader = `${warBit}${n(h.battles)} battles by ${h.active} members; ${n(h.donations)} donations.`;
  return {
    subject: `${f.clan.name}, ${f.week.label}: ${warBit}${f.membership.left.length} left, ${f.membership.joined.length} joined`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "clan_report",
        title: c.K(f.clan.tag, f.clan.name),
        subtitle: `${esc(f.week.label)} · Season ${f.week.season}${f.week.war_week != null ? `, war week ${f.week.war_week}` : ""}`,
        preheader,
        body,
        turnOff: "the clan report",
        links,
      }),
  };
}

/** A small markdown for the Top 100 body: headings, paragraphs, bold,
 *  bullet lists, pipe tables, links; player names in `players_index`
 *  become Browse links wherever they appear as text. */
function markdownToMail(md, c, index = [], blocks = null) {
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
    // A block the writer may PLACE but not author: it names the index
    // and the renderer prints the record's own rows.
    const block = /^\s*\{\{(\w+):(\d+)\}\}\s*$/.exec(l);
    if (block) {
      out.push(blocks?.[block[1]]?.(Number(block[2])) ?? "");
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
  const preheader = f.preheader ?? "";
  return {
    subject: f.subject,
    preheader,
    html: (links) =>
      c.shell({
        kind: "top_100",
        title: esc(f.masthead),
        subtitle: `${esc(f.strap)} · ${esc(f.issue.label)} · Season ${f.issue.season}, day ${f.issue.day_of_season}`,
        preheader,
        body,
        turnOff: f.masthead,
        links,
      }),
  };
}

/** Card art is 2:3 portrait (the card frame, 285x420 at source), never a
 *  square icon, so a width carries a height with it: a cell that sets
 *  only width stretches in Outlook, which ignores `height:auto`. */
const CARD_H = (w) => Math.round((w * 420) / 285);

/** One card cell: the form's OWN icon, the card's name as alt. The name
 *  is what the text half prints, and what a blocked-image client shows. */
/** One line, deliberately: the text alternative breaks a line on every
 *  newline in the source, so an indented cell puts each card on its own
 *  line instead of the row of four the deck actually is. */
function cardCell(card, w) {
  return `<td align="center" valign="top" style="padding:4px;"><img src="${card.icon}" alt="${esc(cardFormLabel(card))}" width="${w}" height="${CARD_H(w)}" style="display:block;border:0;outline:none;text-decoration:none;border-radius:6px;" /></td>`;
}

const cardFormLabel = (card) =>
  `${card.form === "hero" ? "Hero " : card.form === "evolution" ? "Evo " : ""}${card.name}`;

/** A deck: four cells over two rows, then its caption. Table layout
 *  only - no flex, no grid, no background image - because Outlook's
 *  engine is Word's and a phone client is not a browser. The cards come
 *  from the BRIEF, never from the writer: the model names a deck by
 *  emitting {{deck:N}} and the renderer prints what the record holds,
 *  so a deck block cannot disagree with the record. */
function deckBlock(d) {
  if (!d) return "";
  const cells = (d.cards ?? []).map((card) => cardCell(card, 64));
  const row = (xs) =>
    `<tr>${xs.join("")}${Array.from({ length: Math.max(0, 4 - xs.length) }, () => "<td></td>").join("")}</tr>`;
  const facts = [
    d.battles == null ? null : `${n(d.battles)} battles`,
    d.players == null ? null : `${n(d.players)} players`,
    d.win_rate == null ? null : `${(d.win_rate * 100).toFixed(1)}% win rate`,
  ]
    .filter(Boolean)
    .join(" · ");
  const shape = [
    d.archetype_label,
    d.average_elixir == null
      ? null
      : `${d.average_elixir.toFixed(1)} average elixir`,
    d.tower_troop,
  ]
    .filter(Boolean)
    .join(" · ");
  const caption = `<tr><td colspan="4" style="padding:6px 4px 0;font-family:${FONT};font-size:12.5px;line-height:1.5;color:${C.dim};">${esc(shape)}<br><span style="color:${C.faint};">${esc(facts)}</span></td></tr>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:12px 0 4px;">${row(cells.slice(0, 4))}${row(cells.slice(4, 8))}${caption}</table>`;
}

/** The card itself: the base art, and a form beside it when the card has
 *  one, smaller because it is the footnote and not the subject. */
function cardHero(card) {
  const extra = card.icons?.hero
    ? { url: card.icons.hero, label: `Hero ${card.name}` }
    : card.icons?.evolution
      ? { url: card.icons.evolution, label: `Evo ${card.name}` }
      : null;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:6px auto 2px;"><tr>
    <td align="center" valign="bottom" style="padding:0 6px;"><img src="${card.icons.base}" alt="${esc(card.name)}" width="160" height="${CARD_H(160)}" style="display:block;border:0;border-radius:10px;" /></td>
    ${extra ? `<td align="center" valign="bottom" style="padding:0 6px;"><img src="${extra.url}" alt="${esc(extra.label)}" width="96" height="${CARD_H(96)}" style="display:block;border:0;border-radius:8px;" /></td>` : ""}
  </tr></table>`;
}

function cardOfWeek(f, c) {
  const card = f.card;
  const line = [
    card.rarity,
    card.type,
    card.elixir_cost == null ? null : `${card.elixir_cost} elixir`,
  ]
    .filter(Boolean)
    .join(" · ");
  const blocks = { deck: (i) => deckBlock(f.decks?.[i]) };
  const body = `
    ${cardHero(card)}
    ${c.p(`<span style="text-transform:capitalize;">${esc(line)}</span>`, `text-align:center;color:${C.faint};font-size:13px;`)}
    ${markdownToMail(f.body_markdown, c, [], blocks)}
    ${
      f.chart
        ? `<div style="margin:16px 0 4px;"><img src="${f.chart.url}" alt="${esc(f.chart.alt)}" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:8px;" /></div>`
        : ""
    }
    ${c.h2("Your turn")}
    ${c.p(`Ask your agent: <strong style="color:${C.ink};">&ldquo;How am I doing with ${esc(card.name)}?&rdquo;</strong> Elixir answers from your own battles: your usage, your record with it, which of your decks carry it, and how that compares with your clan.`)}
    ${c.p(`Not on Elixir yet? <a href="${c.T(card.page_url)}" style="color:${C.link};">See the ${esc(card.name)} record</a> · <a href="${c.T(`${SITE}/`)}" style="color:${C.link};">Request an account</a>`)}
    ${c.cov(esc(f.coverage))}`;
  const preheader = f.preheader ?? "";
  return {
    subject: f.subject,
    preheader,
    html: (links) =>
      c.shell({
        kind: "card_of_week",
        title: `Card of the Week: ${esc(card.name)}`,
        subtitle: `${esc(f.issue.week_label)} · ${esc(f.issue.season_label)}`,
        preheader,
        body,
        turnOff: f.masthead,
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
      [
        "Credits",
        `+${n(f.credits.earned)}`,
        "1 per 10 points; a point is a fetch that added to the record",
      ],
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
  const preheader = `${n(t.fetches)} fetches across ${k} collector${k === 1 ? "" : "s"}, +${n(f.credits.earned)} credits. Thank you.`;
  return {
    subject: `Your collectors, ${f.week.label}: ${n(t.fetches)} fetches`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "collector_activity",
        title: "Your collectors this week",
        subtitle: `${esc(f.week.label)} · ${k} Elixir Collector${k === 1 ? "" : "s"} on your account`,
        preheader,
        body,
        turnOff: "Your collectors",
        links,
      }),
  };
}

function milestone(f, c) {
  const card = (
    m,
  ) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 0;"><tr><td bgcolor="${C.tile}" style="background-color:${C.tile};border:1px solid ${C.lineSoft};border-left:4px solid ${M.accent};border-radius:12px;padding:16px 16px 14px;">
      <div style="font-family:${FONT};font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:${C.faint};">${m.subject.relationship === "alt" ? `your alt ${c.P(m.subject.tag, m.subject.name)}` : c.P(m.subject.tag, m.subject.name)} · ${esc(m.at)}</div>
      <div style="font-family:${FONT};font-size:22px;font-weight:800;line-height:1.2;color:${C.ink};margin-top:4px;">${esc(m.headline)}</div>
      ${m.big ? `<div style="font-family:${FONT};font-size:34px;font-weight:800;color:${M.ink};line-height:1.1;margin-top:10px;">${esc(m.big)}</div><div style="font-family:${FONT};font-size:12.5px;color:${C.faint};">${esc(m.big_label ?? "")}</div>` : ""}
      ${m.lines?.length ? c.list(m.lines.map(esc)) : ""}
      ${m.next ? c.small(`<strong style="color:${C.dim};">Next:</strong> ${esc(m.next)}`) : ""}
    </td></tr></table>`;
  const body = `${f.milestones.map(card).join("")}
    ${f.also?.length ? `${c.h2("Also")}${c.list(f.also.map((a) => `${c.P(a.tag, a.name)} — ${esc(a.text)}`))}` : ""}
    ${c.cov("Milestones come from the record as it is polled, usually within the hour. A move down never mails; only firsts do.")}`;
  const first = f.milestones[0];
  const more = f.milestones.length - 1;
  const preheader = first.lines?.[0] ?? first.headline;
  return {
    subject: more > 0 ? `${first.headline} (+${more} more)` : first.headline,
    preheader,
    html: (links) =>
      c.shell({
        kind: "milestone",
        title: `Congratulations, ${esc(f.account.name)}`,
        subtitle: esc(first.headline),
        preheader,
        body,
        turnOff: "milestones",
        links,
      }),
  };
}

/**
 * clan_actions_waiting (2026-09-25; Jamie): Elixir Clan's morning mail to
 * a person who can act on something new in their clan. The app composes
 * the words (a subject, a few plain lines, a link into the app); Elixir
 * holds the address, the switch and the unsubscribe, and renders the
 * lines itself, escaped: no markup crosses from an app.
 */
function clanActions(f, c) {
  const clan = f.clan?.name ?? f.clan?.tag ?? "your clan";
  const body = `${c.p(`Waiting for you in ${c.K(f.clan.tag, clan)}:`)}
    ${c.list(f.lines.map(esc))}
    ${c.button("Open your actions", f.link)}
    ${c.cov(`${esc(f.app ?? "Elixir Clan")} sends this through Elixir after its morning run, when something new is yours to do; only people who can act on an action are sent it. Everything in it is what the app shows you signed in.`)}`;
  const preheader = f.lines[0] ?? f.subject;
  return {
    subject: f.subject,
    preheader,
    html: (links) =>
      c.shell({
        kind: "clan_actions_waiting",
        title: "Actions waiting for you",
        subtitle: esc(`${clan} · ${f.app ?? "Elixir Clan"}`),
        preheader,
        body,
        turnOff: "Actions waiting",
        links,
      }),
  };
}

const RENDERERS = {
  arena_week: arena,
  tracking_report: tracking,
  clan_report: clan,
  top_100: top100,
  card_of_week: cardOfWeek,
  collector_activity: collector,
  milestone,
  clan_actions_waiting: clanActions,
};

/** {subject, preheader, html} for a kind's facts. `links.unsubscribe`
 *  is the signed one-click URL for this recipient and kind;
 *  `links.manage` the account page; `links.period` (a week key, an
 *  issue date, a day) names the issue in the campaign tag on every link
 *  into the site and in the pixel's path; `links.send_id` (absent on a
 *  page render) is this send's own id, linked in the footer to its
 *  record in the console and to feedback about it. */
export function renderMail(kind, facts, links) {
  const fn = RENDERERS[kind];
  if (!fn) throw new Error(`renderMail: unknown kind ${kind}`);
  if (!links?.unsubscribe || !links?.manage)
    throw new Error(
      "renderMail: links.unsubscribe and links.manage are required",
    );
  const campaign = links.period ? { kind, period: String(links.period) } : null;
  // A page render (the public Top 100 issue) tags its links but counts
  // as a page view through the site's script, not as an open.
  const out = fn(
    facts,
    make(campaign, {
      pixel: links.pixel !== false,
      timezone: links.timezone ?? "UTC",
    }),
  );
  return {
    subject: out.subject,
    preheader: out.preheader,
    html: out.html(links),
  };
}
