/**
 * SQS consumer Lambda (VPC): one cross-posted timeline brought up to
 * date per wake (Jamie, 2026-10-10: event driven, never polled). An
 * admission that wrote facts writes timeline-sync/<account>.<minute> to
 * the outbox; S3 notifies this queue, which holds it a minute so a burst
 * of admissions is one run; the run writes the lines to discord/ for the
 * non-VPC relay. A failed run leaves the object and retries; an object
 * already gone was run by an earlier copy of the notification.
 */
import { outboxObjects } from "@elixir-mcp/contracts";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/**
 * @param {{
 *   connect: () => Promise<import("pg").Client>,
 *   sync: (db: any, accountId: string) => Promise<object>,
 *   readObject: (obj: {bucket: string, key: string}) => Promise<string | null>,
 *   deleteObject: (obj: {bucket: string, key: string}) => Promise<unknown>,
 * }} deps
 */
export function makeHandler({ connect, sync, readObject, deleteObject }) {
  async function fromRecord(db, body) {
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
      if (
        msg?.v !== 1 ||
        typeof msg.account_id !== "string" ||
        !UUID.test(msg.account_id)
      )
        return "bad_message";
      const out = await sync(await db(), msg.account_id);
      console.log("timeline_synced", msg.account_id, JSON.stringify(out));
      await deleteObject(obj).catch(() =>
        console.error("outbox_delete_failed", "transport_error"),
      );
    }
    return "done";
  }

  return async function handler(event) {
    const batchItemFailures = [];
    let client = null;
    const db = async () => (client ??= await connect());
    try {
      for (const record of event.Records ?? []) {
        let outcome;
        try {
          outcome = await fromRecord(db, record.body);
        } catch (err) {
          console.error(
            "timeline_sync_retry",
            err?.code ?? err?.name ?? "error",
          );
          outcome = "retry";
        }
        if (outcome !== "done")
          batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } finally {
      await client?.end().catch(() => {});
    }
    return { batchItemFailures };
  };
}
