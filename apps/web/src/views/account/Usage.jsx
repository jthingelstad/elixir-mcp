import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { quotaReading } from "../../lib/quota.js";

/**
 * Usage — your daily budget and where it went.
 *
 * Drawn as the 2026-09-09 design draws it: the two quotas as meters at
 * the top, fourteen days of calls as bars with today dimmed because it
 * is still filling, then WHO spent it and on WHAT. The reset time sits
 * in the lede, because "am I near my limit" is only half a question
 * without "and when does it come back".
 *
 * These are panels, not tables: a meter and a bar chart are readings,
 * and the design frames readings. The quota numbers come through
 * lib/quota.js so the profile shows the same ones.
 */

function QuotaCard({ title, line }) {
  return (
    <section
      className="panel"
      style={{ flex: "1 1 300px", padding: "16px 18px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "10px",
          marginBottom: "10px",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600 }}>{title}</span>
        <span
          className={"meter__value" + (line.full ? " meter__value--full" : "")}
          style={{ marginLeft: "auto" }}
        >
          {line.label}
        </span>
      </div>
      <div className="meter" style={{ height: "10px" }}>
        <div className="meter__fill" style={{ width: `${line.pct}%` }} />
      </div>
    </section>
  );
}

/** Fourteen days ending today, zero-filled: the server only returns the
 *  days that had calls, and a quiet day is a real zero on the axis. */
function fourteenDays(days) {
  const byDay = new Map((days ?? []).map((d) => [d.day, d]));
  const out = [];
  const today = new Date();
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() - i,
      ),
    );
    const key = d.toISOString().slice(0, 10);
    out.push({
      day: key,
      calls: byDay.get(key)?.calls ?? 0,
      errors: byDay.get(key)?.errors ?? 0,
      today: i === 0,
    });
  }
  return out;
}

export function Usage() {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.usage().then((r) => r.ok && setUsage(r.data));
  }, []);
  if (!usage) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;

  const quota = quotaReading(usage);
  const days = fourteenDays(usage.days);
  const max = Math.max(...days.map((d) => d.calls), 1);
  const callers = usage.by_caller ?? [];
  const callerMax = Math.max(...callers.map((c) => c.calls), 1);
  const tools = usage.top_tools ?? [];

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Usage</h1>
        <p className="page__lede">
          Your daily budget and where it went. {quota.resets}.
          {usage.agent_calls_today > 0 &&
            ` Your agents spent ${usage.agent_calls_today.toLocaleString()} of today's calls; they draw on the same budget you do.`}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "14px",
        }}
      >
        <QuotaCard title="Calls today" line={quota.calls} />
        <QuotaCard title="Live fetches today" line={quota.fetches} />
      </div>

      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head">
          <span className="panel-title">Calls per day</span>
          <span
            style={{
              marginLeft: "auto",
              fontSize: "12px",
              color: "var(--ink-faint)",
            }}
          >
            14 days · today still filling
          </span>
        </div>
        <div
          style={{
            padding: "18px 16px 6px",
            display: "flex",
            alignItems: "flex-end",
            gap: "6px",
            height: "120px",
          }}
          role="img"
          aria-label={`Calls per day for the last 14 days, up to ${max.toLocaleString()} a day`}
        >
          {days.map((d) => (
            <span
              key={d.day}
              title={`${d.day} · ${d.calls.toLocaleString()} calls${d.errors ? ` · ${d.errors} errors` : ""}`}
              style={{
                flex: "1 1 0",
                minWidth: "6px",
                height: `${Math.max(2, (d.calls / max) * 100)}%`,
                background: "var(--accent)",
                // Today reads as in progress by weight, not by hue: gold
                // stays a brand and ownership colour, never a data value.
                opacity: d.today ? 0.45 : 1,
                borderRadius: "4px 4px 0 0",
              }}
            />
          ))}
        </div>
        <div
          className="mono"
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "0 16px 12px",
            fontSize: "11px",
            color: "var(--ink-faint)",
          }}
        >
          <span>{days[0].day.slice(5)}</span>
          <span>today</span>
        </div>
      </section>

      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
        <section className="panel" style={{ flex: "1 1 320px" }}>
          <div className="panel__head">
            <span className="panel-title">By connection</span>
            <span className="caveat" style={{ marginLeft: "auto" }}>
              7 days
            </span>
          </div>
          <div style={{ padding: "6px 0" }}>
            {callers.length === 0 && (
              <p
                style={{
                  padding: "10px 16px",
                  margin: 0,
                  fontSize: "13px",
                  color: "var(--ink-faint)",
                }}
              >
                Nothing has called yet this week.
              </p>
            )}
            {callers.map((c) => (
              <div
                key={`${c.kind}:${c.name}`}
                style={{
                  padding: "10px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "14px",
                }}
              >
                <span style={{ flex: "0 0 128px", minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: "13.5px",
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "12px",
                      color: "var(--ink-faint)",
                    }}
                  >
                    {c.kind}
                  </span>
                </span>
                <span
                  className="meter"
                  style={{ flex: "1 1 auto", height: "6px" }}
                >
                  <span
                    className="meter__fill"
                    style={{
                      display: "block",
                      width: `${(c.calls / callerMax) * 100}%`,
                    }}
                  />
                </span>
                <span
                  className="mono"
                  style={{
                    flex: "0 0 52px",
                    textAlign: "right",
                    color: "var(--ink-body)",
                  }}
                >
                  {c.calls.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" style={{ flex: "1 1 280px" }}>
          <div className="panel__head">
            <span className="panel-title">Busiest tools</span>
            <span className="caveat" style={{ marginLeft: "auto" }}>
              7 days
            </span>
          </div>
          <div style={{ padding: "6px 0" }}>
            {tools.length === 0 && (
              <p
                style={{
                  padding: "10px 16px",
                  margin: 0,
                  fontSize: "13px",
                  color: "var(--ink-faint)",
                }}
              >
                No calls yet this week.
              </p>
            )}
            {tools.map((t) => (
              <div
                key={t.tool}
                style={{
                  padding: "9px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  fontSize: "13px",
                }}
              >
                <a className="mono" href="/docs/tools">
                  {t.tool}
                </a>
                <span
                  className="mono"
                  style={{ marginLeft: "auto", color: "var(--ink-body)" }}
                >
                  {t.calls.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
