import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Data ▸ Status (Jamie, 2026-09-06): the operational dashboard —
 *  public, mobile-first, installable (add to Home Screen from this
 *  page). Queues, collectors, and roughly an hour of system health,
 *  refreshed every 60s. Health is derived from data, never vibes. */

function ago(ts, now) {
  if (!ts) return "never";
  const s = (now - Date.parse(ts)) / 1000;
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function freshCls(seconds) {
  if (seconds == null) return "freshness freshness--never";
  if (seconds < 900) return "freshness freshness--fresh";
  if (seconds < 86400) return "freshness freshness--stale";
  return "freshness";
}

export function Status() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState("");

  useEffect(() => {
    // Installable from this page: a page-scoped manifest makes
    // add-to-Home-Screen yield a status app that opens right here.
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/status.webmanifest";
    document.head.appendChild(link);
    const touch = document.createElement("link");
    touch.rel = "apple-touch-icon";
    touch.href = "/apple-touch-icon.png";
    document.head.appendChild(touch);
    return () => {
      link.remove();
      touch.remove();
    };
  }, []);

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
  const QUEUES = [
    ["live", "live requests"],
    ["bulk", "bulk requests"],
    ["results", "results"],
    ["live_dlq", "live DLQ"],
    ["bulk_dlq", "bulk DLQ"],
    ["results_dlq", "results DLQ"],
    ["email_dlq", "email DLQ"],
  ];

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Status</h1>
        <span className="page-head__note">
          queues · collectors · the last hour — refreshes every 60s
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
        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">Queues</span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>QUEUE</th>
                  <th className="num">DEPTH</th>
                  <th className="num">IN FLIGHT</th>
                  <th className="num">OLDEST</th>
                </tr>
              </thead>
              <tbody>
                {QUEUES.map(([key, label]) => {
                  const q = data.queues?.[key];
                  const dlq = key.endsWith("_dlq");
                  return (
                    <tr key={key}>
                      <td className={dlq ? "mono" : undefined}>{label}</td>
                      {q ? (
                        <>
                          <td
                            className="num"
                            style={
                              dlq && q.depth > 0
                                ? { color: "var(--red)", fontWeight: 600 }
                                : undefined
                            }
                          >
                            {q.depth}
                          </td>
                          <td className="num">{q.in_flight}</td>
                          <td className="num mono">
                            {q.depth + q.in_flight > 0
                              ? `${q.oldest_seconds}s`
                              : "—"}
                          </td>
                        </>
                      ) : (
                        <td colSpan={3} className="nil">
                          unavailable
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="panel__note">
            A DLQ above zero is an incident; request-queue depth is normal
            backlog the collectors drain.
          </div>
        </section>

        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
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
                className={freshCls(
                  c.last_success_at
                    ? (now - Date.parse(c.last_success_at)) / 1000
                    : null,
                )}
                style={{ marginLeft: "auto" }}
              >
                {ago(c.last_success_at, now)}
              </span>
              <span
                className="mono"
                style={{ fontSize: "11.5px", color: "var(--dim)" }}
              >
                {c.fetches_1h}/h
              </span>
            </div>
          ))}
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

      <p style={{ fontSize: "12px", color: "var(--dim)", marginTop: "16px" }}>
        Tip: add this page to your Home Screen — it installs as a standalone
        status app.
      </p>
    </>
  );
}
