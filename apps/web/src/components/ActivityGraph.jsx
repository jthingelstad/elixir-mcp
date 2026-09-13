import { useEffect, useRef, useState } from "react";

/**
 * Battle activity: a GitHub-style year of days and a 24x7 rhythm tile,
 * drawn from the nightly histogram (docs/activity). Mobile first, like
 * Verify: the year scrolls sideways and opens on the newest weeks, the
 * rhythm fits any width, and a tap on a cell writes what it holds into
 * the caption underneath instead of relying on hover.
 *
 * The rule the whole graphic exists to keep: a day the record did not
 * cover is a hatched "not recorded" cell, never a zero. Zero is a day we
 * watched and nothing was played.
 *
 * Colour is one sequential hue (the accent, four steps) on the console's
 * dark surface; identity is never colour alone - every cell carries its
 * value in an accessible name, and the list under the graphic is the
 * table view.
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
const HOUR_MARKS = [0, 6, 12, 18];

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
  return `${DOW[isoDow(day) - 1]} ${d} ${MONTHS[m - 1]} ${y}`;
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

/** Rotate the UTC rhythm into the viewer's clock: the browser's offset
 *  in whole hours (a half-hour zone lands on its nearest hour). */
export function localRhythm(rhythm, offsetHours) {
  const out = new Array(168).fill(0);
  for (let dow = 0; dow < 7; dow += 1)
    for (let hour = 0; hour < 24; hour += 1) {
      const utc = (((dow * 24 + hour - offsetHours) % 168) + 168) % 168;
      out[dow * 24 + hour] = rhythm[utc] ?? 0;
    }
  return out;
}

function offsetLabel(offsetHours) {
  if (offsetHours === 0) return "UTC";
  const sign = offsetHours > 0 ? "+" : "−";
  return `UTC${sign}${Math.abs(offsetHours)}`;
}

export function ActivityGraph({ data, offsetHours = null }) {
  const [picked, setPicked] = useState(null);
  const scroller = useRef(null);
  useEffect(() => {
    // Open on the newest weeks; the past is a swipe away.
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data?.computed_at]);

  if (!data) return null;
  if (!data.computed_at)
    return (
      <p className="activity__empty">
        Not computed yet. The activity build runs nightly at 05:30 UTC; the
        first graphic for this player appears after the next run.
      </p>
    );

  const days = data.days ?? [];
  const max = days.reduce((m, d) => Math.max(m, d.battles), 0);
  const cols = weeks(days);
  const months = monthLabels(cols);
  const offset =
    offsetHours ?? Math.round(-new Date().getTimezoneOffset() / 60);
  const rhythm = localRhythm(data.rhythm ?? [], offset);
  const rmax = rhythm.reduce((m, w) => Math.max(m, w), 0);
  const recordedDays = days.filter((d) => d.status === "recorded").length;
  const notRecorded = days.length - recordedDays;
  const recent = days.slice(-14).reverse();

  const cellName = (d) =>
    d.status === "not_recorded"
      ? `${dayLabel(d.day)}: not recorded${d.battles ? ` (${d.battles} seen)` : ""}`
      : `${dayLabel(d.day)}: ${d.battles} ${d.battles === 1 ? "battle" : "battles"}`;

  return (
    <div className="activity">
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
            aria-label="Battles per UTC day over the last year"
          >
            {cols.map((col, ci) =>
              col.map((d, ri) =>
                d ? (
                  <button
                    key={d.day}
                    type="button"
                    className={
                      "activity__cell " +
                      (d.status === "not_recorded"
                        ? "activity__cell--none"
                        : `activity__cell--l${level(d.battles, max)}`) +
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
        {picked
          ? cellName(days.find((d) => d.day === picked))
          : `${recordedDays} recorded days, ${notRecorded} not recorded · tap a day`}
      </div>
      <div className="activity__legend">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`activity__cell activity__cell--l${l}`} />
        ))}
        <span>More</span>
        <span className="activity__legend-gap" />
        <span className="activity__cell activity__cell--none" />
        <span>not recorded</span>
      </div>

      <div className="activity__rhythm-head">
        <span>When they play, by hour and weekday ({offsetLabel(offset)})</span>
        <span className="footnote">
          last {data.window_days} days, recent weeks weighted; half-life{" "}
          {data.half_life_days} days
        </span>
      </div>
      <div className="activity__rhythmwrap">
        <div
          className="activity__dows activity__dows--rhythm"
          aria-hidden="true"
        >
          {DOW.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div>
          <div
            className="activity__rhythm"
            role="group"
            aria-label="Battle rhythm by weekday and hour"
          >
            {rhythm.map((w, i) => {
              const dow = Math.floor(i / 24);
              const hour = i % 24;
              const share = rmax > 0 ? w / rmax : 0;
              const lvl = w === 0 ? 0 : level(share, 1);
              return (
                <span
                  key={i}
                  className={`activity__cell activity__cell--r activity__cell--l${lvl}`}
                  role="img"
                  aria-label={`${DOW[dow]} ${String(hour).padStart(2, "0")}:00: ${Math.round(share * 100)}% of the peak`}
                  title={`${DOW[dow]} ${String(hour).padStart(2, "0")}:00 · weight ${w.toFixed(2)}`}
                />
              );
            })}
          </div>
          <div className="activity__hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h}>
                {HOUR_MARKS.includes(h) ? String(h).padStart(2, "0") : ""}
              </span>
            ))}
          </div>
        </div>
      </div>

      <details className="activity__table">
        <summary>The last two weeks as a list</summary>
        <table className="table">
          <thead>
            <tr>
              <th>UTC day</th>
              <th>Battles</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td>
                  {d.status === "not_recorded" ? "not recorded" : d.battles}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
