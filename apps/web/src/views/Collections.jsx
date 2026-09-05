import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Curated collections — browse (everyone) via the explorer bridge, the
 *  same registry tools agents call. */
export function Collections({ navigate }) {
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null); // {slug, ...collections_get body}
  const [err, setErr] = useState("");

  useEffect(() => {
    api.explore("collections_browse").then((r) => {
      if (r.ok) setList(r.data.body?.collections ?? r.data.collections ?? []);
      else setErr("Could not load collections.");
    });
  }, []);

  const openOne = async (slug) => {
    setErr("");
    const r = await api.explore("collections_get", { slug });
    if (r.ok) setOpen(r.data.body ?? r.data);
    else setErr("Could not load that collection.");
  };

  return (
    <section>
      <div className="panel">
        <h3>Collections</h3>
        <p>
          Curated groupings of players and clans — each one is its
          curator&rsquo;s editorial list, not a global label.
        </p>
        {err && <p className="error">{err}</p>}
        {list === null && <p>Loading…</p>}
        {list?.length === 0 && <p>No public collections yet.</p>}
        {list?.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Collection</th>
                <th>Kind</th>
                <th>Members</th>
                <th>About</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.slug}>
                  <td>
                    <button className="quiet" onClick={() => openOne(c.slug)}>
                      {c.title}
                    </button>
                  </td>
                  <td>{c.kind}</td>
                  <td>{c.member_count}</td>
                  <td>{c.description ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && (
        <div className="panel">
          <h3>{open.title}</h3>
          {open.description && <p>{open.description}</p>}
          <table>
            <thead>
              <tr>
                {open.kind === "player" ? (
                  <>
                    <th>Player</th>
                    <th>Tag</th>
                    <th>Trophies</th>
                    <th>Years</th>
                    <th>Recording</th>
                  </>
                ) : (
                  <>
                    <th>Clan</th>
                    <th>Tag</th>
                    <th>Members</th>
                    <th>Recording</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {open.members.map((m) => (
                <tr key={m.player_tag ?? m.clan_tag}>
                  {open.kind === "player" ? (
                    <>
                      <td>{m.name ?? "—"}</td>
                      <td>
                        <button
                          className="quiet"
                          title="Open in the player explorer"
                          onClick={() =>
                            navigate(
                              `/explore/player?tag=${encodeURIComponent(m.player_tag)}`,
                            )
                          }
                        >
                          <code>{m.player_tag}</code>
                        </button>
                      </td>
                      <td>{m.trophies ?? "—"}</td>
                      <td>{m.years_played ?? "?"}</td>
                      <td>{m.recording ? "●" : "—"}</td>
                    </>
                  ) : (
                    <>
                      <td>{m.name ?? "—"}</td>
                      <td>
                        <code>{m.clan_tag}</code>
                      </td>
                      <td>{m.open_members}</td>
                      <td>{m.recording ? "●" : "—"}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {open.note && <p className="fine">{open.note}</p>}
        </div>
      )}
    </section>
  );
}
