import { useEffect, useState } from "react";
import { api } from "../api.js";

/** Curated collections — browse (everyone) via the explorer bridge, the
 *  same registry tools agents call. */
export function Collections({ me, navigate }) {
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

      <MyCollections me={me} />

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

/** Curation for the family tier and above: your own collections,
 *  created and managed right where everyone browses them. */
function MyCollections({ me }) {
  const canCurate =
    me?.entitlements?.collections && me.entitlements.collections.limit !== 0;
  const [mine, setMine] = useState([]);
  const [form, setForm] = useState({ slug: "", title: "", kind: "player" });
  const [tagsText, setTagsText] = useState({});
  const [err, setErr] = useState("");
  const load = async () => {
    const r = await api.myCollections();
    if (r.ok) setMine(r.data.collections ?? []);
  };
  useEffect(() => {
    if (canCurate) load();
  }, [canCurate]);
  if (!canCurate) return null;
  const act = async (body) => {
    setErr("");
    const r = await api.myCollectionAction(body);
    if (!r.ok) setErr(r.data?.message ?? "failed");
    await load();
  };
  const limit = me.entitlements.collections.limit;
  return (
    <div className="panel">
      <h3>Your collections</h3>
      <p>
        Curate up to {limit === null ? "unlimited" : limit} — public ones appear
        above for everyone.
      </p>
      {err && <p className="error">{err}</p>}
      {mine.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Members</th>
              <th>Add / remove tags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {mine.map((c) => (
              <tr key={c.slug}>
                <td>
                  <code>{c.slug}</code>
                </td>
                <td title={(c.members ?? []).join(" ")}>{c.member_count}</td>
                <td>
                  <input
                    placeholder="#TAG #TAG ..."
                    value={tagsText[c.slug] ?? ""}
                    onChange={(e) =>
                      setTagsText({ ...tagsText, [c.slug]: e.target.value })
                    }
                    style={{ width: "11rem" }}
                  />{" "}
                  <button
                    className="quiet"
                    onClick={() => {
                      act({
                        action: "add",
                        slug: c.slug,
                        tags: (tagsText[c.slug] ?? "")
                          .split(/[\s,]+/)
                          .filter(Boolean),
                      });
                      setTagsText({ ...tagsText, [c.slug]: "" });
                    }}
                  >
                    Add
                  </button>{" "}
                  <button
                    className="quiet"
                    onClick={() => {
                      act({
                        action: "remove",
                        slug: c.slug,
                        tags: (tagsText[c.slug] ?? "")
                          .split(/[\s,]+/)
                          .filter(Boolean),
                      });
                      setTagsText({ ...tagsText, [c.slug]: "" });
                    }}
                  >
                    Remove
                  </button>
                </td>
                <td>
                  <button
                    className="quiet"
                    onClick={() => act({ action: "delete", slug: c.slug })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await act({ action: "upsert", ...form });
          setForm({ ...form, slug: "", title: "" });
        }}
        style={{ marginTop: "0.8rem" }}
      >
        <input
          placeholder="slug"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          style={{ width: "8rem" }}
        />{" "}
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={{ width: "10rem" }}
        />{" "}
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        >
          <option value="player">player</option>
          <option value="clan">clan</option>
        </select>{" "}
        <button disabled={!form.slug || !form.title}>Create</button>
      </form>
    </div>
  );
}
