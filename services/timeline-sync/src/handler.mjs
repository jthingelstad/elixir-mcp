/**
 * Elixir Drop's separate SQS source carries one completed game per message.
 * SQS consumer Lambda (VPC): one cross-posted timeline brought up to
 * date per wake (Jamie, 2026-10-10: event driven, never polled). An
 * admission that wrote facts writes timeline-sync/<account>.<minute> to
 * the outbox; S3 notifies this queue, which holds it a minute so a burst
 * of admissions is one run; the run writes the lines to discord/ for the
 * non-VPC relay. A failed run leaves the object and retries; an object
 * already gone was run by an earlier copy of the notification.
 *
 * A clan's activity channel (Social ▸ Discord) is woken the same
 * way, by `{ v: 1, clan_tag }`. Its run may wait on the clan's model, so
 * one that would start with less than `CLAN_RUN_MS` left is sent back
 * to the queue untouched and runs on a later delivery.
 *
 * A clan's Actions in its Discord (2026-10-11) are looked at again a
 * minute after each hand-off to the relay, by `{ v: 1, clan_discord }`:
 * the relay's answers are collected and the next Actions handed over,
 * under the clan's lock. When another holder has the lock it shares
 * itself (Clan does after every request, the morning run after its
 * sweep), so the wake is done.
 *
 * A clan's activity channel holds a story until it has been quiet a few
 * minutes (2026-10-11): the run that held it writes timeline-hold/
 * `{ v: 1, clan_tag }`, which its own queue delivers here five minutes
 * later, and the clan's run goes again.
 *
 * A clan whose own model edits its channel (2026-10-11, the editor) is
 * sent from either queue to timeline-editor/, whose queue delivers one
 * clan an invocation: the model's rounds may take two minutes, and no
 * other wake waits behind them.
 *
 * Home's stored week (home_feed, 0245; #649) is rebuilt by
 * `{ v: 1, home_feed: <account> }`, which a Home read writes when its
 * row is past fresh and the jobs' five-minute run writes for the
 * accounts that read Home lately. A build that fails is logged and
 * dropped, never retried: the next wake builds it, and a read whose row
 * is too old builds it itself. With TIMELINE_STORY_BUILD at `shadow` or
 * `on` (stage 4 of the stored Timeline, 2026-11-25) the build also logs
 * one `home_feed_story_build` line of counts.
 *
 * A recorded player's stored stories (timeline_story, stage 2 of the
 * stored Timeline, 2026-11-23) are rewritten by `{ v: 1, story_player,
 * since }`, which an admission about the player writes once a minute and
 * the jobs' five-minute run writes for what no admission announces. A
 * write already begun after `since` serves it without a build. A failed
 * write is logged (its error's class, never the tag) and dropped: the
 * player's record is then newer than its write, and the next sweep wakes
 * it again.
 *
 * The relay's receipts for the quality ledger (0222: what Discord
 * answered for each post) arrive on discord-receipt/ and are read into
 * the ledger here, the one place in the VPC its notifications reach. Its
 * web push receipts (2026-11-16) arrive on push-receipt/ the same way: a
 * device's last success, or its deletion when its push service says gone.
 */
import { recordDropGame } from "@elixir-mcp/record/attested-facts";
import { isCanonicalTag, outboxObjects } from "@elixir-mcp/contracts";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
/** Room a clan's run needs: its reads (a model's run is sent on). */
const CLAN_RUN_MS = 40_000;
/** Room an editor's run needs to start: its reads and one round. */
const EDITOR_RUN_MS = 60_000;
const LANES = [
  "timeline-sync/",
  "timeline-hold/",
  "timeline-editor/",
  "discord-receipt/",
  "push-receipt/",
];

/**
 * @param {{
 *   dropGamesQueueArn?: string,
 *   connect: () => Promise<import("pg").Client>,
 *   sync: (db: any, accountId: string) => Promise<object>,
 *   syncClan?: (db: any, clanTag: string, opts: { remainingMs: () => number, editor: boolean }) => Promise<object>,
 *   shareClanDiscord?: (db: any, clanTag: string) => Promise<object>,
 *   receipts?: ((db: any, msg: object) => Promise<object | null>) | null,
 *   pushReceipts?: ((db: any, msg: object) => Promise<object | null>) | null,
 *   homeFeed?: ((db: any, accountId: string, opts?: { since?: string }) => Promise<object>) | null,
 *   stories?: ((db: any, playerTag: string, opts: { since: string | null }) => Promise<object>) | null,
 *   readObject: (obj: {bucket: string, key: string}) => Promise<string | null>,
 *   deleteObject: (obj: {bucket: string, key: string}) => Promise<unknown>,
 * }} deps
 */
export function makeHandler({
  dropGamesQueueArn = process.env.DROP_GAMES_QUEUE_ARN,
  connect,
  sync,
  syncClan = null,
  shareClanDiscord = null,
  receipts = null,
  pushReceipts = null,
  homeFeed = null,
  stories = null,
  readObject,
  deleteObject,
}) {
  async function fromRecord(db, body, remainingMs) {
    const objects = outboxObjects(body);
    if (objects === null) return "bad_message";
    for (const obj of objects) {
      // A clan's held stories come back on the hold queue (2026-10-11),
      // to the same run, and its model's run has a queue of its own:
      // only a clan's wake is read on either.
      const lane = LANES.find((l) => obj.key.startsWith(l));
      if (!lane) return "bad_message";
      const receipt = lane === "discord-receipt/";
      const pushReceipt = lane === "push-receipt/";
      const held = lane !== "timeline-sync/" && !receipt && !pushReceipt;
      const editor = lane === "timeline-editor/";
      const text = await readObject(obj);
      if (text === null) continue;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return "bad_message";
      }
      if (held && !(msg?.v === 1 && typeof msg.clan_tag === "string"))
        return "bad_message";
      if (pushReceipt) {
        if (!pushReceipts) return "bad_message";
        const out = await pushReceipts(await db(), msg);
        // A receipt that is not one is dropped, never retried.
        if (out === null) console.error("push_receipt_bad");
        else console.log("push_receipt", JSON.stringify(out));
      } else if (receipt) {
        if (!receipts) return "bad_message";
        const out = await receipts(await db(), msg);
        // A receipt the ledger cannot read is dropped, never retried.
        if (out === null) console.error("discord_receipt_bad");
        else console.log("discord_receipt", JSON.stringify(out));
      } else if (msg?.v === 1 && typeof msg.home_feed === "string") {
        if (!UUID.test(msg.home_feed) || !homeFeed) return "bad_message";
        try {
          // `since`: a week built after this read (own refresh, 2026-11-14).
          const since =
            typeof msg.since === "string" &&
            Number.isFinite(Date.parse(msg.since))
              ? msg.since
              : null;
          const out = await homeFeed(
            await db(),
            msg.home_feed,
            since ? { since } : {},
          );
          // Stage 4's comparison is a line of its own, with no account,
          // tag, name or content (home-feed.mjs logStoryBuild).
          const { story = null, ...built } = out ?? {};
          console.log("home_feed_built", msg.home_feed, JSON.stringify(built));
          if (story)
            console.log(
              JSON.stringify({
                at: "home_feed_story_build",
                door: "home_sync",
                ...story,
              }),
            );
        } catch (err) {
          console.error(
            "home_feed_failed",
            msg.home_feed,
            err?.code ?? err?.name ?? "error",
            err?.message,
          );
        }
      } else if (msg?.v === 1 && typeof msg.story_player === "string") {
        if (!isCanonicalTag(msg.story_player) || !stories) return "bad_message";
        const since =
          typeof msg.since === "string" &&
          Number.isFinite(Date.parse(msg.since))
            ? msg.since
            : null;
        try {
          const out = await stories(await db(), msg.story_player, { since });
          console.log("timeline_story_written", JSON.stringify(out));
        } catch (err) {
          // Counts and the error's class only: no tag in this log.
          console.error(
            "timeline_story_failed",
            err?.code ?? err?.name ?? "error",
          );
        }
      } else if (msg?.v === 1 && typeof msg.clan_discord === "string") {
        if (!isCanonicalTag(msg.clan_discord) || !shareClanDiscord)
          return "bad_message";
        const out = await shareClanDiscord(await db(), msg.clan_discord);
        console.log(
          "clan_discord_shared",
          msg.clan_discord,
          JSON.stringify(out),
        );
      } else if (msg?.v === 1 && typeof msg.clan_tag === "string") {
        if (!isCanonicalTag(msg.clan_tag) || !syncClan) return "bad_message";
        if (remainingMs() < (editor ? EDITOR_RUN_MS : CLAN_RUN_MS))
          return "later";
        const out = await syncClan(await db(), msg.clan_tag, {
          remainingMs,
          editor,
        });
        console.log("clan_activity_synced", msg.clan_tag, JSON.stringify(out));
      } else {
        if (
          msg?.v !== 1 ||
          typeof msg.account_id !== "string" ||
          !UUID.test(msg.account_id)
        )
          return "bad_message";
        const out = await sync(await db(), msg.account_id);
        console.log("timeline_synced", msg.account_id, JSON.stringify(out));
      }
      await deleteObject(obj).catch(() =>
        console.error("outbox_delete_failed", "transport_error"),
      );
    }
    return "done";
  }

  return async function handler(event, context) {
    const remainingMs = () => context?.getRemainingTimeInMillis?.() ?? 60_000;
    const batchItemFailures = [];
    let client = null;
    const db = async () => (client ??= await connect());
    try {
      for (const record of event.Records ?? []) {
        let outcome;
        try {
          if (
            dropGamesQueueArn &&
            record.eventSourceARN === dropGamesQueueArn
          ) {
            const inserted = await recordDropGame(
              await db(),
              JSON.parse(record.body),
            );
            console.log(
              "drop_game_received",
              inserted ? "recorded" : "already_recorded_or_unlinked",
            );
            outcome = "done";
          } else {
            outcome = await fromRecord(db, record.body, remainingMs);
          }
        } catch (err) {
          // The kind and what broke, as the tools' invoker logs it: the
          // 596 dead letters of 2026-10-15 logged only "ReferenceError"
          // here, and their cause was read from the MCP door's log.
          console.error(
            "timeline_sync_retry",
            err?.code ?? err?.name ?? "error",
            err?.message,
          );
          outcome = "retry";
        }
        if (outcome === "later") console.log("clan_activity_later");
        if (outcome !== "done")
          batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } finally {
      await client?.end().catch(() => {});
    }
    return { batchItemFailures };
  };
}
