import { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

export function Admin({ me }) {
  const [requests, setRequests] = useState([]);
  const [gateways, setGateways] = useState([]);
  const [clans, setClans] = useState([]);
  const [usage, setUsage] = useState(null);
  const [clanTag, setClanTag] = useState("");
  const [clanError, setClanError] = useState("");

  const load = useCallback(async () => {
    const [r, g, c, u] = await Promise.all([
      api.adminRequests(),
      api.adminGateways(),
      api.adminClans(),
      api.adminUsage(),
    ]);
    if (r.ok) setRequests(r.data.requests);
    if (g.ok) setGateways(g.data.gateways);
    if (c.ok) setClans(c.data.clans);
    if (u.ok) setUsage(u.data);
  }, []);

  useEffect(() => {
    if (me?.is_owner) load();
  }, [me, load]);

  if (!me?.is_owner) return <p className="notice">Owner only.</p>;

  return (
    <>
      <div className="panel">
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

      <div className="panel">
        <h3>Recorded clans</h3>
        <p>
          Each active clan records its roster, war race, and every open
          member&rsquo;s battles and profile.
        </p>
        {clans.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Clan</th>
                <th>Name</th>
                <th>Status</th>
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
        <div className="panel">
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

      <div className="panel">
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
    </>
  );
}
