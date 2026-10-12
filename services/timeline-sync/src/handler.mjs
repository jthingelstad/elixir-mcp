/**
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
 * The relay's receipts for the quality ledger (0222: what Discord
 * answered for each post) arrive on discord-receipt/ and are read into
 * the ledger here, the one place in the VPC its notifications reach.
 */
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
];

/**
 * @param {{
 *   connect: () => Promise<import("pg").Client>,
 *   sync: (db: any, accountId: string) => Promise<object>,
 *   syncClan?: (db: any, clanTag: string, opts: { remainingMs: () => number, editor: boolean }) => Promise<object>,
 *   shareClanDiscord?: (db: any, clanTag: string) => Promise<object>,
 *   receipts?: ((db: any, msg: object) => Promise<object | null>) | null,
 *   readObject: (obj: {bucket: string, key: string}) => Promise<string | null>,
 *   deleteObject: (obj: {bucket: string, key: string}) => Promise<unknown>,
 * }} deps
 */
export function makeHandler({
  connect,
  sync,
  syncClan = null,
  shareClanDiscord = null,
  receipts = null,
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
      const held = lane !== "timeline-sync/" && !receipt;
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
      if (receipt) {
        if (!receipts) return "bad_message";
        const out = await receipts(await db(), msg);
        // A receipt the ledger cannot read is dropped, never retried.
        if (out === null) console.error("discord_receipt_bad");
        else console.log("discord_receipt", JSON.stringify(out));
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
          outcome = await fromRecord(db, record.body, remainingMs);
        } catch (err) {
          console.error(
            "timeline_sync_retry",
            err?.code ?? err?.name ?? "error",
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
