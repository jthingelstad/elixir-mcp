import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ago, beatCls, freshCls, secsSince } from "../lib/time.js";

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
const colorFor = (i) => SERIES_COLORS[i] ?? "var(--neutral)";

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
                {drawn.map((d) =>
                  d.top ? (
                    <path
                      key={d.name}
                      className="seg"
                      d={topCapPath(x, d.y, bw, d.h, 4)}
                      fill={colorFor(d.si)}
                    />
                  ) : (
                    <rect
                      key={d.name}
                      className="seg"
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
                  aria-label={`${b.bucket}, ${b.fetches} ${unit}`}
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
          </div>
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
          {hovered.fetches === 0 && (
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

export function Status() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    const load = () =>
      api.publicStatus().then((r) => {
        if (!live) return;
        if (r.ok) {
          setData(r.data);
          setNow(Date.now());
        } else setErr("Could not load status.");
      });
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  if (err) return <p className="field-error">{err}</p>;
  if (!data) return <p style={{ color: "var(--faint)" }}>Loading…</p>;

  const h = data.health;
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
      <div className="page-head">
        <h1 className="page-title">Status</h1>
        <span className="page-head__note">
          collectors · the last hour — refreshes every 60s
        </span>
        <span
          className="mono"
          style={{ marginLeft: "auto", fontSize: "11px", color: "var(--dim)" }}
        >
          as of {data.as_of.slice(11, 19)}Z
        </span>
      </div>

      <div
        className={`notice`}
        style={{
          marginBottom: "20px",
          borderColor: h.ok ? "rgba(52,211,153,.35)" : "rgba(248,113,113,.35)",
        }}
      >
        <span
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span className={`chip ${h.ok ? "chip--active" : "chip--error"}`}>
            {h.ok ? "recording" : "attention"}
          </span>
          <span>
            last admission{" "}
            <strong>
              {h.last_admission_seconds != null
                ? `${Math.round(h.last_admission_seconds / 60)}m ago`
                : "—"}
            </strong>{" "}
            · <strong>{h.battles_last_hour.toLocaleString()}</strong> battles in
            the last hour · DLQs{" "}
            <strong
              style={{ color: h.dlq_messages ? "var(--red)" : undefined }}
            >
              {h.dlq_messages}
            </strong>
          </span>
        </span>
      </div>

      <div className="cols">
        <section className="panel" style={{ flex: "1 1 100%", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">Collectors</span>
          </div>
          {data.collectors.map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "center",
                padding: "10px 16px",
                borderTop: "1px solid var(--edge-soft)",
                flexWrap: "wrap",
              }}
            >
              {c.card_icon ? (
                <img
                  src={c.card_icon}
                  alt=""
                  style={{ height: "28px", borderRadius: "4px" }}
                />
              ) : (
                <span
                  className="card-slot"
                  style={{ width: "24px", aspectRatio: "1" }}
                />
              )}
              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                {c.name}
              </span>
              <span
                className={`chip ${
                  c.status === "active"
                    ? "chip--active"
                    : c.status === "pending"
                      ? "chip--pending"
                      : ""
                }`}
              >
                {c.status}
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  display: "flex",
                  gap: "14px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  className={beatCls(secsSince(c.last_heartbeat_at, now))}
                  title="Last contact of any kind with the door, including polls that found no work."
                >
                  <span style={{ color: "var(--dim)" }}>heartbeat </span>
                  {ago(c.last_heartbeat_at, now)}
                </span>
                <span
                  className={freshCls(secsSince(c.last_success_at, now))}
                  title="Last payload this collector fetched that we accepted and recorded."
                >
                  <span style={{ color: "var(--dim)" }}>data </span>
                  {ago(c.last_success_at, now)}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: "11.5px", color: "var(--dim)" }}
                >
                  {c.fetches_1h}/h
                </span>
              </span>
            </div>
          ))}
          <div className="panel__note">
            Heartbeat is any contact with the door, so it stays fresh even when
            a collector polls and finds nothing to do. Data is the last payload
            we actually accepted and recorded. A live heartbeat with old data
            means idle, not broken; a stale heartbeat means the process is gone.
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: "20px" }}>
        <div className="panel__head">
          <span className="panel-title">Capture, last hour</span>
          <span className="caveat">5-minute buckets</span>
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
          Hover a bucket for the per-collector split. A red tick under a bucket
          marks rejected payloads. Quiet stretches are normal — the yield
          scheduler polls where battles actually happen.
        </div>
      </section>

      <section className="panel" style={{ marginTop: "20px" }}>
        <div className="panel__head">
          <span className="panel-title">Capture, last 24 hours</span>
          <span className="caveat">hourly buckets</span>
        </div>
        <CaptureChart
          buckets={data.capture_24h}
          series={series}
          labelEvery={3}
          unit="fetches"
          ariaLabel="fetches per hour over the last 24 hours, stacked by collector"
        />
        <ChartLegend series={series} />
        <div className="panel__note">
          The same stack over a longer window: this is where a collector that
          quietly stopped pulling its weight overnight shows up.
        </div>
      </section>
    </>
  );
}
