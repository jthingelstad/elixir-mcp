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
  const captureMax = Math.max(...data.capture_5m.map((b) => b.fetches), 1);

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
        <div className="chart">
          <svg
            viewBox="0 0 720 80"
            role="img"
            aria-label="fetches per 5 minutes"
          >
            <line className="axis" x1={0} x2={680} y1={72} y2={72} />
            {data.capture_5m.map((b, i) => {
              const n = data.capture_5m.length;
              const bw = Math.max(4, 680 / n - 3);
              const hgt = Math.max(1, (b.fetches / captureMax) * 62);
              const bad = b.rejected > 0;
              return (
                <g key={b.bucket}>
                  <rect
                    className="bar"
                    style={bad ? { fill: "var(--amber)" } : undefined}
                    x={(i * 680) / n}
                    y={72 - hgt}
                    width={bw}
                    height={hgt}
                  >
                    <title>{`${b.bucket}Z — ${b.fetches} fetches, ${b.admitted} admitted${b.rejected ? `, ${b.rejected} rejected` : ""}`}</title>
                  </rect>
                  {i % 3 === 0 && (
                    <text x={(i * 680) / n} y={80} fontSize="9">
                      {b.bucket}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="panel__note">
          Amber buckets contain rejected payloads. Quiet stretches are normal —
          the yield scheduler polls where battles actually happen.
        </div>
      </section>
    </>
  );
}
