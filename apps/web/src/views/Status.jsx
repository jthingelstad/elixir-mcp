import {
  Icon,
  Link,
  secsSince,
  useClock,
  Panel,
  PageHead,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { usePublicStatus } from "../lib/queries.js";
import { CONSOLE } from "../lib/console.js";

/** The service page at /data/service (Jamie, 2026-09-06): the operational dashboard,
 *  mobile-first, behind sign-in since 2026-09-09 (the public health
 *  views are /data/now and /api/public/status). Collectors and roughly an hour of system health, refreshed
 *  every 60s. Health is derived from data, never vibes.
 *
 *  The SQS queue panel was dropped 2026-09-06: migration 0040 replaced
 *  those queues with the Postgres job ledger, so six of the seven rows
 *  had been rendering "unavailable" ever since. */

/** Colours follow the collector, assigned from the server's stable
 *  enrolment order — never from rank, so a busier week cannot repaint
 *  the fleet. Past six, the tail folds into one neutral rather than
 *  inventing hues nobody can tell apart. */
const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];
const colorFor = (i) => SERIES_COLORS[i] ?? "var(--ink-quiet-icon)";

/** Rounded top on the data-end only: the cap belongs to the stack, not
 *  to every segment inside it. */
function topCapPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** One capture chart: fetches per bucket, stacked by collector, with a
 *  hover/focus tooltip breaking the bucket down. Buckets arrive
 *  gap-filled from the server, so a quiet stretch is a visible zero
 *  rather than a hole that compresses the axis. The svg is a GROUP,
 *  not an img: each bucket is a focusable button, and an img role
 *  hides its children from assistive tech while the keyboard still
 *  lands on them (axe: nested-interactive). */
/** A bucket's label is the server's "HH:MM" in UTC. Every bucket falls
 *  in the day before `asOf`, so the instant it names is the latest one
 *  with that UTC clock at or before `asOf`, which the reader's own clock
 *  can then say. */
function bucketInstant(hhmm, asOf) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const anchor = asOf ? new Date(asOf) : new Date();
  const d = new Date(anchor);
  d.setUTCHours(h, m, 0, 0);
  if (d > anchor) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

function CaptureChart({ buckets, series, labelEvery, ariaLabel, unit, asOf }) {
  const [at, setAt] = useState(null);
  const { clock } = useClock();
  const axis = (b) => clock(bucketInstant(b.bucket, asOf));
  const when = (b) => clock(bucketInstant(b.bucket, asOf));
  const n = buckets.length || 1;
  const W = 680;
  const BASE = 72;
  const TOP = 8;
  const slot = W / n;
  const bw = Math.max(3, slot - 3);
  const max = Math.max(...buckets.map((b) => b.fetches), 1);
  const hovered = at == null ? null : buckets[at];
  // The server gap-fills up to now, so the last bucket is always the one
  // still being filled. It reads as a zero bar for the first minutes of
  // every bucket (the scheduler ticks every five), which looked like
  // "nothing captured" to the operator three times in one afternoon.
  const last = buckets.length - 1;
  const hoveredIsLast = at === last;

  return (
    <div className="chartwrap">
      <div className="chart">
        <svg viewBox={`0 0 720 84`} role="group" aria-label={ariaLabel}>
          <line className="axis" x1={0} x2={W} y1={BASE} y2={BASE} />
          {buckets.map((b, i) => {
            const x = i * slot;
            // Stack in the stable series order so a segment keeps its
            // place and colour from bucket to bucket.
            const parts = series
              .map((name, si) => ({ name, si, v: b.by[name] ?? 0 }))
              .filter((p) => p.v > 0);
            const full = (b.fetches / max) * (BASE - TOP);
            let y = BASE;
            const drawn = parts.map((p, k) => {
              const h = (p.v / b.fetches) * full;
              y -= h;
              return { ...p, y, h, top: k === parts.length - 1 };
            });
            return (
              <g key={b.bucket}>
                {i === last && b.fetches === 0 && (
                  <rect
                    className="pending"
                    x={x}
                    y={BASE - 6}
                    width={bw}
                    height={6}
                  />
                )}
                {drawn.map((d) =>
                  d.top ? (
                    <path
                      key={d.name}
                      className={i === last ? "seg bar--partial" : "seg"}
                      d={topCapPath(x, d.y, bw, d.h, 4)}
                      fill={colorFor(d.si)}
                    />
                  ) : (
                    <rect
                      key={d.name}
                      className={i === last ? "seg bar--partial" : "seg"}
                      x={x}
                      y={d.y}
                      width={bw}
                      height={d.h}
                      fill={colorFor(d.si)}
                    />
                  ),
                )}
                {b.rejected > 0 && (
                  <line
                    className="reject-tick"
                    x1={x}
                    x2={x + bw}
                    y1={BASE + 3}
                    y2={BASE + 3}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={x} y={BASE + 12} fontSize="9">
                    {axis(b)}
                  </text>
                )}
                <rect
                  className="hit"
                  x={x}
                  y={0}
                  width={Math.max(slot, 6)}
                  height={BASE}
                  tabIndex={0}
                  role="button"
                  aria-label={
                    i === last
                      ? `${when(b)}, in progress, ${b.fetches} ${unit} so far`
                      : `${when(b)}, ${b.fetches} ${unit}`
                  }
                  onMouseEnter={() => setAt(i)}
                  onFocus={() => setAt(i)}
                  onMouseLeave={() => setAt((c) => (c === i ? null : c))}
                  onBlur={() => setAt((c) => (c === i ? null : c))}
                />
              </g>
            );
          })}
        </svg>
      </div>
      {hovered && (
        <div
          className="charttip"
          style={{ left: `${((at + 0.5) / n) * (W / 720) * 100}%` }}
        >
          <div className="charttip__head">
            {when(hovered)} · {hovered.fetches} {unit}
            {hoveredIsLast ? " so far" : ""}
          </div>
          {hoveredIsLast && (
            <div className="charttip__row">bucket in progress</div>
          )}
          {series
            .map((name, si) => ({ name, si, v: hovered.by[name] ?? 0 }))
            .filter((p) => p.v > 0)
            .reverse()
            .map((p) => (
              <div className="charttip__row" key={p.name}>
                <span
                  className="charttip__sw"
                  style={{ background: colorFor(p.si) }}
                />
                {p.name}
                <span className="num">{p.v}</span>
              </div>
            ))}
          {hovered.fetches === 0 && !hoveredIsLast && (
            <div className="charttip__row">nothing fetched</div>
          )}
          {hovered.rejected > 0 && (
            <div className="charttip__foot">
              {hovered.rejected} rejected of {hovered.fetches}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Every bucket the server sent, including the one in progress. */
function sumFetches(buckets) {
  return (buckets ?? []).reduce((n, b) => n + (b.fetches ?? 0), 0);
}

function ChartLegend({ series }) {
  return (
    <div className="chart-legend">
      {series.map((name, i) => (
        <span className="chart-legend__item" key={name}>
          <span
            className="charttip__sw"
            style={{ background: colorFor(i) }}
            aria-hidden="true"
          />
          {name}
        </span>
      ))}
    </div>
  );
}

/**
 * The global Clash Royale request budget.
 *
 * This is the one number on the page with a rule attached to it rather than a
 * preference: the fleet exists for redundancy and must never multiply the
 * spend, so "are we inside the budget" is a compliance question. It goes at the
 * top because it is the first thing worth knowing.
 *
 * The headline is the last 24 hours against the BULK share of a day's
 * capacity - what the planner may actually spend once the live reserve is
 * held back - and the line under it is the rolling hour and what the live
 * lane was charged. Until 2026-09-27 this was the calendar hour against an
 * elapsed-fraction pace marker, which at ten past the hour read "152 of 636"
 * while the rolling hour was 28%.
 */
function BudgetGauge({ budget }) {
  // The page that answers "is the recorder broken" must not be the page
  // that breaks: a body missing a number renders without that panel
  // rather than taking the screen down with it.
  if (
    typeof budget?.fetches_24h !== "number" ||
    !(budget.bulk_capacity_24h > 0)
  )
    return null;
  const used = budget.fetches_24h;
  const cap = budget.bulk_capacity_24h;
  const pct = Math.min(100, (used / cap) * 100);
  const hour =
    typeof budget.used_hour === "number" && budget.capacity_hour > 0
      ? `last hour ${budget.used_hour.toLocaleString()} of ${budget.capacity_hour.toLocaleString()}`
      : null;
  const changed =
    typeof budget.useful_hour === "number" && budget.measured_hour > 0
      ? `${Math.round((budget.useful_hour / budget.measured_hour) * 100)}% of the hour changed the record`
      : null;
  const live =
    typeof budget.charged_24h?.live === "number"
      ? `live lookups spent ${budget.charged_24h.live.toLocaleString()} in 24 hours`
      : null;

  return (
    <Panel
      title="Shared request budget"
      titleAs="div"
      action={
        <span className="mono ml-auto font-normal">
          {used.toLocaleString()} of {cap.toLocaleString()} in 24 hours ·{" "}
          {Math.round(pct)}%
        </span>
      }
      className="mb-[14px]"
    >
      <div className="panel__body">
        {/* The fill is always --accent: a meter that changes colour has
            stopped being a measurement and become a status chip. */}
        <div
          className="meter"
          role="img"
          aria-label={`${used} of ${cap} requests in the last 24 hours`}
        >
          <div className="meter__fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="block text-[12.5px] text-ink-faint mt-3">
          {[hour, live, changed, `${budget.rate_per_sec}/s`]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <div className="panel__foot">
        One budget for every collector, and live lookups spend it too. More
        collectors add resilience, never more quota. The day's capacity is the
        background share, after {Math.round((budget.live_reserve ?? 0) * 100)}%
        kept for live lookups.
      </div>
    </Panel>
  );
}

/** Work waiting, in pipeline order: due, queued, leased, done. A stat
 *  grid rather than a bar, because these are four stages of one journey
 *  and not four fractions of one whole. */
function QueueGauge({ queue, now }) {
  if (typeof queue?.due_now !== "number") return null;
  const nextIn = queue.next_tick_at
    ? Math.max(0, Math.round((Date.parse(queue.next_tick_at) - now) / 1000))
    : null;
  const by = Object.entries(queue.due_by_endpoint ?? {}).sort(
    (a, b) => b[1] - a[1],
  );
  const cells = [
    [
      "due now",
      queue.due_now,
      by.length > 0
        ? by.map(([e, n]) => `${e} ${n}`).join(" · ")
        : "nothing due",
    ],
    ["queued", queue.queued, "waiting for a collector to take it"],
    ["being fetched", queue.leased, "taken, result not back yet"],
    ["done this hour", queue.done_hour, "recorded"],
  ];
  return (
    <Panel
      title="Work waiting"
      titleAs="div"
      action={
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 400 }}>
          next tick{" "}
          {nextIn == null ? "—" : nextIn === 0 ? "now" : `in ${nextIn}s`}
        </span>
      }
      style={{ marginBottom: "14px" }}
    >
      <div className="stats" style={{ border: 0, borderRadius: 0 }}>
        {cells.map(([label, value, note]) => (
          <div className="stats__cell" key={label}>
            <div className="label">{label}</div>
            <div className="stats__value">{(value ?? 0).toLocaleString()}</div>
            <div className="stats__note">{note}</div>
          </div>
        ))}
      </div>
      <div className="panel__foot">
        Tracked players and clans become due between runs and are planned at the
        next one, every {queue.tick_minutes} minutes. The next run can plan{" "}
        {(queue.next_tick_capacity ?? 0).toLocaleString()}.
      </div>
    </Panel>
  );
}

export function Status() {
  const { when } = useClock();
  // Off by default and visible either way. It used to poll every 60s with
  // nothing on screen saying so, which is the worst of both: a tab left open
  // polled forever, and a reader had no way to know whether what they were
  // looking at was thirty seconds or three hours old.
  const [auto, setAuto] = useState(false);
  const status = usePublicStatus(auto ? 60_000 : false);
  const data = status.data ?? null;
  // When the data was read: 0 until it is, and nothing below uses it
  // before then.
  const now = status.dataUpdatedAt;
  const load = status.refetch;

  if (status.error)
    return <p className="field-error">Could not load status.</p>;
  if (!data) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;

  const h = data.health;
  // "Behind" is the machine's own schedule, not a health verdict: a
  // collector polling happily with nothing to fetch is idle.
  const behind = data.collectors.filter(
    (c) => secsSince(c.last_heartbeat_at, now) > 600,
  ).length;
  const series =
    data.capture_series?.length > 0
      ? data.capture_series
      : [
          ...new Set(
            [...data.capture_5m, ...data.capture_24h].flatMap((b) =>
              Object.keys(b.by ?? {}),
            ),
          ),
        ];

  return (
    <>
      <PageHead
        title="Status"
        sub="The service, not your account. Everyone sees the same numbers."
        aside={
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <span className="mono" style={{ color: "var(--ink-faint)" }}>
              as of {when(data.as_of)}
            </span>
            <button
              className="btn btn--sm"
              aria-pressed={auto}
              onClick={() => setAuto((v) => !v)}
            >
              {auto ? "auto-refresh on" : "auto-refresh off"}
            </button>
            <button className="btn btn--sm" onClick={load}>
              Refresh
            </button>
          </span>
        }
      />

      <p className="footnote">
        <Link to={`${CONSOLE}/status/collectors`}>Collectors</Link>
        {" · "}
        <Link to={`${CONSOLE}/status/efficiency`}>Efficiency</Link>
        {" · "}
        <Link to={`${CONSOLE}/data/dashboard`}>Charts</Link>
      </p>

      <BudgetGauge budget={data.budget} />
      <QueueGauge queue={data.queue} now={now} />

      <Panel
        title="Recording"
        titleAs="div"
        action={
          <span
            className={"chip " + (h.ok ? "chip--ok" : "chip--bad")}
            style={{ marginLeft: "auto" }}
          >
            <span className="chip__dot" />
            {h.ok ? "recording" : "attention"}
          </span>
        }
        style={{ marginBottom: "14px" }}
      >
        <div className="stats" style={{ border: 0, borderRadius: 0 }}>
          <div className="stats__cell">
            <div className="label">Last recorded</div>
            <div className="stats__value">
              {h.last_admission_seconds != null
                ? `${Math.round(h.last_admission_seconds / 60)}m`
                : "—"}
            </div>
            <div className="stats__note">since a payload was recorded</div>
          </div>
          <div className="stats__cell">
            <div className="label">battles</div>
            <div className="stats__value">
              {h.battles_last_hour.toLocaleString()}
            </div>
            <div className="stats__note">in the last hour</div>
          </div>
          <div className="stats__cell">
            <div className="label">Stuck</div>
            <div
              className="stats__value"
              style={h.dlq_messages ? { color: "var(--bad)" } : undefined}
            >
              {h.dlq_messages}
            </div>
            <div className="stats__note">
              {h.dlq_messages ? "needs a human" : "nothing stuck"}
            </div>
          </div>
          {h.capture_audit_24h && (
            <div className="stats__cell">
              <div className="label">reads with a gap</div>
              <div className="stats__value">
                {h.capture_audit_24h.gaps.toLocaleString()}
              </div>
              <div className="stats__note">
                of {h.capture_audit_24h.polls.toLocaleString()} reads, 24h, the
                battle log had already moved on
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Link
        className="panel"
        to={`${CONSOLE}/status/collectors`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 16px",
          marginBottom: "20px",
          color: "inherit",
        }}
      >
        <span style={{ color: "var(--accent-bright)", display: "flex" }}>
          <Icon name="heart-pulse" size={18} />
        </span>
        <span style={{ fontSize: "14px", fontWeight: 600 }}>
          {data.collectors.length} collector
          {data.collectors.length === 1 ? "" : "s"} fetching
        </span>
        <span style={{ fontSize: "13px", color: "var(--ink-faint)" }}>
          {behind === 0
            ? "all reporting on schedule"
            : `${behind} behind schedule`}
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "13.5px",
            color: "var(--ink-link)",
          }}
        >
          All collectors <Icon name="arrow-right" size={16} />
        </span>
      </Link>

      <Panel
        title="Reads, last hour"
        titleAs="div"
        action={
          <span className="caveat">
            5-minute buckets · {sumFetches(data.capture_5m).toLocaleString()}{" "}
            fetches, last bucket in progress
          </span>
        }
        style={{ marginTop: "20px" }}
      >
        <CaptureChart
          buckets={data.capture_5m}
          series={series}
          labelEvery={3}
          unit="fetches"
          asOf={data.as_of}
          ariaLabel="fetches per 5 minutes, stacked by collector"
        />
        <ChartLegend series={series} />
        <div className="panel__note">
          Hover for the per-collector split; a red tick marks rejected payloads.
          Quiet stretches are normal.
        </div>
      </Panel>

      <Panel
        title="Reads, last 24 hours"
        titleAs="div"
        action={
          <span className="caveat">
            hourly buckets · {sumFetches(data.capture_24h).toLocaleString()}{" "}
            fetches, current hour in progress
          </span>
        }
        style={{ marginTop: "20px" }}
      >
        <CaptureChart
          buckets={data.capture_24h}
          series={series}
          labelEvery={3}
          unit="fetches"
          asOf={data.as_of}
          ariaLabel="fetches per hour over the last 24 hours, stacked by collector"
        />
        <ChartLegend series={series} />
      </Panel>
    </>
  );
}
