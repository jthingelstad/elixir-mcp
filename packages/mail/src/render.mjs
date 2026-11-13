/** The renderer: facts in, {subject, preheader, html} out, for the six
 *  product kinds. Every kind sits in the one mail shell (shell.mjs), the
 *  same one the relay's sign-in code and welcome use: the logo and the
 *  wordmark, a product label, one quiet panel, and the
 *  footer that carries the turn-off link, the short mail id and the
 *  disclaimer. Tables and inline styles only; a name opens the
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
  esc,
  mailShell,
  mailParts,
  digestWhyLine,
} from "./shell.mjs";
import { monthDayAt, whenAt } from "@elixir-mcp/ui/time";
import { cardImg } from "./cards.mjs";
import { MAIL_PATHS } from "./paths.mjs";

export const KIND_LABELS = {
  clan_report: "Clan report",
  arena_week: "Your week in the Arena",
  tracking_report: "Your digest",
  top_100: "Top 100",
  card_of_week: "Card of the Week",
  collector_activity: "Collector activity",
  milestone: "Milestones",
  clan_actions_waiting: "Clan actions waiting",
  feedback_answer: "Answers to your feedback",
};

/** The family's apps: a family app's own mail links back to it, and
 *  those links carry the campaign tag too (2026-09-25). Read from the
 *  kit's product manifest, the list the top bar draws: Elixir's own origin
 *  (Clan, part of Elixir, at /clan since 2026-09-28) and every
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
// A player's name opens their player page for every reader (Jamie,
// 2026-11-12, #764: "Yes, one page"): /home/player/<tag without #> (apps/web
// lib/player.js). A clan's name still opens Clan or its record per reader
// (make: clanDoor).
const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));
const playerUrl = (tag) => `${SITE}/home/player/${tagPath(tag)}`;
// A clan's Feed: Clan for its members, the clan directory searched for it
// for anyone else (apps/web src/clan/App.jsx, 2026-11-12).
const clanUrl = (tag) => `${SITE}/clan/${tagPath(tag)}/feed`;
// Clan's own pages (apps/web src/clan/routes.jsx): the tag without its #.
const clanPageUrl = (tag, page) => `${SITE}/clan/${tagPath(tag)}/${page}`;
// The footer links a sent mail's record by its id, and Send feedback opens
// feedback with the mail attached (Jamie, 2026-09-19: "something not right?
// send feedback", one click). The send id is a product identifier, not a
// tracking one (ENGINEERING, "Product identifiers versus measurement"), so
// these links are tagged like every other link into the site; the page
// reports itself to analytics as its kind, never which record.
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

function make(
  campaign = null,
  { pixel = true, timezone = "UTC", memberClans = [], now = Date.now() } = {},
) {
  // A clan's door is chosen per reader (structure, Mail links; A22, Q4): the
  // facts are the same for everyone a report goes to, so the choice is made
  // here and never stored. A render with no reader context (a page's preview,
  // an old send's replay) falls through to the record pages, which open for
  // anyone signed in. A player's name has one door for everyone (#764).
  const isMember = (clanTag) => memberClans.includes(clanTag);
  const playerDoor = (tag) => playerUrl(tag);
  const clanDoor = (tag) =>
    isMember(tag) ? clanPageUrl(tag, "war") : clanUrl(tag);
  // The member pages' one clock (packages/ui/time), so a mail and the
  // page it links to name a moment the same way: "Sat 8:42 pm" within a
  // week, "Fri Oct 23, 5:07 pm" older.
  const dayTime = (m) =>
    m?.at ? whenAt(m.at, timezone, { now }) : (m?.when ?? "");
  const date = (iso) => (iso ? monthDayAt(iso, timezone) : "");
  const T = (url) => tagLink(url, campaign);
  const P = (tag, name) =>
    `<a href="${T(playerDoor(tag))}" title="${esc(tag)}" style="color:${M.link};text-decoration:none;font-weight:600;">${esc(name)}</a>`;
  const K = (tag, name, url = clanDoor(tag)) =>
    `<a href="${T(url)}" title="${esc(tag)}" style="color:${M.link};text-decoration:none;font-weight:600;">${esc(name)}</a>`;
  const parts = mailParts(T);
  // A paragraph: extra CSS as a string, or the part's own options
  // ({size, color, mb, extra}).
  const p = (html, opt = "") =>
    parts.p(html, typeof opt === "string" ? { extra: opt } : opt);
  const { h2, small, box, rows, link } = parts;
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
   *  turn-off, the send's record, the open pixel. */
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
    p,
    h2,
    small,
    list,
    button,
    cov,
    box,
    rows,
    link,
    shell,
    dayTime,
    date,
    isMember,
    clanDoor,
    timezone,
  };
}

/** A record: wins blue, losses rose, everywhere Elixir draws one. */
const recHtml = (w, l) =>
  `<span style="font-family:${MONO};font-weight:700;white-space:nowrap;"><span style="color:${M.win};">${n(w)}</span><span style="color:${M.faint};">–</span><span style="color:${M.loss};">${n(l)}</span></span>`;

// ---------------------------------------------------------------- kinds

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
const timelineUrl = () => `${SITE}/home`;

/** A sentence's first letter in capitals. */
const capFirst = (t) => (t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : t);

/** A clan on the digest: a headline and at most three bullets, the
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

/** A highlight's words as the player wrote them, in a quiet quote. */
const quote = (words) =>
  `<div style="margin:6px 0 0;padding:2px 0 2px 10px;border-left:2px solid ${M.gold};font-family:${FONT};font-size:14px;line-height:1.5;color:${M.ink};">“${esc(words)}”</div>`;

/** One item of the digest: the timeline's sentence, a highlight's words
 *  under it, and the battle's page when the record knows it. Every
 *  string is escaped here, at its output (DECISIONS "A name is escaped
 *  at its output"). */
function digestItem(it, c) {
  const battle = it.battle_url
    ? ` ${c.link(it.battle_url, "See the battle", "font-weight:600;")}`
    : "";
  return `<div style="font-family:${FONT};font-size:13.5px;line-height:1.5;color:${M.muted};margin-top:6px;">${esc(sentence(it.text))}${battle}</div>${it.words ? quote(it.words) : ""}`;
}

/** A person in the digest: their name, their sittings and record, then
 *  what they posted and reached, the rest counted. Tone, not outlines
 *  (DECISIONS "Flat: tone, not outlines"). */
function digestPerson(x, c) {
  const record = x.battles
    ? `${n(x.sessions)} sitting${x.sessions === 1 ? "" : "s"} · ${n(x.battles)} battle${x.battles === 1 ? "" : "s"} · ${recHtml(x.wins, x.losses)}`
    : "No battles recorded";
  const trophies =
    x.trophies && x.trophies.to !== x.trophies.from
      ? `<br>${n(x.trophies.to)} trophies (${signed(x.trophies.to - x.trophies.from)})`
      : x.trophies
        ? `<br>${n(x.trophies.to)} trophies`
        : "";
  const progress = progressText(x.progress);
  const more = x.more_items
    ? c.small(
        `${n(x.more_items)} more on ${c.link(timelineUrl(), "your timeline")}.`,
        "margin-top:4px;",
      )
    : "";
  return c.box(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top" style="font-family:${FONT};font-size:15.5px;font-weight:700;">${c.P(x.tag, x.name)}${x.nickname ? ` <span style="font-weight:400;color:${M.faint};">(${esc(x.nickname)})</span>` : ""}${x.clanmate ? `<br><span style="font-weight:400;font-size:12.5px;color:${M.faint};">In ${c.K(x.clanmate.tag, x.clanmate.name ?? x.clanmate.tag)}</span>` : ""}</td>
      <td align="right" valign="top" style="font-family:${FONT};font-size:12.5px;color:${M.faint};white-space:nowrap;">${record}${trophies}</td></tr></table>
    ${(x.items ?? []).map((it) => digestItem(it, c)).join("")}${progress ? c.small(esc(sentence(capFirst(progress))), "margin-top:4px;") : ""}${more}`,
    { mt: 10 },
  );
}

/** The digest of the people you follow (tracking_report, #767): who
 *  played and posted, what they reached, the clans around the reader and
 *  their own stretch, for a week or a day. An issue stored by the
 *  friends mail before 2026-11-12 is served from its archived HTML
 *  (send records), never re-rendered here. */
function digest(f, c) {
  const daily = f.cadence === "daily";
  const span = daily ? "day" : "week";
  const people = f.people ?? [];
  const total = people.reduce((s, x) => s + (x.battles ?? 0), 0);
  const posted = people.filter((x) =>
    (x.items ?? []).some((it) => it.kind === "battle_highlight"),
  );
  const from = people.length
    ? `${c.h2("From people you follow", `${n(people.length + (f.more_people ?? 0))} of ${n(f.following ?? 0)} had something this ${span}`)}${people.map((x) => digestPerson(x, c)).join("")}${
        f.more_people
          ? c.small(
              `${n(f.more_people)} more ${f.more_people === 1 ? "person" : "people"} you follow had something; ${c.link(`${SITE}/home`, "your feed")} has them all.`,
            )
          : ""
      }`
    : "";
  const you = f.you;
  const youText = you
    ? `${you.battles ? `${n(you.sessions)} sitting${you.sessions === 1 ? "" : "s"}, ${n(you.battles)} battle${you.battles === 1 ? "" : "s"}, ${recHtml(you.wins, you.losses)}` : "No battles recorded"}${you.trophies && you.trophies.to !== you.trophies.from ? `, ${signed(you.trophies.to - you.trophies.from)} trophies` : ""}.${you.alts?.length ? ` With ${you.alts.map((a) => `${c.P(a.tag, a.name)} (${n(a.battles)})`).join(" and ")}.` : ""}${(you.items ?? []).map((it) => `<br>${digestItem(it, c)}`).join("")}${you.progress ? c.small(esc(sentence(capFirst(progressText(you.progress)))), "margin-top:4px;") : ""}${(
        you.alts ?? []
      )
        .filter((a) => a.items?.length || a.progress)
        .map(
          (a) =>
            `<div style="margin-top:8px;font-family:${FONT};font-size:13.5px;font-weight:600;color:${M.ink};">${c.P(a.tag, a.name)}</div>${(a.items ?? []).map((it) => digestItem(it, c)).join("")}${a.progress ? c.small(esc(sentence(capFirst(progressText(a.progress)))), "margin-top:4px;") : ""}`,
        )
        .join("")}`
    : "";
  const around = [
    ...(f.clans ?? []).map((k) => ({
      title: `${c.K(k.tag, k.name)}${you?.clan?.tag === k.tag ? `<span style="font-weight:400;color:${M.faint};">, your clan</span>` : ""}`,
      text: clanBlock(k, c),
      mark: M.link,
    })),
    ...(you
      ? [{ title: `You, ${c.P(you.tag, you.name)}`, text: youText, mark: M.ok }]
      : []),
  ];
  const body = `${from}
    ${around.length ? `${c.h2("Around you")}${c.rows(around)}` : ""}
    ${c.button("Open your feed", `${SITE}/home`)}
    ${c.small(`Anyone with a player tag can be followed: ${c.link(`${SITE}/home/find`, "follow a friend")}. Everyone you follow: <a href="${c.T(MAIL_PATHS.players)}" style="color:${M.link};">Settings › Players</a>.`)}
    ${c.cov(esc(f.coverage ?? ""))}`;
  // The inbox preview: a highlight's words first, else who played.
  const lead = posted[0]
    ? `${posted[0].name}: “${posted[0].items.find((it) => it.kind === "battle_highlight")?.words ?? ""}”`
    : people
        .slice(0, 4)
        .map(
          (x) =>
            `${x.name} ${n(x.battles)} battle${x.battles === 1 ? "" : "s"}`,
        )
        .join(", ");
  const said = posted[0] ? lead : sentence(lead);
  const preheader = lead
    ? said.length > 140
      ? `${said.slice(0, 139)}…`
      : said
    : `Your ${span} in Elixir.`;
  const title = daily ? "Your day in Elixir" : "Your week in Elixir";
  const since = c.date(f.window?.from);
  // With no one you follow in it, a clan's news names the clan (its
  // name is the clan's, never a person's); otherwise "your week".
  const clansOnly = !people.length && !you && (f.clans ?? []).length;
  return {
    subject: `${title}: ${people.length ? `${n(people.length)} ${people.length === 1 ? "person" : "people"} you follow, ${n(total)} battle${total === 1 ? "" : "s"}` : clansOnly ? `${f.clans[0].name}${f.clans.length > 1 ? ` and ${n(f.clans.length - 1)} more` : ""}` : `your ${span}`}`,
    preheader,
    html: (links) =>
      c.shell({
        kind: "tracking_report",
        title,
        subtitle: `${since ? `Since ${esc(since)} · ` : ""}${posted.length ? `${n(posted.length)} highlight${posted.length === 1 ? "" : "s"} · ` : ""}${people.length ? `${n(people.length)} ${people.length === 1 ? "person" : "people"} you follow played ${n(total)} battle${total === 1 ? "" : "s"}` : `your ${span}`}`,
        preheader,
        body,
        why: digestWhyLine(daily ? "daily" : "weekly", c.timezone),
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

/**
 * clan_actions_waiting (2026-09-25; Jamie): Clan's morning mail to a
 * person who can act on something new in their clan. Clan composes the
 * words (a subject, a few plain lines, a link into Clan); the mail holds
 * the address, the switch and the unsubscribe, and renders the lines
 * itself, escaped: no markup crosses from the words.
 */
function clanActions(f, c) {
  const clan = f.clan?.name ?? f.clan?.tag ?? "your clan";
  const tag = f.clan.tag;
  const feed = clanPageUrl(tag, "feed");
  // Clan's lines are one action each, newest first, and past ten a last
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
    ${rest ? c.small(`And ${n(rest)} more in ${c.link(feed, "Clan › Feed")}.`) : ""}
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
        subtitle: `${c.K(tag, clan, feed)}`,
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
  tracking_report: digest,
  collector_activity: collector,
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
      memberClans: Array.isArray(links.member_clans) ? links.member_clans : [],
      ...(links.now === undefined ? {} : { now: Number(links.now) }),
    }),
  );
  return {
    subject: out.subject,
    preheader: out.preheader,
    html: out.html(links),
  };
}
