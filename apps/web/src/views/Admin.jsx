import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

export function Admin({ me, page = "requests" }) {
  const [requests, setRequests] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [clans, setClans] = useState([]);
  const [usage, setUsage] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [svcTokens, setSvcTokens] = useState([]);
  const [newToken, setNewToken] = useState(null);
  const [svcName, setSvcName] = useState("");
  const [clanTag, setClanTag] = useState("");
  const [clanError, setClanError] = useState("");

  const load = useCallback(async () => {
    const [r, g, c, u, f, st] = await Promise.all([
      api.adminRequests(),
      api.adminGateways(),
      api.adminClans(),
      api.adminUsage(),
      api.adminFeedback(),
      api.adminServiceTokens(),
    ]);
    if (r.ok) setRequests(r.data.requests);
    if (g.ok) setGateways(g.data.gateways);
    if (c.ok) setClans(c.data.clans);
    if (u.ok) setUsage(u.data);
    if (f.ok) setFeedback(f.data.feedback);
    if (st.ok) setSvcTokens(st.data.tokens);
  }, []);

  useEffect(() => {
    if (me?.is_owner) load();
  }, [me, load]);

  if (!me?.is_owner) return <p className="notice">Owner only.</p>;

  return (
    <>
      <div className="panel" hidden={page !== "requests"}>
        <h3>Access requests</h3>
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
                      className="quiet"
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

      <div className="panel" hidden={page !== "clans"}>
        <h3>Recorded clans</h3>
        <p>
          <strong>Comprehensive</strong> records the clan AND every open
          member&rsquo;s battles and profile, following membership changes;
          <strong> activity</strong> records only the clan itself (roster, war
          race, standings).
        </p>
        {clans.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Clan</th>
                <th>Name</th>
                <th>Status</th>
                <th>Scope</th>
                <th>Members</th>
                <th>Last roster poll</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {clans.map((c) => (
                <tr key={`${c.clan_tag}-${c.status}`}>
                  <td>
                    <code>{c.clan_tag}</code>
                  </td>
                  <td>{c.name ?? "—"}</td>
                  <td>
                    <span className={`status ${c.status}`}>{c.status}</span>
                  </td>
                  <td>
                    {c.status === "active" ? (
                      <button
                        className="quiet"
                        title="Click to switch scope"
                        onClick={async () => {
                          await api.adminClanAction(
                            c.clan_tag,
                            "scope",
                            c.clan_scope === "comprehensive"
                              ? "activity"
                              : "comprehensive",
                          );
                          load();
                        }}
                      >
                        {c.clan_scope ?? "comprehensive"}
                      </button>
                    ) : (
                      (c.clan_scope ?? "—")
                    )}
                  </td>
                  <td>{c.open_members}</td>
                  <td>
                    {c.last_roster_poll
                      ? new Date(c.last_roster_poll).toLocaleTimeString()
                      : "never"}
                  </td>
                  <td>
                    {c.status === "active" && (
                      <button
                        className="quiet"
                        onClick={async () => {
                          await api.adminClanAction(c.clan_tag, "stop");
                          load();
                        }}
                      >
                        Stop
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
            setClanError("");
            const res = await api.adminClanAction(clanTag, "start");
            if (res.ok) {
              setClanTag("");
              load();
            } else setClanError("That doesn’t look like a CR clan tag.");
          }}
        >
          <label>
            Record a clan
            <input
              placeholder="#J2RGCRVG"
              value={clanTag}
              onChange={(e) => setClanTag(e.target.value)}
            />
          </label>
          {clanError && <p className="error">{clanError}</p>}
          <button>Start recording</button>
        </form>
      </div>

      {usage && (
        <div className="panel" hidden={page !== "usage"}>
          <h3>MCP usage (7 days)</h3>
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
        <h3>Feedback</h3>
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
                  <td>{f.message}</td>
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
        <h3>Service tokens</h3>
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
                        className="quiet"
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
        <h3>Gateways</h3>
        <p>
          Lifecycle: pending → probation (key issued, installed, heartbeating) →
          active. Issuing the IP-bound CR key and IAM user is manual — see
          docs/OPERATORS.md.
        </p>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>IP</th>
              <th>Heartbeat</th>
              <th>Fetches (1h)</th>
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
                    <span className={`status ${g.status}`}>{g.status}</span>
                  </td>
                  <td>
                    <code>{g.static_ip}</code>
                  </td>
                  <td>
                    {g.last_heartbeat_at
                      ? new Date(g.last_heartbeat_at).toLocaleTimeString()
                      : "never"}
                  </td>
                  <td>{g.fetches_last_hour}</td>
                  <td>{Number(g.fetch_points).toLocaleString()}</td>
                  <td>
                    <code>{g.last_seen_sha ?? "—"}</code>
                  </td>
                  <td>
                    {next && (
                      <button
                        className="quiet"
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
                        className="quiet"
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AdminCollections page={page} />

      <AdminAccounts page={page} />
    </>
  );
}

/** Role management: the entitlement ladder applied to real accounts.
 *  Pending upgrade requests surface here; the picker grants them. */
function AdminAccounts({ page }) {
  const [accounts, setAccounts] = useState([]);
  const [roles, setRoles] = useState([]);
  const load = useCallback(async () => {
    const r = await api.adminAccounts();
    if (r.ok) {
      setAccounts(r.data.accounts ?? []);
      setRoles(r.data.roles ?? []);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="panel" hidden={page !== "accounts"}>
      <h3>Accounts</h3>
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
                <select
                  value={a.role}
                  onChange={async (e) => {
                    await api.adminSetRole(a.account_id, e.target.value);
                    load();
                  }}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {a.pending_role_request ? (
                  <span
                    className="status active"
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
              <td className="fine">
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
function AdminCollections({ page }) {
  const [cols, setCols] = useState([]);
  const [form, setForm] = useState({
    slug: "",
    title: "",
    kind: "player",
    description: "",
    visibility: "public",
  });
  const [tagsText, setTagsText] = useState({});
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
      <h3>Collections</h3>
      <p>
        Curated groupings served to every user via{" "}
        <code>collections_browse</code> and Explore ▸ Collections.
      </p>
      {err && <p className="error">{err}</p>}
      {cols.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Slug</th>
              <th>Title</th>
              <th>Kind</th>
              <th>Visibility</th>
              <th>Members</th>
              <th>Add / remove tags</th>
            </tr>
          </thead>
          <tbody>
            {cols.map((c) => (
              <tr key={c.slug}>
                <td>
                  <code>{c.slug}</code>
                </td>
                <td>{c.title}</td>
                <td>{c.kind}</td>
                <td>
                  <button
                    className="quiet"
                    onClick={() =>
                      act({
                        action: "upsert",
                        slug: c.slug,
                        title: c.title,
                        kind: c.kind,
                        visibility:
                          c.visibility === "public" ? "private" : "public",
                      })
                    }
                  >
                    {c.visibility}
                  </button>
                </td>
                <td title={(c.members ?? []).join(" ")}>{c.member_count}</td>
                <td>
                  <input
                    placeholder="#TAG #TAG ..."
                    value={tagsText[c.slug] ?? ""}
                    onChange={(e) =>
                      setTagsText({ ...tagsText, [c.slug]: e.target.value })
                    }
                    style={{ width: "12rem" }}
                  />{" "}
                  <button
                    className="quiet"
                    onClick={async () => {
                      await act({
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
                    onClick={async () => {
                      await act({
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await act({ action: "upsert", ...form });
          setForm({ ...form, slug: "", title: "", description: "" });
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
