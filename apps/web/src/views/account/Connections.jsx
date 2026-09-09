import { useEffect, useState } from "react";
import { api } from "../../api.js";

import { Fresh } from "../../components/Fresh.jsx";

export function Connections() {
  const [connections, setConnections] = useState(null);
  const [copied, setCopied] = useState(false);
  const load = () =>
    api.connections().then((r) => r.ok && setConnections(r.data.connections));
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
                color: "var(--faint)",
                marginTop: 0,
              }}
            >
              Signed in as you. These see your players, your clans and your feed
              — which is exactly what makes them different from an agent.
            </p>
          </div>
          {connections?.length === 0 && (
            <div className="panel__body" style={{ color: "var(--faint)" }}>
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
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c) => (
                    <tr key={c.family_id}>
                      <td>{c.client_name ?? "client"}</td>
                      <td className="mono">{c.scope ?? "cr:read"}</td>
                      <td className="mono">
                        {new Date(c.created_at).toISOString().slice(0, 10)}
                      </td>
                      <td>
                        <Fresh ts={c.last_token_at} />
                      </td>
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
                background: "var(--well)",
                border: "1px solid var(--edge)",
                borderRadius: "var(--r-md)",
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
            <p style={{ fontSize: "12.5px", color: "var(--faint)" }}>
              Add it as a remote MCP server in your client of choice — the OAuth
              sign-in uses the same email as this account. Start with{" "}
              <code>elixir_my_players</code>, then try{" "}
              <em>&ldquo;what&rsquo;s my record this week?&rdquo;</em>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
