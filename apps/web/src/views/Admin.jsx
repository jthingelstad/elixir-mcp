import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { ago, beatCls, freshCls, secsSince } from "../lib/time.js";

export function Admin({ me, page = "requests", navigate, itemId }) {
  const [requests, setRequests] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [usage, setUsage] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [svcTokens, setSvcTokens] = useState([]);
  const [newToken, setNewToken] = useState(null);
  // Provision-click outcome per gateway: the token is staged server-side
  // for the operator's one-time reveal, so Admin must SAY so (or show the
  // error) instead of silently refreshing.
  const [staged, setStaged] = useState({});
  const [svcName, setSvcName] = useState("");

  const load = useCallback(async () => {
    const [r, g, u, f, st] = await Promise.all([
      api.adminRequests(),
      api.adminGateways(),
      api.adminUsage(),
      api.adminFeedback(),
      api.adminServiceTokens(),
    ]);
    if (r.ok) setRequests(r.data.requests);
    if (g.ok) setGateways(g.data.gateways);
    if (u.ok) setUsage(u.data);
    if (f.ok) setFeedback(f.data.feedback);
    if (st.ok) setSvcTokens(st.data.tokens);
  }, []);

  useEffect(() => {
    if (me?.is_admin) load();
  }, [me, load]);

  if (!me?.is_admin) return <p className="notice">Admins only.</p>;

  // Detail routes (detail-views sweep, Jamie 2026-09-05): one item,
  // one addressable page.
  if (page === "feedback" && itemId)
    return <AdminFeedbackItem id={itemId} navigate={navigate} />;
  if (page === "collections" && itemId)
    return <CollectionEditor slug={itemId} navigate={navigate} />;

  return (
    <>
      <div className="panel" hidden={page !== "requests"}>
        <div className="panel__head">
          <span className="panel-title">Access requests</span>
        </div>
        {requests.length === 0 && <p>Queue is empty.</p>}
        {requests.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th>Note</th>
                <th>Requested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.email_hash}>
                  <td>
                    {r.requested_player_tag ? (
                      <code>{r.requested_player_tag}</code>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{r.request_note ?? ""}</td>
                  <td>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>
                    <button
                      onClick={async () => {
                        await api.adminDecide(r.email_hash, "approved");
                        load();
                      }}
                    >
                      Approve
                    </button>{" "}
                    <button
                      className="btn--text"
                      onClick={async () => {
                        await api.adminDecide(r.email_hash, "denied");
                        load();
                      }}
                    >
                      Deny
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {usage && (
        <div className="panel" hidden={page !== "usage"}>
          <div className="panel__head">
            <span className="panel-title">MCP usage (7 days)</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Today</th>
                <th>7d</th>
                <th>Errors</th>
                <th>Quota</th>
                <th>Last call</th>
              </tr>
            </thead>
            <tbody>
              {usage.accounts.map((a) => (
                <tr key={a.email_hash}>
                  <td>
                    {a.primary_tag ? (
                      <code>{a.primary_tag}</code>
                    ) : (
                      <code>{a.email_hash.slice(0, 10)}…</code>
                    )}
                  </td>
                  <td>{a.calls_today}</td>
                  <td>{a.calls_7d}</td>
                  <td>{a.errors_7d || ""}</td>
                  <td>{a.mcp_daily_quota ?? "default"}</td>
                  <td>
                    {a.last_call
                      ? new Date(a.last_call).toLocaleString()
                      : "never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.budget && (
            <p className="notice">
              Budget: {usage.budget.fetches_24h.toLocaleString()} fetches /{" "}
              {usage.budget.capacity_24h.toLocaleString()} capacity (24h) across{" "}
              {usage.budget.subjects_24h} subjects. Heaviest:{" "}
              {usage.budget.top_subjects
                .slice(0, 5)
                .map((t) => `${t.entity_key} (${t.fetches})`)
                .join(", ")}
            </p>
          )}
          {usage.tools.length > 0 && (
            <>
              <h3>Tools (7 days)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Tool</th>
                    <th>Calls</th>
                    <th>Errors</th>
                    <th>Avg ms</th>
                    <th>Truncated</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.tools.map((t) => (
                    <tr key={t.tool}>
                      <td>
                        <code>{t.tool}</code>
                      </td>
                      <td>{t.calls}</td>
                      <td>{t.errors || ""}</td>
                      <td>{t.avg_ms}</td>
                      <td>{t.truncated || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      <div className="panel" hidden={page !== "feedback"}>
        <div className="panel__head">
          <span className="panel-title">Feedback</span>
        </div>
        {feedback.length === 0 && <p>No feedback yet.</p>}
        {feedback.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th>Via</th>
                <th>Category</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.feedback_id}>
                  <td>{f.from_player ? <code>{f.from_player}</code> : "—"}</td>
                  <td>{f.surface}</td>
                  <td>{f.category}</td>
                  <td>
                    <a
                      onClick={() =>
                        navigate(`/admin/feedback/${f.feedback_id}`)
                      }
                    >
                      {f.message.length > 90
                        ? f.message.slice(0, 90) + "…"
                        : f.message}
                    </a>
                    {f.response ? (
                      <span
                        className="mono"
                        style={{
                          marginLeft: "6px",
                          fontSize: "10.5px",
                          color: "var(--dim)",
                        }}
                      >
                        responded
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <select
                      value={f.status}
                      onChange={async (e) => {
                        await api.adminFeedbackStatus(
                          f.feedback_id,
                          e.target.value,
                        );
                        load();
                      }}
                    >
                      {["new", "seen", "planned", "done", "declined"].map(
                        (st) => (
                          <option key={st} value={st}>
                            {st}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" hidden={page !== "tokens"}>
        <div className="panel__head">
          <span className="panel-title">Service tokens</span>
          <span
            className="mono"
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--red)",
            }}
          >
            shown once at issue — never recoverable
          </span>
        </div>
        <p>
          Long-lived API tokens for services (elixir-bot). Calls audit as{" "}
          <code>svc:&lt;name&gt;</code>.
        </p>
        {newToken && (
          <p className="notice">
            <strong>{newToken.name}</strong>: <code>{newToken.token}</code>
            <br />
            Shown once — store it now.
          </p>
        )}
        {svcTokens.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Calls (7d)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {svcTokens.map((t) => (
                <tr key={t.token_id}>
                  <td>
                    <code>{t.name}</code>
                    {t.revoked_at ? " (revoked)" : ""}
                  </td>
                  <td>{new Date(t.created_at).toLocaleDateString()}</td>
                  <td>
                    {t.last_used_at
                      ? new Date(t.last_used_at).toLocaleString()
                      : "never"}
                  </td>
                  <td>{t.calls_7d}</td>
                  <td>
                    {!t.revoked_at && (
                      <button
                        className="btn--text"
                        onClick={async () => {
                          await api.adminServiceTokenAction({
                            revoke_token_id: t.token_id,
                          });
                          load();
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await api.adminServiceTokenAction({ name: svcName });
            if (r.ok) {
              setNewToken(r.data);
              setSvcName("");
              load();
            }
          }}
        >
          <label>
            Issue token
            <input
              placeholder="elixir-bot"
              value={svcName}
              onChange={(e) => setSvcName(e.target.value)}
            />
          </label>
          <button disabled={!svcName.trim()}>Issue</button>
        </form>
      </div>

      <div className="panel" hidden={page !== "gateways"}>
        <div className="panel__head">
          <span className="panel-title">Gateways</span>
        </div>
        <p>
          Lifecycle: pending → probation (key issued, installed, heartbeating) →
          active. Issuing the IP-bound CR key and IAM user is manual — see
          docs/OPERATORS.md.
        </p>
        <p style={{ color: "var(--dim)" }}>
          Heartbeat is any contact with the door, including polls that found no
          work; Data is the last payload we accepted and recorded. Both are the
          same relative clock the public status page shows.
        </p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Channel</th>
              <th>Heartbeat</th>
              <th>Data</th>
              <th>Fetches (1h)</th>
              <th>Points</th>
              <th>Version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gateways.map((g) => {
              const next = {
                pending: "probation",
                probation: "activate",
                active: "drain",
                draining: "probation",
              }[g.status];
              const label = {
                probation: "Begin probation",
                activate: "Activate",
                drain: "Drain",
              }[next];
              return (
                <tr key={g.gateway_id}>
                  <td>{g.name}</td>
                  <td>
                    <span
                      className={`chip ${g.status === "active" ? "chip--active" : g.status === "pending" ? "chip--pending" : ""}`}
                    >
                      {g.status}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`chip ${g.channel === "live" ? "chip--active" : ""}`}
                    >
                      {g.channel ?? "bulk"}
                    </span>
                  </td>
                  <td>
                    <span className={beatCls(secsSince(g.last_heartbeat_at))}>
                      {ago(g.last_heartbeat_at)}
                    </span>
                  </td>
                  <td>
                    <span className={freshCls(secsSince(g.last_success_at))}>
                      {ago(g.last_success_at)}
                    </span>
                  </td>
                  <td>{g.fetches_last_hour}</td>
                  <td>{Number(g.fetch_points).toLocaleString()}</td>
                  <td>
                    <code>{g.last_seen_sha ?? "—"}</code>
                  </td>
                  <td>
                    {next && (
                      <button
                        className="btn--text"
                        onClick={async () => {
                          await api.adminGatewayAction(g.gateway_id, next);
                          load();
                        }}
                      >
                        {label ?? next}
                      </button>
                    )}{" "}
                    {g.status !== "revoked" && (
                      <button
                        className="btn--text"
                        onClick={async () => {
                          const r = await api.adminGatewayAction(
                            g.gateway_id,
                            "provision_token",
                          );
                          setStaged((s) => ({
                            ...s,
                            [g.gateway_id]: r.ok
                              ? { ok: true }
                              : { error: r.data?.error ?? `HTTP ${r.status}` },
                          }));
                          load();
                        }}
                      >
                        Provision token
                      </button>
                    )}{" "}
                    {g.status !== "revoked" && (
                      <button
                        className="btn--text"
                        onClick={async () => {
                          if (
                            window.confirm(
                              `Revoke gateway "${g.name}"? Ingest stops accepting its results immediately.`,
                            )
                          ) {
                            await api.adminGatewayAction(
                              g.gateway_id,
                              "revoke",
                            );
                            load();
                          }
                        }}
                      >
                        Revoke
                      </button>
                    )}
                    {(staged[g.gateway_id] || g.provision_ready) && (
                      <div>
                        <small>
                          {staged[g.gateway_id]?.error ? (
                            <>
                              Provisioning failed: {staged[g.gateway_id].error}
                            </>
                          ) : g.owner_is_me ? (
                            <>
                              Token staged.{" "}
                              <button
                                className="btn--text"
                                onClick={() => navigate("/account/collector")}
                              >
                                Reveal it once on your Collector page →
                              </button>
                            </>
                          ) : (
                            <>
                              Token staged — the operator reveals it once on
                              their Collector page.
                            </>
                          )}
                        </small>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AdminCollections page={page} navigate={navigate} />

      <AdminAccounts page={page} />
    </>
  );
}

/** Role management: the entitlement ladder applied to real accounts.
 *  Pending upgrade requests surface here; the picker grants them. */
function AdminAccounts({ page }) {
  const [accounts, setAccounts] = useState([]);
  const [settable, setSettable] = useState([]);
  const load = useCallback(async () => {
    const r = await api.adminAccounts();
    if (r.ok) {
      setAccounts(r.data.accounts ?? []);
      setSettable(r.data.settable_roles ?? []);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="panel" hidden={page !== "accounts"}>
      <div className="panel__head">
        <span className="panel-title">Accounts</span>
      </div>
      <p>
        Tiers set collection slots and call budgets — never read access. Upgrade
        requests land in Feedback and are flagged here.
      </p>
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Status</th>
            <th>Tier</th>
            <th>Recording</th>
            <th>Collector</th>
            <th>Overrides</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.account_id}>
              <td title={a.account_id}>
                <code>{a.email_hash.slice(0, 10)}</code>
                {a.is_owner ? " (owner)" : ""}
              </td>
              <td>{a.status}</td>
              <td>
                {settable.includes(a.role) ? (
                  <select
                    value={a.role}
                    onChange={async (e) => {
                      await api.adminSetRole(a.account_id, e.target.value);
                      load();
                    }}
                  >
                    {settable.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <strong>{a.role}</strong>
                )}
                {a.pending_role_request ? (
                  <span
                    className="chip chip--pending"
                    title={`Upgrade requested — feedback #${a.pending_role_request}`}
                    style={{ marginLeft: "0.4rem" }}
                  >
                    requested
                  </span>
                ) : null}
              </td>
              <td>
                {a.players_recording}p / {a.clans_recording}c
              </td>
              <td>{a.operator ? "yes" : "—"}</td>
              <td className="panel__note">
                {[
                  a.max_player_recordings != null &&
                    `players=${a.max_player_recordings}`,
                  a.mcp_daily_quota != null && `calls=${a.mcp_daily_quota}`,
                  a.live_daily_quota != null && `live=${a.live_daily_quota}`,
                ]
                  .filter(Boolean)
                  .join(" ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Collections curation (Jamie, 2026-09-05): owner-only create/manage. */
function AdminCollections({ page, navigate }) {
  const [cols, setCols] = useState([]);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    kind: "player",
    description: "",
    visibility: "public",
  });
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const r = await api.adminCollections();
    if (r.ok) setCols(r.data.collections ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (body) => {
    setErr("");
    const r = await api.adminCollectionAction(body);
    if (!r.ok) setErr(r.data?.message ?? r.data?.error ?? "failed");
    await load();
  };

  return (
    <div className="panel" hidden={page !== "collections"}>
      <div className="panel__head">
        <span className="panel-title">Collections</span>
      </div>
      <p>
        Curated groupings served to every user via{" "}
        <code>collections_browse</code> and Explore ▸ Collections.
      </p>
      {err && <p className="field-error">{err}</p>}
      {cols.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Title</th>
              <th>Kind</th>
              <th>Visibility</th>
              <th>Members</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.slug}>
                <td>
                  <a onClick={() => navigate(`/admin/collections/${c.slug}`)}>
                    <code>{c.slug}</code> ›
                  </a>
                </td>
                <td>{c.title}</td>
                <td>{c.kind}</td>
                <td>{c.visibility}</td>
                <td>{c.member_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const slug = form.slug;
          await act({ action: "upsert", ...form });
          setForm({ ...form, slug: "", title: "", description: "" });
          navigate(`/admin/collections/${slug}`);
        }}
        style={{ marginTop: "1rem" }}
      >
        <strong>New collection</strong>{" "}
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
        <input
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          style={{ width: "14rem" }}
        />{" "}
        <button disabled={!form.slug || !form.title}>Create</button>
      </form>
    </div>
  );
}

/** One feedback item, admin lane: the full record plus the moderation
 *  acts — status and the maintainer response (which lands in the
 *  filer's event feed). The response box finally exposes what the API
 *  supported all along. */
function AdminFeedbackItem({ id, navigate }) {
  const [item, setItem] = useState(null);
  const [missed, setMissed] = useState(false);
  const [response, setResponse] = useState("");
  const [saved, setSaved] = useState("");
  const load = useCallback(async () => {
    const r = await api.adminFeedback();
    const found = (r.data?.feedback ?? []).find(
      (f) => String(f.feedback_id) === String(id),
    );
    if (found) {
      setItem(found);
      setResponse((prev) => prev || found.response || "");
    } else setMissed(true);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);
  if (missed)
    return (
      <div className="panel">
        <div className="panel__body">
          No feedback item #{id}.{" "}
          <a onClick={() => navigate("/admin/feedback")}>All feedback ›</a>
        </div>
      </div>
    );
  if (!item) return <p style={{ color: "var(--faint)" }}>Loading…</p>;
  const setStatus = async (status, withResponse) => {
    setSaved("");
    const r = await api.adminFeedbackStatus(
      item.feedback_id,
      status,
      withResponse ? response.trim() || undefined : undefined,
    );
    if (r.ok) {
      setSaved(withResponse ? "Response sent." : "Status saved.");
      load();
    }
  };
  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <a
          className="mono"
          style={{ fontSize: "12px" }}
          onClick={() => navigate("/admin/feedback")}
        >
          ‹ All feedback
        </a>
      </p>
      <section className="panel" style={{ maxWidth: "680px" }}>
        <div className="panel__head">
          <span className="mono" style={{ color: "var(--dim)" }}>
            #{item.feedback_id}
          </span>
          <span className="tag-chip">{item.category}</span>
          <span
            className={`chip ${item.status === "done" ? "chip--active" : item.status === "new" ? "chip--pending" : ""}`}
          >
            {item.status}
          </span>
          <span
            className="mono"
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--dim)",
            }}
          >
            {item.from_player ?? "unknown filer"} · via {item.surface} ·{" "}
            {item.created_at?.slice(0, 10)}
          </span>
        </div>
        <div
          className="panel__body"
          style={{ fontSize: "13px", lineHeight: 1.6 }}
        >
          {item.message}
        </div>
        {item.context && (
          <div
            className="panel__body"
            style={{ borderTop: "1px solid var(--edge-soft)" }}
          >
            <div
              className="mono"
              style={{
                fontSize: "11px",
                color: "var(--dim)",
                marginBottom: "6px",
              }}
            >
              CONTEXT
            </div>
            <pre
              className="mono"
              style={{
                fontSize: "11.5px",
                overflowX: "auto",
                margin: 0,
              }}
            >
              {JSON.stringify(item.context, null, 2)}
            </pre>
          </div>
        )}
        <div
          className="panel__body"
          style={{
            borderTop: "1px solid var(--edge-soft)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <label>
            <span className="label">Maintainer response</span>
            <textarea
              rows={4}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Lands in the filer's feed as feedback_responded."
              style={{ width: "100%" }}
            />
          </label>
          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <select
              value={item.status}
              onChange={(e) => setStatus(e.target.value, false)}
            >
              {["new", "seen", "planned", "done", "declined"].map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!response.trim()}
              onClick={() =>
                setStatus(item.status === "new" ? "seen" : item.status, true)
              }
            >
              Send response
            </button>
            {saved && (
              <span style={{ fontSize: "12px", color: "var(--faint)" }}>
                {saved}
              </span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

/** Open-and-edit collection page (Jamie: "the add remove is very odd,
 *  there should be a way to just open the collection and edit it
 *  there"). Members are rows with their own remove; the meta form
 *  edits in place; Explore shows the same collection as users see it. */
function CollectionEditor({ slug, navigate }) {
  const [col, setCol] = useState(null);
  const [missed, setMissed] = useState(false);
  const [meta, setMeta] = useState(null);
  const [addText, setAddText] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await api.adminCollections();
    const found = (r.data?.collections ?? []).find((c) => c.slug === slug);
    if (found) {
      setCol(found);
      setMeta(
        (prev) =>
          prev ?? {
            title: found.title,
            description: found.description ?? "",
            visibility: found.visibility,
          },
      );
    } else setMissed(true);
  }, [slug]);
  useEffect(() => {
    load();
  }, [load]);
  const act = async (body) => {
    setErr("");
    const r = await api.adminCollectionAction(body);
    if (!r.ok) setErr(r.data?.message ?? r.data?.error ?? "failed");
    await load();
  };
  if (missed)
    return (
      <div className="panel">
        <div className="panel__body">
          No collection “{slug}”.{" "}
          <a onClick={() => navigate("/admin/collections")}>
            All collections ›
          </a>
        </div>
      </div>
    );
  if (!col || !meta) return <p style={{ color: "var(--faint)" }}>Loading…</p>;
  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <a
          className="mono"
          style={{ fontSize: "12px" }}
          onClick={() => navigate("/admin/collections")}
        >
          ‹ All collections
        </a>
      </p>
      {err && <p className="field-error">{err}</p>}
      <div className="cols">
        <div className="cols__main">
          <section className="panel">
            <div className="panel__head">
              <span className="panel-title">
                <code>{col.slug}</code> · {col.kind}s
              </span>
              <a
                className="mono"
                style={{ marginLeft: "auto", fontSize: "11.5px" }}
                onClick={() => navigate(`/explore/collection/${col.slug}`)}
              >
                view in Explore ›
              </a>
            </div>
            <div
              className="panel__body"
              style={{ display: "flex", gap: "8px", alignItems: "center" }}
            >
              <input
                placeholder={col.kind === "clan" ? "#CLANTAG" : "#PLAYERTAG"}
                className="mono"
                value={addText}
                onChange={(e) => setAddText(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="btn"
                disabled={!addText.trim()}
                onClick={async () => {
                  await act({
                    action: "add",
                    slug: col.slug,
                    tags: addText.split(/[\s,]+/).filter(Boolean),
                  });
                  setAddText("");
                }}
              >
                Add
              </button>
            </div>
            {(col.members ?? []).length === 0 && (
              <div className="panel__body" style={{ color: "var(--faint)" }}>
                Empty collection — add tags above.
              </div>
            )}
            {(col.members ?? []).length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(col.members ?? []).map((tag) => (
                    <tr key={tag}>
                      <td>
                        <a
                          className="mono"
                          onClick={() =>
                            navigate(
                              `/explore/${col.kind}/${encodeURIComponent(tag)}`,
                            )
                          }
                        >
                          {tag}
                        </a>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn--text"
                          onClick={() =>
                            act({
                              action: "remove",
                              slug: col.slug,
                              tags: [tag],
                            })
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <div className="cols__rail">
          <section className="panel">
            <div className="panel__head">
              <span className="panel-title">Details</span>
            </div>
            <form
              className="panel__body"
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
              onSubmit={async (e) => {
                e.preventDefault();
                await act({
                  action: "upsert",
                  slug: col.slug,
                  kind: col.kind,
                  ...meta,
                });
              }}
            >
              <label>
                <span className="label">Title</span>
                <input
                  value={meta.title}
                  onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                />
              </label>
              <label>
                <span className="label">Description</span>
                <textarea
                  rows={3}
                  value={meta.description}
                  onChange={(e) =>
                    setMeta({ ...meta, description: e.target.value })
                  }
                />
              </label>
              <label>
                <span className="label">Visibility</span>
                <select
                  value={meta.visibility}
                  onChange={(e) =>
                    setMeta({ ...meta, visibility: e.target.value })
                  }
                >
                  <option value="public">public</option>
                  <option value="private">private</option>
                </select>
              </label>
              <div>
                <button className="btn" disabled={!meta.title.trim()}>
                  Save details
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
