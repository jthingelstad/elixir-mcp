import { useEffect, useState } from "react";
import { api } from "../api.js";
// Subpath import: the contracts barrel pulls node:crypto (deck.js).
import { CHANGELOG } from "@elixir-mcp/contracts/dist/changelog.js";

/** Data (design handoff §2–3): the ONLY place charts belong. Full
 *  recorded history, daily, UTC; today's partial bar at 35% so an
 *  unfinished day never reads as a drop; one hover index drives all
 *  three small multiples with the value printed in each head. */

const W = 720;
const H = 96;
const PLOT_W = 680;

function Chart({ label, series, hover, setHover, todayIdx }) {
  const n = series.length || 1;
  const max = Math.max(...series.map((d) => d.v), 1);
  const bw = Math.max(1, PLOT_W / n - 1);
  const grid = [max, Math.round(max / 2)];
  const hovered = hover != null ? series[hover] : null;
  return (
    <div className="chart">
      <div className="chart__head">
        <span className="stat__label">{label}</span>
        <span className="chart__at">
          {(hovered ?? series.at(-1))?.day ?? ""}
        </span>
        <span className="chart__value">
          {(hovered ?? series.at(-1))?.v?.toLocaleString() ?? "—"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {grid.map((g) => {
          const y = H - 8 - (g / max) * (H - 16);
          return (
            <g key={g}>
              <line className="grid" x1={0} x2={PLOT_W} y1={y} y2={y} />
              <text x={PLOT_W + 6} y={y + 3}>
                {g.toLocaleString()}
              </text>
            </g>
          );
        })}
        <line className="axis" x1={0} x2={PLOT_W} y1={H - 8} y2={H - 8} />
        {series.map((d, i) => {
          const h = Math.max(1, (d.v / max) * (H - 16));
          const x = (i * PLOT_W) / n;
          return (
            <g key={d.day}>
              <rect
                className={
                  i === hover
                    ? "bar bar--hover"
                    : i === todayIdx
                      ? "bar bar--partial"
                      : "bar"
                }
                x={x}
                y={H - 8 - h}
                width={bw}
                height={h}
              />
              <rect
                x={x}
                y={0}
                width={PLOT_W / n}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const fmt = (n) => (n == null ? "—" : n.toLocaleString());

export function Data({ page }) {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState(null);
  useEffect(() => {
    api.publicStats().then((r) => {
      if (r.ok) setStats(r.data);
      else setErr("Could not load corpus stats.");
    });
  }, []);

  if (page === "changelog") {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Contract changelog</h1>
          <span className="page-head__note">
            every change to the tool contract — agents read this via{" "}
            <code>elixir_changelog</code>
          </span>
          <span className="caveat">schema, not news</span>
        </div>
        <section className="panel">
          {CHANGELOG.map((e) => (
            <div
              key={e.version}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(120px, 160px) 1fr",
                borderTop: "1px solid var(--edge-soft)",
              }}
            >
              <div
                className="mono"
                style={{
                  padding: "12px 16px",
                  color: "var(--dim)",
                  fontSize: "11.5px",
                }}
              >
                <div style={{ color: "var(--muted)", fontWeight: 600 }}>
                  {e.version}
                </div>
                {e.date}
              </div>
              <div
                style={{
                  padding: "12px 16px",
                  fontSize: "12.5px",
                  lineHeight: 1.55,
                }}
              >
                {e.summary}
                {e.tools_added && (
                  <div
                    style={{
                      marginTop: "6px",
                      display: "flex",
                      gap: "6px",
                      flexWrap: "wrap",
                      alignItems: "center",
                    }}
                  >
                    <span className="stat__label">tools added</span>
                    {e.tools_added.map((t) => (
                      <code key={t} className="tag-chip">
                        {t}
                      </code>
                    ))}
                  </div>
                )}
                {e.breaking && (
                  <div
                    style={{
                      marginTop: "6px",
                      fontSize: "12px",
                      color: "var(--amber)",
                    }}
                  >
                    breaking: {e.breaking}
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>
      </>
    );
  }

  const t = stats?.totals;
  const mk = (rows, vKey) =>
    (rows ?? []).map((d) => ({ day: d.day, v: d[vKey] }));
  const battles = mk(stats?.series.battles_daily, "battles");
  const players = mk(stats?.series.players_observed_daily, "players");
  const fetches = mk(stats?.series.fetches_daily, "fetches");
  const today = new Date().toISOString().slice(0, 10);
  const todayIdx = battles.findIndex((d) => d.day === today);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">The corpus</h1>
        <span className="page-head__note">
          everything Elixir has recorded — aggregates are public by design
        </span>
      </div>
      {err && <p className="field-error">{err}</p>}

      {t && (
        <div className="stats" style={{ marginBottom: "20px" }}>
          {[
            [
              "battles",
              t.battles,
              `${t.oldest_battle?.slice(0, 10)} → ${t.newest_battle?.slice(5, 10)}`,
            ],
            [
              "players",
              t.players,
              `observed · ${fmt(t.players_recording)} recorded`,
            ],
            ["clans", t.clans, `observed · ${fmt(t.clans_recording)} recorded`],
            ["war weeks", t.war_weeks, "recorded river races"],
            ["snapshots", t.snapshots, "daily player snapshots"],
            ["collectors", t.collectors_active, "machines fetching now"],
          ].map(([label, v, sub]) => (
            <div key={label}>
              <div className="stat__label">{label}</div>
              <div className="stat__value">{fmt(v)}</div>
              <div className="stat__sub">{sub}</div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Over time</span>
            <span className="caveat">full recorded history</span>
            <span className="caveat">daily · UTC</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--dim)",
              }}
            >
              as of {t?.newest_battle?.slice(0, 10)}
            </span>
          </div>
          <div onMouseLeave={() => setHover(null)}>
            <Chart
              label="battles recorded / day"
              series={battles}
              hover={hover}
              setHover={setHover}
              todayIdx={todayIdx}
            />
            <Chart
              label="players observed / day"
              series={players}
              hover={hover != null && players[hover] ? hover : null}
              setHover={setHover}
              todayIdx={players.findIndex((d) => d.day === today)}
            />
            <Chart
              label="collector fetches / day"
              series={fetches}
              hover={hover != null && fetches[hover] ? hover : null}
              setHover={setHover}
              todayIdx={fetches.findIndex((d) => d.day === today)}
            />
          </div>
          <div className="panel__note">
            Battles are bucketed by when they were <em>played</em>, not when
            they were captured — the first weeks are archive backfill and
            undercount live activity. Today is partial (the faded bar).
            Retention is deliberate: the corpus keeps its full history.
          </div>
        </section>
      )}
    </>
  );
}
