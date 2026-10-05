/** The renderer: facts in, {subject, preheader, html} out, for the six
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
import { cardImg, cardTiles, deckStrip, cardFormLabel } from "./cards.mjs";

/** A mode group's reader-facing name (contracts MODE_GROUPS). */
const FAMILY_LABEL = {
  ladder: "Trophy Road",
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
// Ladder, a player's own season (apps/web pages/LadderPage.jsx):
// `?player=` names one of the reader's own players, so only the Arena
// week and Milestones, which are about the reader's own, link it.
const ladderUrl = (tag, page = "") =>
  `${SITE}/ladder${page ? `/${page}` : ""}?player=${tagPath(tag)}`;
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

/** A weekday and a time in the reader's zone ("Sun 4:38 am"). */
function dayTimeIn(iso, timezone = "UTC") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = (tz) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    }).formatToParts(d);
  let parts;
  try {
    parts = fmt(timezone || "UTC");
  } catch {
    parts = fmt("UTC");
  }
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
}

/** A date in the reader's zone ("Sep 17"). */
function dateIn(iso, timezone = "UTC") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const fmt = (tz) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      month: "short",
      day: "numeric",
    }).format(d);
  try {
    return fmt(timezone || "UTC");
  } catch {
    return fmt("UTC");
  }
}

function make(
  campaign = null,
  { pixel = true, timezone = "UTC", mine = [] } = {},
) {
  // The reader's own players: the clan report marks their rows "you".
  const isMine = (tag) => mine.includes(tag);
  const dayTime = (m) => (m?.at ? dayTimeIn(m.at, timezone) : (m?.when ?? ""));
  const date = (iso) => (iso ? dateIn(iso, timezone) : "");
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
  // A paragraph: extra CSS as a string, or the part's own options
  // ({size, color, mb, extra}).
  const p = (html, opt = "") =>
    parts.p(html, typeof opt === "string" ? { extra: opt } : opt);
  const { h2, small, box, rows, link } = parts;
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
  function shell({
    kind,
    title,
    docTitle = null,
    subtitle,
    preheader,
    body,
    turnOff,
    why = null,
    source = null,
    links,
  }) {
    const id = links.send_id;
    return mailShell({
      kind,
      docTitle: docTitle ?? String(title ?? "").replace(/<[^>]+>/g, ""),
      title,
      subtitle,
      preheader,
      body,
      why,
      source,
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
    link,
    shell,
    day,
    days,
    dayTime,
    date,
    isMine,
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

/** A mode family's name in a subject line: proper names keep their
 *  capitals, the rest read as words ("Trophy Road 4–6, war 3–3"). */
const familyWord = (mode) => {
  const label = FAMILY_LABEL[mode] ?? mode;
  return mode === "ladder" || mode === "ranked" ? label : label.toLowerCase();
};

/** A deck in a box: its name with its mode's dot, its record, the eight
 *  cards, and a line with its cost and tower troop (text, never art). */
function deckBox(d, c, { title = null, right = null, w = 56 } = {}) {
  const facts = [
    d.average_elixir == null
      ? null
      : `${Number(d.average_elixir).toFixed(2)} average elixir`,
    d.tower_troop,
    d.level_gap == null || Math.abs(d.level_gap) < 0.05
      ? null
      : `${signed(Number(d.level_gap.toFixed(2)))} levels against the other side`,
  ].filter(Boolean);
  const head = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;"><tr>
      <td style="font-family:${FONT};font-size:15px;font-weight:700;color:${M.ink};">${d.family ? `${dot(d.family)}&nbsp; ` : ""}${title ?? esc(d.label ?? "This deck")}</td>
      <td align="right" style="font-family:${FONT};font-size:13px;color:${M.muted};white-space:nowrap;">${right ?? `${n(d.battles)} battle${d.battles === 1 ? "" : "s"} · ${recHtml(d.wins, d.losses)}`}</td></tr></table>`;
  return c.box(
    `${head}${deckStrip(d.cards, { w })}${facts.length ? `<div style="font-family:${FONT};font-size:12.5px;line-height:1.5;color:${M.faint};margin-top:10px;">${esc(facts.join(" · "))}</div>` : ""}`,
  );
}

function arena(f, c) {
  const pr = f.primary;
  const t = pr.totals;
  const fams = t.by_family ?? [];
  const tr = pr.trophies;
  const trDelta = tr ? tr.to - tr.from : null;
  // One record per mode played, then the trophy line: never a combined
  // win rate (DECISIONS: mode discipline).
  const tiles = [
    ...fams
      .slice(0, 3)
      .map((m) => [
        FAMILY_LABEL[m.mode] ?? m.mode,
        recHtml(m.wins, m.losses),
        `${n(m.battles)} battle${m.battles === 1 ? "" : "s"}`,
        m.mode,
      ]),
    ...(fams.length === 0 && t.battles
      ? [["Record", recHtml(t.wins, t.losses), `${n(t.battles)} battles`]]
      : []),
    ...(tr
      ? [
          [
            "Trophies",
            `<span style="font-family:${MONO};">${signed(trDelta)}</span>`,
            `${n(tr.from)} to ${n(tr.to)}`,
          ],
        ]
      : []),
  ];
  const floor = tr?.floored
    ? c.small(
        `${c.P(pr.tag, pr.name)} stood on the ${n(tr.floor)} floor${tr.arena ? ` (${esc(tr.arena)})` : ""} this week: a loss there costs nothing, so read the record, not the trophy line.`,
      )
    : "";
  const notes = (pr.modes ?? []).filter((m) => m.note);
  const war = fams.find((m) => m.mode === "war");
  const deck = pr.deck
    ? `${c.h2(`Your ${FAMILY_LABEL[pr.deck.family] ?? "main"} deck`)}${deckBox(pr.deck, c)}${c.small(`Every deck of the season, each in the mode it was played in, is in ${c.link(ladderUrl(pr.tag, "decks"), "Ladder › Decks")}.`)}`
    : "";
  const warLine = war
    ? c.p(
        `War: ${n(war.battles)} battle${war.battles === 1 ? "" : "s"}, ${recHtml(war.wins, war.losses)}.`,
        { size: 13.5, extra: "margin-top:10px;" },
      )
    : "";
  const o = pr.opponents;
  const again = o.again ?? [];
  // Who came round more than once (up to three named, the rest
  // counted), then everyone met once.
  const repeats = o.repeats ?? again.length;
  const once = (o.distinct ?? 0) - repeats;
  const named = again.map(
    (x) =>
      `${c.P(x.tag, x.name)} <span style="font-family:${MONO};font-size:12px;color:${M.faint};">${esc(x.tag)}</span> ${x.battles === 2 ? "twice" : `${n(x.battles)} times`}${x.mode ? ` on ${esc(x.mode)}` : ""}, ${recHtml(x.wins, x.losses)} between you`,
  );
  const met = o.distinct
    ? `${c.h2("Who you battled", `${n(o.distinct)} opponent${o.distinct === 1 ? "" : "s"}`)}${c.p(
        named.length
          ? `${named.join("; ")}${repeats > named.length ? `; ${n(repeats - named.length)} more came round more than once` : ""}.${once > 0 ? ` ${once === 1 ? "One other you met once." : `The other ${n(once)} you met once.`}` : ""}`
          : o.distinct === 1
            ? "One opponent, met once."
            : "Every one of them once: nobody came round twice this week.",
        { size: 14 },
      )}`
    : c.small("No head-to-head battles recorded this week.");
  const alts = f.alts.length
    ? `${c.h2("Your other players")}${c.rows(
        f.alts.map((a) => {
          const top = a.by_family?.[0];
          return {
            title: `${c.P(a.tag, a.name)} <span style="font-family:${MONO};font-size:11.5px;font-weight:400;color:${M.faint};">${esc(a.tag)}</span>`,
            text: `${top ? `${dot(top.mode)}&nbsp; ` : ""}${n(a.battles)} battle${a.battles === 1 ? "" : "s"} · ${recHtml(a.wins, a.losses)}${(a.by_family?.length ?? 0) > 1 ? ` <span style="color:${M.faint};">(${a.by_family.map((m) => `${esc(FAMILY_LABEL[m.mode] ?? m.mode)} ${m.wins}–${m.losses}`).join(", ")})</span>` : ""}`,
            right: a.trophies
              ? `<div style="font-family:${MONO};font-size:13px;color:${M.muted};">${n(a.trophies.from)} → ${n(a.trophies.to)}</div><div style="font-family:${FONT};font-size:11.5px;color:${M.faint};">trophies</div>`
              : null,
          };
        }),
      )}`
    : "";
  const altNames = f.alts.map((a) => esc(a.name));
  const body = `
    ${tiles.length ? c.tiles(tiles) : ""}
    ${fams.length > 1 ? c.small("Each mode is its own game, so each gets its own record. There is no combined win rate.") : ""}
    ${floor}${notes.length ? c.small(notes.map((m) => `${esc(m.label)}: ${esc(m.note)}.`).join(" ")) : ""}
    ${deck}${warLine}
    ${met}
    ${alts}
    ${c.button(`Open ${pr.name} in Ladder`, ladderUrl(pr.tag))}
    ${c.cov(esc(pr.coverage))}`;
  const subjectRecords = fams.length
    ? fams
        .slice(0, 3)
        .map((m) => `${familyWord(m.mode)} ${m.wins}–${m.losses}`)
        .join(", ")
    : t.battles
      ? rec(t)
      : f.week.label;
  const preheader = `${f.week.label}: ${n(t.battles)} battle${t.battles === 1 ? "" : "s"}${tr ? `, ${signed(trDelta)} trophies` : ""}${f.alts.length ? `; ${f.alts.map((a) => `${a.name} ${n(a.battles)}`).join(", ")}` : ""}.`;
  return {
    subject: `Your week in the Arena: ${subjectRecords}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "arena_week",
        title: "Your week in the Arena",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${c.P(pr.tag, pr.name)}${altNames.length ? `, with ${altNames.join(" and ")}` : ""}`,
        preheader,
        body,
        turnOff: "the Arena week",
        links,
      }),
  };
}

/** A thin bar split by mode, each mode its own colour: how a person's
 *  week divided. Table cells with widths, the mail's only bar chart. */
function modeBar(fams) {
  const total = fams.reduce((s, m) => s + m.battles, 0);
  if (!total) return "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin:10px 0 6px;"><tr>${fams
    .map(
      (m) =>
        `<td width="${Math.max(1, Math.round((m.battles / total) * 100))}%" bgcolor="${MODE_COLOR[m.mode] ?? M.faint}" style="height:6px;line-height:6px;font-size:0;background-color:${MODE_COLOR[m.mode] ?? M.faint};">&nbsp;</td>`,
    )
    .join("")}</tr></table>`;
}

/** One person's card on the friends mail (the board's EmailFriends): the
 *  name, the battles, a bar and a line per mode, a moment or two, and the
 *  deck they played most. */
function personCard(x, c) {
  const fams = x.by_family ?? [];
  const lines = fams.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${fams
        .map(
          (m) =>
            `<tr><td style="font-family:${FONT};font-size:13.5px;line-height:1.7;color:${M.muted};">${dot(m.mode)}&nbsp; ${esc(FAMILY_LABEL[m.mode] ?? m.mode)}</td><td align="right" style="font-family:${FONT};font-size:13px;color:${M.faint};white-space:nowrap;">${n(m.battles)} battle${m.battles === 1 ? "" : "s"}</td><td align="right" width="76" style="width:76px;font-size:13.5px;white-space:nowrap;">${recHtml(m.wins, m.losses)}</td></tr>`,
        )
        .join("")}</table>`
    : x.battles
      ? c.small(
          `${n(x.battles)} battles, ${recHtml(x.wins, x.losses)}${x.modes ? `; ${esc(x.modes)}` : ""}.`,
        )
      : "";
  const notes = (x.moments ?? []).slice(0, 2).map((m) => esc(m.text));
  const d = x.deck;
  const deck = d
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-top:1px solid ${M.row};"><tr>
        <td style="padding-top:10px;font-family:${FONT};font-size:13.5px;color:${M.ink};"><span style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:${M.faint};">Most played</span>&nbsp; <strong>${esc(d.label ?? "Their deck")}</strong></td>
        <td align="right" style="padding-top:10px;font-family:${FONT};font-size:12px;color:${M.faint};white-space:nowrap;">${n(d.battles)} of ${n(x.deck_battles ?? x.battles)} battles${x.decks_used > 1 ? ` · ${n(x.decks_used)} decks` : ""}</td></tr>
        <tr><td colspan="2" style="padding-top:8px;">${deckStrip(d.cards, { w: 44, gap: 5 })}</td></tr></table>`
    : "";
  return c.box(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${FONT};"><div style="font-size:15.5px;font-weight:700;">${c.P(x.tag, x.name)}${x.nickname ? ` <span style="font-weight:400;color:${M.faint};">(${esc(x.nickname)})</span>` : ""}</div><div style="font-family:${MONO};font-size:11.5px;color:${M.faint};">${esc(x.tag)}</div></td>
      <td align="right" valign="top" style="font-family:${FONT};font-size:12px;color:${M.faint};white-space:nowrap;">${n(x.battles)} battle${x.battles === 1 ? "" : "s"}${x.trophies ? `<br>${n(x.trophies.to)} trophies` : ""}</td></tr></table>
    ${modeBar(fams)}${lines}${notes.length ? `<div style="font-family:${FONT};font-size:12.5px;line-height:1.5;color:${M.faint};margin-top:6px;">${notes.join(" · ")}</div>` : ""}${deck}`,
    { mt: 10 },
  );
}

function tracking(f, c) {
  const pr = f.primary;
  // Cards for whoever the builder drew a card for (a record per mode),
  // a line for the rest; an issue from before the cards prints lines.
  const isCard = (x) => (x.by_family?.length ?? 0) > 0;
  const friendsPlayed = f.friends.filter((x) => x.battles > 0);
  // A watcher from an issue before the cards has a line and no count.
  const watchPlayed = f.watching.filter((x) => (x.battles ?? 1) > 0);
  const lineFor = (w) =>
    `${c.P(w.tag, w.name)} <span style="color:${M.faint};">${esc(w.line ?? `${n(w.battles)} battles`)}</span>`;
  const friends = f.friends.length
    ? `${c.h2("Friends", `${friendsPlayed.length} of ${f.friends.length} played`)}${friendsPlayed.map((x) => personCard(x, c)).join("")}`
    : "";
  const watchCards = f.watching.filter(isCard);
  const watchLines = watchPlayed.filter((x) => !isCard(x));
  const watching = f.watching.length
    ? `${c.h2("Watching", `${watchPlayed.length || "none"} played this week`)}${watchCards.map((x) => personCard(x, c)).join("")}${watchLines.length ? c.list(watchLines.map(lineFor)) : ""}`
    : "";
  const quietNames = [
    ...f.friends.filter((x) => !x.battles),
    ...f.watching.filter((x) => x.battles === 0),
  ];
  const quiet =
    quietNames.length || f.quiet?.length
      ? c.small(
          `No battle recorded this week: ${[
            ...quietNames.map((q) => c.P(q.tag, q.name)),
            ...(f.quiet ?? [])
              .filter((q) => !quietNames.some((x) => x.tag === q.tag))
              .map((q) => `${c.P(q.tag, q.name)} (${q.days} days)`),
          ].join(
            ", ",
          )}. A deck’s count is battles with exactly those eight cards.`,
        )
      : f.friends.length || f.watching.length
        ? c.small("A deck’s count is battles with exactly those eight cards.")
        : "";
  const youFams = pr?.by_family ?? [];
  const around = [
    ...f.clans.map((k) => ({
      title: `${c.K(k.tag, k.name)}${pr?.clan?.tag === k.tag ? `<span style="font-weight:400;color:${M.faint};">, your clan</span>` : ""}`,
      text: esc(k.line),
      mark: M.link,
    })),
    ...(pr
      ? [
          {
            title: `You, ${c.P(pr.tag, pr.name)}`,
            text: `${n(pr.battles)} battle${pr.battles === 1 ? "" : "s"}${youFams.length ? `: ${youFams.map((m) => `${esc(FAMILY_LABEL[m.mode] ?? m.mode)} ${recHtml(m.wins, m.losses)}`).join(", ")}` : pr.battles ? `, ${recHtml(pr.wins, pr.losses)}` : ""}.${f.alts.length ? ` With ${f.alts.map((a) => `${c.P(a.tag, a.name)} (${n(a.battles)})`).join(" and ")}.` : ""}${
              pr.moments?.length
                ? ` ${pr.moments
                    .slice(0, 2)
                    .map((m) => esc(m.text))
                    .join(" · ")}.`
                : ""
            }`,
            mark: M.ok,
          },
        ]
      : []),
  ];
  const people = [...friendsPlayed, ...watchPlayed];
  const total = people.reduce((s, x) => s + (x.battles ?? 0), 0);
  const body = `${friends}${watching}${quiet}
    ${around.length ? `${c.h2("Around you")}${c.rows(around)}` : ""}
    ${c.button("Follow a friend", `${SITE}/console/account/tracking`)}
    ${c.small(`Anyone with a player tag can be followed. Everyone you follow: <a href="${c.T(`${SITE}/console/account/tracking`)}" style="color:${M.link};">Console › Tracking</a>.`)}
    ${c.cov(esc(f.coverage))}`;
  const lead = people
    .slice(0, 4)
    .map((x) => {
      const top = x.by_family?.[0];
      return top
        ? `${x.name} ${n(top.battles)} in ${familyWord(top.mode)}`
        : `${x.name} ${n(x.battles)} battles`;
    })
    .join(", ");
  const preheader = lead
    ? `${lead}.`
    : (f.preheader ?? "Nobody you follow has a battle recorded this week.");
  return {
    subject: `Your friends this week: ${people.length ? `${n(total)} battles, ` : ""}${f.week.label}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "tracking_report",
        title: "Your friends this week",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${people.length ? `${people.length} ${people.length === 1 ? "person" : "people"} you follow played ${n(total)} battle${total === 1 ? "" : "s"}` : "a quiet week"}`,
        preheader,
        body,
        turnOff: "Your friends this week",
        links,
      }),
  };
}

/** A role as a sentence says it: "an elder", "a co-leader". */
const roleWords = (role) =>
  ({
    coLeader: "a co-leader",
    "co-leader": "a co-leader",
    elder: "an elder",
    leader: "the leader",
  })[role] ?? null;

/** The green "you" chip: the reader's own player in a shared list. */
const youChip = ` <span style="display:inline-block;padding:0 7px;border-radius:999px;background-color:${M.youChip};border:1px solid ${M.youEdge};color:${M.youInk};font-family:${FONT};font-size:11px;font-weight:600;line-height:17px;">you</span>`;

/** The race: every clan in the bracket with its fame as a bar, ours
 *  marked green (the clan this mail is about). */
function raceRows(war, clanTag, c) {
  const top = Math.max(1, ...war.standings.map((x) => x.fame ?? 0));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;">${war.standings
    .map((x) => {
      const ours = x.tag === clanTag;
      const w = Math.round(((x.fame ?? 0) / top) * 100);
      const hl = ours ? `background-color:${M.youRow};` : "";
      const bg = ours
        ? `${hl}border-left:3px solid ${M.ok};`
        : `border-left:3px solid ${M.panel};`;
      return `<tr><td width="24" style="width:24px;padding:7px 0 7px 8px;font-family:${MONO};font-size:13px;color:${M.faint};${bg}">${x.rank ?? "–"}</td>
        <td width="150" style="width:150px;padding:7px 8px;font-family:${FONT};font-size:14px;font-weight:${ours ? 700 : 500};color:${M.ink};${hl}white-space:nowrap;overflow:hidden;">${c.K(x.tag, x.name)}</td>
        <td style="padding:7px 0;${hl}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;"><tr>${w > 0 ? `<td width="${w}%" bgcolor="${M.accent}" style="height:8px;line-height:8px;font-size:0;background-color:${M.accent};border-radius:999px;">&nbsp;</td>` : ""}${w < 100 ? `<td bgcolor="${M.pill}" style="height:8px;line-height:8px;font-size:0;background-color:${M.pill};">&nbsp;</td>` : ""}</tr></table></td>
        <td width="64" align="right" style="width:64px;padding:7px 0;font-family:${MONO};font-size:13px;color:${M.ink};${hl}">${n(x.fame)}</td>
        <td width="70" align="right" style="width:70px;padding:7px 8px 7px 0;font-family:${FONT};font-size:12px;color:${M.faint};${hl}">${x.finished ? "finished" : ""}</td></tr>`;
    })
    .join("")}</table>`;
}

function clan(f, c) {
  const war = f.war?.present ? f.war : null;
  const h = f.headline;
  const tag = f.clan.tag;
  const finishedAt = war?.finished_at ? c.dayTime({ at: war.finished_at }) : "";
  const tiles = war
    ? [
        [
          "Place",
          war.rank ? ordinal(war.rank) : "—",
          war.standings?.length ? `of ${war.standings.length} clans` : "",
        ],
        [
          "Fame",
          n(war.fame),
          finishedAt
            ? `over the line ${esc(finishedAt)}`
            : war.finished_early
              ? "over the line early"
              : "the boat's fame",
        ],
        [
          "War trophies",
          war.war_trophies != null && war.trophy_change != null
            ? n(war.war_trophies + war.trophy_change)
            : signed(war.trophy_change),
          war.war_trophies != null && war.trophy_change != null
            ? `${signed(war.trophy_change)} from ${n(war.war_trophies)}`
            : "this race",
        ],
      ]
    : [
        [
          "Battles",
          n(h.battles),
          h.of ? `by ${h.active} of ${h.of} members` : "",
        ],
        [
          "Members",
          n(f.clan.members),
          c.delta(f.clan.members - f.clan.members_from),
        ],
        ["Donations", n(h.donations), "cards given"],
      ];
  const race = war?.standings?.length
    ? `${c.h2("The race", war.finish_war_day ? `over the line on war day ${war.finish_war_day}` : war.colosseum ? "the Colosseum" : "")}${raceRows(war, tag, c)}`
    : "";
  // Who raced: the five with the most points, and the reader's own
  // players wherever they finished.
  const raced = war?.raced ?? [];
  const shown = raced.filter((m, i) => i < 5 || c.isMine(m.tag));
  const whoRaced = raced.length
    ? `${c.h2("Who raced", `${raced.length} member${raced.length === 1 ? "" : "s"} used war decks`)}${c.rows(
        shown.map((m) => ({
          title: `${c.P(m.tag, m.name)}${c.isMine(m.tag) ? youChip : ""}`,
          right: `<span style="font-family:${MONO};font-size:13.5px;color:${M.ink};">${n(m.points)}</span> <span style="font-family:${FONT};font-size:12.5px;color:${M.faint};">&nbsp;${n(m.decks)} deck${m.decks === 1 ? "" : "s"}</span>`,
        })),
      )}${c.small(`Points are each member’s; fame belongs to the boat.${war.finished_early ? " Decks played after the line earn no points." : ""}`)}`
    : war?.battled != null
      ? c.small(`${n(war.battled)} members used war decks this race.`)
      : "";
  // Comings and goings, newest first, as the timeline says them.
  const moves = [
    ...f.membership.joined.map((m) => ({
      at: m.at ?? "",
      mark: M.ok,
      title: `${c.P(m.tag, m.name)} joined`,
      text: `${esc(c.dayTime(m))}${m.note ? `, and ${esc(m.note)}` : ""}.`,
    })),
    ...f.membership.left.map((m) => ({
      at: m.at ?? "",
      mark: M.loss,
      title: `${c.P(m.tag, m.name)} left${roleWords(m.role) ? `, ${roleWords(m.role)}` : ""}`,
      text: `${esc(c.dayTime(m))}.${m.tenure_days != null ? ` Here ${n(m.tenure_days)} day${m.tenure_days === 1 ? "" : "s"}.` : ""}`,
    })),
    ...f.membership.roles.map((m) => ({
      at: m.at ?? "",
      mark: M.link,
      title: `${c.P(m.tag, m.name)}: ${esc(m.from ?? "?")} → ${esc(m.to ?? "?")}`,
      text: m.at ? `${esc(c.dayTime(m))}.` : "",
    })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const MOVES_CAP = 12;
  const extra = moves.length - MOVES_CAP + (f.membership.more ?? 0);
  const comings = `${c.h2("Comings and goings", f.clan.members != null ? `${n(f.clan.members)} members at the end` : "")}${
    moves.length
      ? `${c.rows(moves.slice(0, MOVES_CAP))}${extra > 0 ? c.small(`And ${n(extra)} more in the console.`) : ""}`
      : c.small("No joins, departures or role changes.")
  }`;
  const quietBits = [];
  if (f.presence?.quiet?.length)
    quietBits.push(
      f.presence.quiet
        .map((r) => `${esc(r.name)}, ${n(r.days)} days`)
        .join(" · "),
    );
  const back = f.presence?.returned?.length
    ? `Back: ${f.presence.returned.map((r) => `${esc(r.name)} after ${n(r.days)} days`).join(", ")}.`
    : "";
  const quiet =
    quietBits.length || back
      ? `${c.h2("Gone quiet", "no battle recorded")}${quietBits.length ? c.p(quietBits.join(""), { size: 14 }) : ""}${back ? c.small(back) : ""}`
      : "";
  // The clan's week: the board's rows, from the structured moves when the
  // issue has them; an issue stored before 2026-10-01 has its standouts.
  const wm = f.week_moves;
  const names = (l, show) => {
    const shown = l.items.slice(0, 4);
    const rest = l.items.length + (l.more ?? 0) - shown.length;
    return `${shown.map((x) => `${c.P(x.tag, x.name)} ${show(x)}`).join(", ")}${rest > 0 ? `, and ${n(rest)} more` : ""}`;
  };
  const weekRows = [
    h.battles
      ? {
          title: `${n(h.battles)} battles`,
          text: `In ${n(h.sessions)} sessions, by ${n(h.active)} of ${n(h.of)} members.${wm?.top_battler ? ` ${c.P(wm.top_battler.tag, wm.top_battler.name)} played ${n(wm.top_battler.battles)} of them.` : ""}`,
          mark: M.link,
        }
      : null,
    wm?.ranked?.items?.length
      ? {
          title: "Path of Legends",
          text: `${names(wm.ranked, (x) => `reached ${esc(x.to ?? "a new league")}`)}.`,
          mark: MODE_COLOR.ranked,
        }
      : null,
    wm?.arena?.items?.length
      ? {
          title: "Trophy Road",
          text: `${names(wm.arena, (x) => `reached ${esc(x.to ?? "a new arena")}`)}.`,
          mark: MODE_COLOR.ladder,
        }
      : null,
    wm?.bests?.items?.length
      ? {
          title: "New bests",
          text: `${names(wm.bests, (x) => `<span style="font-family:${MONO};">${n(x.best)}</span>`)}.`,
          mark: M.link,
        }
      : null,
    f.badges?.length
      ? {
          title: "Badges",
          text: `${f.badges.map((b) => `${esc(b.name)}, ${esc(b.badge)}`).join(" · ")}.`,
          mark: M.link,
        }
      : null,
    h.donations
      ? {
          title: `${n(h.donations)} cards donated`,
          text: h.donations_leader
            ? `${c.P(h.donations_leader.tag, h.donations_leader.name)} gave ${n(h.donations_leader.n)} of them.`
            : "",
          mark: M.link,
        }
      : null,
  ].filter(Boolean);
  const oldStandouts =
    !wm && f.standouts?.length
      ? c.list(
          f.standouts.map(
            (x) =>
              `<strong style="color:${M.ink};">${c.P(x.tag, x.name)}</strong>: ${esc(c.days(x.text))}`,
          ),
        )
      : "";
  const theWeek =
    weekRows.length || oldStandouts
      ? `${c.h2("The clan’s week")}${c.rows(weekRows)}${oldStandouts}`
      : "";
  const roster = c.box(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${FONT};font-size:14px;line-height:1.5;color:${M.muted};">The roster, member by member: role, trophies, last battle and donations.</td><td align="right" style="padding-left:10px;font-family:${FONT};font-size:13.5px;white-space:nowrap;"><a href="${c.T(clanUrl(tag))}" style="color:${M.link};text-decoration:none;font-weight:600;">Open the roster ›</a></td></tr></table>`,
    { mt: 18 },
  );
  const body = `
    ${c.tiles(tiles)}
    ${race}${whoRaced}${comings}${quiet}${theWeek}
    ${f.roster_note ? c.small(esc(f.roster_note)) : ""}
    ${roster}
    ${c.button(`Open ${f.clan.name} in the console`, clanUrl(tag))}
    ${c.cov(esc(f.coverage))}`;
  const warBit = war?.rank ? `${ordinal(war.rank)} in war, ` : "";
  const preheader = war
    ? `${n(war.fame)} fame${war.finish_war_day ? `, over the line on war day ${war.finish_war_day}` : ""}. ${n(h.battles)} battles by ${n(h.active)} of ${n(h.of)} members.`
    : `${n(h.battles)} battles by ${n(h.active)} of ${n(h.of)} members; ${n(h.donations)} cards donated.`;
  return {
    subject: `${f.clan.name}, ${f.week.label}: ${warBit}${f.membership.left.length} left, ${f.membership.joined.length} joined`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "clan_report",
        title: `${esc(f.clan.name)} this week`,
        subtitle: `${esc(f.week.label)} · Season ${war?.season ?? f.week.season}${(war?.week ?? f.week.war_week) != null ? `, river race week ${war?.week ?? f.week.war_week}` : ""} · <a href="${c.T(clanUrl(tag))}" style="font-family:${MONO};color:${M.faint};text-decoration:none;">${esc(tag)}</a>`,
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
function collectorSecurity(state) {
  return (
    {
      not_recorded:
        "Security status at this historical observation was not recorded.",
      signed:
        "Signed: reported binary matches a signed release named by the hub.",
      dev_build:
        "Dev build: a local build, rather than a named signed release.",
      unverified: "Unverified: no binary hash reported.",
      mismatch:
        "Mismatch: reported binary hash does not match a named signed release for this version.",
    }[state] ?? "Unverified: no security report available."
  );
}

function collectorUpgrade(f, c) {
  const prefix = f.test ? "[TEST — historical replay] " : "";
  const subject = `${prefix}${f.name} upgraded: ${f.from_version} → ${f.to_version}`;
  const preheader = `${f.name} reported ${f.to_version}; previously ${f.from_version}.`;
  const release = f.release;
  const body = `${f.test ? c.cov("This is a test replay of a historical upgrade. No new upgrade was performed.") : ""}
    ${c.p(`Your collector <strong>${esc(f.name)}</strong> reported an upgrade from <strong>${esc(f.from_version)}</strong> to <strong>${esc(f.to_version)}</strong>.`)}
    ${c.small(`Observed ${esc(c.date(f.observed_at))}, ${esc(c.dayTime({ at: f.observed_at }))}.`)}
    ${c.h2("Security status")}${c.p(esc(collectorSecurity(f.signature_state)))}
    ${c.small("This uses the same self-reported version and binary hash as the dashboard. It is not remote attestation.")}
    ${c.h2("Why this release")}${c.p(esc(release?.reason ?? "No upgrade reason was recorded. The hub observed the installed version change; it cannot confirm whether this host updated automatically or was changed by its operator."))}
    ${release?.reason ? c.small("The reason above was supplied by the maintainer when naming this release; the installation mechanism on this host was not reported.") : ""}
    ${c.h2(release?.source_url?.includes("/compare/") ? "Changes between these releases" : "Target release changes")}${release?.changes ? c.p(esc(release.changes).replaceAll("\n", "<br>")) : c.p("Release notes were not recorded for this version.")}
    ${release?.release_url ? c.p(c.link(release.release_url, "Read the published release notes")) : ""}
    ${release?.source_url && release.source_url !== release.release_url ? c.p(c.link(release.source_url, "Read the source changes")) : ""}
    ${c.button("Open your collectors", `${SITE}/console/status/collectors`)}`;
  return {
    subject,
    preheader,
    html: (links) =>
      c.shell({
        kind: "collector_activity",
        title: `${f.test ? "Test: " : ""}${esc(f.name)} upgraded`,
        subtitle: `${esc(f.from_version)} → ${esc(f.to_version)}`,
        preheader,
        body,
        source: { product: "Collectors", when: f.test ? "Test" : "Upgrade" },
        why: "You get this when Elixir observes one of your collectors upgrade. This shares your collector email preference.",
        turnOff: "collector emails",
        links,
      }),
  };
}

function collector(f, c) {
  if (f.event === "upgrade") return collectorUpgrade(f, c);
  const t = f.totals;
  const list = f.collectors ?? [];
  const k = list.length;
  // What each is doing now. An issue stored before 2026-10-01 carries
  // only the enrolment status, which is what it read then.
  const stateOf = (x) => x.state ?? x.status;
  const count = (...states) =>
    list.filter((x) => states.includes(stateOf(x))).length;
  const running = count("active", "probation");
  const silent = count("silent");
  const stopped = count("draining");
  const waiting = count("pending");
  const tally = [
    `${running} running`,
    silent ? `${silent} silent` : null,
    stopped ? `${stopped} stopped` : null,
    waiting ? `${waiting} waiting` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const statusLine = (x) => {
    const s = stateOf(x);
    const extra = [
      `${n(x.fetches)} fetch${x.fetches === 1 ? "" : "es"} this week`,
      x.errors ? `${n(x.errors)} refused` : null,
      x.note ?? null,
    ]
      .filter(Boolean)
      .map(esc)
      .join(" · ");
    const now =
      s === "active" || s === "probation"
        ? `<span style="color:${M.youInk};"><span style="display:inline-block;width:7px;height:7px;border-radius:999px;background-color:${M.ok};"></span>&nbsp; checking in${s === "probation" ? ", on probation" : ""}</span>`
        : s === "silent"
          ? `<span style="color:${M.warn};">silent${x.since ? ` since ${esc(c.date(x.since))}, ${esc(c.dayTime({ at: x.since }).replace(/^\w+ /, ""))}` : ""}</span>`
          : s === "draining"
            ? `<span style="color:${M.faint};">stopped on purpose${x.since ? `, last checked in on ${esc(c.date(x.since))}` : ""}</span>`
            : s === "pending"
              ? `<span style="color:${M.faint};">enrolled, not yet running</span>`
              : `<span style="color:${M.faint};">${esc(s)}</span>`;
    return `${now}<span style="color:${M.faint};"> · ${extra}</span>`;
  };
  const rowsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${list
    .map((x, i) => {
      const line = i < k - 1 ? `border-bottom:1px solid ${M.row};` : "";
      return `<tr>
      <td width="36" valign="middle" style="width:36px;padding:9px 0;${line}">${x.card_id != null ? cardImg({ id: x.card_id, name: x.name, form: "base" }, 36, { radius: 5 }) : ""}</td>
      <td valign="middle" style="padding:9px 10px 9px 14px;${line}"><div style="font-family:${FONT};font-size:15px;font-weight:600;color:${M.ink};">${esc(x.name)}${x.version ? ` <span style="font-family:${MONO};font-size:11.5px;font-weight:400;color:${M.dim};">${esc(x.version)}</span>` : ""}</div>
        <div style="font-family:${FONT};font-size:12.5px;line-height:1.5;color:${M.faint};margin-top:3px;">${statusLine(x)}</div>
        ${x.signature_state ? `<div style="font-family:${FONT};font-size:12px;line-height:1.5;color:${x.signature_state === "mismatch" ? M.warn : M.faint};margin-top:4px;">${esc(collectorSecurity(x.signature_state))}</div>` : ""}</td>
      <td align="right" valign="middle" style="padding:9px 0;white-space:nowrap;${line}"><div style="font-family:${MONO};font-size:15px;font-weight:700;color:${M.ink};">${n(x.lifetime_points)}</div><div style="font-family:${FONT};font-size:11.5px;color:${M.faint};">points to date</div></td>
    </tr>`;
    })
    .join("")}</table>`;
  const cr = f.credits ?? {};
  const week = [
    `<strong style="color:${M.ink};">+${n(cr.earned)} credits</strong>${cr.points_week != null ? ` from ${n(cr.points_week)} points` : ""}`,
    cr.base
      ? `your daily tool calls stand at ${n(cr.applied)}${cr.capped ? ", the four-times cap" : ` on a base of ${n(cr.base)}`}`
      : null,
    cr.slots?.players || cr.slots?.clans
      ? `running a collector also adds ${cr.slots.players} player slot${cr.slots.players === 1 ? "" : "s"} and ${cr.slots.clans} clan watch${cr.slots.clans === 1 ? "" : "es"}, once per account`
      : null,
  ]
    .filter(Boolean)
    .join("; ");
  const leader = [...list].sort(
    (a, b) => (b.lifetime_points ?? 0) - (a.lifetime_points ?? 0),
  )[0];
  const firstStopped = list.find((x) => stateOf(x) === "draining");
  const firstSilent = list.find((x) => stateOf(x) === "silent");
  const body = `
    ${c.p(`Your ${k === 1 ? "collector" : `${k} collectors`} made <strong style="color:${M.ink};">${n(t.fetches)} fetches</strong> this week${t.of_fleet != null ? `, ${pct(t.of_fleet)} of everything the fleet recorded` : ""}${t.saved_share != null ? `, and filtered ${pct(t.saved_share)} of what they read at the edge as already recorded` : ""}. Thank you: every battle, roster and board in the record came through a machine somebody chose to run.`)}
    ${rowsHtml}
    ${c.small("A point is a fetch that added something to the record; one that brought nothing new earns none. Every 10 points adds one daily tool call, up to four times your base.")}
    ${c.small("More collectors add resilience, not more Clash Royale budget: the whole fleet shares one rate limit.")}
    ${c.small("Security status uses the dashboard’s self-reported version and binary hash; it is not remote attestation. A signed build can still be behind the current release.")}
    ${c.h2("This week")}${c.p(`${week}.`, "margin:0;")}
    ${f.fleet_note ? c.small(esc(f.fleet_note)) : ""}
    ${c.button("Open your collectors", `${SITE}/console/status/collectors`)}
    ${c.cov(esc(f.coverage))}`;
  const preheader = [
    leader
      ? `${leader.name} leads with ${n(leader.lifetime_points)} points.`
      : null,
    firstSilent
      ? `${firstSilent.name} has been silent${firstSilent.since ? ` since ${c.date(firstSilent.since)}` : ""}.`
      : null,
    firstStopped
      ? `${firstStopped.name} is stopped${firstStopped.since ? `, last checked in on ${c.date(firstStopped.since)}` : ""}.`
      : null,
    `+${n(cr.earned)} credits this week.`,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    subject: `Your collectors, ${f.week.label}: ${tally}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "collector_activity",
        title: "Your collectors",
        subtitle: `${esc(f.week.label)} · ${k} enrolled: ${esc(tally.replace("running", "checking in"))}`,
        preheader,
        body,
        turnOff: "Your collectors",
        links,
      }),
  };
}

/** A milestone, as the boards draw one: the moment as the title, the
 *  arena or league large in a box, the battle that did it, a card
 *  unlocked as its art; the rest of what was new in "Also". */
function milestone(f, c) {
  const ms = f.milestones;
  const first = ms[0];
  const isCard = (m) => Boolean(m.card);
  const cards = ms.filter(isCard);
  const others = ms.filter((m) => !isCard(m));
  // "Tue Sep 29, 7:53 pm" in the reader's zone; an issue stored before
  // 2026-10-01 has only its label.
  const when = (m) => {
    if (!m.instant) return m.at ?? "";
    const [wd, ...time] = c.dayTime({ at: m.instant }).split(" ");
    return `${wd} ${c.date(m.instant)}, ${time.join(" ")}`;
  };
  const whose = (s) =>
    `${c.P(s.tag, s.name)} <span style="font-family:${MONO};font-size:12px;color:${M.dim};">${esc(s.tag)}</span>${s.relationship === "alt" ? ", one of your players" : ""}`;
  const oneSubject = ms.every((m) => m.subject.tag === first.subject.tag);
  const allCards = cards.length === ms.length;
  const words = ["", "one", "two", "three", "four"];
  const title =
    allCards && cards.length > 1
      ? oneSubject
        ? `${first.subject.relationship === "alt" ? esc(first.subject.name) : "You"} unlocked ${words[cards.length] ?? cards.length} cards`
        : `${cards.length} cards unlocked`
      : esc(first.headline);
  const big = (m) =>
    c.box(
      `${ms.length > 1 ? `<div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${M.faint};margin-bottom:6px;">${esc(m.headline)}</div>` : ""}
      ${m.big ? `<div style="font-family:${FONT};font-size:28px;font-weight:800;line-height:1.15;color:${M.ink};">${esc(m.big)}</div>` : ""}
      ${m.big_label ? `<div style="font-family:${FONT};font-size:13.5px;line-height:1.5;color:${M.muted};margin-top:4px;">${esc(m.big_label)}</div>` : ""}
      ${m.lines?.length ? c.list(m.lines.map(esc)) : ""}`,
      { pad: "16px", mt: 12 },
    );
  const battle = (b) => {
    if (!b) return "";
    const score =
      b.crowns_against == null ? "" : ` ${b.crowns}–${b.crowns_against}`;
    const against = b.opponent
      ? ` against ${c.P(b.opponent.tag, b.opponent.name)}${b.opponent.starting_trophies != null ? `, who started at ${n(b.opponent.starting_trophies)}` : ""}`
      : "";
    const moved =
      b.trophy_change != null && b.trophy_change !== 0
        ? ` ${signed(b.trophy_change)} trophies.`
        : "";
    // Its page, /battle/<short id>, once the record named one (an
    // issue stored before 2026-10-02 has none).
    const page = b.url
      ? `<div style="font-family:${FONT};font-size:13.5px;margin-top:8px;">${c.link(b.url, "See the battle ›", "font-weight:600;")}</div>`
      : "";
    return `${c.h2("The battle that did it")}${c.box(
      `<div style="font-family:${FONT};font-size:14.5px;line-height:1.5;color:${M.muted};"><strong style="color:${M.ink};">${b.won ? "Won" : "Lost"}${score}</strong>${against}.${moved}</div>${page}`,
    )}`;
  };
  const tiles = cards.length
    ? `<div style="margin-top:12px;">${cardTiles(
        // Under each card its rarity, and whose it is when the cards
        // are more than one player's.
        cards.map((m) => ({
          card: m.card,
          line: [m.card_line, oneSubject ? null : m.subject.name]
            .filter(Boolean)
            .join(" · "),
        })),
        { w: 104, link: (card) => c.T(`${SITE}/cards/${card.id}`) },
      )}</div>${c.small("Each opens the card’s page in Elixir.")}`
    : "";
  const also = f.also?.length
    ? `${c.h2("Also")}${c.rows(
        f.also.map((a) => ({
          title: `${c.P(a.tag, a.name)}: ${esc(a.text)}`,
          right: a.card
            ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="width:30px;">${cardImg(a.card, 30, { radius: 4 })}</td></tr></table>`
            : null,
        })),
      )}`
    : "";
  const body = `${others.map((m) => `${big(m)}${battle(m.battle)}`).join("")}
    ${tiles}
    ${also}
    ${c.button(`Open ${first.subject.name} in Ladder`, ladderUrl(first.subject.tag))}
    ${c.cov("Milestones come from the record as it is polled, usually within the hour. A move down never mails; only firsts do.")}`;
  const more = ms.length - 1;
  const preheader =
    allCards && cards.length > 1
      ? `${cards.map((m) => cardFormLabel(m.card)).join(", ")}.`
      : first.kind === "arena_changed" || first.kind === "ranked_promotion"
        ? // An issue stored before 2026-10-01 said the move in its
          // first line and only the ladder in big_label.
          `${(first.lines?.[0] ?? first.big_label ?? first.headline).replace(/\.$/, "")}.`
        : (first.lines?.[0] ?? first.headline);
  return {
    subject: more > 0 ? `${first.headline} (+${more} more)` : first.headline,
    preheader,
    html: (links) =>
      c.shell({
        kind: "milestone",
        title,
        subtitle: `${esc(when(first))} · ${oneSubject ? whose(first.subject) : `${esc(f.account.name)}’s players`}`,
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
  // The app's lines are one action each, newest first, new ones marked
  // "(new)", and past ten a last line counting the rest.
  const more = /^And (\d+) more\.$/;
  const actions = f.lines.filter((l) => !more.test(l));
  const rest = Number(f.lines.find((l) => more.test(l))?.match(more)[1] ?? 0);
  const total = actions.length + rest;
  const box = (line) => {
    const fresh = / \(new\)$/.test(line);
    const text = line.replace(/ \(new\)$/, "");
    return c.box(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="font-family:${FONT};font-size:15px;font-weight:700;line-height:1.4;color:${M.ink};">${esc(text)}${fresh ? ` <span style="display:inline-block;padding:0 7px;border-radius:999px;background-color:${M.raised};border:1px solid ${M.ring};color:${M.link};font-size:11px;font-weight:600;line-height:17px;">new</span>` : ""}</td>
        <td align="right" style="padding-left:12px;white-space:nowrap;"><a href="${esc(c.T(f.link))}" style="font-family:${FONT};font-size:13.5px;font-weight:600;color:${M.link};text-decoration:none;">Decide ›</a></td>
      </tr></table>`,
      { mt: 8 },
    );
  };
  const body = `${actions.map(box).join("")}
    ${rest ? c.small(`And ${n(rest)} more on the Actions page.`) : ""}
    ${c.small("Each is one decision, made on its page in Elixir Clan. Only people who can act on an action are told about it.")}
    ${c.button("Open Actions in Clan", f.link)}
    ${c.cov(`${esc(f.app ?? "Elixir Clan")} sends this through Elixir after its morning run, when something new is yours to do. Everything in it is what the app shows you signed in.`)}`;
  const preheader = actions
    .slice(0, 3)
    .map((l) => l.replace(/ \(new\)$/, ""))
    .join(" · ");
  return {
    subject: f.subject,
    preheader: preheader || f.subject,
    html: (links) =>
      c.shell({
        kind: "clan_actions_waiting",
        title: `${total === 1 ? "One action" : `${n(total)} actions`} waiting`,
        subtitle: `${c.K(f.clan.tag, clan)} <span style="font-family:${MONO};font-size:12.5px;color:${M.dim};">${esc(f.clan.tag)}</span> · ${esc(f.app ?? "Elixir Clan")}`,
        preheader: preheader || f.subject,
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
  // A preview may suppress the open pixel while retaining campaign links.
  const out = fn(
    facts,
    make(campaign, {
      pixel: links.pixel !== false,
      timezone: links.timezone ?? "UTC",
      mine: Array.isArray(links.mine) ? links.mine : [],
    }),
  );
  return {
    subject: out.subject,
    preheader: out.preheader,
    html: out.html(links),
  };
}
