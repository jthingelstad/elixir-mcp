import { useEffect, useRef, useState } from "react";

/**
 * Battle activity: a GitHub-style year of days (docs/activity). Mobile
 * first, like Verify: the year scrolls sideways and opens on the newest
 * weeks, and a tap on a cell writes what it holds into the caption
 * underneath instead of relying on hover. The 24x7 rhythm tile that sat
 * under it retired 2026-09-19 (Jamie: the year is the product; the
 * rhythm was not worth its place, and the scheduler never used it).
 *
 * The rule the whole graphic exists to keep: zero is a day a battle-log
 * read covered and nothing was played. A day with battles is drawn with
 * them however they arrived; the hatched "not recorded" cell is a day
 * with nothing recorded that no log read covers - unknown, never zero.
 *
 * Colour carries two things (Jamie, 2026-09-15): the HUE is the day's
 * win share, losses red through to wins blue, and the SHADE is the
 * volume, four steps scaled to the player's own busiest day. A day whose
 * battles all ended in draws or unresolved (or a row the nightly job has
 * not rebuilt since tallies were added) has no share to show and keeps
 * the accent ramp. Identity is never colour alone - every cell carries
 * its value in an accessible name, and the list under the graphic is the
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

/** 0..10: the day's win share in tenths, or null when no battle that day
 *  was decided (draws and unresolved count for volume, not for share). */
export function shareBin(d) {
  const decided = (d.wins ?? 0) + (d.losses ?? 0);
  if (d.wins === undefined || decided === 0) return null;
  return Math.round((d.wins / decided) * 10);
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

export function ActivityGraph({ data }) {
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
  const withBattles = days.filter((d) => d.battles > 0).length;
  const coveredDays = days.filter((d) => d.status === "recorded").length;
  const notRecorded = days.filter((d) => d.status === "not_recorded").length;
  const recent = days.slice(-14).reverse();

  const count = (n) => `${n} ${n === 1 ? "battle" : "battles"}`;
  /** "7 wins, 5 losses" and, only when there were any, "1 draw". */
  const record = (d) => {
    if (d.wins === undefined || d.battles === 0) return "";
    const draws = d.battles - d.wins - d.losses;
    const parts = [
      `${d.wins} ${d.wins === 1 ? "win" : "wins"}`,
      `${d.losses} ${d.losses === 1 ? "loss" : "losses"}`,
    ];
    if (draws > 0) parts.push(`${draws} ${draws === 1 ? "draw" : "draws"}`);
    return ` · ${parts.join(", ")}`;
  };
  const cellName = (d) =>
    d.status === "not_recorded"
      ? `${dayLabel(d.day)}: not recorded`
      : `${dayLabel(d.day)}: ${count(d.battles)}${record(d)}${d.partial ? ", log rolled past some" : ""}`;
  const cellClass = (d) => {
    if (d.status === "not_recorded") return "activity__cell--none";
    const lvl = `activity__cell--l${level(d.battles, max)}`;
    const bin = shareBin(d);
    return bin === null
      ? lvl
      : `${lvl} activity__cell--hue activity__cell--w${bin}`;
  };

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
        {picked
          ? cellName(days.find((d) => d.day === picked))
          : `${withBattles} days with battles · ${coveredDays - withBattles} quiet days covered · ${notRecorded} not recorded · tap a day`}
      </div>
      <div className="activity__legend">
        <span>losses</span>
        {[0, 2, 5, 8, 10].map((w) => (
          <span
            key={w}
            className={`activity__cell activity__cell--l4 activity__cell--hue activity__cell--w${w}`}
          />
        ))}
        <span>wins</span>
        <span className="activity__legend-gap" />
        <span>fewer</span>
        {[1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className={`activity__cell activity__cell--l${l} activity__cell--hue activity__cell--w5`}
          />
        ))}
        <span>more</span>
        <span className="activity__legend-gap" />
        <span className="activity__cell activity__cell--none" />
        <span>not recorded</span>
        {data.log_reads_from && <span className="activity__legend-gap" />}
        {data.log_reads_from && (
          <span>
            log read since {data.log_reads_from}
            {data.recorded_from
              ? ` · tracked since ${data.recorded_from.slice(0, 10)}`
              : ""}
          </span>
        )}
      </div>

      <details className="activity__table">
        <summary>The last two weeks as a list</summary>
        <table className="table">
          <thead>
            <tr>
              <th>UTC day</th>
              <th>Battles</th>
              <th>Won / lost</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((d) => (
              <tr key={d.day}>
                <td className="mono">{d.day}</td>
                <td>
                  {d.status === "not_recorded" ? "not recorded" : d.battles}
                </td>
                <td className="mono">
                  {d.wins !== undefined && d.battles > 0
                    ? `${d.wins} / ${d.losses}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
