import { useEffect, useState } from "react";
import { api } from "../../api.js";

import { CapabilityEditor } from "../../components/CapabilityEditor.jsx";

import { ConnectionQuestions } from "../../components/ConnectionQuestions.jsx";
import { Fresh } from "../../components/Fresh.jsx";

export function Connections({ me, navigate }) {
  const [connections, setConnections] = useState(null);
  const [refusals, setRefusals] = useState([]);
  const [copied, setCopied] = useState(false);
  const load = () =>
    api.connections().then((r) => {
      if (!r.ok) return;
      setConnections(r.data.connections);
      setRefusals(r.data.refusals ?? []);
    });
  useEffect(() => {
    load();
  }, []);
  const url = "https://elixir.poapkings.com/mcp";

  return (
    <div className="cols">
      <div className="cols__main">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Connected clients</span>
          </div>
          <div className="panel__body">
            <p
              style={{
                fontSize: "12.5px",
                color: "var(--ink-faint)",
                marginTop: 0,
              }}
            >
              Signed in as you. These see your players, your clans and your feed
              — which is exactly what makes them different from an agent.
            </p>
          </div>
          {refusals.length > 0 && (
            <div
              className="panel__body"
              style={{ color: "var(--warn)", fontSize: "12.5px" }}
            >
              <strong>
                Something is presenting a credential of yours that no longer
                works.
              </strong>
              {refusals.map((r, i) => (
                <div key={i} style={{ marginTop: "4px" }}>
                  <span className="mono">{r.reason}</span> · {r.attempts}{" "}
                  {r.attempts === 1 ? "attempt" : "attempts"}
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
                </div>
              ))}
              <div style={{ marginTop: "6px", color: "var(--ink-faint)" }}>
                Usually a client you disconnected that is still running. It
                cannot read anything — but until it is stopped or reconnected,
                it will keep trying.
              </div>
            </div>
          )}
          {connections?.length === 0 && (
            <div className="panel__body" style={{ color: "var(--ink-faint)" }}>
              Nothing connected yet.
            </div>
          )}
          {connections?.length > 0 && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>CLIENT</th>
                    <th>CAPABILITIES</th>
                    <th>CONNECTED</th>
                    <th>LAST ACTIVE</th>
                    <th>FROM</th>
                    <th>CALLS 7D</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c) => (
                    <tr key={c.family_id}>
                      <td>
                        {c.client_name ?? "client"}
                        {c.principal ? (
                          <div
                            style={{
                              fontSize: "11.5px",
                              color: "var(--ink-faint)",
                            }}
                          >
                            {c.principal.name ?? c.principal.kind}
                            {" · "}
                            <span className="mono">
                              /{c.principal.kind === "agent" ? "a" : "i"}/
                              {c.principal.public_id}/mcp
                            </span>
                          </div>
                        ) : (
                          <div
                            style={{
                              fontSize: "11.5px",
                              color: "var(--ink-faint)",
                            }}
                          >
                            you
                          </div>
                        )}
                      </td>
                      <td>
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
                      </td>
                      <td className="mono">
                        {new Date(c.created_at).toISOString().slice(0, 10)}
                      </td>
                      <td>
                        {/* When it last CALLED, not when it last collected a
                            token: a client that refreshes on a timer looks
                            busy by the second measure and may have done
                            nothing for weeks. Falls back for connections that
                            predate per-call attribution. */}
                        <Fresh ts={c.usage?.at ?? c.last_token_at} />
                      </td>
                      <td className="mono">
                        {c.usage?.ip ? (
                          <>
                            {c.usage.ip}
                            {c.usage.country ? ` · ${c.usage.country}` : ""}
                          </>
                        ) : (
                          <span style={{ color: "var(--ink-faint)" }}>—</span>
                        )}
                      </td>
                      <td>{c.usage?.calls_7d ?? 0}</td>
                      <td>
                        <button
                          className="btn--text"
                          onClick={async () => {
                            await api.revokeConnection(c.family_id);
                            load();
                          }}
                        >
                          Disconnect
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
            <span className="panel-title">Connect a client</span>
          </div>
          <div className="panel__body">
            <div
              style={{
                display: "flex",
                gap: "8px",
                alignItems: "center",
                padding: "10px 12px",
                background: "var(--ground-sunken)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-control)",
              }}
            >
              <code style={{ flex: 1 }}>{url}</code>
              <button
                className="btn--text"
                onClick={() => {
                  navigator.clipboard?.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <p style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
              Add it as a remote MCP server in your client of choice — the OAuth
              sign-in uses the same email as this account.
            </p>
          </div>
        </section>
        <ConnectionQuestions
          claimsKey={(me?.claims ?? [])
            .map((c) => `${c.player_tag}:${c.is_primary}`)
            .join(",")}
          navigate={navigate}
        />
      </div>
    </div>
  );
}
