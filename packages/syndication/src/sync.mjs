/** One account's timeline, brought up to date in its Discord channel.
 *
 *  Run by the timeline-sync Lambda when a wake (wake.mjs) names the
 *  account. It reads the account's own timeline as an agent or the mail
 *  does (non-interactive: leaders-only facts never leave Elixir), from
 *  its own pointer, and writes timeline-discord/ outbox objects with a line
 *  per item that is new or has grown since it was told. The relay posts
 *  a new item and edits a grown one in place, so the rows here are what
 *  was told and at which revision; Discord's message ids stay with the
 *  relay. The pointer is the sync's alone: it never moves a connection's
 *  read pointer or meta.timeline_pending. */
import { DISCORD_POSTS_MAX } from "@elixir-mcp/contracts";
import {
  buildTimeline,
  subjectsFor,
  timelineNews,
} from "@elixir-mcp/tools/activity/entries";
import { battleLinks } from "@elixir-mcp/record/battle-links";
import { discordLine, itemBattleId } from "./lines.mjs";

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
/** The timeline's reach: a pointer older than this reads from here. */
const REACH_MS = 30 * DAY_MS;
/** An open sitting is re-read from its start for this long, so its edit
 *  tells the whole sitting; longer than any sitting is played. */
const OPEN_MS = 12 * HOUR_MS;
/** Told rows outlive the timeline's reach by a day, then go. */
const TOLD_KEEP_DAYS = 31;
/** A window the timeline's cap cut is narrowed at most this often. */
const NARROW_MAX = 6;

/** The revision a post carries: the story's revision, and whether a
 *  sitting is still open, so a sitting that closes with no new battle is
 *  still edited once to drop "still going". */
export const postRevision = (it) =>
  it.revision * 2 + (it.facts?.open === true ? 0 : 1);

const observedMs = (it) => Date.parse(it.observed_at ?? it.at);

/**
 * @param {import("pg").ClientBase} db
 * @param {string} accountId
 * @param {{ outbox: Function, readStatus?: Function, now?: number }} deps
 */
export async function syncAccount(
  db,
  accountId,
  { outbox, readStatus = async () => null, now = Date.now() },
) {
  await db.query("begin");
  try {
    const out = await syncLocked(db, accountId, { outbox, readStatus, now });
    await db.query("commit");
    return out;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

async function syncLocked(db, accountId, { outbox, readStatus, now }) {
  // One sync per account at a time: two wakes a minute apart wait here,
  // and the second reads what the first told.
  const {
    rows: [row],
  } = await db.query(
    `select d.webhook_sealed, d.webhook_fp, d.enabled, d.enabled_at, d.synced_to, d.updated_at,
            a.status, coalesce(a.timezone, o.timezone, 'UTC') as timezone
       from timeline_discord d
       join account a on a.account_id = d.account_id
       left join account o on o.account_id = a.owned_by_account_id
      where d.account_id = $1
        for update of d`,
    [accountId],
  );
  if (!row || !row.enabled) return { skipped: "off" };
  if (row.status !== "approved") return { skipped: "account" };

  // The relay alone hears Discord; when it heard that this webhook is
  // gone or refused (since it was saved), cross-posting turns off and the
  // console says why.
  const status = await readStatus(accountId);
  if (
    status?.state === "gone" &&
    status.webhook === row.webhook_fp &&
    Date.parse(status.at) >= row.updated_at.getTime()
  ) {
    await db.query(
      `update timeline_discord
          set enabled = false, disabled_reason = 'webhook_gone',
              disabled_at = $2
        where account_id = $1`,
      [accountId, new Date(now)],
    );
    return { disabled: "webhook_gone" };
  }

  const enabledMs = row.enabled_at.getTime();
  const fromMs = Math.max(enabledMs, now - REACH_MS, row.synced_to.getTime());
  let toMs = now;
  const subjects = await subjectsFor(db, accountId);
  const clanTags = new Set(
    subjects.filter((s) => s.kind === "clan").map((s) => s.tag),
  );
  // Not filtered (Jamie, 2026-10-10), but an account's own
  // administration ("your account: ...") is not the game and stays in
  // the console.
  const game = (it) => it.section !== "account";
  const read = (from, to, filter = game) =>
    buildTimeline(db, subjects, {
      fromMs: from,
      toMs: to,
      timezone: row.timezone,
      accountId,
      interactive: false,
      filter,
    });

  const byId = new Map();
  let narrowed = false;
  const news =
    subjects.length > 0 &&
    fromMs < toMs &&
    (await timelineNews(db, subjects, { fromMs, toMs, accountId })).any;
  if (news) {
    let built = await read(fromMs, toMs);
    // The timeline keeps a window's newest 150 by when they were
    // observed; a busier window is read again up to the newest it cut,
    // and the rest follows in the next run, so nothing is skipped.
    for (let i = 0; i < NARROW_MAX && built.timeline_more > 0; i += 1) {
      const cut = built.timeline_dropped
        .map(observedMs)
        .filter(Number.isFinite);
      const to = cut.length ? Math.max(...cut) : toMs;
      if (!(to > fromMs && to < toMs)) break;
      toMs = to;
      narrowed = true;
      built = await read(fromMs, toMs);
    }
    for (const it of built.timeline) byId.set(it.id, it);
  }

  // A sitting told while still open is read again from its start, so
  // its edit tells the whole sitting, not the battles since the
  // pointer. Only those stories pass the filter, which runs before the
  // cap, so the long window cannot crowd them out.
  const { rows: open } = await db.query(
    `select item_id, open_from from timeline_discord_told
      where account_id = $1 and open_from > $2`,
    [accountId, new Date(now - OPEN_MS)],
  );
  if (open.length && subjects.length) {
    const openIds = new Set(open.map((r) => r.item_id));
    const openFrom = Math.min(...open.map((r) => r.open_from.getTime()));
    const again = await read(
      Math.max(enabledMs, openFrom - 1),
      toMs,
      (it) => game(it) && openIds.has(it.id),
    );
    for (const it of again.timeline) byId.set(it.id, it);
  }

  const items = [...byId.values()].filter((it) => observedMs(it) > enabledMs);
  const ids = items.map((it) => it.id);
  const { rows: toldRows } = await db.query(
    `select item_id, revision from timeline_discord_told
      where account_id = $1 and item_id = any($2::text[])`,
    [accountId, ids],
  );
  const told = new Map(toldRows.map((r) => [r.item_id, r]));
  const fresh = items
    .filter((it) => (told.get(it.id)?.revision ?? 0) < postRevision(it))
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  if (fresh.length) {
    const battles = await battleLinks(
      db,
      fresh.map(itemBattleId).filter(Boolean),
    );
    const posts = fresh.map((it) => ({
      key: it.id,
      revision: postRevision(it),
      content: discordLine(it, { battles, clanTags, nowMs: now }),
    }));
    for (let i = 0; i < posts.length; i += DISCORD_POSTS_MAX)
      await outbox(
        "timeline-discord",
        {
          v: 1,
          kind: "timeline",
          account_id: accountId,
          // Sealed: the sync copies it and cannot open it.
          webhook: row.webhook_sealed,
          posts: posts.slice(i, i + DISCORD_POSTS_MAX),
        },
        { id: `${accountId}.${now}.${i / DISCORD_POSTS_MAX}` },
      );
    // A sitting still open keeps the start it was first told with, so
    // the next run reads all of it.
    const isOpen = (it) => it.facts?.open === true && !!it.facts?.started_at;
    await db.query(
      `insert into timeline_discord_told
              (account_id, item_id, revision, told_at, open_player, open_from)
       select $1, x.item_id, x.revision, $2, x.open_player, x.open_from
         from unnest($3::text[], $4::int[], $5::text[], $6::timestamptz[])
           as x(item_id, revision, open_player, open_from)
       on conflict (account_id, item_id) do update
          set revision = excluded.revision,
              told_at = excluded.told_at,
              open_player = excluded.open_player,
              open_from = case when excluded.open_from is null then null
                               else least(coalesce(timeline_discord_told.open_from,
                                                   excluded.open_from),
                                          excluded.open_from) end`,
      [
        accountId,
        new Date(now),
        fresh.map((it) => it.id),
        fresh.map(postRevision),
        fresh.map((it) =>
          isOpen(it) ? (it.facts.player_tag ?? it.subject_tag) : null,
        ),
        fresh.map((it) => (isOpen(it) ? it.facts.started_at : null)),
      ],
    );
  }
  await db.query(
    `update timeline_discord_told set open_player = null, open_from = null
      where account_id = $1 and open_from <= $2`,
    [accountId, new Date(now - OPEN_MS)],
  );
  await db.query(
    `delete from timeline_discord_told
      where account_id = $1 and told_at < $2`,
    [accountId, new Date(now - TOLD_KEEP_DAYS * DAY_MS)],
  );
  await db.query(
    `update timeline_discord set synced_to = greatest(synced_to, $2)
      where account_id = $1`,
    [accountId, new Date(toMs)],
  );
  // What the cap held back is the next run's: wake this account again.
  if (narrowed)
    await outbox(
      "timeline-sync",
      { v: 1, account_id: accountId },
      { id: `${accountId}.${now}.more` },
    );
  return { posted: fresh.length, narrowed };
}
