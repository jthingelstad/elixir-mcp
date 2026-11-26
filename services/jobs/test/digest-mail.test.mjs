/**
 * The digest (tracking_report, #767) over a scratch database: a followed
 * friend's post about a battle with their words and the battle's page, a nothing
 * window with no mail, and attested facts never entering it. A clan's attested facts are for the
 * people who read the clan's timeline, and an away is for a leader
 * reading it themselves, never a mail (DECISIONS, "Attested facts"). The
 * mail's moments are filtered BEFORE the timeline's 150-item cap, so a
 * busy clan's facts can neither reach the mail nor crowd its moments out.
 * Since 2026-11-12 it is the one digest: the clan's own news and the
 * people you follow in one story, each player once.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { ATTESTED_FACT_KINDS } from "@elixir-mcp/contracts";
import { buildTimeline } from "../../../packages/tools/src/activity/entries.mjs";
import {
  buildDigest,
  clanNews,
  digestWindow,
} from "../src/email/build-digest.mjs";
import { digestSlot } from "../src/email/index.mjs";
import { renderMail } from "../../../packages/mail/src/render.mjs";
import { htmlToText } from "@elixir-mcp/mail";
import { readMemberItemPath } from "@elixir-mcp/ui/item-link";
import { whenAt } from "@elixir-mcp/ui/time";
import { projectCardCatalog } from "../../../packages/ingest/src/cards.mjs";
import { seedPlayedDeck } from "../../../packages/tools/test/deck-rows.mjs";
import {
  createScratch,
  dropScratch,
} from "../../../packages/ingest/test/helpers.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_mcp_test_digest_mail_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);

const CLAN = "#0QC8RCGY";
const LEADER = "#0LCLRCPQ";
const MEMBER = "#0J8CVLL8";
const OPP = "#0Q0L80CC";
// A friend the leader follows, with a name a person typed to break mail.
const FRIEND = "#00LR2Y2Q";
const FRIEND_NAME = `<img src=x onerror=alert(1)>Stoat`;
const WORDS = `Three crowns <b>at last</b> & "finally"`;
const FROM = new Date("2026-09-14T10:00:00Z");
const TO = new Date("2026-09-21T10:00:00Z");
const window = { fromMs: FROM.getTime(), toMs: TO.getTime() };
// More clan facts than the timeline's cap, all newer than the moment.
const MESSAGES = 160;

let db, accountId;

before(async () => {
  await createScratch(NAME);
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  accountId = (
    await db.query(
      `insert into account (email_hash, status) values ('tracking-test', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Example')`, [
    CLAN,
  ]);
  for (const tag of [LEADER, MEMBER, OPP])
    await db.query(`insert into player (player_tag, name) values ($1, $1)`, [
      tag,
    ]);
  await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
    FRIEND,
    FRIEND_NAME,
  ]);
  // The recipient: a verified leader of the clan, tracking it too.
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'verified', true, 'primary', true)`,
    [accountId, LEADER],
  );
  await db.query(
    `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
     values ($1, $2, 'unverified', false, 'friend', true)`,
    [accountId, FRIEND],
  );
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, role)
     values ($1, $2, '2026-08-01T00:00:00Z', 'leader'),
            ($1, $3, '2026-08-01T00:00:00Z', 'member')`,
    [CLAN, LEADER, MEMBER],
  );
  await db.query(
    `insert into account_clan (account_id, clan_tag, notify) values ($1, $2, true)`,
    [accountId, CLAN],
  );
  // The leader's week: a battle and a career-wins moment early on.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b1', '2026-09-15T11:00:00Z', 'PvP', 'pvp', '2026-09-15T11:30:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, type, type_class)
     values ('b1', $1, 0, '2026-09-15T11:00:00Z', 'win', 'PvP', 'pvp'),
            ('b1', $2, 1, '2026-09-15T11:00:00Z', 'loss', 'PvP', 'pvp')`,
    [LEADER, OPP],
  );
  // The friend's win, and their post about it with their own words,
  // posted by the friend's own account.
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b2', '2026-09-16T20:00:00Z', 'PvP', 'pvp', '2026-09-16T20:30:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ('b2', $1, 0, '2026-09-16T20:00:00Z', 'win', 3, 'PvP', 'pvp'),
            ('b2', $2, 1, '2026-09-16T20:00:00Z', 'loss', 0, 'PvP', 'pvp')`,
    [FRIEND, OPP],
  );
  const fixture = async (name) =>
    JSON.parse(
      await readFile(
        new URL(`../../../fixtures/${name}`, import.meta.url),
        "utf8",
      ),
    );
  await projectCardCatalog(db, {
    payload: await fixture("cards/catalog.json"),
    fetchedAt: TO,
  });
  const played = (
    await fixture("player_battlelog/with_colosseum_duel.json")
  ).find((b) => b.type === "PvP").team[0];
  const deckHash = await seedPlayedDeck(db, {
    battle_id: "b2",
    player_tag: FRIEND,
    battle_time: "2026-09-16T20:00:00Z",
    cards: played.cards,
    supportCards: played.supportCards,
  });
  await db.query(
    "update battle_participant set deck_hash = $1 where battle_id = 'b2' and player_tag = $2",
    [deckHash, FRIEND],
  );
  const poster = (
    await db.query(
      `insert into account (email_hash, status) values ('digest-friend', 'approved')
       returning account_id`,
    )
  ).rows[0].account_id;
  await db.query(
    `insert into account_post (item_id, player_tag, battle_id, account_id, body, created_at)
     values ('tl_' || substr(md5(random()::text), 1, 20), $1, 'b2', $2, $3, '2026-09-16T21:00:00Z')`,
    [FRIEND, poster, WORDS],
  );
  await db.query(
    `insert into player_event
       (player_tag, event_type, timing, window_start, window_end, value_after, step)
     values ($1, 'career_wins_step', 'estimated', '2026-09-15T10:00:00Z',
             '2026-09-15T12:00:00Z', 5000, 5000)`,
    [LEADER],
  );
  // Later in the week: a member's away (leaders only), clan chat lines
  // past the cap (clan), and a personal record for the leader (player).
  const fact = (kind, subject, player, detail, ref, at) =>
    db.query(
      `insert into attested_fact
         (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
          source, source_ref, attester_tag, attester_role, occurred_at, recorded_at)
       values ($1, $2, $3, $4, $5, 'clan', 'clan.poapkings.com', $6, $7,
               'leader', $8, $8)`,
      [
        subject,
        subject === "clan" ? CLAN : null,
        player,
        kind,
        detail,
        ref,
        LEADER,
        at,
      ],
    );
  await fact(
    "member_away",
    "clan",
    MEMBER,
    {},
    "away-1",
    "2026-09-17T09:00:00Z",
  );
  for (let i = 0; i < MESSAGES; i++)
    await fact(
      "clan_message",
      "clan",
      null,
      { channel: "clan_chat", body: `private line ${i}` },
      `chat-${i}`,
      new Date(Date.parse("2026-09-18T00:00:00Z") + i * 60_000).toISOString(),
    );
  await fact(
    "personal_record",
    "player",
    LEADER,
    { game: "Elixir Drop", score: 1234 },
    "record-1",
    "2026-09-19T09:00:00Z",
  );
});

after(async () => {
  await db?.end();
  await dropScratch(NAME);
});

test("control: unfiltered, the recipient's timeline carries the facts and the cap cuts the moment", async () => {
  const { timeline } = await buildTimeline(
    db,
    [
      { kind: "player", tag: LEADER, relationship: "primary" },
      { kind: "clan", tag: CLAN },
    ],
    {
      fromMs: FROM.getTime(),
      toMs: TO.getTime(),
      accountId,
      interactive: true,
    },
  );
  const kinds = new Set(timeline.map((it) => it.kind));
  for (const k of ["clan_message", "personal_record"])
    assert.ok(kinds.has(k), `${k} is on the timeline`);
  // The mail used to read this timeline and filter after the cap.
  assert.ok(!kinds.has("career_wins_step"), "the cap spent on facts");
});

test("a leader's digest holds no attested kind, and the facts do not crowd out their moments", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId, timezone: "UTC" },
    kind: "tracking_report",
    window,
  });
  assert.ok(mail?.you, "the leader has their own week");
  assert.ok(
    mail.you.items.some((m) => /career wins/.test(m.text)),
    `the career-wins moment survives the cap: ${JSON.stringify(mail.you.items)}`,
  );
  const body = JSON.stringify(mail);
  for (const kind of ATTESTED_FACT_KINDS)
    assert.ok(!body.includes(kind), `${kind} is not in the mail`);
  assert.ok(!/private line|away from|personal best/.test(body), body);
});

test("digest posts and non-post updates show their original local time and exact member item", async () => {
  const facts = await buildDigest({
    db,
    account: { accountId, timezone: "America/Chicago" },
    kind: "tracking_report",
    window,
  });
  const update = facts.you.items.find((it) => it.kind === "career_wins_step");
  const post = facts.people
    .find((p) => p.tag === FRIEND)
    .items.find((it) => it.kind === "battle_highlight");
  assert.equal(update.at, "2026-09-15T12:00:00.000Z");
  assert.equal(post.at, "2026-09-16T21:00:00.000Z");
  const now = Date.parse("2026-11-18T12:00:00Z");
  const rendered = renderMail("tracking_report", facts, {
    timezone: "America/Chicago",
    now,
    unsubscribe: "https://elixir.example/off",
    manage: "/settings/emails",
  });
  const text = htmlToText(rendered.html);
  for (const item of [update, post]) {
    assert.ok(text.includes(whenAt(item.at, "America/Chicago", { now })), text);
    const url = new URL(item.member_path, "https://elixir.poapkings.com");
    const id = url.pathname.split("/").at(-1);
    const target = readMemberItemPath(id, Object.fromEntries(url.searchParams));
    assert.equal(target.ref.kind, item.kind);
    assert.ok(rendered.html.includes(`/home/item/${id}?`));
    assert.equal(target.ref.at, item.at);
  }
});

test("a followed friend's post about a battle comes with their words and the battle's page, never their share link", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId, timezone: "UTC" },
    kind: "tracking_report",
    window,
  });
  const friend = mail.people.find((p) => p.tag === FRIEND);
  assert.ok(friend, JSON.stringify(mail.people));
  assert.equal(friend.relationship, "friend");
  assert.equal(friend.battles, 1);
  const champion = friend.sittings[0].deck.cards.find((c) => c.id === 26000074);
  assert.equal(champion.rarity, "champion");
  assert.equal(champion.form, "base");
  const [h] = friend.items;
  assert.equal(h.kind, "battle_highlight");
  // The words as typed: escaping is the render's, at its output.
  assert.equal(h.words, WORDS);
  assert.match(h.text, /posted about a 3-0 win/);
  assert.ok(
    !h.text.includes("at last"),
    "the words are not in the sentence too",
  );
  assert.match(String(h.battle_url), /\/battle\/b2$/);
  assert.ok(!("share_url" in h));
  assert.equal(mail.following, 1);
  // Rendered, the name and the words are text, never markup.
  const out = renderMail("tracking_report", mail, {
    unsubscribe: "https://elixir.example/u",
    manage: "/settings/emails",
    period: "2026-09-21",
    pixel: false,
  });
  assert.doesNotMatch(out.html, /<img src=x|<b>at last/);
  assert.match(out.html, /&lt;img src=x onerror=alert\(1\)&gt;Stoat/);
  assert.match(
    out.html,
    /Three crowns &lt;b&gt;at last&lt;\/b&gt; &amp; &quot;finally&quot;/,
  );
  // The friend's name opens the player page, the one door for every
  // reader (#764); the record pages are no longer a name's door.
  assert.ok(
    out.html.includes(`/home/player/${FRIEND.slice(1)}?`),
    "the friend's name opens the player page",
  );
  assert.doesNotMatch(out.html, /\/console\/explore\/player\//);
});

test("a window where nothing happened is no mail", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId, timezone: "UTC" },
    kind: "digest_daily",
    window: digestWindow(new Date("2026-07-01T00:00:00Z"), "digest_daily"),
  });
  assert.equal(mail, null);
});

test("the window: a day, a week or the closed season back, starting no earlier than that email's last send", () => {
  const now = new Date("2026-11-18T14:30:00Z");
  const day = 86400_000;
  assert.deepEqual(digestWindow(now, "tracking_report"), {
    fromMs: now.getTime() - 7 * day,
    toMs: now.getTime(),
  });
  assert.equal(digestWindow(now, "digest_daily").fromMs, now.getTime() - day);
  // The weekly recap's own last send bounds it: nothing twice.
  const last = new Date(now.getTime() - day + 60_000);
  assert.equal(
    digestWindow(now, "tracking_report", last).fromMs,
    last.getTime(),
  );
  // A send older than the span leaves the span.
  assert.equal(
    digestWindow(now, "digest_daily", new Date(now.getTime() - 3 * day)).fromMs,
    now.getTime() - day,
  );
  // The season recap reaches back to the closed season's start.
  const start = Date.parse("2026-10-05T10:00:00Z");
  assert.equal(
    digestWindow(now, "digest_season", undefined, start).fromMs,
    start,
  );
  assert.throws(() => digestWindow(now, "digest_season"));
});

test("each digest's slot: the daily brief any day, the weekly recap on Monday, the season recap on a season's first day", () => {
  const scheduled = { scheduled: true };
  const thu = new Date("2026-10-08T11:00:00Z");
  const mon = new Date("2026-10-12T11:00:00Z");
  const rollover = new Date("2026-11-02T11:00:00Z");
  assert.deepEqual(digestSlot("digest_daily", thu, scheduled), {
    due: true,
    periodKey: "2026-10-08",
  });
  assert.equal(digestSlot("tracking_report", thu, scheduled).due, false);
  assert.deepEqual(digestSlot("tracking_report", mon, scheduled), {
    due: true,
    periodKey: "2026-10-12",
  });
  assert.equal(digestSlot("digest_season", mon, scheduled).due, false);
  assert.deepEqual(digestSlot("digest_season", rollover, scheduled), {
    due: true,
    periodKey: "S137",
    season: 137,
    seasonStartMs: Date.parse("2026-10-05T10:00:00Z"),
  });
  // An ops run (one account, or force) sends any day.
  assert.equal(
    digestSlot("digest_season", mon, { scheduled: false }).due,
    true,
  );
  // On a rollover Monday all three are due.
  for (const kind of ["digest_daily", "tracking_report", "digest_season"])
    assert.equal(digestSlot(kind, rollover, scheduled).due, true, kind);
});

// Readers of their own, so the leader's counts above stay as they are.
const W2 = {
  fromMs: Date.parse("2026-10-01T00:00:00Z"),
  toMs: Date.parse("2026-10-08T00:00:00Z"),
};
async function reader(label, claims) {
  const id = (
    await db.query(
      `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
      [`digest-${label}`],
    )
  ).rows[0].account_id;
  for (const [tag, relationship] of claims) {
    await db.query(
      `insert into player (player_tag, name) values ($1, $1) on conflict do nothing`,
      [tag],
    );
    await db.query(
      `insert into claim (account_id, player_tag, status, is_primary, relationship, notify)
       values ($1, $2, $3, $4, $5, true)`,
      [
        id,
        tag,
        relationship === "friend" ? "unverified" : "verified",
        relationship === "primary",
        relationship,
      ],
    );
  }
  return id;
}

test("a followed player who only posted is told: a post about an older battle, with no battles in the window", async () => {
  const QUIET = "#0P0LQ0C9";
  const POSTER = "#08LV2GGR";
  const id = await reader("post-only", [
    [QUIET, "primary"],
    [POSTER, "friend"],
  ]);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b3', '2026-08-20T20:00:00Z', 'PvP', 'pvp', '2026-08-20T20:30:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ('b3', $1, 0, '2026-08-20T20:00:00Z', 'win', 2, 'PvP', 'pvp')`,
    [POSTER],
  );
  await db.query(
    `insert into account_post (item_id, player_tag, battle_id, account_id, body, created_at)
     values ('tl_' || substr(md5(random()::text), 1, 20), $1, 'b3', $2, 'Still my best game', '2026-10-03T12:00:00Z')`,
    [POSTER, id],
  );
  const mail = await buildDigest({
    db,
    account: { accountId: id, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
  });
  assert.ok(mail, "a post alone is a digest");
  const [p] = mail.people;
  assert.equal(p.tag, POSTER);
  assert.equal(p.name, POSTER);
  assert.equal(p.battles, 0);
  assert.equal(p.post_count, 1);
  assert.deepEqual(mail.followed_activity, {
    posters: 1,
    posts: 1,
    players: 0,
    battles: 0,
  });
  assert.equal(p.items[0].kind, "battle_highlight");
  assert.equal(p.items[0].words, "Still my best game");
  assert.equal(mail.you, null, "a quiet reader with no alt has no line");
  const out = renderMail("tracking_report", mail, {
    unsubscribe: "https://elixir.example/u",
    manage: "/settings/emails",
    period: "2026-10-08",
    pixel: false,
  });
  assert.doesNotMatch(out.html, /No battles recorded/);
  assert.match(out.subject, /1 post from 1 player/);
  assert.match(out.html, /Still my best game/);
});

test("an alt that played makes the reader's own stretch when the primary was quiet", async () => {
  const MAIN = "#0QQQ22CJ";
  const ALT = "#00U8GYLQ";
  const id = await reader("alt-only", [
    [MAIN, "primary"],
    [ALT, "alt"],
  ]);
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ('b4', '2026-10-04T18:00:00Z', 'PvP', 'pvp', '2026-10-04T18:20:00Z')`,
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ('b4', $1, 0, '2026-10-04T18:00:00Z', 'win', 1, 'PvP', 'pvp')`,
    [ALT],
  );
  const mail = await buildDigest({
    db,
    account: { accountId: id, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
  });
  assert.ok(mail, "an alt's battles are a digest");
  assert.deepEqual(mail.people, []);
  assert.equal(mail.you.tag, MAIN);
  assert.equal(mail.you.battles, 0);
  assert.deepEqual(
    mail.you.alts.map((a) => [a.tag, a.battles]),
    [[ALT, 1]],
  );
});

// The merge (2026-11-12): a clan the reader tracks and members they
// follow. Invented players and clan, as every fixture here.
const C2 = "#09UCRVCV";
const MATE = "#08CPPJ8Y";
const GONE = "#0RJPVCP0";
const NEWBIE = "#0RPQCQ20";
const SELF = "#098PRJCP";

async function played(id, tag, at) {
  await db.query(
    `insert into battle (battle_id, battle_time, type, type_class, created_at)
     values ($1, $2, 'PvP', 'pvp', $2::timestamptz + interval '10 minutes')`,
    [id, at],
  );
  await db.query(
    `insert into battle_participant (battle_id, player_tag, side, battle_time, outcome, crowns, type, type_class)
     values ($1, $2, 0, $3, 'win', 1, 'PvP', 'pvp')`,
    [id, tag, at],
  );
}

let mergeReader, clanOnlyReader;
test("setup: a clan with a join and a departure, two clanmates followed", async () => {
  await db.query(`insert into clan (clan_tag, name) values ($1, 'Otters')`, [
    C2,
  ]);
  for (const [tag, name] of [
    [MATE, "Mate"],
    [GONE, "Gone"],
    [NEWBIE, "Newbie"],
  ])
    await db.query(`insert into player (player_tag, name) values ($1, $2)`, [
      tag,
      name,
    ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values ($1, $2, '2026-08-01T00:00:00Z', null, 'member'),
            ($1, $3, '2026-08-01T00:00:00Z', '2026-10-03T08:00:00Z', 'member'),
            ($1, $4, '2026-10-02T08:00:00Z', null, 'member')`,
    [C2, MATE, GONE, NEWBIE],
  );
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, occurred_at, player_tag, role_after)
     values ($1, 'member_joined', 'estimated', '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z', $2, 'member')`,
    [C2, NEWBIE],
  );
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, occurred_at, player_tag)
     values ($1, 'member_left', 'estimated', '2026-10-03T08:00:00Z', '2026-10-03T08:00:00Z', '2026-10-03T08:00:00Z', $2)`,
    [C2, GONE],
  );
  await played("m1", MATE, "2026-10-04T12:00:00Z");
  await played("m2", GONE, "2026-10-02T12:00:00Z");
  mergeReader = await reader("merge", [
    [SELF, "primary"],
    [MATE, "friend"],
    [GONE, "friend"],
  ]);
  clanOnlyReader = await reader("clan-only", [["#0R2YLRRJ", "primary"]]);
  for (const id of [mergeReader, clanOnlyReader])
    await db.query(
      `insert into account_clan (account_id, clan_tag, notify) values ($1, $2, true)`,
      [id, C2],
    );
});

test("each player once: a followed clanmate is told under themselves, the clan part keeps to its own news", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId: mergeReader, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
  });
  assert.ok(mail);
  const [clan] = mail.clans;
  assert.equal(clan.tag, C2);
  const told = [clan.headline, ...clan.bullets].join(" | ");
  assert.match(told, /joined: Newbie/);
  assert.match(told, /departed: Gone/);
  // The clan part never repeats its members' play.
  assert.doesNotMatch(told, /battle|quiet/i);
  const mate = mail.people.find((p) => p.tag === MATE);
  assert.deepEqual(mate.clanmate, { tag: C2, name: "Otters" });
  assert.equal(mate.battles, 1);
  // The departure is the clan's news; it is not told again under Gone.
  const gone = mail.people.find((p) => p.tag === GONE);
  assert.ok(gone, JSON.stringify(mail.people));
  assert.ok(
    !gone.items.some((it) => it.kind === "clan_left"),
    JSON.stringify(gone.items),
  );
  // Each player appears once in the whole mail.
  const out = renderMail("tracking_report", mail, {
    unsubscribe: "https://elixir.example/u",
    manage: "/settings/emails",
    period: "2026-10-08",
    pixel: false,
  });
  assert.equal(out.html.match(/>Mate</g)?.length, 1, out.html);
  assert.match(out.html, /In <a [^>]*>Otters<\/a>/);
});

test("the clan part turned off: no clan part, and the moves are told under the people", async () => {
  const mail = await buildDigest({
    db,
    account: { accountId: mergeReader, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
    fold: { clan: false, arena: true },
  });
  assert.ok(mail, "the people followed still make a digest");
  assert.deepEqual(mail.clans, []);
  const gone = mail.people.find((p) => p.tag === GONE);
  assert.ok(gone, JSON.stringify(mail.people));
  assert.ok(
    gone.items.some((it) => it.kind === "clan_left"),
    JSON.stringify(gone.items),
  );
});

test("the clan part turned off: a followed clanmate's role change is told under them (Codex on #919)", async () => {
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, occurred_at, player_tag, role_before, role_after)
     values ($1, 'role_changed', 'estimated', '2026-10-04T09:00:00Z', '2026-10-04T09:00:00Z', '2026-10-04T09:00:00Z', $2, 'member', 'elder')`,
    [C2, MATE],
  );
  const args = {
    db,
    account: { accountId: mergeReader, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
  };
  const off = await buildDigest({
    ...args,
    fold: { clan: false, arena: true },
  });
  const mate = off.people.find((p) => p.tag === MATE);
  assert.ok(
    mate.items.some(
      (it) => it.kind === "member_role_changed" && /Elder/.test(it.text),
    ),
    JSON.stringify(mate.items),
  );
  // On, the role change is the clan part's news and never told twice.
  const on = await buildDigest(args);
  assert.match(
    [on.clans[0].headline, ...on.clans[0].bullets].join(" | "),
    /roles/,
  );
  assert.ok(
    !on.people
      .find((p) => p.tag === MATE)
      .items.some((it) => it.kind === "member_role_changed"),
  );
});

test("the clan part turned off: a followed clanmate promoted with nothing else to tell still stands in the digest (Codex on #922)", async () => {
  const QUIET = "#0V2YC8QQ";
  await db.query(`insert into player (player_tag, name) values ($1, 'Quiet')`, [
    QUIET,
  ]);
  await db.query(
    `insert into clan_membership (clan_tag, player_tag, joined_observed_at, left_observed_at, role)
     values ($1, $2, '2026-08-01T00:00:00Z', null, 'elder')`,
    [C2, QUIET],
  );
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, occurred_at, player_tag, role_before, role_after)
     values ($1, 'role_changed', 'estimated', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z', '2026-10-04T10:00:00Z', $2, 'member', 'elder')`,
    [C2, QUIET],
  );
  // A reader who follows the clan and only this quiet member.
  const id = await reader("quiet-promoted", [
    ["#0YQ2Y0LR", "primary"],
    [QUIET, "friend"],
  ]);
  await db.query(
    `insert into account_clan (account_id, clan_tag, notify) values ($1, $2, true)`,
    [id, C2],
  );
  const mail = await buildDigest({
    db,
    account: { accountId: id, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
    fold: { clan: false, arena: true },
  });
  assert.ok(mail, "the promotion alone is a digest");
  assert.deepEqual(mail.clans, []);
  const quiet = mail.people.find((p) => p.tag === QUIET);
  assert.ok(quiet, JSON.stringify(mail.people));
  assert.equal(quiet.battles, 0);
  assert.ok(
    quiet.items.some((it) => it.kind === "member_role_changed"),
    JSON.stringify(quiet.items),
  );
});

test("a clan's news alone sends a weekly digest, never one for a reader who had the clan report off", async () => {
  const args = {
    db,
    account: { accountId: clanOnlyReader, timezone: "UTC" },
    window: W2,
  };
  const weekly = await buildDigest({ ...args, kind: "tracking_report" });
  assert.ok(weekly, "the clan's week is a digest");
  assert.deepEqual(weekly.people, []);
  assert.equal(weekly.clans[0].tag, C2);
  const out = renderMail("tracking_report", weekly, {
    unsubscribe: "https://elixir.example/u",
    manage: "/settings/emails",
    period: "2026-10-08",
    pixel: false,
  });
  assert.match(out.subject, /Otters/);
  // Clan report off before the merge: no more mail than before.
  assert.equal(
    await buildDigest({
      ...args,
      kind: "tracking_report",
      fold: { clan: false, arena: true },
    }),
    null,
  );
  // A daily reader is not mailed every day for roster moves alone.
  assert.equal(await buildDigest({ ...args, kind: "digest_daily" }), null);
});

test("an alt is a name and a count for a reader who had Arena week off", async () => {
  const MAIN = "#0RJ2LUCQ";
  const ALT = "#0VC0RU8P";
  const id = await reader("arena-off", [
    [MAIN, "primary"],
    [ALT, "alt"],
  ]);
  await played("a1", ALT, "2026-10-05T18:00:00Z");
  const base = {
    db,
    account: { accountId: id, timezone: "UTC" },
    kind: "tracking_report",
    window: W2,
  };
  const on = await buildDigest(base);
  assert.ok("items" in on.you.alts[0]);
  const off = await buildDigest({
    ...base,
    fold: { clan: true, arena: false },
  });
  assert.deepEqual(off.you.alts, [{ tag: ALT, name: ALT, battles: 1 }]);
});

test("a finished race is a daily reader's clan news; the clan line names its place and fame", async () => {
  await db.query(
    `insert into war_week (clan_tag, season_id, section_index, is_colosseum, started_observed_at, finished_observed_at, closed_at)
     values ($1, 136, 3, false, '2026-09-28T10:00:00Z', '2026-10-05T09:40:00Z', '2026-10-05T09:38:00Z')`,
    [C2],
  );
  await db.query(
    `insert into clan_event (clan_tag, event_type, timing, window_start, window_end, occurred_at, war_season_id, section_index, fame, rank)
     values ($1, 'week_resolved', 'estimated', '2026-10-05T09:40:00Z', '2026-10-05T09:40:00Z', '2026-10-05T09:40:00Z', 136, 3, 10000, 2)`,
    [C2],
  );
  const mail = await buildDigest({
    db,
    account: { accountId: clanOnlyReader, timezone: "UTC" },
    kind: "digest_daily",
    window: W2,
  });
  assert.ok(mail);
  assert.equal(mail.clans[0].race, true);
  assert.equal(
    mail.clans[0].headline,
    "River race (season 136, week 4): finished 2nd with 10,000 fame",
  );
});

test("the clan's news, as a line: Colosseum named, names capped, roles", () => {
  const names = (n) => ({
    items: Array.from({ length: n }, (_, i) => ({
      tag: `#T${i}`,
      name: `P${i}`,
    })),
    more: 0,
  });
  const { race, parts } = clanNews({
    war: {
      resolved: [
        { season_id: 141, week: 4, is_colosseum: true, rank: 1, fame: 52000 },
      ],
    },
    roster: {
      joined: names(7),
      left: { items: [], more: 0 },
      role_changes: {
        items: [{ name: "P1", from: "member", to: "elder" }],
        more: 0,
      },
    },
  });
  assert.equal(race, true);
  assert.deepEqual(parts, [
    "Colosseum (season 141, week 4): finished 1st with 52,000 fame",
    "joined: P0, P1, P2, P3, P4 +2 more",
    "roles: P1 member → elder",
  ]);
  assert.deepEqual(clanNews({}), { race: false, parts: [], named: [] });
});

test("clanNews names the people you follow first, and says which moves it named", () => {
  const joined = {
    items: Array.from({ length: 7 }, (_, i) => ({
      tag: `#T${i}`,
      name: `P${i}`,
    })),
    more: 0,
  };
  // The reader follows the sixth to join: named, not hidden in "+N more"
  // (Codex on #823).
  const { parts, named } = clanNews(
    {
      roster: {
        joined,
        left: { items: [{ tag: "#L0", name: "Gone" }], more: 0 },
      },
    },
    new Set(["#T5"]),
  );
  assert.deepEqual(parts, [
    "joined: P5, P0, P1, P2, P3 +2 more",
    "departed: Gone",
  ]);
  assert.deepEqual(named, [
    ["joined|#T5", "joined|#T0", "joined|#T1", "joined|#T2", "joined|#T3"],
    ["left|#L0"],
  ]);
});

test("digest ownership proof is batched for shown players and does not come from a friend claim", async () => {
  const args = {
    db,
    account: { accountId, timezone: "UTC" },
    kind: "tracking_report",
    window,
  };
  const mail = await buildDigest(args);
  assert.equal(
    mail.player_verifications[LEADER],
    true,
    "verified without chosen art",
  );
  assert.equal(mail.player_verifications[FRIEND], false);
  await db.query("begin");
  try {
    await db.query(
      "update claim set status = 'verified' where account_id = $1 and player_tag = $2",
      [accountId, FRIEND],
    );
    assert.equal(
      (await buildDigest(args)).player_verifications[FRIEND],
      false,
      "a friend relationship is not ownership",
    );
    await db.query(
      "update claim set status = 'unverified' where account_id = $1 and player_tag = $2",
      [accountId, FRIEND],
    );
    const owner = (
      await db.query(
        "insert into account (email_hash, status) values ('digest-proof-owner', 'approved') returning account_id",
      )
    ).rows[0].account_id;
    await db.query(
      "insert into claim (account_id, player_tag, status, is_primary, relationship) values ($1, $2, 'verified', true, 'primary')",
      [owner, FRIEND],
    );
    assert.equal(
      (await buildDigest(args)).player_verifications[FRIEND],
      true,
      "a separate verified owner, without art",
    );
  } finally {
    await db.query("rollback");
  }
});
