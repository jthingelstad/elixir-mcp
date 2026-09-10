import { Integrations } from "./Integrations.jsx";
import { useEffect, useState, useCallback, Fragment } from "react";
import { api } from "../api.js";
import { LogTable } from "../components/LogTable.jsx";
import { Icon } from "../components/Icon.jsx";
import { Markdown } from "../components/Markdown.jsx";
import { ago } from "../lib/time.js";

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
  if (page === "accounts")
    return itemId ? (
      <AdminAccountDetail id={itemId} navigate={navigate} />
    ) : (
      <AdminAccounts navigate={navigate} />
    );
  if (page === "usage") return <AdminUsage />;
  if (page === "collectors") return <AdminCollectors navigate={navigate} />;
  if (page === "connections") return <AdminConnections />;
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
      crumb="Admin"
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
function AdminAccounts({ navigate }) {
  const [accounts, setAccounts] = useState([]);
  // settable_roles is read by the record page, which is where a tier is
  // now changed; the list only has to find an account.
  const load = useCallback(async () => {
    const r = await api.adminAccounts();
    if (r.ok) setAccounts(r.data.accounts ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  // Six columns became four. The ops-lane overrides, the collector flag
  // and the tier prompt moved to the record page: a list is for finding
  // an account, and everything you can DO to one belongs where you have
  // opened it and can see what you are changing.
  const rows = accounts.map((a) => [
    {
      text: a.email ?? principalLabel(a),
      title: a.account_id,
      onClick: () => navigate(`/admin/accounts/${a.account_id}`),
    },
    a.status,
    {
      text: a.role + (a.pending_role_request ? " · upgrade requested" : ""),
      tone: a.pending_role_request ? "warn" : undefined,
    },
    `${a.players_recording ?? 0} players · ${a.clans_recording ?? 0} clans`,
  ]);

  return (
    <LogTable
      crumb="Admin"
      title="Accounts"
      note="Everyone with a door. Tiers set what we record and the daily call budget — never read access."
      cols={[
        ["ACCOUNT", "left"],
        ["STATUS", "left"],
        ["TIER", "left"],
        ["TRACKING", "left"],
      ]}
      rows={rows}
      monoCols={[0]}
      filters={[
        { key: "tier", label: "Tier", col: 2 },
        { key: "status", label: "Status", col: 1 },
      ]}
      minWidth={620}
      empty="No accounts yet."
      footnote="An account is named by the address it signs in with. Open one to change its tier or read its overrides. Upgrade requests land in Feedback and are flagged in the tier column."
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
      crumb="Admin"
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

/** One account, admin lane: what it is, what it may do, and the one
 *  thing an admin changes. The tier used to be a window.prompt from the
 *  list — a control with no context, on a row you had to count columns
 *  to read. Facts first, then the change, on a page that shows what you
 *  are changing. */
function AdminAccountDetail({ id, navigate }) {
  const [accounts, setAccounts] = useState(null);
  const [settable, setSettable] = useState([]);
  const [role, setRole] = useState("");
  const [saved, setSaved] = useState("");

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

  const a = (accounts ?? []).find((x) => String(x.account_id) === String(id));
  useEffect(() => {
    if (a) setRole(a.role);
  }, [a]);

  if (accounts === null)
    return <p style={{ color: "var(--ink-faint)" }}>Loading…</p>;
  if (!a)
    return (
      <div className="panel">
        <div className="panel__body">
          No account {id}.{" "}
          <a onClick={() => navigate("/admin/accounts")}>All accounts ›</a>
        </div>
      </div>
    );

  const facts = [
    ["Email", a.email ?? "— (predates the address being kept)"],
    ["Account id", a.account_id],
    ["Kind", a.kind ?? "person"],
    ["Public id", a.public_id ?? "—"],
    ["Principal name", a.principal_name ?? "—"],
    ["Status", a.status],
    ["Created", day(a.created_at)],
    [
      "Tracking",
      `${a.players_recording ?? 0} players · ${a.clans_recording ?? 0} clans`,
    ],
    ["Runs a collector", a.operator ? "yes" : "no"],
    [
      "Overrides · ops only",
      [
        a.max_player_recordings != null && `players ${a.max_player_recordings}`,
        a.mcp_daily_quota != null && `calls ${a.mcp_daily_quota}`,
        a.live_daily_quota != null && `live ${a.live_daily_quota}`,
      ]
        .filter(Boolean)
        .join(" · ") || "none",
    ],
  ];

  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <a
          className="mono"
          style={{ fontSize: "12px" }}
          onClick={() => navigate("/admin/accounts")}
        >
          ‹ All accounts
        </a>
      </p>
      <section className="panel" style={{ maxWidth: "680px" }}>
        <div className="panel__head">
          <span className="panel-title">{a.email ?? principalLabel(a)}</span>
          {a.is_owner && <span className="chip chip--info">owner</span>}
          {a.pending_role_request && (
            <span className="chip chip--warn">upgrade requested</span>
          )}
        </div>
        {/* .fields is the console's one key/value list (Agents, Explore
            and the collector record all use it) — a flat dl, no wrapper
            divs, because the grid is two columns of the SAME list. */}
        <dl className="fields" style={{ margin: 0 }}>
          {facts.map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd className={k === "Email" ? undefined : "mono"}>{v}</dd>
            </Fragment>
          ))}
        </dl>
        <div
          className="panel__body"
          style={{
            borderTop: "1px solid var(--line-soft)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <label className="field-label" htmlFor="account-tier">
            Tier
          </label>
          <select
            id="account-tier"
            value={role}
            disabled={!settable.includes(a.role)}
            onChange={(e) => setRole(e.target.value)}
          >
            {[...new Set([a.role, ...settable])].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            className="btn btn--sm"
            disabled={!settable.includes(a.role) || role === a.role}
            onClick={async () => {
              const r = await api.adminSetRole(a.account_id, role);
              setSaved(r.ok ? "Tier saved." : "That did not work.");
              if (r.ok) load();
            }}
          >
            Save tier
          </button>
          {saved && <span className="caveat">{saved}</span>}
          {!settable.includes(a.role) && (
            <span className="caveat">
              This account&rsquo;s tier is not yours to set.
            </span>
          )}
        </div>
        <div
          className="panel__body"
          style={{ borderTop: "1px solid var(--line-soft)" }}
        >
          <p className="footnote" style={{ margin: 0 }}>
            A tier sets what we RECORD for an account and its daily call budget.
            It never changes what the account can read — every recorded fact is
            readable by every account. Overrides are set in the ops lane,
            deliberately not here.
          </p>
        </div>
      </section>
    </>
  );
}

/**
 * Every account's live connections, and the power to end one.
 *
 * Jamie opened Service tokens looking for this and found something else
 * (2026-09-10): a service token is an owner-issued headless credential
 * bound to one account, one per consuming service. THIS is "who is
 * connected, and can I stop it" — the same rows each holder sees under
 * Account > Connections, across every account, with the address that
 * holds them.
 */
function AdminConnections() {
  const [rows, setRows] = useState([]);
  const load = useCallback(async () => {
    const r = await api.adminConnections();
    if (r.ok) setRows(r.data.connections ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const table = rows.map((c) => [
    {
      text:
        c.email ??
        (c.kind && c.kind !== "person"
          ? `${c.public_id ?? "principal"} (${c.kind})`
          : (c.account_id ?? "").slice(0, 8)),
      title: c.account_id,
    },
    c.client_name ?? "—",
    String(c.calls_7d ?? 0),
    c.last_call_at ? day(c.last_call_at) : "never",
    day(c.absolute_expires_at),
    {
      text: "Revoke",
      action: async () => {
        // Somebody else's credential: the confirmation names whose, and
        // what stops working, because "Revoke" on a table row is the
        // easiest destructive click in the console to make by accident.
        const whose = c.email ?? c.public_id ?? "this account";
        if (
          !window.confirm(
            `Revoke ${c.client_name ?? "this connection"} for ${whose}? It stops reading on its next call, and they will have to connect it again.`,
          )
        )
          return;
        await api.adminRevokeConnection(c.family_id);
        load();
      },
    },
  ]);

  return (
    <LogTable
      crumb="Admin"
      title="Connections across accounts"
      note="Every live OAuth connection, whoever holds it. Revoking one ends it on its next call and lands on that account's own event log."
      cols={[
        ["ACCOUNT", "left"],
        ["CLIENT", "left"],
        ["CALLS 7D", "right"],
        ["LAST CALL", "left"],
        ["EXPIRES", "left"],
        ["", "right"],
      ]}
      rows={table}
      monoCols={[0, 3, 4]}
      filters={[{ key: "client", label: "Client", col: 1 }]}
      minWidth={820}
      empty="No live connections."
      footnote="A service token is a different thing: owner-issued, headless, bound to one account, and listed under Service tokens."
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
      crumb="Admin"
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
        crumb="Admin"
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

/**
 * The collector fleet, admin lane — a LIST now, not a console.
 *
 * It carried ten columns and every lifecycle action inline, so the row
 * you were about to act on was the hardest thing on the page to read
 * (Jamie, 2026-09-10). Five columns, and the name opens the collector's
 * own record — the SAME record the status page opens, with the
 * operations panel on it for whoever may act. One collector, one page.
 */
function AdminCollectors({ navigate }) {
  const [gateways, setGateways] = useState([]);
  const load = useCallback(async () => {
    const r = await api.adminGateways();
    if (r.ok) setGateways(r.data.gateways ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const rows = gateways.map((g) => [
    {
      text: g.card_name ?? g.name ?? "unnamed",
      title: g.name,
      onClick: () =>
        navigate(
          `/status/collectors/${encodeURIComponent(g.card_name ?? g.name)}`,
        ),
    },
    g.owner_account_id
      ? (g.owner_player_name ?? g.owner_email_hash?.slice(0, 10) ?? "claimed")
      : "unowned",
    {
      text: g.status,
      tone:
        g.status === "active"
          ? "ok"
          : g.status === "revoked"
            ? undefined
            : "warn",
    },
    { text: ago(g.last_heartbeat_at), title: g.last_heartbeat_at ?? "never" },
    String(g.fetches_last_hour ?? 0),
  ]);

  return (
    <LogTable
      crumb="Admin"
      title="Collector fleet"
      note="Lifecycle is forward-only: pending, then probation once the key is issued and it is heartbeating, then active. Open one to act on it."
      cols={[
        ["COLLECTOR", "left"],
        ["OPERATOR", "left"],
        ["STATE", "left"],
        ["HEARTBEAT", "left"],
        ["FETCHES 1H", "right"],
      ]}
      rows={rows}
      monoCols={[3]}
      filters={[{ key: "state", label: "State", col: 2 }]}
      minWidth={640}
      empty="No collectors yet."
      footnote="Heartbeat is any contact with the door, including polls that found no work — a fresh heartbeat with stale data is an idle collector, not a broken one. Issuing the IP-bound CR key is manual."
    />
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
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "14px",
          flexWrap: "wrap",
          marginBottom: "18px",
        }}
      >
        <div>
          <p className="page__crumb">Admin · owner only</p>
          <h1 className="page__title">Service tokens</h1>
          <p className="page__lede">
            Headless credentials you issue by hand: one per consuming service,
            no browser and no consent screen, each acting with the entitlements
            of the account it is bound to. Not a user&rsquo;s connection &mdash;
            those are on{" "}
            <a href="/admin/connections">Connections across accounts</a>.
            Integration keys live on Integrations. Calls audit as{" "}
            <code>svc:&lt;name&gt;</code>.
          </p>
        </div>
        <form
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
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
          <input
            aria-label="Token name"
            placeholder="elixir-bot"
            value={svcName}
            onChange={(e) => setSvcName(e.target.value)}
            style={{ width: "160px" }}
          />
          <button className="btn btn--primary" disabled={!svcName.trim()}>
            <Icon name="key-round" size={16} />
            Create token
          </button>
        </form>
      </div>
      {newToken && (
        <p className="notice">
          <strong>{newToken.name}</strong>: <code>{newToken.token}</code>
          <br />
          Shown once — store it now.
        </p>
      )}
      {svcTokens.length === 0 ? (
        <div className="empty">
          <div className="empty__title">No service tokens</div>
          <p className="empty__body" style={{ marginBottom: 0 }}>
            A token here is the owner&rsquo;s own long-lived credential for a
            service that acts as this account. Products with their own identity
            belong on Integrations.
          </p>
        </div>
      ) : (
        <div className="table__scroll">
          <table className="table" style={{ minWidth: "620px" }}>
            <thead>
              <tr>
                <th>NAME</th>
                <th>ACTS AS</th>
                <th>CREATED</th>
                <th>LAST USED</th>
                <th className="num">CALLS 7D</th>
                <th>STATE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {svcTokens.map((t) => (
                <tr key={t.token_id}>
                  <td className="mono">{t.name}</td>
                  {/* Whose entitlements it spends. Every token is the
                      owner's today, and the column is here because that
                      is a fact about the credential, not a given. */}
                  <td>
                    {t.account_email ?? "—"}
                    {t.account_role ? (
                      <span
                        style={{ color: "var(--ink-faint)", fontSize: "12px" }}
                      >
                        {" "}
                        · {t.account_role}
                      </span>
                    ) : null}
                  </td>
                  <td className="mono">{String(t.created_at).slice(0, 10)}</td>
                  <td className="mono">{ago(t.last_used_at)}</td>
                  <td className="num">{t.calls_7d}</td>
                  <td>
                    {/* Dot and ink on one value: live is fine, revoked
                        is over and carries no tone. */}
                    <span
                      className={"chip " + (t.revoked_at ? "" : "chip--ok")}
                    >
                      <span className="chip__dot" />
                      {t.revoked_at ? "revoked" : "live"}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {!t.revoked_at && (
                      <button
                        className="btn btn--sm btn--danger"
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
        </div>
      )}
      <p
        className="footnote"
        style={{ margin: "14px 2px 0", maxWidth: "78ch" }}
      >
        A token is shown once, at creation. Revoking is final: a revoked token
        still being presented shows up on Connections as a refusal, not as a
        call.
      </p>
    </>
  );
}

/** The call a report is about, read over the admin lane so the maintainer
 *  sees what the filer saw — the arguments and the answer, not a
 *  description of them. Attached by the console's Report this call button
 *  and by elixir_feedback's request_id (contract 1.1.0). */
function AttachedCall({ requestId }) {
  const [record, setRecord] = useState(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api.adminCall(requestId).then((r) => {
      if (r.ok) setRecord(r.data);
      else setMissing(true);
    });
  }, [requestId]);

  return (
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
        THE CALL · {requestId}
      </div>
      {missing && (
        <p className="caveat" style={{ margin: 0 }}>
          That call is no longer in the log — audit rows are pruned, the report
          is kept.
        </p>
      )}
      {record && (
        <>
          <p style={{ margin: "0 0 8px", fontSize: "13px" }}>
            <span className="mono">{record.call?.tool}</span> ·{" "}
            {record.call?.duration_ms ?? "—"} ms ·{" "}
            {record.call?.created_at?.slice(0, 16).replace("T", " ")}Z
            {record.call?.error_code ? ` · ${record.call.error_code}` : ""}
          </p>
          <pre
            className="mono"
            style={{
              fontSize: "11.5px",
              overflowX: "auto",
              maxHeight: "260px",
              margin: 0,
            }}
          >
            {JSON.stringify(record.request ?? record.call?.args ?? {}, null, 2)}
          </pre>
        </>
      )}
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
        {/* Feedback is written in Markdown — the console's form says so
            and elixir_feedback takes it the same way — so it renders as
            Markdown here too. The reader's side already did; the queue
            where it is actually READ was showing the asterisks. */}
        <div
          className="panel__body"
          style={{ fontSize: "13px", lineHeight: 1.6 }}
        >
          <Markdown text={item.message} />
        </div>
        {item.request_id && <AttachedCall requestId={item.request_id} />}
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
                  on save. It never takes capture away from a player or clan
                  somebody else is already recording.
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
