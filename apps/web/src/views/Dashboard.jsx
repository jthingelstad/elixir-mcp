import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Activity } from "./Activity.jsx";
import { CollectorDetail } from "./CollectorDetail.jsx";

function freshness(ts) {
  if (!ts) return "never";
  const mins = Math.round((Date.now() - Date.parse(ts)) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function Dashboard({ me, refresh, navigate, page = "overview" }) {
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");
  const [tzSaved, setTzSaved] = useState(false);
  const [gateways, setGateways] = useState(null); // null until first load
  const [usage, setUsage] = useState(null);
  const [connections, setConnections] = useState([]);
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
      <TierPanel me={me} page={page} />
      <ClansPanel page={page} />
      {page === "activity" && <Activity />}
      {page === "collector" && <CollectorDetail />}
      <div className="panel" hidden={page !== "overview"}>
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
                        title="Toggle whether this tag feeds your notification pipe"
                        onClick={async () => {
                          await api.claimAction({
                            player_tag: c.player_tag,
                            action: c.notify ? "notify_off" : "notify_on",
                          });
                          refresh();
                        }}
                      >
                        {c.notify ? "🔔 on" : "🔕 off"}
                      </button>{" "}
                      <button
                        className="quiet"
                        onClick={async () => {
                          await api.claimAction({
                            player_tag: c.player_tag,
                            action: "remove",
                          });
                          refresh();
                        }}
                      >
                        Remove
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
            Add a player (added = recorded)
            <input
              placeholder="#20JJJ2CCRU"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button>Add</button>
        </form>
      </div>

      {usage && (
        <div className="panel" hidden={page !== "usage"}>
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
        <div className="panel" hidden={page !== "agents"}>
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

      <div className="panel" hidden={page !== "agents"}>
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

      <div className="panel" hidden={page !== "collector"}>
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

      <div className="panel" hidden={page !== "feedback"}>
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

      <div className="panel" hidden={page !== "overview"}>
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

/** The entitlement ladder, made visible: your tier, what it includes,
 *  how full each slot is, and the self-serve upgrade request. */
function TierPanel({ me, page }) {
  const [reqRole, setReqRole] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const e = me.entitlements;
  if (!e) return null;
  const ladder = ["member", "leader", "family", "partner"];
  const higher = ladder.slice(ladder.indexOf(me.role) + 1);
  const slot = (label, s) =>
    s && (
      <li>
        {label}: <strong>{s.used}</strong> of{" "}
        <strong>{s.limit === null ? "unlimited" : s.limit}</strong>
      </li>
    );
  return (
    <div className="panel" hidden={page !== "overview"}>
      <h3>Your tier</h3>
      <p>
        You are on the <strong>{me.role}</strong> tier
        {e.operator_bonus_applied
          ? " (collector bonus applied — thanks for running one)"
          : ""}
        . Tiers set what Elixir records for you and your daily call budget —
        never what you can read; all recorded game data is open to every
        account. <a href="/docs">Full ladder in the docs.</a>
      </p>
      <ul>
        {slot("Player recordings", e.player_slots)}
        {slot("Clan watches (activity)", e.activity_clans)}
        {slot("Clan watches (comprehensive)", e.comprehensive_clans)}
        {slot("Collections", e.collections)}
        <li>
          Tool calls per day:{" "}
          <strong>{e.mcp_calls_per_day ?? "unlimited"}</strong> · live CR
          fetches: <strong>{e.live_fetches_per_day ?? "unlimited"}</strong>
        </li>
      </ul>
      {higher.length > 0 && (
        <form
          onSubmit={async (ev) => {
            ev.preventDefault();
            const r = await api.requestRole(reqRole, note || undefined);
            setSent(
              r.ok
                ? "Request sent — the maintainer reviews these by hand."
                : (r.data?.message ?? "Could not send the request."),
            );
          }}
        >
          <strong>Request an upgrade</strong>{" "}
          <select
            value={reqRole}
            onChange={(ev) => setReqRole(ev.target.value)}
          >
            <option value="">choose a tier…</option>
            {higher.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>{" "}
          <input
            placeholder="Why? (your clan, your project…)"
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            style={{ width: "16rem" }}
          />{" "}
          <button disabled={!reqRole}>Request</button>
          {sent && <p className="fine">{sent}</p>}
        </form>
      )}
    </div>
  );
}

/** Added = recorded (Jamie, 2026-09-05): adding a clan starts capture
 *  within your tier's slots; the only per-clan setting is notify. */
function ClansPanel({ page }) {
  const [data, setData] = useState(null);
  const [tag, setTag] = useState("");
  const [scope, setScope] = useState("comprehensive");
  const [err, setErr] = useState("");
  const load = async () => {
    const r = await api.myClans();
    if (r.ok) setData(r.data);
  };
  useEffect(() => {
    load();
  }, []);
  const act = async (body) => {
    setErr("");
    const r = await api.myClanAction(body);
    if (!r.ok) setErr(r.data?.message ?? "failed");
    await load();
  };
  return (
    <div className="panel" hidden={page !== "overview"}>
      <h3>Your clans</h3>
      <p>
        Added means recorded — activity (roster + war) or comprehensive (every
        member&rsquo;s battles) — within your tier&rsquo;s slots
        {data
          ? ` (activity ${data.slots.activity.used}/${data.slots.activity.limit ?? "∞"}, comprehensive ${data.slots.comprehensive.used}/${data.slots.comprehensive.limit ?? "∞"})`
          : ""}
        . The bell controls your notification pipe.
      </p>
      {err && <p className="error">{err}</p>}
      {data?.home_clan &&
        !data.clans.some((c) => c.clan_tag === data.home_clan.clan_tag) && (
          <p>
            ★ Your clan: <strong>{data.home_clan.name ?? "—"}</strong>{" "}
            <code>{data.home_clan.clan_tag}</code>{" "}
            {["comprehensive", "activity"].map((sc) => {
              const slot = data.slots[sc];
              const full = slot.limit !== null && slot.used >= slot.limit;
              return (
                <button
                  key={sc}
                  className="quiet"
                  disabled={full}
                  style={full ? { opacity: 0.45 } : undefined}
                  title={
                    full
                      ? slot.limit === 0
                        ? `Your tier has no ${sc} slots — request an upgrade above.`
                        : `Your ${sc} slots are full.`
                      : `Add your clan at ${sc} scope`
                  }
                  onClick={() =>
                    act({
                      action: "add",
                      clan_tag: data.home_clan.clan_tag,
                      scope: sc,
                    })
                  }
                >
                  Add {sc}
                </button>
              );
            })}
          </p>
        )}
      {data?.clans?.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Clan</th>
              <th>Tag</th>
              <th>Scope</th>
              <th>Recording</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.clans.map((c) => (
              <tr key={c.clan_tag}>
                <td>
                  {data.home_clan?.clan_tag === c.clan_tag ? "★ " : ""}
                  {c.name ?? "—"}
                </td>
                <td>
                  <code>{c.clan_tag}</code>
                </td>
                <td>
                  {c.scope}
                  {c.effective_scope && c.effective_scope !== c.scope
                    ? ` (running ${c.effective_scope})`
                    : ""}
                </td>
                <td>{c.recording_status === "active" ? "●" : "—"}</td>
                <td>
                  <button
                    className="quiet"
                    title="Toggle whether this clan feeds your notification pipe"
                    onClick={() =>
                      act({
                        clan_tag: c.clan_tag,
                        action: c.notify ? "notify_off" : "notify_on",
                      })
                    }
                  >
                    {c.notify ? "🔔 on" : "🔕 off"}
                  </button>{" "}
                  <button
                    className="quiet"
                    onClick={() =>
                      act({ clan_tag: c.clan_tag, action: "remove" })
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
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await act({ action: "add", clan_tag: tag, scope });
          setTag("");
        }}
        style={{ marginTop: "0.8rem" }}
      >
        <input
          placeholder="#CLANTAG"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          style={{ width: "9rem" }}
        />{" "}
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="comprehensive">comprehensive</option>
          <option value="activity">activity</option>
        </select>{" "}
        <button disabled={!tag}>Add clan</button>
      </form>
    </div>
  );
}
