import { useEffect, useState } from "react";
import { api } from "../api.js";

function freshness(ts) {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - Date.parse(ts)) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function Dashboard({ me, refresh, navigate }) {
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");
  const [tzSaved, setTzSaved] = useState(false);
  const [gateways, setGateways] = useState(null); // null until first load
  const [usage, setUsage] = useState(null);
  const [connections, setConnections] = useState([]);
  const [activity, setActivity] = useState([]);
  const [fb, setFb] = useState({
    message: "",
    category: "general",
    sent: false,
  });
  const [ladder, setLadder] = useState([]);
  const [gwForm, setGwForm] = useState({
    name: "",
    ip: "",
    error: "",
    done: false,
  });

  useEffect(() => {
    if (me?.authenticated)
      api.usage().then((r) => {
        if (r.ok) setUsage(r.data);
      });
    if (me?.authenticated)
      api.connections().then((r) => {
        if (r.ok) setConnections(r.data.connections);
      });
    if (me?.authenticated)
      api.activity().then((r) => {
        if (r.ok) setActivity(r.data.events);
      });
  }, [me?.authenticated]);

  if (me === null) return <p className="notice">Loading…</p>;
  if (!me.authenticated) {
    return (
      <div className="panel">
        <h3>Sign in first</h3>
        <p>
          <a
            href="/signin"
            onClick={(e) => {
              e.preventDefault();
              navigate("/signin");
            }}
          >
            Sign in
          </a>{" "}
          to see your dashboard.
        </p>
      </div>
    );
  }

  const recordingFor = (t) => me.recordings.find((r) => r.subject_tag === t);
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];

  return (
    <>
      <div className="panel">
        <h3>Your players</h3>
        {me.claims.length === 0 && (
          <p>No tags claimed yet — add yours below.</p>
        )}
        {me.claims.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Tag</th>
                <th>Name</th>
                <th>Clan</th>
                <th>Recording</th>
                <th>Last poll</th>
                <th>Fetches/24h</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {me.claims.map((c) => {
                const rec = recordingFor(c.player_tag);
                return (
                  <tr key={c.player_tag}>
                    <td>
                      <code>{c.player_tag}</code>
                      {c.is_primary ? " ★" : ""}
                    </td>
                    <td>{c.name ?? "—"}</td>
                    <td>
                      {c.last_known_clan_tag ? (
                        <code>{c.last_known_clan_tag}</code>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <span
                        className={`status ${rec?.status ?? "not_recording"}`}
                      >
                        {rec?.status ?? "off"}
                      </span>
                    </td>
                    <td>{freshness(rec?.freshest_poll)}</td>
                    <td>{rec?.fetches_24h ?? ""}</td>
                    <td>
                      <button
                        className="quiet"
                        onClick={async () => {
                          await api.setRecording(
                            c.player_tag,
                            rec?.status === "active" ? "stop" : "start",
                          );
                          refresh();
                        }}
                      >
                        {rec?.status === "active" ? "Stop" : "Record"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            const res = await api.addClaim(tag);
            if (res.ok) {
              setTag("");
              refresh();
            } else setError("That doesn’t look like a CR tag.");
          }}
        >
          <label>
            Claim a player tag
            <input
              placeholder="#20JJJ2CCRU"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button>Claim</button>
        </form>
      </div>

      {usage && (
        <div className="panel">
          <h3>Usage</h3>
          <p>
            Today: <strong>{usage.today_calls}</strong>
            {usage.quota_max ? ` of ${usage.quota_max}` : ""} tool calls
            {usage.live_max
              ? ` · ${usage.live_today} of ${usage.live_max} live fetches`
              : usage.live_today
                ? ` · ${usage.live_today} live fetches`
                : ""}
          </p>
          {usage.days.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Calls</th>
                  <th>Errors</th>
                </tr>
              </thead>
              <tbody>
                {usage.days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td>{d.calls}</td>
                    <td>{d.errors || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {usage.top_tools.length > 0 && (
            <p className="notice">
              Most used:{" "}
              {usage.top_tools.map((t) => `${t.tool} (${t.calls})`).join(", ")}
            </p>
          )}
        </div>
      )}

      {connections.length > 0 && (
        <div className="panel">
          <h3>Connected agents</h3>
          <p>
            MCP clients authorized on your account. Disconnecting revokes their
            tokens immediately.
          </p>
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Connected</th>
                <th>Last active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.family_id}>
                  <td>{c.client_name ?? "Unnamed client"}</td>
                  <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                    {c.last_token_at
                      ? new Date(c.last_token_at).toLocaleString()
                      : "—"}
                  </td>
                  <td>
                    <button
                      className="quiet"
                      onClick={async () => {
                        await api.revokeConnection(c.family_id);
                        const r = await api.connections();
                        if (r.ok) setConnections(r.data.connections);
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

      <div className="panel">
        <h3>Connect your agent</h3>
        <p>
          Add this MCP server to Claude (or any MCP client) and sign in with
          your email when it asks: <code>https://elixir.poapkings.com/mcp</code>
        </p>
        <p>
          Start with <code>elixir_my_players</code>, then try{" "}
          <em>&ldquo;what&rsquo;s my record this week?&rdquo;</em>
        </p>
      </div>

      <div className="panel">
        <h3>Run a gateway</h3>
        <p>
          Gateways are the machines that talk to the Clash Royale API — one
          shared rate budget, more machines for redundancy. You need a machine
          with a static IP that stays on.
        </p>
        {gateways === null ? (
          <button
            className="quiet"
            onClick={async () => {
              const r = await api.myGateways();
              setGateways(r.ok ? r.data.gateways : []);
              const l = await api.gatewayLadder();
              if (l.ok) setLadder(l.data.ladder);
            }}
          >
            Show my gateways
          </button>
        ) : (
          <>
            {gateways.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Arena</th>
                    <th>Points</th>
                    <th>Last success</th>
                  </tr>
                </thead>
                <tbody>
                  {gateways.map((g) => (
                    <tr key={g.gateway_id}>
                      <td>{g.name}</td>
                      <td>
                        <span className={`status ${g.status}`}>{g.status}</span>
                      </td>
                      <td>
                        {g.arena?.name}
                        {g.arena?.next
                          ? ` (${g.arena.next.points_needed.toLocaleString()} to ${g.arena.next.name})`
                          : " (max!)"}
                      </td>
                      <td>{g.fetch_points?.toLocaleString()}</td>
                      <td>{freshness(g.last_success_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ladder.length > 0 && (
              <>
                <h3>Gateway ladder</h3>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Gateway</th>
                      <th>Arena</th>
                      <th>Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ladder.map((g) => (
                      <tr key={g.name}>
                        <td>{g.rank}</td>
                        <td>{g.name}</td>
                        <td>{g.arena}</td>
                        <td>{g.points.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {gwForm.done ? (
              <p className="notice">
                Hand raised. You&rsquo;ll get an email when your key is ready;
                then follow the operator guide in the repo (docs/OPERATORS.md).
              </p>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await api.raiseGateway(gwForm.name, gwForm.ip);
                  if (res.ok) {
                    setGwForm({ ...gwForm, error: "", done: true });
                    const r = await api.myGateways();
                    if (r.ok) setGateways(r.data.gateways);
                  } else {
                    setGwForm({
                      ...gwForm,
                      error:
                        res.data.error === "name_taken"
                          ? "That name is taken."
                          : "Name (letters/digits/hyphens) and an IPv4 address, please.",
                    });
                  }
                }}
              >
                <label>
                  Gateway name
                  <input
                    placeholder="kitchen-mac"
                    value={gwForm.name}
                    onChange={(e) =>
                      setGwForm({ ...gwForm, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  Static IP
                  <input
                    placeholder="203.0.113.7"
                    value={gwForm.ip}
                    onChange={(e) =>
                      setGwForm({ ...gwForm, ip: e.target.value })
                    }
                  />
                </label>
                {gwForm.error && <p className="error">{gwForm.error}</p>}
                <button>Raise my hand</button>
              </form>
            )}
          </>
        )}
      </div>

      {activity.length > 0 && (
        <div className="panel">
          <h3>Recent activity</h3>
          <table>
            <tbody>
              {activity.map((e, i) => (
                <tr key={i}>
                  <td>{new Date(e.created_at).toLocaleString()}</td>
                  <td>{e.kind.replaceAll("_", " ")}</td>
                  <td>{e.detail?.player_tag ?? e.detail?.name ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <h3>Send feedback</h3>
        <p>
          Bugs, wrong-looking data, missing capabilities, praise — it all goes
          straight to the roadmap. Your agent can do this too, with the{" "}
          <code>elixir_feedback</code> tool.
        </p>
        {fb.sent ? (
          <p className="notice">Received — thank you.</p>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await api.sendFeedback(fb.message, fb.category);
              if (r.ok) setFb({ ...fb, sent: true });
            }}
          >
            <select
              value={fb.category}
              onChange={(e) => setFb({ ...fb, category: e.target.value })}
            >
              <option value="general">general</option>
              <option value="bug">bug</option>
              <option value="data_quality">data quality</option>
              <option value="feature">feature idea</option>
              <option value="praise">praise</option>
            </select>
            <textarea
              rows="3"
              maxLength="4000"
              placeholder="What should we know?"
              value={fb.message}
              onChange={(e) => setFb({ ...fb, message: e.target.value })}
              style={{ display: "block", width: "100%", margin: ".5rem 0" }}
            />
            <button disabled={!fb.message.trim()}>Send</button>
          </form>
        )}
      </div>

      <div className="panel">
        <h3>Timezone</h3>
        <p>Battle times and daily windows resolve in your local time.</p>
        <select
          value={me.timezone ?? "UTC"}
          onChange={async (e) => {
            await api.setTimezone(e.target.value);
            setTzSaved(true);
            refresh();
          }}
        >
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
        {tzSaved && <p className="notice">Saved.</p>}
      </div>
    </>
  );
}
