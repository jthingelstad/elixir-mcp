/** The weekly week_form run ({week_form: true}, EventBridge Monday
 *  16:15Z): stores each claimed player's reading for the game week that
 *  closed at 10:00Z, once its grace has passed (0311,
 *  @elixir-mcp/record/week-form-store). By hand, {week_form: {week_start,
 *  after?}} writes one closed week, or carries a run on from a tag.
 *
 *  Idempotent: a second run for a week writes the same rows and moves no
 *  computed_at. A run that stops short (the deadline) fails the
 *  invocation, and the async retry runs the week again from the start,
 *  which rewrites nothing it already wrote. */
import {
  WEEK_FORM_GRACE_MS,
  WEEK_MS,
  storeWeekForms,
  weekFormDue,
} from "@elixir-mcp/record/week-form-store";
import { openJobsClient } from "./db.mjs";

/** The week a run writes: the one named (a closed Monday 10:00Z whose
 *  grace has passed) or the latest due. */
export function weekFormWeek(spec, nowMs = Date.now()) {
  if (!spec?.week_start) return weekFormDue(nowMs);
  const start = Date.parse(spec.week_start);
  const d = new Date(start);
  if (
    !Number.isFinite(start) ||
    d.getUTCDay() !== 1 ||
    start % 3_600_000 !== 0 ||
    d.getUTCHours() !== 10
  )
    throw new Error("week_form: week_start must be a Monday 10:00Z");
  if (start + WEEK_MS + WEEK_FORM_GRACE_MS > nowMs)
    throw new Error("week_form: that week's grace has not passed");
  return start;
}

export async function runWeekForm(
  databaseUrl,
  { spec = null, remainingMs = null, nowMs = Date.now() } = {},
) {
  const start = weekFormWeek(spec, nowMs);
  const db = await openJobsClient(databaseUrl, { op: "week_form" });
  try {
    return await storeWeekForms(db, start, {
      after: typeof spec?.after === "string" ? spec.after : "",
      remainingMs,
    });
  } finally {
    await db.end();
  }
}
