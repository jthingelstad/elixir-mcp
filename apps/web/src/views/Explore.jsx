import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

/**
 * The data explorer: the MCP tool surface, rendered. Every view is one
 * bridge call to the same registry agents use — identical entitlements,
 * freshness honesty, and shapes. Users see exactly what their agents see.
 */

const TABS = [
  "Summary",
  "Battles",
  "Trend",
  "Decks",
  "Collection",
  "War",
  "Coverage",
];

function WinRateChart({ weekly }) {
  if (!weekly || weekly.length === 0) return null;
  const W = 640;
  const H = 160;
  const pad = 28;
  const xs = weekly.map((_, i) =>
    weekly.length === 1
      ? W / 2
      : pad + (i * (W - 2 * pad)) / (weekly.length - 1),
  );
  const y = (rate) => H - pad - (rate ?? 0) * (H - 2 * pad);
  const line = weekly
    .map((w, i) => `${i === 0 ? "M" : "L"}${xs[i]},${y(w.win_rate ?? 0)}`)
    .join(" ");
  const maxBattles = Math.max(...weekly.map((w) => w.battles));
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto" }}
      role="img"
      aria-label="Weekly win rate"
    >
      <line
        x1={pad}
        x2={W - pad}
        y1={y(0.5)}
        y2={y(0.5)}
        stroke="var(--edge)"
        strokeDasharray="4 4"
      />
      <text x={W - pad + 4} y={y(0.5) + 4} fontSize="10" fill="var(--faint)">
        50%
      </text>
      {weekly.map((w, i) => (
        <rect
          key={w.iso_week}
          x={xs[i] - 6}
          width="12"
          y={H - pad - (w.battles / maxBattles) * 30}
          height={(w.battles / maxBattles) * 30}
          fill="var(--purple-glow)"
        />
      ))}
      <path d={line} fill="none" stroke="var(--gold)" strokeWidth="2.5" />
      {weekly.map((w, i) => (
        <g key={w.iso_week}>
          <circle
            cx={xs[i]}
            cy={y(w.win_rate ?? 0)}
            r="3.5"
            fill="var(--gold)"
          />
          <text
            x={xs[i]}
            y={H - 6}
            fontSize="9"
            fill="var(--faint)"
            textAnchor="middle"
          >
            {w.iso_week.slice(5)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function pct(x) {
  return x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`;
}

export function Explore({ me, navigate }) {
  const [players, setPlayers] = useState(null);
  const [subject, setSubject] = useState(null);
  const [tab, setTab] = useState("Summary");
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [battleFilters, setBattleFilters] = useState({ mode: "", outcome: "" });

  useEffect(() => {
    if (!me?.authenticated) return;
    api.explore("list_my_players").then((r) => {
      if (r.ok && !r.data.is_error) {
        setPlayers(r.data.body.players);
        if (r.data.body.players[0]) {
          setSubject(r.data.body.players[0].player_tag);
        }
      }
    });
  }, [me?.authenticated]);

  const load = useCallback(
    async (whichTab, extraArgs = {}) => {
      if (!subject) return;
      setBusy(true);
      setError(null);
      const call = async (tool, args) => {
        const r = await api.explore(tool, { player_tag: subject, ...args });
        if (!r.ok) throw new Error("request failed");
        if (r.data.is_error) throw new Error(r.data.body.error.message);
        return r.data.body;
      };
      try {
        let d;
        if (whichTab === "Summary") d = await call("get_player_summary");
        else if (whichTab === "Battles") {
          const args = { limit: 25, verbosity: "compact", include_total: true };
          if (battleFilters.mode) args.mode = battleFilters.mode;
          if (battleFilters.outcome) args.outcome = battleFilters.outcome;
          if (extraArgs.cursor) args.cursor = extraArgs.cursor;
          const page = await call("query_battles", args);
          d = extraArgs.cursor
            ? {
                ...page,
                battles: [
                  ...(data[`Battles:${subject}`]?.battles ?? []),
                  ...page.battles,
                ],
              }
            : page;
        } else if (whichTab === "Trend")
          d = await call("get_performance", { group_by: "week" });
        else if (whichTab === "Decks")
          d = await call("get_deck_performance", { sort: "battles" });
        else if (whichTab === "Collection") d = await call("get_collection");
        else if (whichTab === "Coverage") d = await call("get_coverage");
        else if (whichTab === "War") {
          const clan = await call("get_clan", { clan_tag: undefined });
          let war = null;
          try {
            war = await call("get_war", { clan_tag: undefined });
          } catch {
            war = null;
          }
          d = { clan, war };
        }
        setData((prev) => ({ ...prev, [`${whichTab}:${subject}`]: d }));
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [subject, battleFilters, data],
  );

  useEffect(() => {
    if (subject && !data[`${tab}:${subject}`]) load(tab);
    // eslint-disable-next-line react/exhaustive-deps
  }, [tab, subject]);

  if (me === null) return <p className="notice">Loading…</p>;
  if (!me.authenticated) {
    return (
      <div className="panel">
        <h3>Sign in first</h3>
        <p>
          <a
            href="/signin"
            onClick={(e) => {
              e.preventDefault();
              navigate("/signin");
            }}
          >
            Sign in
          </a>{" "}
          to explore your data.
        </p>
      </div>
    );
  }

  const d = data[`${tab}:${subject}`];

  return (
    <>
      <div className="panel">
        <h3>Explore</h3>
        <p>
          Browsing exactly what your agent sees — every view below is one MCP
          tool call.
        </p>
        {players && (
          <label>
            Player{" "}
            <select
              value={subject ?? ""}
              onChange={(e) => setSubject(e.target.value)}
            >
              {players.map((p) => (
                <option key={p.player_tag} value={p.player_tag}>
                  {p.name ?? p.player_tag} ({p.player_tag})
                </option>
              ))}
            </select>
          </label>
        )}
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={t === tab ? "tab active" : "tab"}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        {busy && <p className="notice">Loading…</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {tab === "Summary" && d && (
        <div className="panel">
          <h3>
            {d.name ?? d.player_tag}{" "}
            {d.clan && <span className="notice">· {d.clan.name}</span>}
          </h3>
          <p>
            <strong>{d.trophies?.toLocaleString() ?? "—"}</strong> trophies
            {d.trophies_as_of ? ` (as of ${d.trophies_as_of})` : ""}
          </p>
          <p>
            Last 30 days: {d.last_30_days.wins}W–{d.last_30_days.losses}L (
            {pct(d.last_30_days.win_rate)}),{" "}
            {d.last_30_days.net_trophies >= 0 ? "+" : ""}
            {d.last_30_days.net_trophies} trophies
          </p>
          {d.top_deck && (
            <p>
              Top deck ({d.top_deck.battles} battles, {pct(d.top_deck.win_rate)}
              ): {d.top_deck.cards.map((c) => c.name).join(", ")}
            </p>
          )}
        </div>
      )}

      {tab === "Battles" && d && (
        <div className="panel">
          <h3>
            Battles{" "}
            {d.total_count !== undefined && (
              <span className="notice">({d.total_count} match filters)</span>
            )}
          </h3>
          <p>
            <select
              value={battleFilters.mode}
              onChange={(e) => {
                setBattleFilters({ ...battleFilters, mode: e.target.value });
                setData((prev) => ({ ...prev, [`Battles:${subject}`]: null }));
              }}
            >
              <option value="">all modes</option>
              {["ladder", "ranked", "war", "challenge", "casual"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>{" "}
            <select
              value={battleFilters.outcome}
              onChange={(e) => {
                setBattleFilters({ ...battleFilters, outcome: e.target.value });
                setData((prev) => ({ ...prev, [`Battles:${subject}`]: null }));
              }}
            >
              <option value="">any outcome</option>
              <option value="win">wins</option>
              <option value="loss">losses</option>
            </select>
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Mode</th>
                  <th>Result</th>
                  <th>Crowns</th>
                  <th>Trophies</th>
                  <th>Opponent</th>
                </tr>
              </thead>
              <tbody>
                {d.battles.map((b, i) => (
                  <tr key={i}>
                    <td>{b.battle_time_local ?? b.battle_time}</td>
                    <td>{b.game_mode?.name ?? b.type}</td>
                    <td>
                      <span className={`status ${b.me.outcome}`}>
                        {b.me.outcome}
                      </span>
                    </td>
                    <td>
                      {b.me.crowns}–
                      {Math.max(...b.opponents.map((o) => o.crowns ?? 0), 0)}
                    </td>
                    <td>
                      {b.me.trophy_change > 0 ? "+" : ""}
                      {b.me.trophy_change ?? ""}
                    </td>
                    <td>
                      {b.opponents
                        .map((o) => o.name ?? o.player_tag)
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.next_cursor && (
            <button
              className="quiet"
              onClick={() => load("Battles", { cursor: d.next_cursor })}
            >
              Load more
            </button>
          )}
        </div>
      )}

      {tab === "Trend" && d && (
        <div className="panel">
          <h3>Weekly win rate</h3>
          <WinRateChart weekly={d.weekly} />
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Battles</th>
                  <th>W–L</th>
                  <th>Win rate</th>
                  <th>Net trophies</th>
                </tr>
              </thead>
              <tbody>
                {(d.weekly ?? []).map((w) => (
                  <tr key={w.iso_week}>
                    <td>{w.iso_week}</td>
                    <td>{w.battles}</td>
                    <td>
                      {w.wins}–{w.losses}
                    </td>
                    <td>{pct(w.win_rate)}</td>
                    <td>
                      {w.net_trophies > 0 ? "+" : ""}
                      {w.net_trophies}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Decks" && d && (
        <div className="panel">
          <h3>Decks ({d.total_battles_in_window} battles)</h3>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Cards</th>
                  <th>Battles</th>
                  <th>Share</th>
                  <th>W–L</th>
                  <th>Win rate</th>
                  <th>Last used</th>
                </tr>
              </thead>
              <tbody>
                {d.decks.map((k) => (
                  <tr key={k.deck_hash}>
                    <td>{k.cards.map((c) => c.name).join(", ")}</td>
                    <td>{k.battles}</td>
                    <td>{pct(k.share_of_battles)}</td>
                    <td>
                      {k.wins}–{k.losses}
                    </td>
                    <td>{pct(k.win_rate)}</td>
                    <td>{k.last_used.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "Collection" && d && (
        <div className="panel">
          <h3>
            Collection{" "}
            <span className="notice">level {d.collection_level}</span>
          </h3>
          <div className="cardgrid">
            {(d.cards ?? []).map((c) => (
              <div key={c.id} className="cardtile" title={c.name}>
                {c.iconUrls?.medium && (
                  <img src={c.iconUrls.medium} alt={c.name} loading="lazy" />
                )}
                <span>
                  {c.level}
                  {c.evolutionLevel ? "★" : ""}
                </span>
              </div>
            ))}
          </div>
          <p className="notice">
            Levels shown on the in-game 1–16 scale. ★ = evolution owned.
          </p>
        </div>
      )}

      {tab === "War" && d && (
        <div className="panel">
          <h3>{d.clan?.name ?? "War"}</h3>
          {d.war?.standings ? (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Clan</th>
                    <th>Fame</th>
                  </tr>
                </thead>
                <tbody>
                  {d.war.standings.map((s2, i) => (
                    <tr key={s2.tag ?? i}>
                      <td>{s2.rank ?? i + 1}</td>
                      <td>{s2.clan ?? s2.tag}</td>
                      <td>{s2.fame?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No current war data for your clan.</p>
          )}
          {d.clan?.members && (
            <p className="notice">{d.clan.members.length} members recorded.</p>
          )}
        </div>
      )}

      {tab === "Coverage" && d && (
        <div className="panel">
          <h3>Coverage</h3>
          <p>{d.battles.note}</p>
          <ul>
            {d.polls.map((p2) => (
              <li key={p2.endpoint}>
                <code>{p2.endpoint}</code> last admitted{" "}
                {p2.last_admitted_at ?? "never"}
              </li>
            ))}
          </ul>
          {d.snapshots?.first_date && (
            <p className="notice">
              Daily snapshots begin {d.snapshots.first_date}.
            </p>
          )}
          {d.completeness_last_7_days?.note && (
            <p className="notice">{d.completeness_last_7_days.note}</p>
          )}
        </div>
      )}
    </>
  );
}
