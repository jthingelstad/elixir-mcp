/** The renderer: facts in, {subject, preheader, html} out, for the six
 *  product kinds. Every kind sits in the one mail shell (shell.mjs), the
 *  same one the relay's sign-in code and welcome use: the logo and the
 *  wordmark, a product label, one quiet panel, and the
 *  footer that carries the turn-off link, the short mail id, the sponsor
 *  line and the disclaimer. Tables and inline styles only; a name opens the
 *  page that is this reader's door to it (make); the coverage note comes
 *  last. Dark only, by decision
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
import { monthDayAt, seasonWeek, whenAt } from "@elixir-mcp/ui/time";
import { cardImg, cardTiles, deckStrip, cardFormLabel } from "./cards.mjs";
import { MAIL_PATHS } from "./paths.mjs";

/** The week a subject names: "Season 137, week 4". An issue stored before
 *  2026-11-05 knows no week of its season, and keeps its dates. */
const weekName = (w) =>
  w?.season && w?.war_week
    ? seasonWeek(w.season, w.war_week)
    : (w?.label ?? "");

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
  feedback_answer: "Answers to your feedback",
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
// Record pages: /console/explore/player/<tag without #> (apps/web
// views/Explore.jsx, tagPath). A name in mail opens one of these unless the
// reader has a better door to it (make: playerDoor, clanDoor).
const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));
const playerUrl = (tag) => `${SITE}/console/explore/player/${tagPath(tag)}`;
const clanUrl = (tag) => `${SITE}/console/explore/clan/${tagPath(tag)}`;
// Ladder, a player's own season (apps/web pages/LadderPage.jsx):
// `?player=` names one of the reader's own players, so only the Arena
// week and Milestones, which are about the reader's own, link it.
// `?season=` is the season the mail describes (2026-10-08), so a link
// opened after the roll still shows that season, not the new one.
const ladderUrl = (tag, page = "", season = null) =>
  `${SITE}/ladder${page ? `/${page}` : ""}?player=${tagPath(tag)}${season != null ? `&season=${encodeURIComponent(season)}` : ""}`;
// Clan's own pages (packages/clan-web, routes.jsx): the tag without its #.
const clanPageUrl = (tag, page) => `${SITE}/clan/${tagPath(tag)}/${page}`;
const clanMemberUrl = (clanTag, tag) =>
  clanPageUrl(clanTag, `members/${tagPath(tag)}`);
// A clan's river race week in the console (apps/web views/Explore.jsx):
// /explore/week/<tag>~<season>~<section index>, the week counted from 0.
const raceWeekUrl = (tag, season, week) =>
  `${SITE}/console/explore/week/${tagPath(tag)}~${encodeURIComponent(season)}~${Number(week) - 1}`;
// The footer links a sent mail's record by its id, and Send feedback opens
// feedback with the mail attached (Jamie, 2026-09-19: "something not right?
// send feedback", one click). The send id is a product identifier, not a
// tracking one (ENGINEERING, "Product identifiers versus measurement"), so
// these links are tagged like every other link into the site; the page
// reports itself to analytics as its kind, never which record.
// The same line to everyone, in every product email (Jamie, 2026-09-19,
// the settled policy): free, sponsor-supported, sponsorship buys nothing.
const SUPPORT_URL = `${SITE}/support`;
const sentMailUrl = (sendId, { report = false } = {}) =>
  report ? MAIL_PATHS.report(sendId) : MAIL_PATHS.record(sendId);

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

function make(
  campaign = null,
  {
    pixel = true,
    timezone = "UTC",
    mine = [],
    memberClans = [],
    verifiedClans = [],
    clanmates = {},
    season = null,
    now = Date.now(),
  } = {},
) {
  // The reader's own players: the clan report marks their rows "you".
  const isMine = (tag) => mine.includes(tag);
  // One door per name, chosen per reader (structure, Mail links; A22, Q4): the
  // facts are the same for everyone a report goes to, so the choice is made
  // here and never stored. A render with no reader context (a page's preview,
  // an old send's replay) falls through to the record pages, which open for
  // anyone signed in.
  const isMember = (clanTag) => memberClans.includes(clanTag);
  // A clan-visible fact needs more than a door: a verified claim, as the
  // record's own reader asks (reader.mjs). No answer means no fact.
  const readsClanFacts = (clanTag) => verifiedClans.includes(clanTag);
  const playerDoor = (tag) => {
    if (isMine(tag)) return ladderUrl(tag, "", season);
    const shared = clanmates[tag];
    return shared ? clanMemberUrl(shared, tag) : playerUrl(tag);
  };
  const clanDoor = (tag) =>
    isMember(tag) ? clanPageUrl(tag, "season") : clanUrl(tag);
  const rosterDoor = (tag) =>
    isMember(tag) ? clanPageUrl(tag, "members") : clanUrl(tag);
  // The member pages' one clock (packages/ui/time), so a mail and the
  // page it links to name a moment the same way: "Sat 8:42 pm" within a
  // week, "Fri Oct 23, 5:07 pm" older.
  const dayTime = (m) =>
    m?.at ? whenAt(m.at, timezone, { now }) : (m?.when ?? "");
  const date = (iso) => (iso ? monthDayAt(iso, timezone) : "");
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
    `<a href="${T(playerDoor(tag))}" title="${esc(tag)}" style="color:${M.link};text-decoration:none;font-weight:600;">${esc(name)}</a>`;
  const K = (tag, name, url = clanDoor(tag)) =>
    `<a href="${T(url)}" title="${esc(tag)}" style="color:${M.link};text-decoration:none;font-weight:600;">${esc(name)}</a>`;
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
  // Headline figures: at most two open columns across.
  // Table cells, not inline blocks: a phone client is not a browser.
  const tiles = (items) => {
    const per = Math.min(2, items.length || 1);
    const out = [];
    for (let i = 0; i < items.length; i += per) {
      const row = items.slice(i, i + per);
      out.push(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin:${i ? 10 : 0}px 0 0;"><tr>${row
          .map(
            ([label, value, hint, mode], k) =>
              `<td valign="top" width="${Math.floor(100 / per)}%" style="padding:0 ${k < per - 1 ? 5 : 0}px 0 ${k ? 5 : 0}px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px 0;${k ? `border-left:1px solid ${M.edge};padding-left:16px;` : ""}">
          <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${M.faint};">${mode ? `${dot(mode)}&nbsp;` : ""}${esc(label)}</div>
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
    `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px;">
      <tr>${cols.map((c, i) => `<th scope="col" align="${align[i] ?? "left"}" style="font-family:${FONT};font-size:12px;font-weight:600;color:${M.faint};padding:6px 6px 6px 0;border-bottom:1px solid ${M.edge};">${esc(c)}</th>`).join("")}</tr>
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
      },
      send: id
        ? {
            id,
            record: T(sentMailUrl(id)),
            report: T(sentMailUrl(id, { report: true })),
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
    isMember,
    readsClanFacts,
    clanDoor,
    rosterDoor,
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

/** Free text as a sentence: one full stop, never two. A moment's text
 *  is already a sentence ("took Arrows Mastery to level 10."), and a
 *  mail that joined two and added its own printed "10.." (Jamie's
 *  friends mail, 2026-10-07). Join clauses, then end the sentence once. */
const clause = (s) =>
  String(s ?? "")
    .trim()
    .replace(/[.\s]+$/, "");
const sentence = (s) => {
  const t = String(s ?? "").trim();
  return !t || /[.!?…]$/.test(t) ? t : `${t}.`;
};

/** The week's small firsts as counts ("3 cards unlocked, 2 badge
 *  levels"): card unlocks and badge levels no longer mail on their own
 *  (Jamie, 2026-10-08), so the weekly mail says how many. A legendary
 *  badge mails as a milestone and is no longer counted; an issue stored
 *  before then carries legendary_badges and renders it as before. */
function progressText(p) {
  if (!p) return "";
  const k = (v, one, many) => (v ? `${n(v)} ${v === 1 ? one : many}` : null);
  return [
    k(p.cards_unlocked, "card unlocked", "cards unlocked"),
    k(p.badge_levels, "badge level", "badge levels"),
    k(p.legendary_badges, "legendary badge", "legendary badges"),
  ]
    .filter(Boolean)
    .join(", ");
}

// A reader's own timeline on Home: every moment, newest first, the small
// ones the mail only counts.
const timelineUrl = () => `${SITE}/home/timeline`;

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

/** "Trophy Road win rate 54% this week (31 battles), up from 48% over
 *  the previous four weeks (112 battles).": the week beside the four
 *  before it, as @elixir-mcp/record/form shaped battles_performance's
 *  two windows. Numbers and counts only: "up" and "down" say which way
 *  the two numbers lie, never what they mean. Each count is the battles
 *  the rate is over (draws and boat battles are outside it). */
function formSentence(form) {
  const a = form?.week;
  const b = form?.previous;
  if (!a || !b || a.win_rate == null || b.win_rate == null) return "";
  const battles = (k) => `${n(k)} battle${k === 1 ? "" : "s"}`;
  const now = Math.round(a.win_rate * 100);
  const then = Math.round(b.win_rate * 100);
  const way = now > then ? "up from" : now < then ? "down from" : "level with";
  return `${FAMILY_LABEL[form.mode] ?? form.mode} win rate ${now}% this week (${battles(a.decided_battles)}), ${way} ${then}% over the previous four weeks (${battles(b.decided_battles)}).`;
}

/** Under this many battles in a week, a person's main or most played deck is
 *  not drawn (about 5, by the boards). */
const DECK_MIN_BATTLES = 5;

function arena(f, c) {
  const pr = f.primary;
  const t = pr.totals;
  const fams = t.by_family ?? [];
  const tr = pr.trophies;
  const trDelta = tr ? tr.to - tr.from : null;
  // One record per mode played, then the trophy line: never a combined
  // win rate (DECISIONS: mode discipline).
  const tiles = [
    ...fams.map((m) => [
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
        `${c.P(pr.tag, pr.name)} stood on the ${n(tr.floor)} floor${tr.arena ? ` (${esc(tr.arena)})` : ""} this week: a loss there costs no trophies, so the trophy line can stay flat.`,
      )
    : "";
  const notes = (pr.modes ?? []).filter((m) => m.note);
  // A week under a handful of battles has no main deck to speak of; where the
  // decks are stays said.
  const decksLink = c.link(
    ladderUrl(pr.tag, "decks", f.week?.season),
    "Ladder › Decks",
  );
  const deck =
    pr.deck && (t.battles ?? 0) >= DECK_MIN_BATTLES
      ? `${c.h2(`Your ${FAMILY_LABEL[pr.deck.family] ?? "main"} deck`)}${deckBox(pr.deck, c)}${c.small(`More decks in ${decksLink}.`)}`
      : t.battles
        ? c.small(`Your decks are in ${decksLink}.`)
        : "";
  const o = pr.opponents;
  const again = o.again ?? [];
  // Who came round more than once (up to three named, the rest
  // counted), then everyone met once.
  const repeats = o.repeats ?? again.length;
  const once = (o.distinct ?? 0) - repeats;
  const named = again.map(
    (x) =>
      `${c.P(x.tag, x.name)} ${x.battles === 2 ? "twice" : `${n(x.battles)} times`}${x.mode ? ` on ${esc(x.mode)}` : ""}, ${recHtml(x.wins, x.losses)} between you`,
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
  // Each alt's week, and under it the firsts that waited for this mail (D12).
  // A held first with no battle is still a row: the first is the news.
  const alts = f.alts.length
    ? `${c.h2("Your other players")}${c.rows(
        f.alts.map((a) => {
          const families = a.by_family ?? [];
          const firsts = (a.firsts ?? []).map(
            (x) =>
              `<div style="margin-top:2px;">${esc(capFirst(clause(x.text)))}${x.at ? `, ${esc(c.dayTime({ at: x.at }))}` : ""}.</div>`,
          );
          return {
            title: c.P(a.tag, a.name),
            text: `${
              a.battles
                ? `${n(a.battles)} battle${a.battles === 1 ? "" : "s"}${families.length ? ` · ${families.map((m) => `${esc(FAMILY_LABEL[m.mode] ?? m.mode)} ${recHtml(m.wins, m.losses)}`).join(" · ")}` : ` · ${recHtml(a.wins, a.losses)}`}`
                : ""
            }${firsts.join("")}`,
            right: a.trophies
              ? `<div style="font-family:${MONO};font-size:13px;color:${M.muted};">${n(a.trophies.from)} → ${n(a.trophies.to)}</div><div style="font-family:${FONT};font-size:11.5px;color:${M.faint};">trophies</div>`
              : null,
          };
        }),
      )}`
    : "";
  const altNames = f.alts.map((a) => esc(a.name));
  // Card unlocks and badges, counted (an issue before 2026-10-08 has none).
  const counted = (f.progress ?? []).filter((x) => progressText(x));
  const progress = counted.length
    ? `${c.h2("Cards and badges")}${c.list(
        counted.map((x) => `${c.P(x.tag, x.name)}: ${esc(progressText(x))}`),
      )}${c.small(`See each on your ${c.link(timelineUrl(), "timeline")}.`)}`
    : "";
  // An issue stored before 2026-10-08, or a week under the minimum,
  // has no form and no line.
  const form = formSentence(pr.form);
  const body = `
    ${tiles.length ? c.tiles(tiles) : ""}
    ${form ? c.p(esc(form), { size: 14, extra: "margin-top:12px;" }) : ""}

    ${floor}${notes.length ? c.small(notes.map((m) => sentence(`${esc(m.label)}: ${esc(m.note)}`)).join(" ")) : ""}
    ${deck}
    ${met}
    ${alts}
    ${progress}
    ${c.button(`Open ${pr.name} in Ladder`, ladderUrl(pr.tag, "", f.week?.season))}
    ${c.cov(esc(pr.coverage))}`;
  const subjectRecords = fams.length
    ? fams
        .slice(0, 3)
        .map((m) => `${familyWord(m.mode)} ${m.wins}–${m.losses}`)
        .join(", ")
    : t.battles
      ? rec(t)
      : weekName(f.week);
  const playedAlts = f.alts.filter((a) => a.battles);
  const preheader = `${f.week.label}: ${n(t.battles)} battle${t.battles === 1 ? "" : "s"}${tr ? `, ${signed(trDelta)} trophies` : ""}${playedAlts.length ? `; ${playedAlts.map((a) => `${a.name} ${n(a.battles)}`).join(", ")}` : ""}.`;
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
  // Two moments, newest first, then the week's card unlocks and badges
  // as counts; clauses, so a moment's own full stop never doubles.
  const notes = [
    ...(x.moments ?? []).slice(0, 2).map((m) => esc(clause(m.text))),
    ...(progressText(x.progress) ? [esc(progressText(x.progress))] : []),
  ];
  const d = (x.battles ?? 0) >= DECK_MIN_BATTLES ? x.deck : null;
  const deck = d
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-top:1px solid ${M.row};"><tr>
        <td style="padding-top:10px;font-family:${FONT};font-size:13.5px;color:${M.ink};"><span style="font-size:13px;font-weight:600;color:${M.faint};">Most played</span>&nbsp; <strong>${esc(d.label ?? "Their deck")}</strong></td>
        <td align="right" style="padding-top:10px;font-family:${FONT};font-size:12px;color:${M.faint};white-space:nowrap;">${n(d.battles)} of ${n(x.deck_battles ?? x.battles)} battles${x.decks_used > 1 ? ` · ${n(x.decks_used)} decks` : ""}</td></tr>
        <tr><td colspan="2" style="padding-top:8px;">${deckStrip(d.cards, { w: 44, gap: 5 })}</td></tr></table>`
    : "";
  return c.box(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${FONT};"><div style="font-size:15.5px;font-weight:700;">${c.P(x.tag, x.name)}${x.nickname ? ` <span style="font-weight:400;color:${M.faint};">(${esc(x.nickname)})</span>` : ""}</div></td>
      <td align="right" valign="top" style="font-family:${FONT};font-size:12px;color:${M.faint};white-space:nowrap;">${n(x.battles)} battle${x.battles === 1 ? "" : "s"}${x.trophies ? `<br>${n(x.trophies.to)} trophies` : ""}</td></tr></table>
    ${modeBar(fams)}${lines}${notes.length ? `<div style="font-family:${FONT};font-size:12.5px;line-height:1.5;color:${M.faint};margin-top:6px;">${notes.join(" · ")}</div>` : ""}${deck}`,
    { mt: 10 },
  );
}

/** Watched and followed players this long without a battle are one
 *  line of names on the friends mail. */
const LONG_QUIET_DAYS = 30;

const capFirst = (t) => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : t);

/** A clan on the friends mail: a headline and at most three bullets, the
 *  clan sentence's own clauses in its own order, the rest counted with a
 *  link to the clan (2026-10-08). An issue stored before then has the
 *  sentence as one line. */
function clanBlock(k, c) {
  if (k.headline == null) return esc(k.line ?? "");
  const more = k.more
    ? c.small(
        `${c.link(c.clanDoor(k.tag), `${n(k.more)} more`)} on the clan’s page.`,
        "margin-top:2px;",
      )
    : "";
  return `<div>${esc(sentence(capFirst(k.headline)))}</div>${k.bullets?.length ? c.list(k.bullets.map((b) => esc(capFirst(clause(b))))) : ""}${more}`;
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
  // Quiet for a month or more is one line of names, longest quiet
  // first (Jamie, 2026-10-08: a watched player "169 days" quiet,
  // every week); the recently quiet keep their own line.
  const daysOf = new Map((f.quiet ?? []).map((q) => [q.tag, q.days]));
  const everyQuiet = [
    ...quietNames.map((q) => ({
      tag: q.tag,
      name: q.name,
      days: daysOf.get(q.tag) ?? null,
      said: false,
    })),
    ...(f.quiet ?? [])
      .filter((q) => !quietNames.some((x) => x.tag === q.tag))
      .map((q) => ({
        tag: q.tag,
        name: q.name,
        days: q.days ?? null,
        said: true,
      })),
  ];
  const longQuiet = everyQuiet
    .filter((q) => (q.days ?? 0) >= LONG_QUIET_DAYS)
    .sort((a, b) => b.days - a.days);
  const recentQuiet = everyQuiet
    .filter((q) => !longQuiet.includes(q))
    .map((q) =>
      q.said && q.days != null
        ? `${c.P(q.tag, q.name)} (${q.days} day${q.days === 1 ? "" : "s"})`
        : c.P(q.tag, q.name),
    );
  const deckNote = "A deck’s count is battles with exactly those eight cards.";
  const hasDeck = [...friendsPlayed, ...watchCards].some(
    (x) => x.deck && (x.battles ?? 0) >= DECK_MIN_BATTLES,
  );
  const quiet = [
    recentQuiet.length
      ? `No battle recorded this week: ${recentQuiet.join(", ")}.`
      : "",
    longQuiet.length
      ? `Quiet for ${LONG_QUIET_DAYS} days or more: ${longQuiet.map((q) => c.P(q.tag, q.name)).join(", ")}.`
      : "",
  ].filter(Boolean);
  const quietHtml =
    quiet.length || f.friends.length || f.watching.length
      ? quiet.map((q) => c.small(q)).join("") +
        (hasDeck ? c.small(deckNote) : "")
      : "";
  const youFams = pr?.by_family ?? [];
  const youNotes = [
    ...(pr?.moments ?? []).slice(0, 2).map((m) => esc(clause(m.text))),
    ...(progressText(pr?.progress) ? [esc(progressText(pr.progress))] : []),
  ];
  const around = [
    ...f.clans.map((k) => ({
      title: `${c.K(k.tag, k.name)}${pr?.clan?.tag === k.tag ? `<span style="font-weight:400;color:${M.faint};">, your clan</span>` : ""}`,
      text: clanBlock(k, c),
      mark: M.link,
    })),
    ...(pr
      ? [
          {
            title: `You, ${c.P(pr.tag, pr.name)}`,
            text: `${n(pr.battles)} battle${pr.battles === 1 ? "" : "s"}${youFams.length ? `: ${youFams.map((m) => `${esc(FAMILY_LABEL[m.mode] ?? m.mode)} ${recHtml(m.wins, m.losses)}`).join(", ")}` : pr.battles ? `, ${recHtml(pr.wins, pr.losses)}` : ""}.${f.alts.length ? ` With ${f.alts.map((a) => `${c.P(a.tag, a.name)} (${n(a.battles)})`).join(" and ")}.` : ""}${youNotes.length ? ` ${sentence(youNotes.join(" · "))}` : ""}`,
            mark: M.ok,
          },
        ]
      : []),
  ];
  const people = [...friendsPlayed, ...watchPlayed];
  const total = people.reduce((s, x) => s + (x.battles ?? 0), 0);
  const body = `${friends}${watching}${quietHtml}
    ${around.length ? `${c.h2("Around you")}${c.rows(around)}` : ""}
    ${c.button("Follow a friend", `${SITE}/home/friends`)}
    ${c.small(`Anyone with a player tag can be followed. Everyone you follow: <a href="${c.T(MAIL_PATHS.players)}" style="color:${M.link};">Settings › Players</a>.`)}
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
    subject: `Your friends this week: ${people.length ? `${n(total)} battles, ` : ""}${weekName(f.week)}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "tracking_report",
        title: "Your friends this week",
        subtitle: `${esc(f.week.label)} · Season ${f.week.season} · ${people.length ? `${people.length} ${people.length === 1 ? "person" : "people"} you follow played ${n(total)} battle${total === 1 ? "" : "s"}` : "a quiet week"}`,
        preheader,
        body,
        links,
      }),
  };
}

/** A role as a sentence says it: "an elder", "a co-leader". */
const roleWords = (role) =>
  ({
    member: "Member",
    elder: "Elder",
    coLeader: "Co-leader",
    "co-leader": "Co-leader",
    leader: "Leader",
  })[role] ?? null;

/** The green "you" chip: the reader's own player in a shared list. */
const youChip = ` <span style="display:inline-block;padding:0 7px;border-radius:999px;background-color:${M.youChip};border:1px solid ${M.youEdge};color:${M.youInk};font-family:${FONT};font-size:11px;font-weight:600;line-height:17px;">you</span>`;

/** The race: rank, clan and fame, with our clan marked green.
 *  Three fluid columns fit a phone; finish status stays beside the fame. */
function raceRows(war, clanTag, c) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;border-collapse:collapse;">
    <tr><th scope="col" width="28" style="width:28px;text-align:left;font-family:${FONT};font-size:12px;color:${M.faint};padding-bottom:6px;">#</th><th scope="col" style="text-align:left;font-family:${FONT};font-size:12px;color:${M.faint};padding-bottom:6px;">Clan</th><th scope="col" width="80" style="width:80px;text-align:right;font-family:${FONT};font-size:12px;color:${M.faint};padding-bottom:6px;">Fame</th></tr>
    ${war.standings
      .map((x) => {
        const ours = x.tag === clanTag;
        const hl = ours ? `background-color:${M.youRow};` : "";
        return `<tr><td style="padding:8px 4px;font-family:${MONO};font-size:13px;color:${M.faint};${hl}">${x.rank ?? "–"}</td>
        <td style="padding:8px;font-family:${FONT};font-size:14px;line-height:1.4;font-weight:${ours ? 700 : 500};color:${M.ink};${hl}overflow-wrap:anywhere;">${c.K(x.tag, x.name)}</td>
        <td align="right" style="padding:8px 4px;font-family:${MONO};font-size:13px;color:${M.ink};${hl}">${n(x.fame)}${x.finished ? `<div style="font-family:${FONT};font-size:12px;color:${M.faint};">finished</div>` : ""}</td></tr>`;
      })
      .join("")}</table>`;
}

/** The week beside the ones before it (2026-10-08): the race's war
 *  decks used of those possible against the races before, and (in the
 *  clan's-week row) the clan's battles and members who battled against
 *  the weeks before, each only as far back as the record holds. The
 *  words say how many are compared, and with none the comparison is left
 *  out. An issue stored before then has no `trend` and renders without
 *  it. */
const capped = (w) => Math.min(w.decks_used, w.decks_possible);
const share = (used, possible) =>
  possible > 0 ? Math.min(1, used / possible) : null;
const beforeWords = (k, what) =>
  k === 4
    ? `the four ${what}s before`
    : `the ${k === 1 ? `one recorded ${what}` : `${k} recorded ${what}s`} before`;
const raceName = (w) =>
  `Season ${w.season}, week ${w.week}${w.colosseum ? " (Colosseum)" : ""}`;

function trendBlock(f, c) {
  const t = f.trend;
  if (!t) return "";
  const parts = [];
  const war = t.war;
  if (war?.this_week) {
    const w = war.this_week;
    const prior = war.prior ?? [];
    const unplayed = Math.max(0, w.decks_possible - w.decks_used);
    let line = `This race: <strong style="color:${M.ink};">${n(w.decks_used)} of ${n(w.decks_possible)}</strong> possible war decks used (${pct(share(w.decks_used, w.decks_possible))})${unplayed ? `, ${n(unplayed)} not played` : ""}.`;
    let table = "";
    if (prior.length) {
      const pooled = share(
        prior.reduce((s, x) => s + capped(x), 0),
        prior.reduce((s, x) => s + x.decks_possible, 0),
      );
      line += ` Over ${beforeWords(prior.length, "race")}: ${pct(pooled)}.`;
      table = c.table(
        ["Race", "Used", "Possible", "Share"],
        [w, ...prior].map((x, i) => [
          `${esc(raceName(x))}${i === 0 ? ` <span style="color:${M.faint};">this week</span>` : ""}`,
          n(x.decks_used),
          n(x.decks_possible),
          pct(share(x.decks_used, x.decks_possible)),
        ]),
        {
          align: ["left", "right", "right", "right"],
          mono: [false, true, true, true],
        },
      );
    }
    parts.push(
      `${c.p(line, { size: 14 })}${table}${c.small("Possible is four decks a war day up to the finish line (every day in Colosseum) for each member on the roster when the race closed. Decks played after the finish count as used; training days are not counted.")}`,
    );
  }
  if (!parts.length) return "";
  return `${c.h2("War decks")}${parts.join("")}`;
}

/** The clan's battles and members who battled in the weeks before,
 *  said beside this week's in the clan's-week row; "" with none. */
function activityBefore(f) {
  const prior = f.trend?.activity?.prior ?? [];
  const k = prior.length;
  if (!k) return "";
  const avg = (key) => Math.round(prior.reduce((s, x) => s + x[key], 0) / k);
  return k === 1
    ? ` The one recorded week before had ${n(avg("battles"))} battles, by ${n(avg("active"))} members.`
    : ` ${k === 4 ? "The four weeks before" : `The ${k} recorded weeks before`} averaged ${n(avg("battles"))} battles a week, by ${n(avg("active"))} members.`;
}

/** A badge once, however many of its levels the week told (2026-11-06). The
 *  builder folds them; an issue stored before then renders folded too. */
const uniqueBadges = (badges) => {
  const seen = new Map();
  for (const b of badges) seen.set(`${b.name}|${b.badge}`, b);
  return [...seen.values()];
};

/** Decks a race day allows each member; `war_days` counts its war days. */
const WAR_DECKS_PER_DAY = 4;

/** The reader's own line under the tiles (D11): one per player of theirs who
 *  used at least one war deck, so a reader who did not race sees none. "of N"
 *  is said only of a race that closed; the report describes a closed race, and
 *  a race with no recorded war days says only what was used. */
function youLine(f, war, c) {
  if (!war) return "";
  const days = f.trend?.war?.this_week?.war_days;
  const of =
    Number.isInteger(days) && days > 0
      ? ` of ${n(days * WAR_DECKS_PER_DAY)}`
      : "";
  const lines = (war.raced ?? [])
    .filter((m) => c.isMine(m.tag) && m.decks >= 1)
    .map(
      (m) =>
        `You, ${c.P(m.tag, m.name)}: ${n(m.decks)}${of} war deck${m.decks === 1 && !of ? "" : "s"}, ${n(m.points)} points.`,
    );
  return lines
    .map((l) => c.p(l, { size: 14, extra: "margin:12px 0 0;" }))
    .join("");
}

function clan(f, c) {
  const war = f.war?.present ? f.war : null;
  const h =
    f.clan.scope === "activity"
      ? { ...f.headline, battles: null, active: null, sessions: null }
      : f.headline;
  const tag = f.clan.tag;
  const unknownActivity =
    f.clan.scope === "activity"
      ? "This clan’s battles are not recorded, only its roster and races."
      : "Battle activity is unavailable for this report.";
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
        ...(h.battles != null
          ? [
              [
                "Battles",
                n(h.battles),
                h.active != null && h.of
                  ? `by ${h.active} of ${h.of} members`
                  : "",
              ],
            ]
          : []),
        [
          "Members",
          n(f.clan.members),
          c.delta(f.clan.members - f.clan.members_from),
        ],
        ["Donations", n(h.donations), "cards given"],
      ];
  // The week the race was (2026-10-08): its page in the console, by
  // Season and Week, so the link still names this race after the next.
  const raceWeek =
    war?.season != null && war?.week != null
      ? c.small(
          `Every member’s decks and points for Season ${esc(war.season)}, week ${esc(war.week)} are on ${c.link(raceWeekUrl(tag, war.season, war.week), "the week’s page")}.`,
        )
      : "";
  const race = war?.standings?.length
    ? `${c.h2("The race", war.finish_war_day ? `over the line on war day ${war.finish_war_day}` : war.colosseum ? "the Colosseum" : "")}${raceRows(war, tag, c)}${raceWeek}`
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
      text: `${esc(c.dayTime(m))}${m.note ? `, and ${esc(m.note.replace(/^left again\b/, "departed again"))}` : ""}.`,
    })),
    ...f.membership.left.map((m) => ({
      at: m.at ?? "",
      mark: M.loss,
      // "was removed" only once a leader says so, and that word is the clan's
      // (a clan-visibility fact): anyone else reads the roster's own line.
      title: `${c.P(m.tag, m.name)} ${m.removed && c.readsClanFacts(tag) ? "was removed from" : "departed"} ${esc(f.clan.name)}${roleWords(m.role) ? ` (was ${roleWords(m.role)})` : ""}`,
      text: `${esc(c.dayTime(m))}.`,
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
      ? `${c.rows(moves.slice(0, MOVES_CAP))}${extra > 0 ? c.small(`And ${n(extra)} more on ${c.link(c.clanDoor(tag), "the clan’s page")}.`) : ""}`
      : c.small("No joins, departures or role changes.")
  }`;
  // Verified members only (A19): the Monday report reaches people outside the
  // clan, and nobody below co-leader sees a count, so a verified member reads
  // the date of the last battle and anyone else reads no line. An issue stored
  // before the date was kept has only its count, and says nothing for a date it
  // cannot name.
  const quietNames = c.readsClanFacts(tag)
    ? (f.presence?.quiet ?? [])
        .filter((r) => r.last_battle)
        .map((r) => `${esc(r.name)}, last battle ${esc(c.date(r.last_battle))}`)
    : [];
  const backNames = c.readsClanFacts(tag)
    ? (f.presence?.returned ?? []).map((r) => esc(r.name))
    : [];
  const quiet =
    quietNames.length || backNames.length
      ? `${c.h2("Gone quiet", "no battle recorded")}${quietNames.length ? c.p(quietNames.join(" · "), { size: 14 }) : ""}${backNames.length ? c.small(`Back: ${backNames.join(", ")}.`) : ""}`
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
          text: `In ${n(h.sessions)} sessions, by ${n(h.active)} of ${n(h.of)} members.${activityBefore(f)}${wm?.top_battler ? ` ${c.P(wm.top_battler.tag, wm.top_battler.name)} played ${n(wm.top_battler.battles)} of them.` : ""}`,
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
          text: `${uniqueBadges(f.badges)
            .map((b) => `${esc(b.name)}, ${esc(b.badge)}`)
            .join(" · ")}.`,
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
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${FONT};font-size:14px;line-height:1.5;color:${M.muted};">The roster, member by member: role, trophies, last battle and donations.</td><td align="right" style="padding-left:10px;font-family:${FONT};font-size:13.5px;white-space:nowrap;"><a href="${c.T(c.rosterDoor(tag))}" style="color:${M.link};text-decoration:none;font-weight:600;">Open the roster ›</a></td></tr></table>`,
    { mt: 18 },
  );
  const body = `
    ${c.tiles(tiles)}
    ${youLine(f, war, c)}
    ${h.battles == null ? c.small(unknownActivity) : ""}
    ${race}${whoRaced}${trendBlock(f, c)}${comings}${quiet}${theWeek}
    ${f.roster_note ? c.small(esc(f.roster_note)) : ""}
    ${roster}
    ${c.button(`Open ${f.clan.name}`, c.clanDoor(tag))}
    ${c.cov(esc(f.coverage))}`;
  const warBit = war?.rank ? `${ordinal(war.rank)} in war, ` : "";
  const activityLine =
    h.battles == null
      ? unknownActivity
      : `${n(h.battles)} battles${h.active != null && h.of != null ? ` by ${n(h.active)} of ${n(h.of)} members` : ""}.`;
  const preheader = war
    ? `${n(war.fame)} fame${war.finish_war_day ? `, over the line on war day ${war.finish_war_day}` : ""}. ${activityLine}`
    : `${activityLine} ${n(h.donations)} cards donated.`;
  return {
    subject: `${f.clan.name}, ${weekName(f.week)}: ${warBit}${f.membership.left.length} departed, ${f.membership.joined.length} joined`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "clan_report",
        title: `${esc(f.clan.name)} this week`,
        subtitle: `${esc(f.week.label)} · Season ${war?.season ?? f.week.season}${(war?.week ?? f.week.war_week) != null ? `, river race week ${war?.week ?? f.week.war_week}` : ""} · <a href="${c.T(c.clanDoor(tag))}" style="font-family:${MONO};color:${M.faint};text-decoration:none;">${esc(tag)}</a>`,
        preheader,
        body,
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
        "Signed: reported binary matches a signed release named by Elixir.",
      dev_build:
        "Dev build: a local build, rather than a named signed release.",
      unverified: "Unverified: no binary hash reported.",
      mismatch:
        "Mismatch: reported binary hash does not match a named signed release for this version.",
    }[state] ?? "Unverified: no security report available."
  );
}

function collectorUpgrade(f, c) {
  const prefix = f.test ? "[Test replay] " : "";
  const subject = `${prefix}${f.name} upgraded: ${f.from_version} → ${f.to_version}`;
  const preheader = `${f.name} reported ${f.to_version}; previously ${f.from_version}.`;
  const release = f.release;
  const body = `${f.test ? c.cov("This is a test replay of a historical upgrade. No new upgrade was performed.") : ""}
    ${c.p(`Your collector <strong>${esc(f.name)}</strong> reported an upgrade from <strong>${esc(f.from_version)}</strong> to <strong>${esc(f.to_version)}</strong>.`)}
    ${c.small(`Seen ${esc(c.dayTime({ at: f.observed_at }))}.`)}
    ${c.h2("Security status")}${c.p(esc(collectorSecurity(f.signature_state)))}
    ${c.small("This uses the same self-reported version and binary hash as the collectors page. It does not prove the build is genuine.")}
    ${c.h2("Why this release")}${c.p(esc(release?.reason ?? "No upgrade reason was recorded. Elixir saw the installed version change; it cannot tell whether this host updated by itself or its operator changed it."))}
    ${release?.reason ? c.small("The reason above was supplied by the maintainer when naming this release; the installation mechanism on this host was not reported.") : ""}
    ${c.h2(release?.source_url?.includes("/compare/") ? "Changes between these releases" : "Target release changes")}${release?.changes ? c.p(esc(release.changes).replaceAll("\n", "<br>")) : c.p("Release notes were not recorded for this version.")}
    ${release?.release_url ? c.p(c.link(release.release_url, "Read the published release notes")) : ""}
    ${release?.source_url && release.source_url !== release.release_url ? c.p(c.link(release.source_url, "Read the source changes")) : ""}
    ${c.button("Open your collectors", MAIL_PATHS.collectors)}`;
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
        why: "You get this when Elixir sees one of your collectors upgrade. This shares your collector email preference.",
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
      x.adding_fetches != null
        ? `${n(x.adding_fetches)} fetches with new facts`
        : null,
    ]
      .filter(Boolean)
      .map(esc)
      .join(" · ");
    const now =
      s === "active" || s === "probation"
        ? `<span style="color:${M.youInk};"><span style="display:inline-block;width:7px;height:7px;border-radius:999px;background-color:${M.ok};"></span>&nbsp; checking in${s === "probation" ? ", on probation" : ""}</span>`
        : s === "silent"
          ? `<span style="color:${M.warn};">silent${x.since ? ` since ${esc(c.dayTime({ at: x.since }))}` : ""}</span>`
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
    </tr>`;
    })
    .join("")}</table>`;
  // What running one earns: the Family tier, and nothing else (#539). An
  // issue stored before 2026-10-12 carries credits instead and says no
  // tier line; its retired points lines are not drawn.
  const tier = f.tier ?? null;
  const tierLine = !tier
    ? null
    : tier.granted
      ? `your limits are ${esc(tier.role)}, granted, which already sits above Family`
      : tier.family_earned
        ? "your active collector raises your limits to Family"
        : "an active collector raises your limits to Family, and none of yours is active right now";
  const firstStopped = list.find((x) => stateOf(x) === "draining");
  const firstSilent = list.find((x) => stateOf(x) === "silent");
  const body = `
    ${c.p(`<strong style="color:${M.ink};">${n(t.fetches)} fetches</strong> this week${t.of_fleet != null ? ` · ${pct(t.of_fleet)} of all collectors’ fetches` : ""}.`)}
    ${t.saved_share != null ? c.small(`${pct(t.saved_share)} of what your collectors read was blocked before it reached Elixir, as already recorded.`) : ""}
    ${rowsHtml}
    ${c.small("More collectors add resilience, not more Clash Royale budget: all collectors share one rate limit.")}
    ${c.small("Security status uses the self-reported version and binary hash; it does not prove the build is genuine. A signed build can still be behind the current release.")}
    ${tierLine ? `${c.h2("Your limits")}${c.p(`${tierLine[0].toUpperCase()}${tierLine.slice(1)}.`, "margin:0;")}` : ""}
    ${f.fleet_note ? c.small(esc(f.fleet_note)) : ""}
    ${c.button("Open your collectors", MAIL_PATHS.collectors)}
    ${c.cov(esc(f.coverage))}`;
  const preheader = [
    firstSilent
      ? `${firstSilent.name} has been silent${firstSilent.since ? ` since ${c.date(firstSilent.since)}` : ""}.`
      : null,
    firstStopped
      ? `${firstStopped.name} is stopped${firstStopped.since ? `, last checked in on ${c.date(firstStopped.since)}` : ""}.`
      : null,
    tier && !tier.granted && tier.family_earned
      ? "Your active collector raises your limits to Family."
      : null,
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
  // The one clock, in the reader's zone; an issue stored before
  // 2026-10-01 has only its label.
  const when = (m) => (m.instant ? c.dayTime({ at: m.instant }) : (m.at ?? ""));
  const oneSubject = ms.every((m) => m.subject.tag === first.subject.tag);
  const allCards = cards.length === ms.length;
  const words = ["", "one", "two", "three", "four"];
  const title =
    allCards && cards.length > 1
      ? oneSubject
        ? `You unlocked ${words[cards.length] ?? cards.length} cards`
        : `${cards.length} cards unlocked`
      : esc(first.headline);
  const big = (m) => {
    const distinctBig =
      m.big &&
      !String(m.headline ?? "")
        .toLowerCase()
        .includes(String(m.big).toLowerCase());
    const heading = ms.length > 1 ? c.h3(esc(m.headline)) : "";
    if (!distinctBig)
      return `${heading}${m.big_label ? c.p(esc(m.big_label)) : ""}${m.lines?.length ? c.list(m.lines.map(esc)) : ""}`;
    return c.box(
      `${heading}<div style="font-family:${FONT};font-size:28px;font-weight:700;line-height:1.15;color:${M.ink};">${esc(m.big)}</div>
      ${m.big_label ? `<div style="font-family:${FONT};font-size:13.5px;line-height:1.5;color:${M.muted};margin-top:4px;">${esc(m.big_label)}</div>` : ""}
      ${m.lines?.length ? c.list(m.lines.map(esc)) : ""}`,
      { pad: "16px", mt: 12 },
    );
  };
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
    ${c.button(
      `Open ${first.subject.name} in Ladder`,
      ladderUrl(first.subject.tag, "", f.season),
    )}
    ${c.cov("Milestones come from the record, usually within the hour. A move down never mails; only firsts do.")}`;
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
        subtitle: `${esc(when(first))} · ${oneSubject ? c.P(first.subject.tag, first.subject.name) : "Your players"}`,
        preheader,
        body,
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
  const tag = f.clan.tag;
  const today = clanPageUrl(tag, "today");
  // The app's lines are one action each, newest first, and past ten a last
  // line counting the rest. A line that is a string came from a Clan of
  // before 2026-11-06, new ones marked "(new)": it draws with no reason.
  const more = /^And (\d+) more\.$/;
  const lines = f.lines.map((l) =>
    typeof l === "string"
      ? { title: l.replace(/ \(new\)$/, ""), new: / \(new\)$/.test(l), raw: l }
      : l,
  );
  const actions = lines.filter((l) => !more.test(l.raw ?? ""));
  const rest = Number(
    lines.find((l) => more.test(l.raw ?? ""))?.raw.match(more)[1] ?? 0,
  );
  const total = actions.length + rest;
  const reasonOf = (l) =>
    String(l.reason ?? "").replace(/\{\{when:([^}]+)\}\}/g, (_, at) =>
      c.dayTime({ at }),
    );
  const titleOf = (l) => {
    const words = esc(l.title);
    return Number.isInteger(l.number)
      ? c.link(
          clanPageUrl(tag, `actions/${l.number}`),
          words,
          "font-weight:600;",
        )
      : words;
  };
  const body = `${c.rows(
    actions.map((l) => ({
      title: `${titleOf(l)}${l.new ? ` <span style="font-size:12px;font-weight:600;color:${M.link};">· New</span>` : ""}`,
      text: l.reason ? esc(reasonOf(l)) : "",
    })),
  )}
    ${rest ? c.small(`And ${n(rest)} more in ${c.link(today, "Clan › Today")}.`) : ""}
    ${c.button("Review in Clan", f.link)}
    ${c.cov(`Clan sends this each morning when something new is yours to decide. Only people who can act on these actions get it.`)}`;
  const preheader =
    actions.length === 1 && actions[0].reason
      ? reasonOf(actions[0])
      : actions
          .slice(0, 4)
          .map((l) => l.title)
          .join(" · ");
  return {
    subject: f.subject,
    preheader: preheader || f.subject,
    html: (links) =>
      c.shell({
        kind: "clan_actions_waiting",
        title: `${total === 1 ? "One action" : `${n(total)} actions`} waiting`,
        subtitle: `${c.K(tag, clan, today)}`,
        preheader: preheader || f.subject,
        body,
        links,
      }),
  };
}

/**
 * feedback_answer (0204; Jamie, 2026-10-08): the maintainer answered
 * something the reader filed, from any part of Elixir. One mail per
 * answer, sent only when they have not already read it where they filed
 * it. Their own words come back as an excerpt; the answer whole, as
 * plain text (it was written as Markdown for the Console's page).
 */
const FEEDBACK_AREA_LABEL = {
  mcp: "MCP",
  api: "the JSON API",
  console: "the app",
  ladder: "Ladder",
  clan: "Clan",
  mail: "an email",
  docs: "the docs",
  recorder: "the recorder",
};
const FEEDBACK_STATUS_LABEL = {
  seen: "Seen",
  planned: "Planned",
  needs_info: "A question for you",
  done: "Done",
  declined: "Declined",
};
function feedbackAnswer(f, c) {
  const clip = (text, max) => {
    const one = String(text ?? "").trim();
    return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
  };
  const paragraphs = (text) =>
    String(text ?? "")
      .trim()
      .split(/\n\s*\n/)
      .map((para) => c.p(esc(para.trim()).replace(/\n/g, "<br>")))
      .join("");
  const status = FEEDBACK_STATUS_LABEL[f.status] ?? f.status;
  const where = FEEDBACK_AREA_LABEL[f.area] ?? "Elixir";
  const version = f.shipped_in
    ? `<span style="font-family:${MONO};">${esc(f.shipped_in)}</span>`
    : "";
  const shipped = version ? ` · shipped in ${version}` : "";
  const question = f.status === "needs_info";
  const body = `${question ? (version ? c.small(`Shipped in ${version}`, "margin:0 0 12px;") : "") : c.small(`${esc(status)}${shipped}`, "margin:0 0 12px;")}
    ${paragraphs(f.response)}
    ${c.button(question ? "Reply in Elixir" : "Open it in Elixir", f.link)}
    ${c.h2("You wrote")}
    ${c.box(c.p(esc(clip(f.message, 600)).replace(/\n/g, "<br>"), { mb: 0, color: M.muted }))}
    ${c.small("Reply from that page to continue the same thread.")}`;
  const preheader = clip(String(f.response ?? "").replace(/\s+/g, " "), 140);
  return {
    // needs_info (11.10.0) is a question, not an answer: say so first.
    subject: `${f.status === "needs_info" ? "A question about" : "Answered"}: “${clip(String(f.message ?? "").replace(/\s+/g, " "), 60)}”`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "feedback_answer",
        title: question
          ? "A question about your feedback"
          : "Your feedback, answered",
        subtitle: `About ${esc(where)} · filed ${esc(c.date(f.filed_at))}`,
        preheader,
        body,
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
  feedback_answer: feedbackAnswer,
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
      memberClans: Array.isArray(links.member_clans) ? links.member_clans : [],
      verifiedClans: Array.isArray(links.verified_clans)
        ? links.verified_clans
        : [],
      clanmates: links.clanmates ?? {},
      // The season the mail describes: an own player's Ladder link opens it,
      // not the one running when the link is clicked (2026-10-08).
      season:
        facts?.week?.season ?? facts?.war?.season ?? facts?.season ?? null,
      ...(links.now === undefined ? {} : { now: Number(links.now) }),
    }),
  );
  return {
    subject: out.subject,
    preheader: out.preheader,
    html: out.html(links),
  };
}
