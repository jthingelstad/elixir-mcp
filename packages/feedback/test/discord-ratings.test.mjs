/**
 * A rating of one Discord post (2026-10-11): feedback with a
 * discord_post ref, filed only about a post the filer may rate (their
 * own or their agent's timeline line; a clan's post, its leader checked
 * by the caller), a second rating following the first, Jamie told of a
 * thumbs down or a note only, and the page kind never accepted from a
 * door's own refs. On a scratch database (golden rule 9).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { migrate } from "../../../services/migrate/src/migrate.mjs";
import {
  FeedbackError,
  cleanRefs,
  discordRatings,
  feedbackItem,
  rateDiscordPost,
} from "../src/feedback.mjs";

const ADMIN_URL =
  process.env.PG_ADMIN_URL ?? "postgres://otto@localhost:5432/postgres";
const NAME = `elixir_discord_ratings_test_${process.pid}`;
const DB_URL = ADMIN_URL.replace(/\/postgres$/, `/${NAME}`);
const FP = "0123456789abcdef";
const CLAN = "#J2RGCRVG";
const POST = {
  mine: "aaaaaaaa-0000-4000-8000-000000000001",
  agents: "aaaaaaaa-0000-4000-8000-000000000002",
  others: "aaaaaaaa-0000-4000-8000-000000000003",
  action: "aaaaaaaa-0000-4000-8000-000000000004",
  activity: "aaaaaaaa-0000-4000-8000-000000000005",
  skipped: "aaaaaaaa-0000-4000-8000-000000000006",
  refused: "aaaaaaaa-0000-4000-8000-000000000007",
  lost: "aaaaaaaa-0000-4000-8000-000000000008",
  waiting: "aaaaaaaa-0000-4000-8000-000000000009",
};

let db;
let person;
let other;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.query(`create database ${NAME}`);
  await admin.end();
  await migrate({
    databaseUrl: DB_URL,
    migrationsDir: new URL("../../../db/migrations", import.meta.url).pathname,
  });
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();
  const make = async (hash) =>
    (
      await db.query(
        `insert into account (email_hash, status) values ($1, 'approved') returning account_id`,
        [hash],
      )
    ).rows[0].account_id;
  person = { accountId: await make("ratings-person") };
  other = { accountId: await make("ratings-other") };
  const agent = (
    await db.query(
      `insert into account (email_hash, status, kind, owned_by_account_id, public_id)
       values (null, 'approved', 'agent', $1, 'rateagent01') returning account_id`,
      [person.accountId],
    )
  ).rows[0].account_id;
  const row = (id, feature, accountId, clanTag) =>
    db.query(
      `insert into discord_post (post_id, feature, account_id, clan_tag,
         destination, webhook_fp, post_key, revision, action, mode, content,
         handed_at, outcome, outcome_at)
       values ($1, $2, $3, $4, $5, $6, 'k', 1, 'post', 'line', 'Ada won.',
               now(), 'posted', now())`,
      [id, feature, accountId, clanTag, clanTag ?? accountId, FP],
    );
  await row(POST.mine, "timeline", person.accountId, null);
  await row(POST.agents, "timeline", agent, null);
  await row(POST.others, "timeline", other.accountId, null);
  await row(POST.action, "clan_actions", null, CLAN);
  await row(POST.activity, "clan_activity", null, CLAN);
  for (const [id, action, outcome] of [
    [POST.skipped, "skip", "skipped"],
    [POST.refused, "post", "refused"],
    [POST.lost, "post", "not_delivered"],
    [POST.waiting, "post", null],
  ])
    await db.query(
      `insert into discord_post (post_id, feature, clan_tag, destination,
         webhook_fp, post_key, revision, action, mode, content, handed_at,
         outcome, outcome_at)
       values ($1, 'clan_activity', $2, $2, $3, 'k', 1, $4, 'model', 'Bo won.',
               now(), $5, case when $5::text is null then null else now() end)`,
      [id, CLAN, FP, action, outcome],
    );
});
after(async () => {
  await db?.end();
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${NAME} with (force)`);
  await admin.end();
});

const refused = async (promise, code) =>
  assert.rejects(promise, (err) => {
    assert.ok(err instanceof FeedbackError);
    assert.equal(err.code, code);
    return true;
  });

test("a door's own refs never carry a Discord post: only a page that checked it files one", () => {
  const out = cleanRefs([{ kind: "discord_post", ref: POST.mine }]);
  assert.deepEqual(out.refs, []);
  assert.equal(out.dropped[0].reason, "unknown_kind");
});

test("a timeline line is the filer's or their agent's to rate; another's is not found", async () => {
  const told = [];
  const notifyOwner = async (spec) => told.push(spec);
  const up = await rateDiscordPost(db, {
    account: person,
    feature: "timeline",
    postId: POST.mine.toUpperCase(),
    rating: "up",
    notifyOwner,
  });
  assert.equal(up.rating, "up");
  assert.equal(told.length, 0, "a bare thumbs up is not news to Jamie");
  const item = await feedbackItem(db, up.feedback_id);
  assert.deepEqual(item.refs, [{ kind: "discord_post", ref: POST.mine }]);
  assert.equal(item.area, "console");
  assert.equal(item.category, "praise");
  assert.equal(item.context.rating, "up");

  const agents = await rateDiscordPost(db, {
    account: person,
    feature: "timeline",
    postId: POST.agents,
    rating: "down",
    note: "  It named the wrong deck. ",
    notifyOwner,
  });
  assert.equal(told.length, 1, "a thumbs down is");
  const down = await feedbackItem(db, agents.feedback_id);
  assert.match(down.message, /: It named the wrong deck\.$/);
  assert.equal(down.context.noted, true);

  await refused(
    rateDiscordPost(db, {
      account: person,
      feature: "timeline",
      postId: POST.others,
      rating: "up",
    }),
    "not_found",
  );
  // A clan's post is never a timeline's.
  await refused(
    rateDiscordPost(db, {
      account: person,
      feature: "timeline",
      postId: POST.action,
      rating: "up",
    }),
    "not_found",
  );
});

test("a clan's post is rated within its clan and feature; a second rating follows the first, and the latest stands", async () => {
  const first = await rateDiscordPost(db, {
    account: other,
    feature: "clan_actions",
    clanTag: "j2rgcrvg",
    postId: POST.action,
    rating: "down",
  });
  const second = await rateDiscordPost(db, {
    account: other,
    feature: "clan_actions",
    clanTag: CLAN,
    postId: POST.action,
    rating: "up",
    note: "On reflection, fine.",
  });
  assert.equal(String(second.follows_id), String(first.feedback_id));
  assert.equal((await feedbackItem(db, second.feedback_id)).area, "clan");
  assert.deepEqual(
    await discordRatings(db, other.accountId, [
      POST.action,
      POST.activity,
      "nope",
    ]),
    { [POST.action]: { rating: "up", feedback_id: second.feedback_id } },
  );
  for (const [feature, clanTag, postId] of [
    ["clan_activity", CLAN, POST.action],
    ["clan_actions", "#GCYQR9VY", POST.action],
    ["clan_actions", "not a tag", POST.action],
    ["clan_actions", CLAN, "not-a-uuid"],
  ])
    await refused(
      rateDiscordPost(db, {
        account: other,
        feature,
        clanTag,
        postId,
        rating: "up",
      }),
      "not_found",
    );
});

test("a rating is up or down, a note is bounded, and the feature is one of the three", async () => {
  const base = {
    account: person,
    feature: "clan_activity",
    clanTag: CLAN,
    postId: POST.activity,
  };
  await refused(rateDiscordPost(db, { ...base, rating: "meh" }), "bad_rating");
  await refused(
    rateDiscordPost(db, { ...base, rating: "up", note: "x".repeat(1001) }),
    "bad_note",
  );
  await refused(
    rateDiscordPost(db, { ...base, feature: "email", rating: "up" }),
    "bad_feature",
  );
});

test("only a line that reached the channel is rated: a skip, a refusal or a lost one is not found", async () => {
  const base = { account: person, feature: "clan_activity", clanTag: CLAN };
  for (const postId of [POST.skipped, POST.refused, POST.lost])
    await refused(
      rateDiscordPost(db, { ...base, postId, rating: "down" }),
      "not_found",
    );
  // Its receipt still on the way: the history already shows it posted.
  const waiting = await rateDiscordPost(db, {
    ...base,
    postId: POST.waiting,
    rating: "up",
  });
  assert.equal(waiting.ok, true);
});
