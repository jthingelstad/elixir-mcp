import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

/** Explore ▸ Meta (SITE-IA): the observed meta and group trends over a
 *  chosen segment — the whole corpus, one clan, or a curated
 *  collection like the pros. Observation, never opinion: shrunk win
 *  rates, distinct pilots, sample sizes on everything. */
const VIEWS = ["Decks", "Cards", "Trends"];

function pct(x) {
  return x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`;
}

export function Meta({ me }) {
  const [view, setView] = useState("Decks");
  const [segment, setSegment] = useState({ kind: "corpus", value: "" });
  const [collections, setCollections] = useState([]);
  const [data, setData] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!me?.authenticated) return;
    api.explore("collections_browse").then((r) => {
      if (r.ok && !r.data.is_error)
        setCollections(
          (r.data.body?.collections ?? []).filter((c) => c.kind === "player"),
        );
    });
  }, [me?.authenticated]);

  const segArgs = useCallback(() => {
    if (segment.kind === "clan" && segment.value)
      return { clan_tag: segment.value };
    if (segment.kind === "collection" && segment.value)
      return { collection: segment.value };
    return {};
  }, [segment]);

  const key = `${view}:${segment.kind}:${segment.value}`;
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const tool =
      view === "Decks"
        ? "battles_meta_decks"
        : view === "Cards"
          ? "battles_meta_cards"
          : "battles_trends";
    const r = await api.explore(tool, segArgs());
    setBusy(false);
    if (!r.ok || r.data.is_error) {
      setError(r.data?.body?.error?.message ?? "request failed");
      return;
    }
    setData((prev) => ({ ...prev, [key]: r.data.body }));
  }, [view, segArgs, key]);

  useEffect(() => {
    if (me?.authenticated && !data[key]) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, segment, me?.authenticated]);

  if (me === null) return <p className="notice">Loading…</p>;
  if (!me.authenticated)
    return <p className="notice">Sign in to explore the meta.</p>;

  const d = data[key];
  return (
    <section>
      <div className="panel">
        <h3>The observed meta</h3>
        <p className="fine">
          What&rsquo;s actually being played and winning in the recorded corpus
          — shrunk win rates so tiny samples never top a list, distinct pilots
          so composition shows. Never a tier list.
        </p>
        <div className="tabs">
          <button
            className={segment.kind === "corpus" ? "tab active" : "tab"}
            onClick={() => setSegment({ kind: "corpus", value: "" })}
          >
            Whole corpus
          </button>
          {collections.map((c) => (
            <button
              key={c.slug}
              className={
                segment.kind === "collection" && segment.value === c.slug
                  ? "tab active"
                  : "tab"
              }
              onClick={() => setSegment({ kind: "collection", value: c.slug })}
            >
              {c.title}
            </button>
          ))}
          <input
            placeholder="#CLANTAG"
            style={{ width: "8rem" }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target.value)
                setSegment({ kind: "clan", value: e.target.value });
            }}
          />
        </div>
        <div className="tabs" style={{ marginTop: "0.4rem" }}>
          {VIEWS.map((v) => (
            <button
              key={v}
              className={v === view ? "tab active" : "tab"}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </div>
        {busy && <p>Loading…</p>}
        {error && <p className="error">{error}</p>}

        {view === "Decks" && d?.decks && (
          <>
            <p className="fine">
              Segment <strong>{d.segment}</strong> ·{" "}
              {d.decided_battles.toLocaleString()} decided battles · segment win
              rate {pct(d.segment_win_rate)}
            </p>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Deck</th>
                    <th>Battles</th>
                    <th>Pilots</th>
                    <th>Usage</th>
                    <th>Win rate</th>
                    <th>Shrunk</th>
                  </tr>
                </thead>
                <tbody>
                  {d.decks.map((k) => (
                    <tr key={k.deck_hash}>
                      <td className="fine">
                        {k.cards.map((c) => c.name).join(", ")}
                      </td>
                      <td>{k.battles}</td>
                      <td>{k.players}</td>
                      <td>{pct(k.usage_share)}</td>
                      <td>{pct(k.win_rate)}</td>
                      <td>
                        <strong>{pct(k.shrunk_win_rate)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {view === "Cards" && d?.cards && (
          <>
            <p className="fine">
              Segment <strong>{d.segment}</strong> ·{" "}
              {d.decided_battles.toLocaleString()} decided battles
            </p>
            <table>
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Battles</th>
                  <th>Pilots</th>
                  <th>Usage</th>
                  <th>Shrunk WR</th>
                </tr>
              </thead>
              <tbody>
                {d.cards.map((c) => (
                  <tr key={`${c.card_id}-${c.evolution ?? 0}`}>
                    <td>
                      {c.name}
                      {c.evolution === 1 ? " (Evo)" : ""}
                      {c.evolution === 2 ? " (Hero)" : ""}
                    </td>
                    <td>{c.battles}</td>
                    <td>{c.players}</td>
                    <td>{pct(c.usage_share)}</td>
                    <td>{pct(c.shrunk_win_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {view === "Trends" && d?.weeks && (
          <>
            <p className="fine">
              Segment <strong>{d.segment}</strong> — weekly series; group win
              rates move with who played that week.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Battles</th>
                  <th>Pilots</th>
                  <th>Win rate</th>
                  <th>Net trophies</th>
                </tr>
              </thead>
              <tbody>
                {d.weeks.map((w) => (
                  <tr key={w.iso_week}>
                    <td>{w.iso_week}</td>
                    <td>{w.battles}</td>
                    <td>{w.players}</td>
                    <td>{pct(w.win_rate)}</td>
                    <td>{w.net_trophies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {d?.note && <p className="fine">{d.note}</p>}
      </div>
    </section>
  );
}
