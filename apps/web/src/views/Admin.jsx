import { Integrations } from "./Integrations.jsx";
import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { LogTable } from "../components/LogTable.jsx";
import { ago, beatCls, freshCls, secsSince } from "../lib/time.js";

/**
 * Admin, eight pages.
 *
 * Six of them are the console's one log table with different columns
 * (components/LogTable.jsx) — the same component Activity's three views
 * use, so the console never grows a second table idiom. Collectors and
 * Service tokens keep their own screens: a lifecycle with a different
 * legal move per row, and a one-time secret reveal, are not a log.
 *
 * Each page loads only what it needs. This used to fetch all five admin
 * endpoints on every one of them.
 */

/**
 * How to name a principal in an admin table.
 *
 * These tables read `email_hash` because for a long time every account WAS a
 * person and always had one. Migration 0053 made the column nullable so that
 * agents and integrations -- which belong to a person and have no address of
 * their own -- could exist at all, and every one of these views kept calling
 * .slice() on it. The first agent created blanked EVERY admin page, because a
 * throw inside a render unmounts the whole tree.
 *
 * The guard alone would print a dash, which is worse than nothing in a table
 * whose job is telling you who did what. An agent has a name; use it.
 */
function principalLabel(a) {
  if (a.primary_tag) return a.primary_tag;
  // A PERSON is their email hash. Their tokens have names too, and reaching
  // for one made the owner's own row read as "elixir-bot" -- a person
  // labelled with a machine they happen to own.
  if (a.kind && a.kind !== "person") {
    // An agent's name lives on its service_token, not the account row; the
    // slug is the stable fallback if the token was revoked.
    if (a.principal_name) return a.principal_name;
    if (a.public_id) return a.public_id;
  }
  if (a.email_hash) return a.email_hash.slice(0, 10);
  return a.account_id ? a.account_id.slice(0, 8) : "unknown";
}

const day = (ts) => (ts ? new Date(ts).toISOString().slice(0, 10) : "—");

export function Admin({ me, page = "requests", navigate, itemId }) {
  if (!me?.is_admin)
    return <p className="callout callout--warn">Admins only.</p>;
  if (page === "integrations") return <Integrations />;
  if (page === "accounts") return <AdminAccounts />;
  if (page === "usage") return <AdminUsage />;
  if (page === "collectors") return <AdminCollectors navigate={navigate} />;
  if (page === "service-tokens") return <AdminServiceTokens />;
  if (page === "collections")
    return itemId ? (
      <CollectionEditor slug={itemId} navigate={navigate} />
    ) : (
      <AdminCollections navigate={navigate} />
    );
  if (page === "feedback")
    return itemId ? (
      <AdminFeedbackItem id={itemId} navigate={navigate} />
    ) : (
      <AdminFeedback navigate={navigate} />
    );
  return <AdminRequests />;
}

/** Access requests. Granted by hand, oldest first — the queue is short
 *  and the decision is a judgement, so there is no bulk action. */
function AdminRequests() {
  const [requests, setRequests] = useState([]);
  const load = useCallback(async () => {
    const r = await api.adminRequests();
    if (r.ok) setRequests(r.data.requests ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const decide = async (hash, status) => {
    await api.adminDecide(hash, status);
    load();
  };

  const rows = requests.map((r) => [
    day(r.created_at),
    r.email_hash ? r.email_hash.slice(0, 10) : "—",
    r.requested_player_tag ?? "—",
    r.request_note ?? "",
    { text: "Approve", action: () => decide(r.email_hash, "approved") },
    { text: "Deny", action: () => decide(r.email_hash, "denied") },
  ]);

  return (
    <LogTable
      title="Access requests"
      note="Granted by hand, oldest first."
      cols={[
        ["ASKED", "left"],
        ["ACCOUNT", "left"],
        ["WANTS", "left"],
        ["NOTE", "left"],
        ["", "right"],
        ["", "right"],
      ]}
      rows={rows}
      monoCols={[0, 1, 2]}
      empty="Queue is empty."
      footnote="An address is never shown here, only the first ten characters of its hash — enough to match a person to the email they wrote from, and not reversible."
    />
  );
}

/** Accounts and tiers. The three override columns are read-only and say
 *  so: they are set in the ops lane, and a control here would be a
 *  second way to write them. */
function AdminAccounts() {
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

  const rows = accounts.map((a) => {
    const overrides =
      [
        a.max_player_recordings != null && `players ${a.max_player_recordings}`,
        a.mcp_daily_quota != null && `calls ${a.mcp_daily_quota}`,
        a.live_daily_quota != null && `live ${a.live_daily_quota}`,
      ]
        .filter(Boolean)
        .join(" · ") || "—";
    return [
      {
        text:
          principalLabel(a) +
          (a.kind && a.kind !== "person" ? ` (${a.kind})` : "") +
          (a.is_owner ? " (owner)" : ""),
        title: a.account_id,
      },
      a.status,
      {
        text: a.role + (a.pending_role_request ? " · upgrade requested" : ""),
        tone: a.pending_role_request ? "warn" : undefined,
      },
      `${a.players_recording ?? 0} players · ${a.clans_recording ?? 0} clans`,
      a.operator ? "yes" : "—",
      overrides,
      settable.includes(a.role)
        ? {
            text: "Set tier",
            action: async () => {
              const next = window.prompt(
                `Tier for ${principalLabel(a)} — one of: ${settable.join(", ")}`,
                a.role,
              );
              if (next && settable.includes(next)) {
                await api.adminSetRole(a.account_id, next);
                load();
              }
            },
          }
        : "",
    ];
  });

  return (
    <LogTable
      title="Accounts"
      note="Everyone with a door. Tiers set what we record and the daily call budget — never read access."
      cols={[
        ["ACCOUNT", "left"],
        ["STATUS", "left"],
        ["TIER", "left"],
        ["TRACKING", "left"],
        ["COLLECTOR", "left"],
        ["OVERRIDES · OPS ONLY", "left"],
        ["", "right"],
      ]}
      rows={rows}
      monoCols={[0, 5]}
      filters={[
        { key: "tier", label: "Tier", col: 2 },
        { key: "status", label: "Status", col: 1 },
      ]}
      minWidth={880}
      empty="No accounts yet."
      footnote="Overrides are set in the ops lane, not here. Tier changes are the console's control. Upgrade requests land in Feedback and are flagged in the tier column."
    />
  );
}

/** Usage across accounts. The shared FETCH budget is a service-wide
 *  number and lives on Status; this is the per-account call side. */
function AdminUsage() {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.adminUsage().then((r) => r.ok && setUsage(r.data));
  }, []);

  const rows = (usage?.accounts ?? []).map((a) => [
    principalLabel(a) + (a.kind && a.kind !== "person" ? ` (${a.kind})` : ""),
    String(a.calls_7d ?? 0),
    String(a.calls_today ?? 0),
    a.errors_7d ? String(a.errors_7d) : "0",
    a.mcp_daily_quota == null ? "tier default" : String(a.mcp_daily_quota),
    a.last_call ? day(a.last_call) : "never",
  ]);

  const busiest = (usage?.tools ?? [])
    .slice(0, 5)
    .map((t) => `${t.tool} (${t.calls.toLocaleString()})`)
    .join(", ");

  return (
    <LogTable
      title="Usage across accounts"
      note="Seven days. The shared fetch budget is on Status."
      cols={[
        ["ACCOUNT", "left"],
        ["CALLS 7D", "right"],
        ["TODAY", "right"],
        ["ERRORS 7D", "right"],
        ["DAILY QUOTA", "right"],
        ["LAST CALL", "left"],
      ]}
      rows={rows}
      monoCols={[0, 5]}
      empty="No calls in the last seven days."
      footnote={
        busiest
          ? `Busiest tools over the same seven days: ${busiest}.`
          : undefined
      }
    />
  );
}

/** The feedback queue. Unread first is the API's order; the status
 *  control is on the item, because deciding what to do about a piece of
 *  feedback means reading it. */
function AdminFeedback({ navigate }) {
  const [feedback, setFeedback] = useState([]);
  useEffect(() => {
    api.adminFeedback().then((r) => r.ok && setFeedback(r.data.feedback ?? []));
  }, []);

  const rows = feedback.map((f) => [
    day(f.created_at),
    f.from_player ?? "—",
    f.surface ?? "",
    f.category ?? "",
    {
      text: f.message.length > 80 ? f.message.slice(0, 80) + "…" : f.message,
      onClick: () => navigate(`/admin/feedback/${f.feedback_id}`),
    },
    {
      text: f.status + (f.response ? " · answered" : ""),
      tone: f.status === "new" ? "accent-bright" : undefined,
    },
  ]);

  return (
    <LogTable
      title="Feedback queue"
      note="Sent from the console and from elixir_feedback at the MCP door."
      cols={[
        ["WHEN", "left"],
        ["FROM", "left"],
        ["VIA", "left"],
        ["CATEGORY", "left"],
        ["SAID", "left"],
        ["STATE", "left"],
      ]}
      rows={rows}
      monoCols={[0, 1]}
      filters={[
        { key: "state", label: "State", col: 5 },
        { key: "category", label: "Category", col: 3 },
        { key: "via", label: "Via", col: 2 },
      ]}
      minWidth={820}
      empty="No feedback yet."
      footnote="Every item gets a response; the response lands in the filer's notification feed. Open one to answer it."
    />
  );
}

/** Collections curation: owner-only create/manage. */
function AdminCollections({ navigate }) {
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

  const rows = cols.map((c) => [
    {
      text: c.slug,
      onClick: () => navigate(`/admin/collections/${c.slug}`),
    },
    c.title,
    c.kind,
    c.visibility,
    String(c.member_count ?? 0),
  ]);

  return (
    <>
      <LogTable
        title="Collections"
        note="Curated sets served to every account through collections_browse and Explore."
        cols={[
          ["SLUG", "left"],
          ["TITLE", "left"],
          ["KIND", "left"],
          ["VISIBILITY", "left"],
          ["MEMBERS", "right"],
        ]}
        rows={rows}
        monoCols={[0]}
        filters={[
          { key: "kind", label: "Kind", col: 2 },
          { key: "visibility", label: "Visibility", col: 3 },
        ]}
        empty="No collections yet. Every member added to one starts recording, so a collection is a recording decision."
      />
      {err && <p className="field-error">{err}</p>}
      <form
        style={{
          display: "flex",
          gap: "8px",
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: "20px",
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          const slug = form.slug;
          setErr("");
          const r = await api.adminCollectionAction({
            action: "upsert",
            ...form,
          });
          if (!r.ok) {
            setErr(r.data?.message ?? r.data?.error ?? "failed");
            return;
          }
          setForm({ ...form, slug: "", title: "", description: "" });
          navigate(`/admin/collections/${slug}`);
        }}
      >
        <span className="label">New collection</span>
        <input
          className="mono"
          placeholder="slug"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          style={{ flex: "0 1 9rem" }}
        />
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          style={{ flex: "0 1 11rem" }}
        />
        <select
          className="select"
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        >
          <option value="player">player</option>
          <option value="clan">clan</option>
        </select>
        <input
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          style={{ flex: "1 1 14rem" }}
        />
        <button className="btn" disabled={!form.slug || !form.title}>
          Create
        </button>
      </form>
    </>
  );
}

/** The collector fleet, admin lane. Not a log: lifecycle is forward-only
 *  (pending -> probation -> active -> draining -> probation) and each row
 *  offers only the move it may legally make. */
function AdminCollectors({ navigate }) {
  const [gateways, setGateways] = useState([]);
  // Provision-click outcome per gateway: the token is staged server-side
  // for the operator's one-time reveal, so Admin must SAY so (or show the
  // error) instead of silently refreshing.
  const [staged, setStaged] = useState({});
  const load = useCallback(async () => {
    const r = await api.adminGateways();
    if (r.ok) setGateways(r.data.gateways ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Collector fleet</h1>
        <p className="page__lede">
          Lifecycle is forward-only: pending, then probation once the key is
          issued and it is heartbeating, then active. Issuing the IP-bound CR
          key and the IAM user is manual.
        </p>
      </div>
      <p className="footnote" style={{ margin: "0 0 16px", maxWidth: "78ch" }}>
        Heartbeat is any contact with the door, including polls that found no
        work. Data is the last payload we accepted and recorded. A fresh
        heartbeat with stale data is an idle collector, not a broken one.
      </p>
      <table>
        <thead>
          <tr>
            <th>Collector</th>
            <th>Operator</th>
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
                <td>
                  {/* Card name is the public identity everywhere else -
                  the status page, the ladder, the MCP tools - while
                  the machine name is what you SSH into. Admin is the
                  one screen that has to join the two. */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "7px",
                    }}
                  >
                    {g.card_icon && (
                      <img
                        src={g.card_icon}
                        alt=""
                        style={{ height: "22px", borderRadius: "3px" }}
                      />
                    )}
                    <span style={{ fontWeight: 600 }}>
                      {g.card_name ?? "unnamed"}
                    </span>
                  </div>
                  <code style={{ color: "var(--ink-faint)" }}>{g.name}</code>
                </td>
                <td>
                  {g.owner_account_id ? (
                    <>
                      <div>
                        {g.owner_player_name ?? "no player claimed"}
                        {g.owner_is_me && (
                          <span className="chip" style={{ marginLeft: "6px" }}>
                            you
                          </span>
                        )}
                      </div>
                      <code style={{ color: "var(--ink-faint)" }}>
                        {g.owner_email_hash?.slice(0, 10) ?? "—"}
                      </code>
                    </>
                  ) : (
                    <span className="nil">unowned</span>
                  )}
                </td>
                <td>
                  <span
                    className={`chip ${g.status === "active" ? "chip--ok" : g.status === "pending" ? "chip--warn" : "chip--info"}`}
                  >
                    {g.status}
                  </span>
                </td>
                <td>
                  <span
                    className={`chip ${g.channel === "live" ? "chip--info" : "chip--info"}`}
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
                          await api.adminGatewayAction(g.gateway_id, "revoke");
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
                          <>Provisioning failed: {staged[g.gateway_id].error}</>
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
                            Token staged — the operator reveals it once on their
                            Collector page.
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
    </>
  );
}

/** Service keys for other products. The key is shown once at issue and
 *  never again — only its hash is stored, so there is nothing to show. */
function AdminServiceTokens() {
  const [svcTokens, setSvcTokens] = useState([]);
  const [newToken, setNewToken] = useState(null);
  const [svcName, setSvcName] = useState("");
  const load = useCallback(async () => {
    const r = await api.adminServiceTokens();
    if (r.ok) setSvcTokens(r.data.tokens ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Service keys</h1>
        <p className="page__lede">
          Long-lived keys held by other products. Calls audit as{" "}
          <code>svc:&lt;name&gt;</code>.
        </p>
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
    </>
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
  if (!item) return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
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
          <span className="mono" style={{ color: "var(--ink-faint)" }}>
            #{item.feedback_id}
          </span>
          <span className="tag-chip">{item.category}</span>
          <span
            className={`chip ${item.status === "done" ? "chip--ok" : item.status === "new" ? "chip--warn" : "chip--info"}`}
          >
            {item.status}
          </span>
          <span
            className="mono"
            style={{
              marginLeft: "auto",
              fontSize: "11px",
              color: "var(--ink-faint)",
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
            style={{ borderTop: "1px solid var(--line-soft)" }}
          >
            <div
              className="mono"
              style={{
                fontSize: "11px",
                color: "var(--ink-faint)",
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
            borderTop: "1px solid var(--line-soft)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <label>
            <span className="field-label">Maintainer response</span>
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
              <span style={{ fontSize: "12px", color: "var(--ink-faint)" }}>
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
  const [tagText, setTagText] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    const r = await api.adminCollections();
    const found = (r.data?.collections ?? []).find((c) => c.slug === slug);
    if (found) {
      setCol(found);
      // Reset the editor to what the server has, unless the operator is
      // mid-edit: a background reload must not eat typing.
      setTagText((prev) => prev ?? (found.members ?? []).join("\n"));
      setMeta(
        (prev) =>
          prev ?? {
            title: found.title,
            description: found.description ?? "",
            visibility: found.visibility,
            scope: found.scope ?? "comprehensive",
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
  if (!col || !meta || tagText === null)
    return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  const membersText = (col.members ?? []).join("\n");
  const pending = tagText
    .split(/\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const dirty = pending.join("\n") !== membersText;
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
            {/* One textarea, one tag per line, saved as a SET (Jamie,
                2026-09-06). Editing a list by adding one box at a time
                and clicking Remove per row was the wrong shape for the
                thing: you think about the membership, not the diff. */}
            <div className="panel__body">
              <label>
                <span className="field-label">
                  Members — one {col.kind} tag per line
                </span>
                <textarea
                  className="mono"
                  rows={Math.min(
                    24,
                    Math.max(8, tagText.split("\n").length + 2),
                  )}
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  placeholder={
                    col.kind === "clan"
                      ? "#CLANTAG\n#CLANTAG"
                      : "#PLAYERTAG\n#PLAYERTAG"
                  }
                  style={{ width: "100%", resize: "vertical" }}
                />
              </label>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  alignItems: "center",
                  marginTop: "10px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn"
                  disabled={!dirty || saving}
                  onClick={async () => {
                    setSaving(true);
                    await act({
                      action: "set",
                      slug: col.slug,
                      tags: tagText
                        .split(/\n/)
                        .map((t) => t.trim())
                        .filter(Boolean),
                    });
                    setSaving(false);
                  }}
                >
                  {saving ? "Saving…" : "Save members"}
                </button>
                {dirty && (
                  <button
                    className="btn--text"
                    onClick={() => setTagText(membersText)}
                    disabled={saving}
                  >
                    Discard changes
                  </button>
                )}
                <span style={{ color: "var(--ink-faint)", fontSize: "11.5px" }}>
                  {dirty
                    ? `${pending.length} tag${pending.length === 1 ? "" : "s"} — unsaved`
                    : `${pending.length} tag${pending.length === 1 ? "" : "s"}`}
                </span>
              </div>
              <p
                style={{
                  color: "var(--ink-faint)",
                  fontSize: "11.5px",
                  marginBottom: 0,
                }}
              >
                Saving replaces the membership with exactly what is above. Every{" "}
                {col.kind} listed here is recorded for as long as it stays; a{" "}
                {col.kind} nobody else is watching stops being recorded when you
                remove it.
              </p>
            </div>
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
                <span className="field-label">Title</span>
                <input
                  value={meta.title}
                  onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                />
              </label>
              <label>
                <span className="field-label">Description</span>
                <textarea
                  rows={10}
                  maxLength={2000}
                  value={meta.description}
                  onChange={(e) =>
                    setMeta({ ...meta, description: e.target.value })
                  }
                  style={{ resize: "vertical" }}
                />
                <span
                  className="field-label"
                  style={{ color: "var(--ink-faint)", fontWeight: 400 }}
                >
                  {meta.description.length}/2000
                </span>
              </label>
              <label>
                <span className="field-label">How deeply to record</span>
                <select
                  value={meta.scope ?? "comprehensive"}
                  onChange={(e) => setMeta({ ...meta, scope: e.target.value })}
                >
                  <option value="comprehensive">
                    comprehensive —{" "}
                    {col.kind === "clan"
                      ? "every member's battles too"
                      : "profile and every battle"}
                  </option>
                  <option value="activity">
                    activity —{" "}
                    {col.kind === "clan"
                      ? "the clan itself only"
                      : "profile only, no battles"}
                  </option>
                </select>
                <span
                  className="field-label"
                  style={{ color: "var(--ink-faint)", fontWeight: 400 }}
                >
                  {col.kind === "clan"
                    ? "Comprehensive follows membership as it changes and records each member's battles and profile. Activity records the clan itself: roster, war, standings, participation."
                    : "Comprehensive records each player's profile and every battle they play. Activity records the profile only."}{" "}
                  Deepening applies to everything listed here and takes effect
                  on save. It never takes capture away from a subject somebody
                  else is already recording.
                </span>
              </label>
              <label>
                <span className="field-label">Visibility</span>
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
