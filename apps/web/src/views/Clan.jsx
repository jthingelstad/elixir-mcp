import { useEffect, useState } from "react";
import { api } from "../api.js";

function ago(ts) {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - Date.parse(ts)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 48) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function Clan({ me, navigate }) {
  const [clan, setClan] = useState(null); // null = loading
  const [denied, setDenied] = useState(false);
  const [intel, setIntel] = useState({});

  const load = async () => {
    const res = await api.clan();
    if (res.ok) setClan(res.data);
    else setDenied(true);
  };
  useEffect(() => {
    load();
  }, []);
  // Clan intelligence (SITE-IA): the same registry tools agents call.
  useEffect(() => {
    if (!me?.authenticated || denied) return;
    for (const [key, tool] of [
      ["standings", "clans_standings"],
      ["pilots", "clans_pilot_scores"],
      ["rivals", "war_rivals"],
    ]) {
      api.explore(tool, {}).then((r) => {
        if (r.ok && !r.data.is_error)
          setIntel((prev) => ({ ...prev, [key]: r.data.body }));
      });
    }
  }, [me?.authenticated, denied]);

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
          to see your clan.
        </p>
      </div>
    );
  }
  if (denied) {
    return (
      <div className="panel">
        <h3>No recorded clan</h3>
        <p>Your claimed players aren’t in a clan Elixir MCP records yet.</p>
      </div>
    );
  }
  if (clan === null) return <p className="notice">Loading…</p>;

  const standings = clan.war?.standings ?? [];

  return (
    <>
      <div className="panel">
        <h3>
          {clan.name ?? clan.clan_tag} <code>{clan.clan_tag}</code>
        </h3>
        {clan.war ? (
          <>
            <p className="notice">
              Season {clan.war.season_id}, week {clan.war.section_index + 1}
              {clan.war.is_colosseum ? " — Colosseum" : ""}
            </p>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Clan</th>
                  <th>Fame</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s, i) => (
                  <tr
                    key={s.tag}
                    className={s.tag === clan.clan_tag ? "us" : ""}
                  >
                    <td>{s.rank ?? i + 1}</td>
                    <td>{s.clan ?? s.tag}</td>
                    <td>{s.fame?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p>
            No war data recorded yet — standings appear after the first river
            race poll.
          </p>
        )}
      </div>

      <div className="panel">
        <h3>Roster ({clan.members.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Trophies</th>
              <th>Donations</th>
              <th>Last battle</th>
            </tr>
          </thead>
          <tbody>
            {clan.members.map((m) => (
              <tr key={m.player_tag}>
                <td>{m.name ?? m.player_tag}</td>
                <td>{m.role ?? "—"}</td>
                <td>{m.trophies?.toLocaleString() ?? "—"}</td>
                <td>{m.donations ?? "—"}</td>
                <td>{ago(m.last_battle)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {intel.standings?.members?.length > 0 && (
        <div className="panel">
          <h3>Standings</h3>
          <p className="fine">
            Recorded win rate over {intel.standings.window_days} days — clan
            median {(intel.standings.median_win_rate * 100).toFixed(1)}%.
            {" " + intel.standings.basis}
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Battles</th>
                <th>Win rate</th>
              </tr>
            </thead>
            <tbody>
              {intel.standings.members.map((m, i) => (
                <tr key={m.player_tag}>
                  <td>{i + 1}</td>
                  <td>{m.name ?? m.player_tag}</td>
                  <td>{m.battles ?? m.wins + m.losses}</td>
                  <td>
                    {m.win_rate != null
                      ? `${(m.win_rate * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {intel.pilots?.members?.length > 0 && (
        <div className="panel">
          <h3>Pilot Scores</h3>
          <p className="fine">
            Wins card levels can&rsquo;t explain, clan-wide —{" "}
            {intel.pilots.scored_members} members with 30+ leveled battles in{" "}
            {intel.pilots.window_days} days.
          </p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Member</th>
                <th>Years</th>
                <th>n</th>
                <th>Pilot Score</th>
              </tr>
            </thead>
            <tbody>
              {intel.pilots.members.map((m) => (
                <tr key={m.player_tag}>
                  <td>{m.rank}</td>
                  <td>{m.name ?? m.player_tag}</td>
                  <td>{m.years_played ?? "?"}</td>
                  <td>{m.n}</td>
                  <td>
                    {m.pilot_score > 0 ? "+" : ""}
                    {(m.pilot_score * 100).toFixed(1)} ±
                    {(m.standard_error * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {intel.rivals?.rivals?.length > 0 && (
        <div className="panel">
          <h3>Scouting Report</h3>
          <p className="fine">{intel.rivals.basis}</p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Rival</th>
                  <th>Races seen</th>
                  <th>Avg fame</th>
                  <th>Best</th>
                  <th>Zero-fame</th>
                </tr>
              </thead>
              <tbody>
                {intel.rivals.rivals.slice(0, 20).map((r) => (
                  <tr key={r.clan_tag}>
                    <td>
                      {r.name ?? "—"} <code>{r.clan_tag}</code>
                    </td>
                    <td>{r.races_observed}</td>
                    <td>
                      {r.mean_fame != null
                        ? Number(r.mean_fame).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {r.max_fame != null
                        ? Number(r.max_fame).toLocaleString()
                        : "—"}
                    </td>
                    <td>{r.zero_fame_races ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
