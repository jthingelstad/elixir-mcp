import { useEffect, useState, useCallback } from "react";
import { api } from "../../api.js";

import { Fresh } from "../../components/Fresh.jsx";

export function AgentDetail({ id, navigate }) {
  const [agent, setAgent] = useState(null);
  const [missed, setMissed] = useState(false);
  const [events, setEvents] = useState(null);
  const [identities, setIdentities] = useState(null);
  const [minted, setMinted] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api.myPrincipals();
    if (!r.ok) return;
    const found = (r.data.agents ?? []).find((a) => a.account_id === id);
    if (!found) return setMissed(true);
    setAgent(found);
    const [ev, ids] = await Promise.all([
      api.principalEvents(id),
      api.principalIdentities(id),
    ]);
    if (ev.ok) setEvents(ev.data.events ?? []);
    if (ids.ok) setIdentities(ids.data.identities ?? []);
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (missed)
    return (
      <div className="panel">
        <div className="panel__body">
          No agent here on your account.{" "}
          <a onClick={() => navigate("/account/agents")}>All agents ›</a>
        </div>
      </div>
    );
  if (!agent) return <p style={{ color: "var(--faint)" }}>Loading…</p>;

  const live = (agent.tokens ?? []).filter((k) => !k.revoked_at);
  const suspended = agent.status !== "approved";

  return (
    <>
      <p style={{ margin: "0 0 10px" }}>
        <a
          className="mono"
          style={{ fontSize: "12px" }}
          onClick={() => navigate("/account/agents")}
        >
          ‹ All agents
        </a>
      </p>

      <section className="panel" style={{ marginBottom: "16px" }}>
        <div className="panel__head">
          <span className="panel-title">
            {live[0]?.name ?? agent.public_id}
          </span>
          {suspended && (
            <span style={{ color: "var(--red)", fontSize: "12px" }}>
              suspended
            </span>
          )}
        </div>
        <dl className="fields">
          <dt>Clan</dt>
          <dd className="mono">
            {(agent.clans ?? []).map((c) => c.clan_tag).join(", ") || "—"}
          </dd>
          <dt>Slug</dt>
          <dd className="mono">{agent.public_id ?? "—"}</dd>
          <dt>Calls (7 days)</dt>
          <dd>
            {agent.calls_7d ?? 0}{" "}
            <span className="hint">
              charged to your daily budget, not the agent&rsquo;s
            </span>
          </dd>
          <dt>Unread notifications</dt>
          <dd>{agent.unread_events ?? 0}</dd>
        </dl>
        <div className="panel__actions">
          <button
            className="btn btn--quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const r = await api.rotatePrincipalToken(id);
              setBusy(false);
              if (r.ok) setMinted(r.data.token);
              load();
            }}
          >
            Issue a new key
          </button>
          <button
            className="btn btn--quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api.setPrincipalStatus(
                id,
                suspended ? "approved" : "disabled",
              );
              setBusy(false);
              load();
            }}
          >
            {suspended ? "Resume" : "Suspend"}
          </button>
          <span style={{ fontSize: "12px", color: "var(--faint)" }}>
            {suspended
              ? "Its key reads as invalid while suspended; resuming restores the same key."
              : "Suspending makes its key read as invalid, without revoking it."}
          </span>
        </div>
        {minted && (
          <div className="panel__body">
            <p style={{ fontSize: "12.5px", margin: "0 0 6px" }}>
              <strong>Copy this key now.</strong> It is shown once and never
              again — only its hash is stored. The previous key stopped working
              the moment this one was issued.
            </p>
            <code style={{ wordBreak: "break-all" }}>{minted}</code>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginBottom: "16px" }}>
        <div className="panel__head">
          <span className="panel-title">Who it answers for</span>
        </div>
        <div
          className="panel__body"
          style={{ fontSize: "12.5px", color: "var(--faint)" }}
        >
          An agent serves many people through one connection. This is the map
          from an id on its own surface — a Discord user, say — to the player it
          answers about. The agent builds it with elixir_identify.
        </div>
        {identities?.length === 0 && (
          <div className="panel__body" style={{ color: "var(--faint)" }}>
            Nobody mapped yet.
          </div>
        )}
        {identities?.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>THEIR ID</th>
                  <th>PLAYER</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {identities.map((m) => (
                  <tr key={m.external_id}>
                    <td className="mono">{m.external_id}</td>
                    <td>
                      {m.name ? `${m.name} ` : ""}
                      <span className="mono">{m.player_tag}</span>
                    </td>
                    <td>
                      <button
                        className="btn--text"
                        onClick={async () => {
                          await api.removePrincipalIdentity(id, m.external_id);
                          load();
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel__head">
          <span className="panel-title">Its notifications</span>
          <span style={{ fontSize: "12px", color: "var(--faint)" }}>
            newest first · reading here never marks them seen
          </span>
        </div>
        {events?.length === 0 && (
          <div className="panel__body" style={{ color: "var(--faint)" }}>
            Nothing yet.
          </div>
        )}
        {events?.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>WHEN</th>
                  <th>TOPIC</th>
                  <th>SUBJECT</th>
                  <th>COUNT</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.event_id}>
                    <td>
                      <Fresh ts={e.created_at} />
                    </td>
                    <td className="mono">{e.topic}</td>
                    <td className="mono">{e.subject_tag ?? "—"}</td>
                    <td>{e.payload?.count ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function Agents({ navigate }) {
  const [principals, setPrincipals] = useState(null);
  const [form, setForm] = useState({ name: "", clan_tag: "" });
  const [minted, setMinted] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    api.myPrincipals().then((r) => r.ok && setPrincipals(r.data));
  useEffect(() => {
    load();
  }, []);

  const clans = principals?.addable_clans ?? [];

  async function create(e) {
    e.preventDefault();
    setError(null);
    const res = await api.createAgent({
      name: form.name,
      clan_tag: form.clan_tag || clans[0]?.clan_tag,
    });
    if (!res.ok) {
      setError(
        res.data?.error === "clan_not_added"
          ? "Add that clan to your account first — an agent can only act for a clan you already record."
          : res.data?.error === "name_taken"
            ? "You already have an agent with that name."
            : res.data?.error === "invalid_name"
              ? "Lowercase letters, numbers and hyphens."
              : "Could not create that agent.",
      );
      return;
    }
    // Shown once, never stored, and never fetchable again.
    setMinted(res.data.token);
    setForm({ name: "", clan_tag: "" });
    load();
  }

  return (
    <div className="cols">
      <div className="cols__main">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Your agents</span>
          </div>
          <div className="panel__body">
            <p
              style={{
                fontSize: "12.5px",
                color: "var(--faint)",
                marginTop: 0,
              }}
            >
              An agent acts for a clan rather than for you. It has its own
              identity, its own key and its own event feed — so what it does
              never lands in your history, and what you do never shows up as
              its. It spends your daily calls, and you can make one for any clan
              you already record.
            </p>
          </div>

          {principals?.agents?.length === 0 && (
            <div className="panel__body" style={{ color: "var(--faint)" }}>
              No agents yet.
            </div>
          )}
          {principals?.agents?.length > 0 && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>AGENT</th>
                    <th>CLAN</th>
                    <th>TIER</th>
                    <th>LAST ACTIVE</th>
                    {/* An agent spends the OWNER's daily calls, and the
                        owner's own usage view cannot see them -- it filters
                        to the owner's account_id and an agent has its own.
                        Without this column a budget can be exhausted by
                        something you have no way to look at. */}
                    <th>CALLS 7D</th>
                    <th>STATUS</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {principals.agents.map((a) => {
                    const live = (a.tokens ?? []).filter((k) => !k.revoked_at);
                    return (
                      <tr key={a.account_id}>
                        <td>{live[0]?.name ?? a.public_id}</td>
                        <td className="mono">
                          {(a.clans ?? []).map((c) => c.clan_tag).join(", ") ||
                            "—"}
                        </td>
                        <td>{a.role}</td>
                        <td>
                          {live[0]?.last_used_at ? (
                            <Fresh ts={live[0].last_used_at} />
                          ) : (
                            <span style={{ color: "var(--faint)" }}>never</span>
                          )}
                        </td>
                        <td>{a.calls_7d ?? 0}</td>
                        <td>
                          {a.status === "approved" ? (
                            "active"
                          ) : (
                            <span style={{ color: "var(--red)" }}>
                              suspended
                            </span>
                          )}
                        </td>
                        <td>
                          <a
                            onClick={() =>
                              navigate(`/account/agents/${a.account_id}`)
                            }
                          >
                            Open ›
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {minted && (
            <div className="panel__body">
              <p style={{ fontSize: "12.5px", margin: "0 0 6px" }}>
                <strong>Copy this key now.</strong> It is shown once and never
                again — only its hash is stored.
              </p>
              <code style={{ wordBreak: "break-all" }}>{minted}</code>
            </div>
          )}

          <div className="panel__body">
            {clans.length === 0 ? (
              <p style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                Add a clan on your Overview first — an agent needs a clan to act
                for.
              </p>
            ) : (
              <form
                onSubmit={create}
                style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}
              >
                <input
                  placeholder="agent name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
                <select
                  value={form.clan_tag}
                  onChange={(e) =>
                    setForm({ ...form, clan_tag: e.target.value })
                  }
                >
                  {clans.map((c) => (
                    <option key={c.clan_tag} value={c.clan_tag}>
                      {c.clan_tag}
                    </option>
                  ))}
                </select>
                <button type="submit">Create agent</button>
              </form>
            )}
            {error && (
              <p style={{ fontSize: "12.5px", color: "var(--amber)" }}>
                {error}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
