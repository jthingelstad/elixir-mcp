/**
 * Tests that seed battle_participant rows by hand (deck JSON and a hash)
 * project them into deck / deck_card / battle_participant_card the way
 * ingest does for real payloads, through the same backfill SQL the
 * production op runs. Call after seeding, before invoking a card tool.
 */
import { backfillBatch } from "../../migrate/src/deck-backfill.mjs";

export async function projectDeckRows(db) {
  let after;
  for (;;) {
    const r = await backfillBatch(db, { after, batch: 20000 });
    if (r.done) return;
    after = r.next_after;
  }
}
