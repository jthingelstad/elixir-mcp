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

  const load = async () => {
    const res = await api.clan();
    if (res.ok) setClan(res.data);
    else setDenied(true);
  };
  useEffect(() => {
    load();
  }, []);

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

      {clan.my_claims.length > 0 && (
        <div className="panel">
          <h3>Battle sharing</h3>
          <p>
            Clanmates always see war stats. Sharing lets them see your full
            recorded battle history through their own agents.
          </p>
          {clan.my_claims.map((c) => (
            <label key={c.player_tag} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={c.share_battles_with_clan === true}
                onChange={async (e) => {
                  await api.setShareBattles(c.player_tag, e.target.checked);
                  load();
                }}
              />{" "}
              Share <code>{c.player_tag}</code> battles with my clan
            </label>
          ))}
        </div>
      )}
    </>
  );
}
