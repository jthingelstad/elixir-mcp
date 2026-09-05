import { useEffect, useState } from "react";
import { api } from "../api.js";
// Subpath import: the contracts barrel pulls node:crypto (deck.js).
import { CHANGELOG } from "@elixir-mcp/contracts/dist/changelog.js";

/** The public data story (SITE-IA 2026-09-05): corpus scale and
 *  full-history daily series, no auth. Charts are dependency-free
 *  inline SVG — this is transparency, not a BI platform. */

function Sparkbars({ points, width = 640, height = 120, label }) {
  if (!points || points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.v), 1);
  const bw = Math.max(1, Math.floor(width / points.length) - 1);
  return (
    <figure style={{ margin: "0.5rem 0 1.2rem" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        style={{ width: "100%", height: "auto", display: "block" }}
      >
        {points.map((p, i) => {
          const h = Math.max(1, Math.round((p.v / max) * (height - 4)));
          return (
            <rect
              key={p.day}
              x={i * (bw + 1)}
              y={height - h}
              width={bw}
              height={h}
              fill="var(--purple, #8a6ff0)"
            >
              <title>{`${p.day}: ${p.v.toLocaleString()}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="fine">
        {label} — {points[0].day} to {points.at(-1).day}, peak{" "}
        {max.toLocaleString()}
      </figcaption>
    </figure>
  );
}

const fmt = (n) => (n === null || n === undefined ? "—" : n.toLocaleString());

export function Data({ page }) {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.publicStats().then((r) => {
      if (r.ok) setStats(r.data);
      else setErr("Could not load corpus stats.");
    });
  }, []);

  if (page === "changelog") {
    return (
      <section>
        <div className="panel">
          <h3>Contract changelog</h3>
          <p>
            Every change to the tool contract, machine-readable to agents via{" "}
            <code>elixir_changelog</code>. Event lists in entries are schema,
            not news.
          </p>
          {CHANGELOG.map((e) => (
            <div key={e.version} style={{ marginBottom: "1rem" }}>
              <strong>
                {e.version} · {e.date}
              </strong>
              <p style={{ margin: "0.25rem 0" }}>{e.summary}</p>
              {e.tools_added && (
                <p className="fine">
                  tools added:{" "}
                  {e.tools_added.map((t) => (
                    <code key={t} style={{ marginRight: "0.4rem" }}>
                      {t}
                    </code>
                  ))}
                </p>
              )}
              {e.breaking && <p className="fine">breaking: {e.breaking}</p>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const t = stats?.totals;
  return (
    <section>
      <div className="panel">
        <h3>The corpus</h3>
        <p>
          Elixir MCP records what the Clash Royale API forgets. Everything below
          is the full recorded history — aggregates are public by design.
        </p>
        {err && <p className="error">{err}</p>}
        {t && (
          <ul>
            <li>
              <strong>{fmt(t.battles)}</strong> battles recorded, from{" "}
              {t.oldest_battle?.slice(0, 10)} to {t.newest_battle?.slice(0, 10)}
            </li>
            <li>
              <strong>{fmt(t.players)}</strong> players observed ·{" "}
              <strong>{fmt(t.players_recording)}</strong> actively recorded
            </li>
            <li>
              <strong>{fmt(t.clans)}</strong> clans observed ·{" "}
              <strong>{fmt(t.clans_recording)}</strong> recorded
            </li>
            <li>
              <strong>{fmt(t.war_weeks)}</strong> war weeks ·{" "}
              <strong>{fmt(t.snapshots)}</strong> daily snapshots
            </li>
            <li>
              <strong>{fmt(t.collectors_active)}</strong> collectors active
            </li>
          </ul>
        )}
      </div>

      {stats && (
        <div className="panel">
          <h3>Over time</h3>
          <Sparkbars
            label="Battles recorded per day (by when they were played)"
            points={stats.series.battles_daily.map((d) => ({
              day: d.day,
              v: d.battles,
            }))}
          />
          <Sparkbars
            label="New players observed per day"
            points={stats.series.players_observed_daily.map((d) => ({
              day: d.day,
              v: d.players,
            }))}
          />
          <Sparkbars
            label="Collector fetches per day"
            points={stats.series.fetches_daily.map((d) => ({
              day: d.day,
              v: d.fetches,
            }))}
          />
          <p className="fine">{stats.note}</p>
        </div>
      )}
    </section>
  );
}
