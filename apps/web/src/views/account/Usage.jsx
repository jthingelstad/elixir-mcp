import { useEffect, useState } from "react";
import { api } from "../../api.js";

export function Usage({ me }) {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.usage().then((r) => r.ok && setUsage(r.data));
  }, []);
  if (!usage) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  const max = Math.max(...(usage.days ?? []).map((d) => d.calls), 1);
  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Usage</h1>
        <p className="page__lede">
          What your connections spent, and what is left of today. Agents are
          broken out, because they spend the same budget you do.
        </p>
      </div>
      <div className="cols">
        <div className="cols__main">
          <section className="panel">
            <div className="panel__head">
              <span className="panel-title">Daily tool calls</span>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "11.5px",
                  color: "var(--ink-faint)",
                }}
              >
                {usage.today_calls} of {usage.quota_max ?? "∞"} today
                {usage.agent_calls_today > 0 &&
                  ` · ${usage.agent_calls_today} from your agents`}
              </span>
            </div>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>DAY</th>
                    <th className="num">CALLS</th>
                    <th className="num">ERRORS</th>
                    <th style={{ width: "40%" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {(usage.days ?? []).map((d) => (
                    <tr key={d.day}>
                      <td className="mono">{d.day}</td>
                      <td className="num">{d.calls}</td>
                      <td className="num">
                        {d.errors ? (
                          <span style={{ color: "var(--bad)" }}>
                            {d.errors}
                          </span>
                        ) : (
                          <span className="nil">—</span>
                        )}
                      </td>
                      <td>
                        <div className="meter">
                          <div
                            className="meter__fill"
                            style={{ width: `${(d.calls / max) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel__note">
              Live CR fetches today: {usage.live_today ?? 0} of{" "}
              {usage.live_max ?? me?.entitlements?.live_fetches_per_day ?? "∞"}{" "}
              — the live lane spends the shared CR budget; recorded reads do
              not.
            </div>
          </section>
        </div>
        <div className="cols__rail">
          <section className="panel">
            <div className="panel__head">
              <span className="panel-title">Most used tools</span>
              <span className="caveat">7 days</span>
            </div>
            <div className="panel__body">
              {(usage.top_tools ?? []).map((t) => {
                const tmax = Math.max(
                  ...(usage.top_tools ?? []).map((x) => x.calls),
                  1,
                );
                return (
                  <div key={t.tool} style={{ marginBottom: "10px" }}>
                    <div
                      style={{
                        display: "flex",
                        fontSize: "12px",
                        marginBottom: "4px",
                      }}
                    >
                      <code>{t.tool}</code>
                      <span
                        className="mono"
                        style={{
                          marginLeft: "auto",
                          color: "var(--ink-faint)",
                        }}
                      >
                        {t.calls}
                      </span>
                    </div>
                    <div className="meter">
                      <div
                        className="meter__fill"
                        style={{ width: `${(t.calls / tmax) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
