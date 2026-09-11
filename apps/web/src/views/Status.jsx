import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Icon } from "../components/Icon.jsx";
import { secsSince } from "../lib/time.js";

/** Data ▸ Status (Jamie, 2026-09-06): the operational dashboard —
 *  public, mobile-first, installable (add to Home Screen from this
 *  page). Collectors and roughly an hour of system health, refreshed
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
 *  rather than a hole that compresses the axis. */
function CaptureChart({ buckets, series, labelEvery, ariaLabel, unit }) {
  const [at, setAt] = useState(null);
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
        <svg viewBox={`0 0 720 84`} role="img" aria-label={ariaLabel}>
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
                    {b.bucket}
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
                      ? `${b.bucket}, in progress, ${b.fetches} ${unit} so far`
                      : `${b.bucket}, ${b.fetches} ${unit}`
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
            {hovered.bucket}Z · {hovered.fetches} {unit}
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
 * The global Clash Royale request budget for the hour in progress.
 *
 * This is the one number on the page with a rule attached to it rather than a
 * preference: the fleet exists for redundancy and must never multiply the
 * spend, so "are we inside the budget" is a compliance question. It goes at the
 * top because it is the first thing worth knowing and it was not shown at all.
 *
 * The pace marker is what makes it readable. Spend is not meant to be flat —
 * the scheduler polls where battles are — so a bar alone cannot distinguish a
 * busy hour from an overspent one. The marker is elapsed-fraction of capacity:
 * fill level with it is on pace, well short is idle, past it is a burst.
 */
function BudgetGauge({ budget }) {
  // The page that answers "is the recorder broken" must not be the page
  // that breaks: a body missing a number renders without that panel
  // rather than taking the screen down with it.
  if (typeof budget?.used_hour !== "number") return null;
  const {
    used_hour: used,
    capacity_hour: cap,
    expected_hour: expected,
  } = budget;
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const pacePct = cap > 0 ? Math.min(100, (expected / cap) * 100) : 0;
  const over = used > expected * 1.25 && used > 60;
  const nearCap = pct >= 90;
  const verdict = nearCap
    ? "at the hour's ceiling"
    : over
      ? "ahead of pace"
      : used < expected * 0.5
        ? "below pace"
        : "on pace";

  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head">
        <span>Shared request budget</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 400 }}>
          {used.toLocaleString()} of {cap.toLocaleString()} this hour ·{" "}
          {budget.rate_per_sec}/s
          {typeof budget.useful_hour === "number" && budget.measured_hour > 0
            ? ` · ${Math.round((budget.useful_hour / budget.measured_hour) * 100)}% changed the record`
            : ""}
        </span>
      </div>
      <div className="panel__body">
        {/* The fill is always --accent. State is the marker and the line
            under it, because a meter that changes colour has stopped
            being a measurement and become a status chip. */}
        <div
          className="meter meter--marked"
          role="img"
          aria-label={`${used} of ${cap} requests used this hour; ${expected} expected by now`}
        >
          <div className="meter__fill" style={{ width: `${pct}%` }} />
          <div
            className="meter__mark"
            style={{ left: `${pacePct}%` }}
            title="Pace — where we should be at this hour"
          />
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "12px",
            fontSize: "12.5px",
            color: "var(--ink-faint)",
          }}
        >
          <span
            style={{
              width: "2px",
              height: "13px",
              background: "var(--ink)",
              display: "inline-block",
              flex: "0 0 auto",
            }}
          />
          <span>
            pace at {Math.round(pacePct)}% — {verdict}
          </span>
        </div>
      </div>
      <div className="panel__foot">
        One budget for the whole fleet. More collectors are resilience, never
        more quota.
      </div>
    </section>
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
    ["queued", queue.queued, "waiting for a collector to lease it"],
    ["being fetched", queue.leased, "leased, result not back yet"],
    ["done this hour", queue.done_hour, "admitted and recorded"],
  ];
  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head">
        <span>Work waiting</span>
        <span className="mono" style={{ marginLeft: "auto", fontWeight: 400 }}>
          next tick{" "}
          {nextIn == null ? "—" : nextIn === 0 ? "now" : `in ${nextIn}s`}
        </span>
      </div>
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
        Tracked players and clans become due between ticks and are planned at
        the next one, every {queue.tick_minutes} minutes. The next tick can plan{" "}
        {(queue.next_tick_capacity ?? 0).toLocaleString()}.
      </div>
    </section>
  );
}

export function Status({ navigate }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState("");
  // Off by default and visible either way. It used to poll every 60s with
  // nothing on screen saying so, which is the worst of both: a tab left open
  // polled forever, and a reader had no way to know whether what they were
  // looking at was thirty seconds or three hours old.
  const [auto, setAuto] = useState(false);

  const load = useCallback(
    () =>
      api.publicStatus().then((r) => {
        if (r.ok) {
          setData(r.data);
          setNow(Date.now());
          setErr("");
        } else setErr("Could not load status.");
      }),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [auto, load]);

  if (err) return <p className="field-error">{err}</p>;
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
      <div
        style={{
          marginBottom: "18px",
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="page__title">Status</h1>
          <p className="page__lede">
            The service, not your account. Everyone sees the same numbers.
          </p>
        </div>
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
            as of {data.as_of.slice(11, 19)}Z
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
      </div>

      <BudgetGauge budget={data.budget} />
      <QueueGauge queue={data.queue} now={now} />

      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head">
          <span>Recording</span>
          <span
            className={"chip " + (h.ok ? "chip--ok" : "chip--bad")}
            style={{ marginLeft: "auto" }}
          >
            <span className="chip__dot" />
            {h.ok ? "recording" : "attention"}
          </span>
        </div>
        <div className="stats" style={{ border: 0, borderRadius: 0 }}>
          <div className="stats__cell">
            <div className="label">last admission</div>
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
            <div className="label">dead letters</div>
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
              <div className="label">capture gaps</div>
              <div className="stats__value">
                {h.capture_audit_24h.gaps.toLocaleString()}
              </div>
              <div className="stats__note">
                of {h.capture_audit_24h.polls.toLocaleString()} polls, 24h — the
                battle log had already rolled
              </div>
            </div>
          )}
        </div>
      </section>

      <a
        className="panel"
        onClick={() => navigate("/status/collectors")}
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
      </a>

      <section className="panel" style={{ marginTop: "20px" }}>
        <div className="panel__head">
          <span className="panel-title">Capture, last hour</span>
          <span className="caveat">
            5-minute buckets · {sumFetches(data.capture_5m).toLocaleString()}{" "}
            fetches, last bucket in progress
          </span>
        </div>
        <CaptureChart
          buckets={data.capture_5m}
          series={series}
          labelEvery={3}
          unit="fetches"
          ariaLabel="fetches per 5 minutes, stacked by collector"
        />
        <ChartLegend series={series} />
        <div className="panel__note">
          Hover for the per-collector split; a red tick marks rejected payloads.
          Quiet stretches are normal.
        </div>
      </section>

      <section className="panel" style={{ marginTop: "20px" }}>
        <div className="panel__head">
          <span className="panel-title">Capture, last 24 hours</span>
          <span className="caveat">
            hourly buckets · {sumFetches(data.capture_24h).toLocaleString()}{" "}
            fetches, current hour in progress
          </span>
        </div>
        <CaptureChart
          buckets={data.capture_24h}
          series={series}
          labelEvery={3}
          unit="fetches"
          ariaLabel="fetches per hour over the last 24 hours, stacked by collector"
        />
        <ChartLegend series={series} />
      </section>
    </>
  );
}
