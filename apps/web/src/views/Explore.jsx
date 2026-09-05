import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

/**
 * Explore — the record browser (design handoff 2026-09-05). Not a
 * reporting product: the agent is the analyst; this page answers "is
 * the data there, and is it right?" A lookup box resolves to records
 * you traverse by clicking references. Every record is one bridge call
 * to the same registry tools agents use — render nothing the contract
 * doesn't return. Deep linking is the feature: every record has a real
 * URL and copy-link reopens exactly this record.
 */

const TAG_RE = /^#?[0-9a-zA-Z]{3,12}$/;
const HASH_RE = /^(deck:)?[0-9a-f]{16,64}$/i;
const WEEK_RE = /^\d{4}-W\d{2}$/i;

function normTag(q) {
  return "#" + q.trim().toUpperCase().replace(/^#/, "").replaceAll("O", "0");
}
const encTag = (t) => encodeURIComponent(t.replace(/^#/, ""));
const decTag = (t) => "#" + decodeURIComponent(t).replace(/^#/, "");

function Freshness({ meta }) {
  const s = meta?.freshness_seconds;
  if (s === null || s === undefined)
    return <span className="freshness freshness--never">never polled</span>;
  const cls =
    s < 900
      ? "freshness freshness--fresh"
      : s < 86400
        ? "freshness freshness--stale"
        : "freshness";
  const label =
    s < 90
      ? `${Math.round(s)}s ago`
      : s < 5400
        ? `${Math.round(s / 60)}m ago`
        : s < 172800
          ? `${Math.round(s / 3600)}h ago`
          : `${Math.round(s / 86400)}d ago`;
  return <span className={cls}>polled {label}</span>;
}

function recent() {
  try {
    return JSON.parse(localStorage.getItem("elixir-recent") || "[]");
  } catch {
    return [];
  }
}
function pushRecent(entry) {
  const cur = recent().filter((r) => r.href !== entry.href);
  cur.unshift(entry);
  localStorage.setItem("elixir-recent", JSON.stringify(cur.slice(0, 6)));
}

/** One bridge call per record — the toolbar shows exactly this call. */
async function fetchRecord(kind, id) {
  const call = async (tool, args) => {
    const r = await api.explore(tool, args);
    if (!r.ok) throw new Error("request failed");
    if (r.data.is_error) {
      const e = new Error(r.data.body?.error?.message ?? "error");
      e.code = r.data.body?.error?.code;
      throw e;
    }
    return { tool, args, body: r.data.body };
  };
  switch (kind) {
    case "player":
      return call("players_summary", { player_tag: id });
    case "clan":
      return call("clans_roster", { clan_tag: id });
    case "battle":
      return call("battles_query", { battle_id: id });
    case "deck":
      return call("battles_query", { deck_hash: id, limit: 10 });
    case "collection":
      return call("collections_get", { slug: id });
    case "week": {
      const [clan, season, section] = id.split("~");
      const res = await call("war_history", {
        clan_tag: decTag(clan),
        seasons: 12,
      });
      return { ...res, weekKey: { season, section } };
    }
    case "list": {
      const [what, key] = id.split(":");
      if (what === "battles")
        return call("battles_query", {
          player_tag: decTag(key),
          verbosity: "compact",
          include_total: true,
        });
      if (what === "decks")
        return call("battles_decks", { player_tag: decTag(key) });
      if (what === "members")
        return call("clans_roster", { clan_tag: decTag(key) });
      if (what === "weeks")
        return call("war_history", { clan_tag: decTag(key), seasons: 12 });
      if (what === "deckbattles")
        return call("battles_query", {
          deck_hash: key,
          verbosity: "compact",
          include_total: true,
        });
      if (what === "colmembers") return call("collections_get", { slug: key });
      throw new Error(`unknown list ${what}`);
    }
    default:
      throw new Error(`unknown record kind ${kind}`);
  }
}

function callString(tool, args) {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `${tool}(${parts.join(", ")})`;
}

function NicknameEditor({ nick, onSaved }) {
  const [value, setValue] = useState(nick.current ?? "");
  const [busy, setBusy] = useState(false);
  const save = async (v) => {
    setBusy(true);
    await api.explore("elixir_nickname", {
      player_tag: nick.tag,
      nickname: v,
    });
    setBusy(false);
    onSaved();
  };
  return (
    <div className="panel__actions">
      <span style={{ fontSize: "12px", color: "var(--faint)" }}>
        Your nickname
      </span>
      <input
        value={value}
        maxLength={40}
        placeholder="how YOU know them"
        onChange={(e) => setValue(e.target.value)}
        style={{ flex: "0 1 180px" }}
      />
      <button
        className="btn btn--quiet"
        disabled={busy || value.trim() === (nick.current ?? "")}
        onClick={() => save(value.trim() || null)}
      >
        Save
      </button>
      {nick.current && (
        <button
          className="btn--text"
          disabled={busy}
          onClick={() => save(null)}
        >
          Clear
        </button>
      )}
      <span
        style={{ marginLeft: "auto", fontSize: "11.5px", color: "var(--dim)" }}
      >
        private to your account
      </span>
    </div>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn--text"
      onClick={() => {
        navigator.clipboard?.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "copied" : "copy link"}
    </button>
  );
}

export function Explore({ me, navigate, path }) {
  // /explore | /explore/:kind/:id(+)
  const segs = path.split("/").filter(Boolean).slice(1); // after 'explore'
  const kind = segs[0] ?? null;
  const id = segs.slice(1).join("/") ?? null;

  if (!kind) return <Lookup me={me} navigate={navigate} />;
  return (
    <RecordPage key={path} me={me} navigate={navigate} kind={kind} rawId={id} />
  );
}

/* ── Lookup ──────────────────────────────────────────────── */

function Lookup({ me, navigate }) {
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState(null);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [collections, setCollections] = useState([]);
  const [corpus, setCorpus] = useState(null);

  useEffect(() => {
    api.explore("collections_browse").then((r) => {
      if (r.ok && !r.data.is_error)
        setCollections(r.data.body?.collections ?? []);
    });
    api.publicStats().then((r) => {
      if (r.ok) setCorpus(r.data.totals);
    });
  }, []);

  const go = useCallback(
    (kind, recId) => {
      // trail restarts from the lookup
      sessionStorage.removeItem("elixir-trail");
      navigate(`/explore/${kind}/${recId}`);
    },
    [navigate],
  );

  const searchNames = async (query) => {
    const r = await api.explore("players_search", { query, limit: 8 });
    if (!r.ok || r.data.is_error) return false;
    const found = r.data.body?.matches ?? [];
    if (found.length === 0) return false;
    if (found.length === 1) {
      go("player", encTag(found[0].player_tag));
      return true;
    }
    setMatches({ query, found });
    return true;
  };

  const resolve = async (raw) => {
    const query = raw.trim();
    if (!query) return;
    setBusy(true);
    setMiss(null);
    setMatches(null);
    try {
      const slug = query.toLowerCase();
      if (collections.some((c) => c.slug === slug)) {
        go("collection", slug);
        return;
      }
      if (HASH_RE.test(query)) {
        go("deck", query.replace(/^deck:/i, "").toLowerCase());
        return;
      }
      if (WEEK_RE.test(query)) {
        const mine = await api.myClans();
        const home = mine.ok ? mine.data.home_clan?.clan_tag : null;
        if (home) {
          go("list", `weeks:${encTag(home)}`);
          return;
        }
        setMiss(query);
        return;
      }
      if (TAG_RE.test(query)) {
        const tag = normTag(query);
        const p = await api.explore("players_summary", { player_tag: tag });
        if (p.ok && !p.data.is_error) {
          go("player", encTag(tag));
          return;
        }
        const c = await api.explore("clans_roster", { clan_tag: tag });
        if (c.ok && !c.data.is_error) {
          go("clan", encTag(tag));
          return;
        }
        // Not a recorded tag - maybe it was a NAME all along ("tyler").
        if (await searchNames(query)) return;
        setMiss(tag);
        return;
      }
      // Names and nicknames resolve too - players_search ranks YOUR
      // nicknames first, then your people, then the corpus.
      if (await searchNames(query)) return;
      setMiss(query);
    } finally {
      setBusy(false);
    }
  };

  const tryChips = [
    ...(me?.claims?.[0]
      ? [{ label: me.claims[0].player_tag, q: me.claims[0].player_tag }]
      : []),
    ...collections.slice(0, 2).map((c) => ({ label: c.slug, q: c.slug })),
  ];

  return (
    <>
      <div style={{ maxWidth: "620px", padding: "32px 0 8px" }}>
        <div className="hero-title" style={{ fontSize: "30px" }}>
          Do we have it?
        </div>
        <p className="record__sub" style={{ fontSize: "14px" }}>
          Paste a player tag, a clan tag, a deck hash, an ISO week — or just
          type a name or one of your nicknames. Elixir answers what it has
          recorded, then lets you click straight through the records — so when
          your agent says something surprising, you can go check.
        </p>
        <form
          style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            resolve(q);
          }}
        >
          <input
            className="mono"
            placeholder="#20JJJ2CCRU"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{
              flex: "1 1 240px",
              padding: "11px 12px",
              fontSize: "14px",
            }}
          />
          <button
            className="btn"
            disabled={busy}
            style={{ padding: "11px 18px" }}
          >
            {busy ? "Looking…" : "Look up"}
          </button>
        </form>
        {tryChips.length > 0 && (
          <div
            className="mono"
            style={{
              display: "flex",
              gap: "8px",
              marginTop: "10px",
              flexWrap: "wrap",
              color: "var(--dim)",
              fontSize: "11.5px",
            }}
          >
            <span>try:</span>
            {tryChips.map((t) => (
              <a key={t.label} onClick={() => resolve(t.q)}>
                {t.label}
              </a>
            ))}
          </div>
        )}
        {matches && (
          <div
            className="panel"
            style={{ marginTop: "18px", overflow: "hidden" }}
          >
            <div className="panel__head">
              <span className="panel-title">
                {matches.found.length} players match
              </span>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "var(--dim)",
                }}
              >
                &ldquo;{matches.query}&rdquo;
              </span>
            </div>
            {matches.found.map((m) => (
              <a
                key={m.player_tag}
                onClick={() => go("player", encTag(m.player_tag))}
                style={{
                  display: "flex",
                  gap: "10px",
                  padding: "10px 16px",
                  borderTop: "1px solid var(--edge-soft)",
                  fontSize: "12.5px",
                  color: "var(--ink)",
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 600 }}>{m.name ?? "—"}</span>
                {m.nickname && (
                  <span className="tag-chip">&ldquo;{m.nickname}&rdquo;</span>
                )}
                <span className="tag">{m.player_tag}</span>
                <span className="kind-chip">{m.source}</span>
                {m.clan_tag && (
                  <span
                    className="mono"
                    style={{
                      marginLeft: "auto",
                      fontSize: "11px",
                      color: "var(--dim)",
                    }}
                  >
                    {m.clan_tag}
                  </span>
                )}
              </a>
            ))}
          </div>
        )}
        {miss && (
          <div
            className="empty"
            style={{
              marginTop: "18px",
              textAlign: "left",
              padding: "14px 16px",
            }}
          >
            <div
              style={{ display: "flex", gap: "10px", alignItems: "baseline" }}
            >
              <span className="tag">{miss}</span>
              <span
                className="mono"
                style={{
                  color: "var(--red)",
                  fontWeight: 600,
                  fontSize: "11.5px",
                }}
              >
                no records
              </span>
            </div>
            <div className="empty__body" style={{ textAlign: "left" }}>
              Nothing in the corpus matches that tag or name. Elixir only
              records players and clans someone added — it does not crawl the
              game. Add it from{" "}
              <a onClick={() => navigate("/account/overview")}>
                Account ▸ Overview
              </a>{" "}
              and recording starts on the next poll.
            </div>
          </div>
        )}
      </div>

      <div className="cols" style={{ marginTop: "28px" }}>
        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">Recent lookups</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--dim)",
              }}
            >
              this browser only
            </span>
          </div>
          {recent().length === 0 && (
            <div className="panel__body" style={{ color: "var(--faint)" }}>
              Nothing yet.
            </div>
          )}
          {recent().map((r) => (
            <a
              key={r.href}
              onClick={() => navigate(r.href)}
              style={{
                display: "flex",
                gap: "10px",
                padding: "10px 16px",
                borderTop: "1px solid var(--edge-soft)",
                fontSize: "12.5px",
                color: "var(--ink)",
                flexWrap: "wrap",
              }}
            >
              <span className="tag">{r.tag}</span>
              <span style={{ color: "var(--faint)" }}>{r.name}</span>
              <span className="kind-chip">{r.kind}</span>
            </a>
          ))}
        </section>

        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">Collections</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--dim)",
              }}
            >
              curator lists
            </span>
          </div>
          {collections.map((c) => (
            <a
              key={c.slug}
              onClick={() => go("collection", c.slug)}
              style={{
                display: "flex",
                gap: "10px",
                padding: "10px 16px",
                borderTop: "1px solid var(--edge-soft)",
                fontSize: "12.5px",
                color: "var(--ink)",
              }}
            >
              <span>{c.title}</span>
              <span className="tag">{c.slug}</span>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  color: "var(--dim)",
                  fontSize: "11.5px",
                }}
              >
                {c.member_count} members
              </span>
            </a>
          ))}
        </section>

        <section className="panel" style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div className="panel__head">
            <span className="panel-title">What the corpus holds</span>
            <a
              onClick={() => navigate("/data/dashboard")}
              className="mono"
              style={{ marginLeft: "auto", fontSize: "11px" }}
            >
              Data ›
            </a>
          </div>
          <div className="panel__body">
            {corpus && (
              <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
                {[
                  ["battles", corpus.battles],
                  ["players", corpus.players],
                  ["clans", corpus.clans],
                ].map(([label, v]) => (
                  <div key={label}>
                    <div className="stat__label">{label}</div>
                    <div className="stat__value">{v?.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="panel__note">
            Explore is a coverage check, not a report — your agent is the
            analyst.
          </div>
        </section>
      </div>
    </>
  );
}

/* ── Record page ─────────────────────────────────────────── */

function loadTrail() {
  try {
    return JSON.parse(sessionStorage.getItem("elixir-trail") || "[]");
  } catch {
    return [];
  }
}
function saveTrail(t) {
  sessionStorage.setItem("elixir-trail", JSON.stringify(t));
}

function RecordPage({ me, navigate, kind, rawId }) {
  const [state, setState] = useState({ loading: true });
  const [raw, setRaw] = useState(false);
  const [bump, setBump] = useState(0);
  const href = `/explore/${kind}/${rawId}`;

  useEffect(() => {
    let live = true;
    fetchRecord(kind, rawId)
      .then((res) => {
        if (!live) return;
        const view = buildView(kind, rawId, res, me);
        // trail: truncate on revisit, else append
        let trail = loadTrail();
        const at = trail.findIndex((c) => c.href === href);
        if (at >= 0) trail = trail.slice(0, at + 1);
        else trail = [...trail, { href, label: view.crumb }];
        saveTrail(trail);
        pushRecent({
          href,
          tag: view.tag ?? "",
          name: view.title,
          kind: view.kindLabel.toLowerCase(),
        });
        setState({ view, res, trail });
      })
      .catch((err) => {
        if (live) setState({ error: err.message, code: err.code });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, rawId, bump]);

  if (state.loading) return <p style={{ color: "var(--faint)" }}>Loading…</p>;
  if (state.error) {
    return (
      <div className="empty" style={{ maxWidth: "560px", margin: "32px auto" }}>
        <div className="empty__mark">×</div>
        <div className="empty__title">
          {state.code === "not_recorded" || state.code === "not_found"
            ? "No records"
            : "Could not load this record"}
        </div>
        <div className="empty__body">
          {state.error}{" "}
          <a onClick={() => navigate("/explore")}>Back to lookup</a>
        </div>
      </div>
    );
  }

  const { view, res, trail } = state;
  const goRef = (to) => navigate(to);

  return (
    <>
      <div className="trail">
        <a onClick={() => navigate("/explore")}>corpus</a>
        {trail.map((c, i) => (
          <span key={c.href} style={{ display: "contents" }}>
            <span className="trail__sep">/</span>
            <a
              aria-current={i === trail.length - 1 ? "page" : undefined}
              onClick={() => (i === trail.length - 1 ? null : navigate(c.href))}
            >
              {c.label}
            </a>
          </span>
        ))}
      </div>

      <div className="record__head">
        <span className="kind-chip">{view.kindLabel}</span>
        <h1 className="page-title" style={{ fontSize: "24px" }}>
          {view.title}
        </h1>
        {view.tag && <span className="tag">{view.tag}</span>}
        {view.nickEdit?.current && (
          <span className="tag-chip" title="your private nickname">
            &ldquo;{view.nickEdit.current}&rdquo;
          </span>
        )}
        {view.chip && (
          <span className={`chip ${view.chip.cls ?? ""}`}>
            {view.chip.label}
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>
          <Freshness meta={res.body.meta} />
        </span>
      </div>
      {view.sub && <div className="record__sub">{view.sub}</div>}

      {view.table && (
        <section className="panel">
          <div className="tablewrap">
            <table style={{ minWidth: "640px" }}>
              <thead>
                <tr>
                  {view.table.cols.map((c) => (
                    <th key={c.label} className={c.num ? "num" : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={view.table.cols[j].num ? "num" : undefined}
                      >
                        {cell.href ? (
                          <a
                            className={cell.mono ? "tag" : undefined}
                            onClick={() => goRef(cell.href)}
                            style={cell.style}
                          >
                            {cell.text}
                          </a>
                        ) : (
                          <span
                            className={
                              cell.outcome
                                ? `outcome outcome--${cell.outcome}`
                                : cell.mono
                                  ? "tag"
                                  : cell.nil
                                    ? "nil"
                                    : undefined
                            }
                            style={cell.style}
                          >
                            {cell.text}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.note && <div className="panel__note">{view.note}</div>}
        </section>
      )}

      {view.fields && (
        <div className="cols">
          <section className="panel" style={{ flex: "1 1 380px", minWidth: 0 }}>
            <div className="panel__head">
              <span className="panel-title">Fields</span>
              <span
                className="mono"
                style={{
                  marginLeft: "auto",
                  fontSize: "11px",
                  color: "var(--dim)",
                }}
              >
                references are links
              </span>
            </div>
            <dl className="fields" style={{ margin: 0 }}>
              {view.fields.map((f) => (
                <span key={f.label} style={{ display: "contents" }}>
                  <dt>{f.label}</dt>
                  <dd>
                    {f.href ? (
                      <a
                        className={f.mono ? "tag" : undefined}
                        onClick={() => goRef(f.href)}
                      >
                        {f.value}
                      </a>
                    ) : (
                      <span className={f.mono ? "tag" : undefined}>
                        {f.value}
                      </span>
                    )}{" "}
                    {f.hint && <span className="hint">{f.hint}</span>}
                    {f.sample && <span className="sample">{f.sample}</span>}
                  </dd>
                </span>
              ))}
            </dl>
            {view.nickEdit && (
              <NicknameEditor
                nick={view.nickEdit}
                onSaved={() => setBump((b) => b + 1)}
              />
            )}
            {view.note && <div className="panel__note">{view.note}</div>}
          </section>

          {view.tiles?.length > 0 && (
            <section
              className="panel"
              style={{ flex: "1 1 280px", minWidth: 0 }}
            >
              <div className="panel__head">
                <span className="panel-title">What we have</span>
              </div>
              <div className="tiles">
                {view.tiles.map((t) =>
                  t.href ? (
                    <a
                      key={t.label}
                      className="tile"
                      href={t.href}
                      onClick={(e) => {
                        e.preventDefault();
                        goRef(t.href);
                      }}
                    >
                      <span
                        className={
                          typeof t.value === "number"
                            ? "stat__value"
                            : "stat__value--text"
                        }
                        style={{
                          fontSize:
                            typeof t.value === "number" ? "22px" : undefined,
                        }}
                      >
                        {typeof t.value === "number"
                          ? t.value.toLocaleString()
                          : t.value}
                      </span>
                      <span className="tile__label">{t.label} ›</span>
                    </a>
                  ) : (
                    <div key={t.label} className="tile">
                      <span
                        className="stat__value"
                        style={{ fontSize: "22px" }}
                      >
                        {typeof t.value === "number"
                          ? t.value.toLocaleString()
                          : t.value}
                      </span>
                      <span className="tile__label">{t.label}</span>
                    </div>
                  ),
                )}
              </div>
            </section>
          )}
        </div>
      )}

      <section className="panel" style={{ marginTop: "20px" }}>
        <div className="toolbar">
          <code>{callString(res.tool, res.args)}</code>
          <button className="btn--text" onClick={() => setRaw(!raw)}>
            {raw ? "hide raw" : "raw JSON"}
          </button>
          <CopyLink />
        </div>
        {raw && <pre className="raw">{JSON.stringify(res.body, null, 1)}</pre>}
        <div className="panel__note">
          One tool call produced this page — the same one your agent makes, with
          your entitlements applied.
        </div>
      </section>
    </>
  );
}

/* ── View builders: shape each record from the REAL payload ── */

function buildView(kind, rawId, res, me) {
  const b = res.body;
  const meFirstTag = me?.claims?.find((c) => c.is_primary)?.player_tag;
  const fmt = (t) =>
    t ? new Date(t).toISOString().replace("T", " ").slice(0, 16) + "Z" : "—";

  if (kind === "player") {
    const tag = decTag(rawId);
    const yours = tag === meFirstTag;
    const fields = [];
    if (b.name !== undefined)
      fields.push({ label: "name", value: b.name ?? "—" });
    fields.push({ label: "player_tag", value: tag, mono: true });
    if (b.clan?.tag ?? b.clan_tag)
      fields.push({
        label: "clan_tag",
        value: b.clan?.tag ?? b.clan_tag,
        mono: true,
        href: `/explore/clan/${encTag(b.clan?.tag ?? b.clan_tag)}`,
        hint: b.clan?.name,
      });
    if (b.trophies !== undefined)
      fields.push({ label: "trophies", value: String(b.trophies) });
    if (b.last_30_days) {
      const r = b.last_30_days;
      fields.push({
        label: "last 30 days",
        value: `${r.wins}–${r.losses}${r.draws ? `–${r.draws}` : ""}`,
        sample:
          (r.wins ?? 0) + (r.losses ?? 0) < 10
            ? "n<10"
            : `n=${r.wins + r.losses}`,
      });
    }
    if (b.most_played_deck?.deck_hash)
      fields.push({
        label: "top deck",
        value: b.most_played_deck.deck_hash.slice(0, 12) + "…",
        mono: true,
        href: `/explore/deck/${b.most_played_deck.deck_hash}`,
      });
    return {
      kindLabel: "PLAYER",
      crumb: `${b.nickname ?? b.name ?? tag} ${tag}`,
      title: (yours ? "★ " : "") + (b.name ?? tag),
      tag,
      nickEdit: { tag, current: b.nickname ?? null },
      chip: b.meta?.recording_active_since
        ? { label: "recording", cls: "chip--active" }
        : { label: "observed only" },
      sub: "What the recorder holds for this player. Coverage tiles open the underlying records.",
      fields,
      tiles: [
        {
          label: "battles",
          value: "browse",
          href: `/explore/list/battles:${encTag(tag)}`,
        },
        {
          label: "decks",
          value: "browse",
          href: `/explore/list/decks:${encTag(tag)}`,
        },
      ],
      note: b.note,
    };
  }

  if (kind === "clan") {
    const tag = decTag(rawId);
    const members = b.members ?? [];
    return {
      kindLabel: "CLAN",
      crumb: `${b.name ?? tag} ${tag}`,
      title: b.name ?? tag,
      tag,
      chip: { label: "recorded", cls: "chip--active" },
      sub: "The clan as recorded: roster and war history.",
      fields: [
        { label: "name", value: b.name ?? "—" },
        { label: "clan_tag", value: tag, mono: true },
        { label: "members", value: String(members.length) },
      ],
      tiles: [
        {
          label: "members",
          value: members.length,
          href: `/explore/list/members:${encTag(tag)}`,
        },
        {
          label: "war weeks",
          value: "browse",
          href: `/explore/list/weeks:${encTag(tag)}`,
        },
      ],
      note: b.note,
    };
  }

  if (kind === "battle") {
    const bt = b.battles?.[0];
    if (!bt) {
      const e = new Error("battle not found");
      e.code = "not_found";
      throw e;
    }
    const myTag = bt.me.player_tag ?? b.player_tag;
    const opp = bt.opponents?.[0];
    const fields = [
      { label: "battle_time", value: fmt(bt.battle_time) },
      { label: "type", value: bt.type },
      { label: "game_mode", value: bt.game_mode?.name ?? "—" },
      ...(bt.arena ? [{ label: "arena", value: bt.arena }] : []),
      {
        label: "player",
        value: myTag,
        mono: true,
        href: `/explore/player/${encTag(myTag)}`,
      },
      ...(opp
        ? [
            {
              label: "opponent_tag",
              value: opp.player_tag,
              mono: true,
              href: `/explore/player/${encTag(opp.player_tag)}`,
              hint: opp.name,
            },
          ]
        : []),
      { label: "crowns", value: `${bt.me.crowns}–${opp?.crowns ?? "?"}` },
      ...(bt.me.trophy_change !== null && bt.me.trophy_change !== undefined
        ? [{ label: "trophy_change", value: String(bt.me.trophy_change) }]
        : []),
      ...(bt.me.deck_hash
        ? [
            {
              label: "deck_hash",
              value: bt.me.deck_hash.slice(0, 16) + "…",
              mono: true,
              href: `/explore/deck/${bt.me.deck_hash}`,
            },
          ]
        : []),
      ...(opp?.deck_hash
        ? [
            {
              label: "opp deck_hash",
              value: opp.deck_hash.slice(0, 16) + "…",
              mono: true,
              href: `/explore/deck/${opp.deck_hash}`,
            },
          ]
        : []),
    ];
    return {
      kindLabel: "BATTLE",
      crumb: `battle ${fmt(bt.battle_time)}`,
      title: `battle ${fmt(bt.battle_time)}`,
      tag: null,
      chip: bt.me.outcome
        ? {
            label: bt.me.outcome,
            cls:
              bt.me.outcome === "win"
                ? "chip--active"
                : bt.me.outcome === "loss"
                  ? "chip--error"
                  : "",
          }
        : null,
      sub: `As recorded from ${myTag}'s perspective. A battle has no children — every value here is the record itself.`,
      fields,
      tiles: [],
      note: b.card_legend,
    };
  }

  if (kind === "deck") {
    const ds = b.deck_stats ?? {};
    const cards =
      b.battles?.[0]?.me?.deck?.cards?.map((c) => c.name).join(", ") ?? null;
    return {
      kindLabel: "DECK",
      crumb: `deck ${rawId.slice(0, 10)}…`,
      title: `deck ${rawId.slice(0, 10)}…`,
      tag: null,
      chip: { label: "public" },
      sub: "One exact deck identity across the whole corpus.",
      fields: [
        { label: "deck_hash", value: rawId, mono: true },
        ...(cards ? [{ label: "cards", value: cards }] : []),
        { label: "battles", value: String(ds.battles ?? 0) },
        { label: "record", value: `${ds.wins ?? 0}–${ds.losses ?? 0}` },
        { label: "distinct players", value: String(ds.players ?? 0) },
        { label: "first used", value: fmt(ds.first_used) },
        { label: "last used", value: fmt(ds.last_used) },
      ],
      tiles: [
        {
          label: "battles with this deck",
          value: ds.battles ?? 0,
          href: `/explore/list/deckbattles:${rawId}`,
        },
      ],
      note: b.deck_note,
    };
  }

  if (kind === "collection") {
    const members = b.members ?? [];
    return {
      kindLabel: "COLLECTION",
      crumb: b.title ?? rawId,
      title: b.title ?? rawId,
      tag: rawId,
      chip: { label: b.kind ?? "player" },
      sub:
        b.description ??
        "A curator's list — membership is editorial, never a global fact.",
      table: {
        cols: [
          { label: "MEMBER" },
          { label: "TAG" },
          { label: "TROPHIES", num: true },
          { label: "RECORDING" },
        ],
        rows: members.map((m) => [
          {
            text: m.name ?? "—",
            href: m.player_tag
              ? `/explore/player/${encTag(m.player_tag)}`
              : undefined,
          },
          { text: m.player_tag ?? m.clan_tag, mono: true },
          m.trophies !== undefined && m.trophies !== null
            ? { text: String(m.trophies) }
            : { text: "—", nil: true },
          {
            text: m.recording ? "recording" : "observed",
            style: m.recording
              ? { color: "var(--green)" }
              : { color: "var(--faint)" },
          },
        ]),
      },
      note: b.note,
    };
  }

  if (kind === "week") {
    const wk = (b.weeks ?? []).find(
      (w) =>
        String(w.season_id) === res.weekKey?.season &&
        String(w.section_index) === res.weekKey?.section,
    );
    if (!wk) {
      const e = new Error("war week not in the recorded log");
      e.code = "not_found";
      throw e;
    }
    return {
      kindLabel: "WAR WEEK",
      crumb: `S${wk.season_id} W${Number(wk.section_index) + 1}`,
      title: `Season ${wk.season_id}, week ${Number(wk.section_index) + 1}`,
      tag: b.clan_tag,
      chip: wk.is_colosseum
        ? { label: "colosseum", cls: "chip--pending" }
        : null,
      sub: "One recorded river-race week for this clan.",
      fields: [
        { label: "season", value: String(wk.season_id) },
        { label: "week", value: String(Number(wk.section_index) + 1) },
        ...(wk.rank ? [{ label: "final rank", value: String(wk.rank) }] : []),
        ...(wk.fame !== undefined
          ? [{ label: "boat fame", value: String(wk.fame) }]
          : []),
        {
          label: "clan_tag",
          value: b.clan_tag,
          mono: true,
          href: `/explore/clan/${encTag(b.clan_tag)}`,
        },
      ],
      tiles: [],
      note: b.note,
    };
  }

  if (kind === "list") return buildListView(rawId, res);
  throw new Error(`unknown kind ${kind}`);
}

function buildListView(rawId, res) {
  const [what, key] = rawId.split(":");
  const b = res.body;
  const fmt = (t) =>
    t ? new Date(t).toISOString().slice(5, 16).replace("T", " ") + "Z" : "—";

  if (what === "battles" || what === "deckbattles") {
    const rows = (b.battles ?? []).map((bt) => {
      const myTag = bt.me.player_tag ?? b.player_tag;
      const opp = bt.opponents?.[0];
      return [
        {
          text: fmt(bt.battle_time),
          mono: true,
          href: bt.battle_id ? `/explore/battle/${bt.battle_id}` : undefined,
        },
        ...(what === "deckbattles"
          ? [
              {
                text: myTag,
                mono: true,
                href: `/explore/player/${encTag(myTag)}`,
              },
            ]
          : [
              opp
                ? {
                    text: `${opp.name ?? opp.player_tag}`,
                    href: `/explore/player/${encTag(opp.player_tag)}`,
                  }
                : { text: "—", nil: true },
            ]),
        { text: bt.me.outcome ?? "—", outcome: bt.me.outcome },
        { text: bt.game_mode?.name ?? bt.type },
        bt.me.deck_hash
          ? {
              text: bt.me.deck_hash.slice(0, 10) + "…",
              mono: true,
              href: `/explore/deck/${bt.me.deck_hash}`,
            }
          : { text: "—", nil: true },
        bt.me.trophy_change !== null && bt.me.trophy_change !== undefined
          ? { text: String(bt.me.trophy_change) }
          : { text: "—", nil: true },
      ];
    });
    return {
      kindLabel: "BATTLES",
      crumb: "battles",
      title:
        what === "deckbattles"
          ? `battles · deck ${key.slice(0, 10)}…`
          : `battles · ${decTag(key)}`,
      tag: what === "deckbattles" ? null : decTag(key),
      chip: null,
      sub: b.total_count
        ? `${b.total_count.toLocaleString()} recorded battles match; newest first, 25 per page.`
        : "Newest first, 25 per page.",
      table: {
        cols: [
          { label: "TIME" },
          { label: what === "deckbattles" ? "PLAYER" : "VS" },
          { label: "RESULT" },
          { label: "MODE" },
          { label: "DECK" },
          { label: "ΔTROPHIES", num: true },
        ],
        rows,
      },
      note: b.warnings?.join(" ") ?? b.card_legend ?? b.deck_note,
    };
  }

  if (what === "decks") {
    return {
      kindLabel: "DECKS",
      crumb: "decks",
      title: `decks · ${decTag(key)}`,
      tag: decTag(key),
      sub: `${b.total_battles_in_window?.toLocaleString?.() ?? ""} battles across ${b.decks?.length ?? 0} distinct decks in the window.`,
      table: {
        cols: [
          { label: "DECK" },
          { label: "BATTLES", num: true },
          { label: "W", num: true },
          { label: "L", num: true },
          { label: "SHARE", num: true },
          { label: "LAST USED" },
        ],
        rows: (b.decks ?? []).map((d) => [
          {
            text:
              d.cards?.map((c) => c.name).join(", ") ||
              d.deck_hash.slice(0, 12),
            href: `/explore/deck/${d.deck_hash}`,
          },
          { text: String(d.battles) },
          { text: String(d.wins) },
          { text: String(d.losses) },
          {
            text:
              d.share_of_battles != null
                ? `${(d.share_of_battles * 100).toFixed(0)}%`
                : "—",
          },
          { text: fmt(d.last_used), mono: true },
        ]),
      },
      note: b.note,
    };
  }

  if (what === "members") {
    return {
      kindLabel: "MEMBERS",
      crumb: "members",
      title: `members · ${b.name ?? decTag(key)}`,
      tag: decTag(key),
      sub: "Open membership as recorded.",
      table: {
        cols: [
          { label: "MEMBER" },
          { label: "TAG" },
          { label: "ROLE" },
          { label: "TROPHIES", num: true },
          { label: "LAST BATTLE" },
        ],
        rows: (b.members ?? []).map((m) => [
          {
            text: m.name ?? "—",
            href: `/explore/player/${encTag(m.player_tag)}`,
          },
          { text: m.player_tag, mono: true },
          { text: m.role ?? "—" },
          m.trophies != null
            ? { text: String(m.trophies) }
            : { text: "—", nil: true },
          m.last_battle
            ? { text: fmt(m.last_battle), mono: true }
            : { text: "never", nil: true },
        ]),
      },
      note: b.note,
    };
  }

  if (what === "weeks") {
    return {
      kindLabel: "WAR WEEKS",
      crumb: "weeks",
      title: `war weeks · ${decTag(key)}`,
      tag: decTag(key),
      sub: "Recorded river-race weeks, newest first.",
      table: {
        cols: [
          { label: "WEEK" },
          { label: "RANK", num: true },
          { label: "FAME", num: true },
          { label: "" },
        ],
        rows: (b.weeks ?? []).map((w) => [
          {
            text: `S${w.season_id} W${Number(w.section_index) + 1}${w.is_colosseum ? " · colosseum" : ""}`,
            mono: true,
            href: `/explore/week/${encTag(decTag(key))}~${w.season_id}~${w.section_index}`,
          },
          w.rank != null ? { text: String(w.rank) } : { text: "—", nil: true },
          w.fame != null ? { text: String(w.fame) } : { text: "—", nil: true },
          { text: "" },
        ]),
      },
      note: b.note,
    };
  }

  if (what === "colmembers") {
    return buildView("collection", key, res);
  }
  throw new Error(`unknown list ${what}`);
}
