import { noun, useClock } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";

/**
 * Battle activity: a GitHub-style year of days (docs/activity). Mobile
 * first, like Verify: the year scrolls sideways and opens on the newest
 * weeks, and a tap on a cell writes what it holds into the caption
 * underneath instead of relying on hover. The 24x7 rhythm tile that sat
 * under it retired 2026-09-19 (Jamie: the year is the product; the
 * rhythm was not worth its place, and the scheduler never used it).
 *
 * A whole closed UTC day needs complete comparable observation intervals
 * before an empty count means quiet. Positive battles always stay visible;
 * incomplete or missing evidence never means inactivity.
 *
 * One hue by battle count, four steps scaled to the player's own busiest
 * day, and hatching for unknown (Jamie, 2026-11-05: won and lost stay in the
 * two-week list; the page is about recording). Identity is never colour
 * alone: every cell carries its value in an accessible name, and the list
 * under the graphic is the table view.
 */
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function isoDow(day) {
  // 1 = Monday ... 7 = Sunday, from a YYYY-MM-DD read as UTC.
  const d = new Date(day + "T00:00:00Z").getUTCDay();
  return d === 0 ? 7 : d;
}

function dayLabel(day) {
  // A fixed spelling, never the locale's: the label is the cell's
  // accessible name and the caption, and it must read the same on every
  // device (and in the tests).
  const [y, m, d] = day.split("-").map(Number);
  return `${DOW[isoDow(day) - 1]} ${MONTHS[m - 1]} ${d} ${y}`;
}

/** 0..4: which step of the ramp a count sits on, relative to the
 *  player's own busiest day, so a casual player's evenings still read. */
export function level(count, max) {
  if (!count || max <= 0) return 0;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

/** The year as week columns (Monday first), padded at the start so the
 *  rows line up; pads are drawn transparent. */
export function weeks(days) {
  const out = [];
  let col = [];
  if (days.length)
    for (let i = 1; i < isoDow(days[0].day); i += 1) col.push(null);
  for (const d of days) {
    col.push(d);
    if (col.length === 7) {
      out.push(col);
      col = [];
    }
  }
  if (col.length) out.push(col);
  return out;
}

/** Month labels by column: the first column holding a day 1-7 of a month. */
function monthLabels(cols) {
  const labels = new Array(cols.length).fill("");
  let seen = null;
  cols.forEach((col, i) => {
    for (const d of col) {
      if (!d) continue;
      const month = d.day.slice(0, 7);
      if (month !== seen && Number(d.day.slice(8)) <= 7) {
        seen = month;
        labels[i] = MONTHS[Number(d.day.slice(5, 7)) - 1];
        break;
      }
    }
  });
  return labels;
}

export function ActivityGraph({ data, error, onRetry }) {
  const [picked, setPicked] = useState(null);
  const { when, whenDay } = useClock();
  const scroller = useRef(null);
  useEffect(() => {
    // Open on the newest weeks; the past is a swipe away.
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data?.computed_at, data?.player_tag]);
  useEffect(() => setPicked(null), [data?.player_tag]);

  const failedRead = error && (
    <div className="activity__empty" role="status">
      <p>
        {data
          ? "The latest activity read failed. Showing the last successful read."
          : "The activity graphic could not be loaded right now. What was read is unknown."}
      </p>
      {onRetry && (
        <button type="button" className="btn btn--ghost" onClick={onRetry}>
          Retry activity read
        </button>
      )}
    </div>
  );
  if (!data) return failedRead || <p className="activity__empty">Loading…</p>;
  if (!data.as_of && !data.computed_at)
    return (
      <p className="activity__empty">
        Activity is unavailable. A gap in the record does not mean this player
        did not play.
      </p>
    );

  const days = data.days ?? [];
  const max = days.reduce((m, d) => Math.max(m, d.battles), 0);
  const cols = weeks(days);
  const months = monthLabels(cols);
  const withBattles = days.filter((d) => d.battles > 0).length;
  const quietDays = days.filter(
    (d) => d.battles === 0 && d.coverage === "complete",
  ).length;
  const unknownDays = days.filter(
    (d) => d.battles === 0 && d.coverage !== "complete",
  ).length;
  const selected = days.find((d) => d.day === picked);
  const recent = days.slice(-14).reverse();

  const count = (n) => `${n} ${n === 1 ? "battle" : "battles"}`;
  const evidenceLabel = (d) =>
    d.coverage === "complete"
      ? "the whole day was read"
      : d.coverage === "partial"
        ? "part of the day was read"
        : "unknown";
  const lastDay = days.at(-1)?.day;
  /** One day in the list: what was recorded, never a claim about an
   *  unread day. */
  const listLine = (d) => {
    if (d.battles > 0) {
      const open = d.day === lastDay ? " so far. Today is still open." : ".";
      const score =
        d.wins !== undefined
          ? ` ${d.wins} won, ${d.losses} lost${d.battles - d.wins - d.losses > 0 ? `, ${d.battles - d.wins - d.losses} drawn` : ""}.`
          : "";
      return `${count(d.battles)}${open}${score}`;
    }
    return d.coverage === "complete"
      ? "Quiet. The log was read all day."
      : "Unknown. Part of this day's log may be missing.";
  };
  const cellName = (d) =>
    d.battles > 0
      ? `${dayLabel(d.day)}: ${count(d.battles)} recorded · ${evidenceLabel(d)}`
      : d.coverage === "complete"
        ? `${dayLabel(d.day)}: 0 battles · read in full`
        : `${dayLabel(d.day)}: ${evidenceLabel(d)} · no battles recorded`;
  const cellClass = (d) => {
    if (!d.battles && d.coverage !== "complete") return "activity__cell--none";
    return `activity__cell--l${level(d.battles, max)}`;
  };

  return (
    <div className="activity">
      {failedRead}
      <div className="activity__yearwrap">
        <div className="activity__dows" aria-hidden="true">
          {DOW.map((d, i) => (
            <span key={d}>{i % 2 === 0 ? d : ""}</span>
          ))}
        </div>
        <div className="activity__scroll" ref={scroller}>
          <div className="activity__months" aria-hidden="true">
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
          <div
            className="activity__year"
            role="group"
            aria-label="Battles per day over the last year"
          >
            {cols.map((col, ci) =>
              col.map((d, ri) =>
                d ? (
                  <button
                    key={d.day}
                    type="button"
                    className={
                      "activity__cell " +
                      cellClass(d) +
                      (picked === d.day ? " activity__cell--on" : "")
                    }
                    aria-label={cellName(d)}
                    aria-pressed={picked === d.day}
                    onClick={() => setPicked(d.day)}
                    onFocus={() => setPicked(d.day)}
                  />
                ) : (
                  <span
                    key={`pad-${ci}-${ri}`}
                    className="activity__cell activity__cell--pad"
                    aria-hidden="true"
                  />
                ),
              ),
            )}
          </div>
        </div>
      </div>
      <div className="activity__caption" aria-live="polite">
        {selected
          ? cellName(selected)
          : `${withBattles} ${noun(withBattles, "day")} with recorded battles, ${quietDays} quiet ${noun(quietDays, "day")}, ${unknownDays} unknown ${noun(unknownDays, "day")}. Days run midnight to midnight UTC.`}
      </div>
      <div className="activity__legend">
        <span>Fewer</span>
        {[1, 2, 3, 4].map((l) => (
          <span key={l} className={`activity__cell activity__cell--l${l}`} />
        ))}
        <span>More battles</span>
        <span className="activity__legend-gap" />
        <span className="activity__cell activity__cell--l0" />
        <span>Quiet: log read all day</span>
        <span className="activity__legend-gap" />
        <span className="activity__cell activity__cell--none" />
        <span>Unknown</span>
      </div>
      <p className="footnote px-4">
        A day is quiet only when its whole log was read. Unknown means part of
        it may be missing, so it doesn&rsquo;t mean they didn&rsquo;t play.
        Recorded battles always show.{" "}
        <a href="/docs/activity">How this is drawn</a>
      </p>
      <p className="footnote px-4">
        Read {when(data.as_of ?? data.computed_at)}.
        {data.recorded_from
          ? ` Followed since ${whenDay(data.recorded_from)}.`
          : ""}
      </p>
      <details className="activity__table">
        <summary>The last two weeks as a list</summary>
        <ul className="st-list">
          {recent.map((d) => (
            <li key={d.day}>
              <strong>{dayLabel(d.day)}.</strong> {listLine(d)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
