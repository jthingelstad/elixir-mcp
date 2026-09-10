import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { CapabilityEditor } from "../../components/CapabilityEditor.jsx";
import { ConnectionQuestions } from "../../components/ConnectionQuestions.jsx";
import { Fresh } from "../../components/Fresh.jsx";

/**
 * Connections — everything that can call Elixir with your authority.
 *
 * One typed table, not two. An OAuth client you consented to and an
 * agent holding its own key are different mechanisms with the same
 * consequence: they read your record and they spend your daily budget.
 * Splitting them across two screens meant the question "what can reach
 * my data" had two answers and neither was complete.
 *
 * Each row says which DOOR it uses (/mcp is you; /a/<id>/mcp is an
 * agent) and whether it acts AS YOU or FOR A CLAN, because those are the
 * two things that decide what a caller sees.
 *
 * The headline failure gets a callout of its own: a credential that no
 * longer works but is still being presented. It reads nothing, but it
 * will keep trying until somebody stops it, and nothing else on the
 * account would ever mention it.
 */
export function Connections({ me, navigate }) {
  const [connections, setConnections] = useState(null);
  const [refusals, setRefusals] = useState([]);
  const [agents, setAgents] = useState(null);
  const [copied, setCopied] = useState(false);

  const load = () => {
    api.connections().then((r) => {
      if (!r.ok) return;
      setConnections(r.data.connections ?? []);
      setRefusals(r.data.refusals ?? []);
    });
    api.myPrincipals().then((r) => r.ok && setAgents(r.data.agents ?? []));
  };
  useEffect(() => {
    load();
  }, []);

  const url = `${window.location.origin}/mcp`;
  const clients = connections ?? [];
  const keyed = (agents ?? []).filter(
    // An agent that connected over OAuth already has a row as a client;
    // this is the other kind, holding a service key of its own.
    (a) => !clients.some((c) => c.principal?.public_id === a.public_id),
  );
  const total = clients.length + keyed.length;

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Connections</h1>
        <p className="page__lede">
          Everything that can call Elixir with your authority. All of it spends
          your daily budget.
        </p>
      </div>

      {refusals.map((r, i) => (
        <div
          key={i}
          className="callout callout--warn"
          style={{ marginBottom: "14px", alignItems: "center" }}
        >
          <Icon name="circle-dashed" size={17} />
          <span>
            <span className="mono">{r.reason}</span> · {r.attempts}{" "}
            {r.attempts === 1 ? "refused attempt" : "refused attempts"}
            {r.ip ? (
              <>
                {" from "}
                <span className="mono">{r.ip}</span>
                {r.country ? ` (${r.country})` : ""}
              </>
            ) : null}
            {r.last_seen ? (
              <>
                {", last "}
                <Fresh ts={r.last_seen} />
              </>
            ) : null}
            .{" "}
            {r.kind === "service_token"
              ? "A revoked or suspended agent key, or a service token, is still being presented: it reads nothing, and keeps trying until whatever holds it is stopped or re-keyed."
              : "Usually a client you disconnected that is still running: it reads nothing, and keeps trying until it is stopped."}
          </span>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          padding: "0 0 13px",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600 }}>
          {total} with access
        </span>
        <button
          className="btn"
          style={{ marginLeft: "auto" }}
          onClick={() => navigate("/account/agents")}
        >
          <Icon name="plus" size={16} />
          New agent
        </button>
        <button
          className="btn btn--primary"
          onClick={() => {
            navigator.clipboard?.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy /mcp URL"}
        </button>
      </div>

      {connections !== null && total === 0 ? (
        <div className="empty">
          <div className="empty__title">Nothing connected yet</div>
          <p className="empty__body">
            Add <span className="mono">{url}</span> as a remote MCP server in
            your client. The sign-in uses the same email as this account, and
            what it may do is yours to set on the consent screen.
          </p>
          <a className="btn" href="/docs/quickstart">
            Quickstart <Icon name="arrow-right" size={15} />
          </a>
        </div>
      ) : (
        <div className="table__scroll">
          <table className="table" style={{ minWidth: "760px" }}>
            <thead>
              <tr>
                <th>CALLER</th>
                <th>ACTS</th>
                <th>MAY DO</th>
                <th>LAST CALL</th>
                <th style={{ textAlign: "right" }}>7D</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const agent = c.principal;
                return (
                  <tr key={c.family_id}>
                    <td>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "9px",
                        }}
                      >
                        <span
                          style={{
                            color: "var(--accent-bright)",
                            display: "flex",
                          }}
                        >
                          <Icon name="plug" size={16} />
                        </span>
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>
                          {c.client_name ?? "client"}
                        </span>
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "var(--ink-faint)",
                          marginTop: "3px",
                        }}
                      >
                        connected{" "}
                        {new Date(c.created_at).toISOString().slice(0, 10)}
                        {c.usage?.ip ? ` · ${c.usage.ip}` : ""}
                        {c.usage?.country ? ` (${c.usage.country})` : ""}
                      </span>
                    </td>
                    <td>
                      <span
                        className="btn btn--sm"
                        style={{ cursor: "default" }}
                      >
                        {agent ? "for a clan" : "as you"}
                      </span>
                      <span
                        className="mono"
                        style={{
                          display: "block",
                          color: "var(--ink-faint)",
                          marginTop: "4px",
                        }}
                      >
                        {agent
                          ? `/${agent.kind === "agent" ? "a" : "i"}/${agent.public_id}/mcp`
                          : "/mcp"}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "normal" }}>
                      <CapabilityEditor
                        scope={c.scope ?? "cr:read"}
                        onSave={async (scope) => {
                          const r = await api.setConnectionScope(
                            c.family_id,
                            scope,
                          );
                          if (r.ok) load();
                          return r;
                        }}
                      />
                      <span
                        style={{
                          display: "block",
                          fontSize: "12px",
                          color: "var(--ink-faint)",
                        }}
                      >
                        granted at sign-in
                      </span>
                    </td>
                    <td>
                      {/* When it last CALLED, not when it last collected a
                          token: a client that refreshes on a timer looks
                          busy by the second measure and may have done
                          nothing for weeks. */}
                      <Fresh ts={c.usage?.at ?? c.last_token_at} />
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      {c.usage?.calls_7d ?? 0}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn--sm"
                        onClick={async () => {
                          await api.revokeConnection(c.family_id);
                          load();
                        }}
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                );
              })}
              {keyed.map((a) => (
                <tr key={a.account_id ?? a.public_id}>
                  <td>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "9px",
                      }}
                    >
                      <span
                        style={{
                          color:
                            a.status === "approved"
                              ? "var(--accent-bright)"
                              : "var(--warn)",
                          display: "flex",
                        }}
                      >
                        <Icon name="shield-check" size={16} />
                      </span>
                      <a
                        style={{ fontWeight: 600, fontSize: "14px" }}
                        onClick={() =>
                          navigate(`/account/agents/${a.account_id}`)
                        }
                      >
                        {a.name ?? a.public_id}
                      </a>
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color:
                          a.status === "approved"
                            ? "var(--ink-faint)"
                            : "var(--warn)",
                        marginTop: "3px",
                      }}
                    >
                      {a.status === "approved"
                        ? "agent · its own key"
                        : "suspended · key reads as invalid"}
                    </span>
                  </td>
                  <td>
                    <span className="btn btn--sm" style={{ cursor: "default" }}>
                      {(a.clans ?? []).length > 0 ? "for a clan" : "as you"}
                    </span>
                    <span
                      className="mono"
                      style={{
                        display: "block",
                        color: "var(--ink-faint)",
                        marginTop: "4px",
                      }}
                    >
                      /a/{a.public_id}/mcp
                    </span>
                  </td>
                  <td style={{ whiteSpace: "normal" }}>
                    {(a.clans ?? []).map((c) => c.clan_tag).join(", ") ||
                      "your record"}
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "var(--ink-faint)",
                      }}
                    >
                      set on the agent
                    </span>
                  </td>
                  <td>
                    <Fresh ts={a.last_call_at} />
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {a.calls_7d ?? 0}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      className="btn btn--sm"
                      onClick={() =>
                        navigate(`/account/agents/${a.account_id}`)
                      }
                    >
                      Open
                    </button>
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
        A client signed in as you sees your players, your clans and your feed.
        An agent sees what its own key allows and, if it is a clan&rsquo;s
        agent, that clan — which is what makes the two different.
      </p>

      <div style={{ marginTop: "24px" }}>
        <ConnectionQuestions
          claimsKey={(me?.claims ?? [])
            .map((c) => `${c.player_tag}:${c.is_primary}`)
            .join(",")}
          navigate={navigate}
        />
      </div>
    </>
  );
}
