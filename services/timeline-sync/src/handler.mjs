/**
 * SQS consumer Lambda (VPC): one cross-posted timeline brought up to
 * date per wake (Jamie, 2026-10-10: event driven, never polled). An
 * admission that wrote facts writes timeline-sync/<account>.<minute> to
 * the outbox; S3 notifies this queue, which holds it a minute so a burst
 * of admissions is one run; the run writes the lines to discord/ for the
 * non-VPC relay. A failed run leaves the object and retries; an object
 * already gone was run by an earlier copy of the notification.
 *
 * A clan's activity channel (Clan Settings, Social) is woken the same
 * way, by `{ v: 1, clan_tag }`. Its run may wait on the clan's model, so
 * one that would start with less than `CLAN_RUN_MS` left is sent back
 * to the queue untouched and runs on a later delivery.
 */
import { isCanonicalTag, outboxObjects } from "@elixir-mcp/contracts";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
/** Room a clan's run needs: its reads, and the model's 25 s at most. */
const CLAN_RUN_MS = 40_000;

/**
 * @param {{
 *   connect: () => Promise<import("pg").Client>,
 *   sync: (db: any, accountId: string) => Promise<object>,
 *   syncClan?: (db: any, clanTag: string, opts: { remainingMs: () => number }) => Promise<object>,
 *   readObject: (obj: {bucket: string, key: string}) => Promise<string | null>,
 *   deleteObject: (obj: {bucket: string, key: string}) => Promise<unknown>,
 * }} deps
 */
export function makeHandler({
  connect,
  sync,
  syncClan = null,
  readObject,
  deleteObject,
}) {
  async function fromRecord(db, body, remainingMs) {
    const objects = outboxObjects(body);
    if (objects === null) return "bad_message";
    for (const obj of objects) {
      if (!obj.key.startsWith("timeline-sync/")) return "bad_message";
      const text = await readObject(obj);
      if (text === null) continue;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return "bad_message";
      }
      if (msg?.v === 1 && typeof msg.clan_tag === "string") {
        if (!isCanonicalTag(msg.clan_tag) || !syncClan) return "bad_message";
        if (remainingMs() < CLAN_RUN_MS) return "later";
        const out = await syncClan(await db(), msg.clan_tag, { remainingMs });
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
