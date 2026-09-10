import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Eight weeks. Long enough to see a trend, short enough that a daily bar is
 *  still a bar rather than a hairline. */
const WINDOW_DAYS = 56;

/** Data (design handoff §2-3): the ONLY place charts belong. Full
 *  recorded history, daily, UTC; today's partial bar at 35% so an
 *  unfinished day never reads as a drop; one hover index drives all
 *  three small multiples with the value printed in each head.
 *
 *  The contract changelog used to be a third page here. It is content,
 *  not live data, so it moved to the static site at /data/changelog
 *  where a crawler and an agent can read it. */

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

export function Data() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState(null);
  useEffect(() => {
    api.publicStats().then((r) => {
      if (r.ok) setStats(r.data);
      else setErr("Could not load corpus stats.");
    });
  }, []);

  const t = stats?.totals;
  /**
   * All three charts on one fixed axis: the last eight weeks.
   *
   * They used to render whatever length each series happened to have, so three
   * charts stacked above each other, all labelled "per day", covered three
   * different spans — and a reader comparing them was comparing different
   * windows without being told. A day with no rows is a real zero on a time
   * axis, not a gap to compress, so missing days are filled rather than
   * skipped.
   */
  const mk = (rows, vKey) => {
    const byDay = new Map((rows ?? []).map((d) => [d.day, d[vKey] ?? 0]));
    const out = [];
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    cursor.setUTCDate(cursor.getUTCDate() - (WINDOW_DAYS - 1));
    for (let i = 0; i < WINDOW_DAYS; i += 1) {
      const day = cursor.toISOString().slice(0, 10);
      out.push({ day, v: byDay.get(day) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  };
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
            <span className="caveat">last 8 weeks</span>
            <span className="caveat">daily · UTC</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--ink-faint)",
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
