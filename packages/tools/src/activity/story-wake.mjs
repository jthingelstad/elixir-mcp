/**
 * The wake that keeps a recorded player's stored stories fresh (stage 2
 * of the stored Timeline, 2026-11-23;
 * docs/notes/2026-11-23-timeline-story-fresh.md).
 *
 * An admission that wrote facts about a player calls wakeStories after
 * its commit, as it calls wakeSyndication: one timeline-sync outbox
 * object per player per minute, written once, so every admission about
 * that player in the minute is one object. The queue holds it a minute
 * (DelaySeconds 60), so it is read after its minute has closed; its
 * `since` is the minute's end, and a write whose build began after that
 * holds every admission of the minute (refreshSubjectStories skips the
 * wake then). The object's key carries an md5 of the tag, never the tag.
 *
 * Never fails the admission: the collector logs a failure and the jobs'
 * sweep (storiesToWake) finds the news within five minutes.
 */
import { createHash } from "node:crypto";
import { RECORDED_PLAYERS_SQL } from "../recorded-players.mjs";

const MINUTE_MS = 60_000;

/** The outbox id of a player's wake in `minute` (epoch minutes). */
export const storyWakeId = (tag, minute) =>
  `story.${createHash("md5").update(tag).digest("hex")}.${minute}`;

/** The wake writer for an outbox, or null without one:
 *  `(tag, now) => Promise`. */
export function storyWake(outbox) {
  if (!outbox) return null;
  return (tag, now = Date.now()) => {
    const minute = Math.floor(now / MINUTE_MS);
    return outbox(
      "timeline-sync",
      {
        v: 1,
        story_player: tag,
        since: new Date((minute + 1) * MINUTE_MS).toISOString(),
      },
      { id: storyWakeId(tag, minute), once: true },
    );
  };
}

/** After an admission about `tag`: wake its stories when it is a
 *  recorded player (RECORDED_PLAYERS_SQL: the store holds only those).
 *  One statement; the tag is pushed into both branches of the set, each
 *  an indexed lookup. Returns 1 when woken. */
export async function wakeStories(db, tag, { outbox, now = Date.now() }) {
  const wake = storyWake(outbox);
  if (!wake || !tag) return 0;
  const { rows } = await db.query(
    `select 1 from (${RECORDED_PLAYERS_SQL}) r where r.player_tag = $1 limit 1`,
    [tag],
  );
  if (!rows.length) return 0;
  await wake(tag, now);
  return 1;
}
