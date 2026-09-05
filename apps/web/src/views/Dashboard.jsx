import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Activity } from "./Activity.jsx";
import { CollectorPage } from "./CollectorDetail.jsx";

/**
 * Account (design handoff §6–11). Overview is a two-column console:
 * players + clans tables in the main column, tier/agents/timezone in
 * the rail. Notify is a switch (a bell glyph is a notification, not a
 * setting); ★ marks yours; connect-your-agent lives on Agents.
 */

const TAG_OK = /^#?[0289PYLQGRJCUVOo]{3,12}$/;

function ago(ts, now = Date.now()) {
  if (!ts) return null;
  const s = (now - Date.parse(ts)) / 1000;
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function Fresh({ ts }) {
  // Render-time clock read is deliberate but the linter is right that
  // it must be stable per mount: capture once.
  const [now] = useState(() => Date.now());
  if (!ts) return <span className="freshness freshness--never">never</span>;
  const s = (now - Date.parse(ts)) / 1000;
  const cls =
    s < 900
      ? "freshness freshness--fresh"
      : s < 86400
        ? "freshness freshness--stale"
        : "freshness";
  return <span className={cls}>{ago(ts)}</span>;
}

function NickCell({ tag, current, refresh }) {
  const [value, setValue] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const v = value.trim();
    if (v === (current ?? "")) return;
    setBusy(true);
    await api.explore("elixir_nickname", {
      player_tag: tag,
      nickname: v || null,
    });
    setBusy(false);
    refresh();
  };
  return (
    <input
      className="mono"
      value={value}
      placeholder="—"
      maxLength={40}
      disabled={busy}
      aria-label={`nickname for ${tag}`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      style={{
        width: "7.5rem",
        padding: "3px 8px",
        fontSize: "12px",
        background: "transparent",
        borderColor: "transparent",
      }}
    />
  );
}

function Switch({ on, onToggle, label }) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={on ? "true" : "false"}
      aria-label={label}
      onClick={onToggle}
    />
  );
}

export function Dashboard({ me, refresh, navigate, page }) {
  if (me === null) return <p style={{ color: "var(--faint)" }}>Loading…</p>;
  if (page === "activity") return <Activity />;
  if (page === "collector") return <CollectorPage />;
  if (page === "agents") return <Agents />;
  if (page === "usage") return <Usage me={me} />;
  if (page === "feedback") return <Feedback navigate={navigate} />;
  return <Overview me={me} refresh={refresh} navigate={navigate} />;
}

/* ── Overview ────────────────────────────────────────────── */

function Overview({ me, refresh, navigate }) {
  const [tag, setTag] = useState("");
  const [tagErr, setTagErr] = useState("");
  const [clans, setClans] = useState(null);
  const [clanTag, setClanTag] = useState("");
  const [clanScope, setClanScope] = useState("comprehensive");
  const [clanErr, setClanErr] = useState("");

  const loadClans = () => api.myClans().then((r) => r.ok && setClans(r.data));
  useEffect(() => {
    loadClans();
  }, []);

  const recFor = (t) => me.recordings?.find((r) => r.subject_tag === t);
  const e = me.entitlements;

  return (
    <div className="cols">
      <div className="cols__main" style={{ flex: "1 1 560px" }}>
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Your players</span>
            {e && (
              <span className="sample">
                {e.player_slots.used} of {e.player_slots.limit ?? "∞"} slots
              </span>
            )}
          </div>
          {me.claims.length === 0 ? (
            <div className="panel__body">
              <div className="empty">
                <div className="empty__mark">＋</div>
                <div className="empty__title">No players added yet</div>
                <div className="empty__body">
                  Added means recorded — capture starts on the next poll.
                </div>
              </div>
            </div>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>TAG</th>
                    <th>NAME</th>
                    <th>NICKNAME</th>
                    <th>CLAN</th>
                    <th>RECORDING</th>
                    <th>LAST POLL</th>
                    <th className="num">FETCHES/24H</th>
                    <th>NOTIFY</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {me.claims.map((c) => {
                    const rec = recFor(c.player_tag);
                    return (
                      <tr key={c.player_tag}>
                        <td>
                          {c.is_primary && <span className="yours">★ </span>}
                          <span className="tag">{c.player_tag}</span>
                        </td>
                        <td>{c.name ?? "—"}</td>
                        <td>
                          <NickCell
                            tag={c.player_tag}
                            current={c.nickname}
                            refresh={refresh}
                          />
                        </td>
                        <td>
                          {c.last_known_clan_tag ? (
                            <span className="tag">{c.last_known_clan_tag}</span>
                          ) : (
                            <span className="nil">—</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`chip ${rec?.status === "active" ? "chip--active" : ""}`}
                          >
                            {rec?.status ?? "off"}
                          </span>
                        </td>
                        <td>
                          <Fresh ts={rec?.freshest_poll} />
                        </td>
                        <td className="num">{rec?.fetches_24h ?? ""}</td>
                        <td>
                          <Switch
                            on={c.notify}
                            label={`notify for ${c.player_tag}`}
                            onToggle={async () => {
                              await api.claimAction({
                                player_tag: c.player_tag,
                                action: c.notify ? "notify_off" : "notify_on",
                              });
                              refresh();
                            }}
                          />
                        </td>
                        <td>
                          <button
                            className="btn--text"
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
            </div>
          )}
          <div className="panel__actions">
            <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
              Add a player
            </span>
            <input
              className="mono"
              placeholder="#20JJJ2CCRU"
              aria-invalid={tagErr ? "true" : undefined}
              value={tag}
              onChange={(e2) => {
                setTag(e2.target.value);
                setTagErr("");
              }}
              style={{ flex: "0 1 180px" }}
            />
            <button
              className="btn"
              onClick={async () => {
                if (!TAG_OK.test(tag.trim())) {
                  setTagErr("That doesn't look like a CR tag.");
                  return;
                }
                const r = await api.addClaim(tag.trim());
                if (r.ok) {
                  setTag("");
                  refresh();
                } else setTagErr(r.data?.message ?? "Could not add.");
              }}
            >
              Add
            </button>
            {tagErr && <span className="field-error">{tagErr}</span>}
            <span
              style={{
                marginLeft: "auto",
                fontSize: "12px",
                color: "var(--dim)",
              }}
            >
              added = recorded
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Your clans</span>
            {clans && (
              <span className="sample">
                activity {clans.slots.activity.used}/
                {clans.slots.activity.limit ?? "∞"} · comprehensive{" "}
                {clans.slots.comprehensive.used}/
                {clans.slots.comprehensive.limit ?? "∞"}
              </span>
            )}
          </div>
          {clans?.home_clan &&
            !clans.clans.some(
              (c) => c.clan_tag === clans.home_clan.clan_tag,
            ) && (
              <div className="panel__body" style={{ paddingBottom: 0 }}>
                <div className="notice">
                  <span>
                    <span className="yours">★</span> Your clan:{" "}
                    <strong>{clans.home_clan.name ?? "—"}</strong>{" "}
                    <span className="tag">{clans.home_clan.clan_tag}</span>{" "}
                    <button
                      className="btn--text"
                      onClick={async () => {
                        await api.myClanAction({
                          action: "add",
                          clan_tag: clans.home_clan.clan_tag,
                          scope: "comprehensive",
                        });
                        loadClans();
                      }}
                    >
                      Add comprehensive
                    </button>
                    <button
                      className="btn--text"
                      onClick={async () => {
                        await api.myClanAction({
                          action: "add",
                          clan_tag: clans.home_clan.clan_tag,
                          scope: "activity",
                        });
                        loadClans();
                      }}
                    >
                      Add activity
                    </button>
                  </span>
                </div>
              </div>
            )}
          {clans?.clans?.length > 0 && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>CLAN</th>
                    <th>TAG</th>
                    <th>SCOPE</th>
                    <th>RECORDING</th>
                    <th>NOTIFY</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clans.clans.map((c) => (
                    <tr key={c.clan_tag}>
                      <td>
                        {clans.home_clan?.clan_tag === c.clan_tag && (
                          <span className="yours">★ </span>
                        )}
                        {c.name ?? "—"}
                      </td>
                      <td>
                        <span className="tag">{c.clan_tag}</span>
                      </td>
                      <td>
                        <span className="tag-chip">
                          {c.scope}
                          {c.effective_scope && c.effective_scope !== c.scope
                            ? " †"
                            : ""}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`chip ${c.recording_status === "active" ? "chip--active" : ""}`}
                        >
                          {c.recording_status ?? "off"}
                        </span>
                      </td>
                      <td>
                        <Switch
                          on={c.notify}
                          label={`notify for ${c.clan_tag}`}
                          onToggle={async () => {
                            await api.myClanAction({
                              clan_tag: c.clan_tag,
                              action: c.notify ? "notify_off" : "notify_on",
                            });
                            loadClans();
                          }}
                        />
                      </td>
                      <td>
                        <button
                          className="btn--text"
                          onClick={async () => {
                            await api.myClanAction({
                              clan_tag: c.clan_tag,
                              action: "remove",
                            });
                            loadClans();
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
          <div className="panel__actions">
            <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
              Add a clan
            </span>
            <input
              className="mono"
              placeholder="#CLANTAG"
              value={clanTag}
              onChange={(e2) => {
                setClanTag(e2.target.value);
                setClanErr("");
              }}
              style={{ flex: "0 1 150px" }}
            />
            <select
              value={clanScope}
              onChange={(e2) => setClanScope(e2.target.value)}
              style={{ width: "auto" }}
            >
              <option value="comprehensive">comprehensive</option>
              <option value="activity">activity</option>
            </select>
            <button
              className="btn"
              onClick={async () => {
                const r = await api.myClanAction({
                  action: "add",
                  clan_tag: clanTag.trim(),
                  scope: clanScope,
                });
                if (r.ok) {
                  setClanTag("");
                  loadClans();
                } else setClanErr(r.data?.message ?? "Could not add.");
              }}
            >
              Add
            </button>
            {clanErr && <span className="field-error">{clanErr}</span>}
          </div>
          {clans?.clans?.some(
            (c) => c.effective_scope && c.effective_scope !== c.scope,
          ) && (
            <div className="panel__note">
              † another account records this clan comprehensively — the shared
              recording runs at the widest scope anyone requested.
            </div>
          )}
        </section>
      </div>

      <div className="cols__rail">
        <TierRail me={me} />
        <section className="panel">
          <div
            className="panel__body"
            style={{ display: "flex", gap: "10px", alignItems: "baseline" }}
          >
            <span className="panel-title">Your agents</span>
            <a
              style={{ marginLeft: "auto", fontSize: "12.5px" }}
              onClick={() => navigate("/account/agents")}
            >
              Agents ›
            </a>
          </div>
        </section>
        <Timezone me={me} refresh={refresh} />
      </div>
    </div>
  );
}

function TierRail({ me }) {
  const [reqRole, setReqRole] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const e = me.entitlements;
  if (!e) return null;
  const ladder = ["member", "leader", "family", "partner"];
  const higher = ladder.slice(ladder.indexOf(me.role) + 1);
  const meterRow = (label, s) =>
    s && (
      <div key={label} style={{ marginBottom: "10px" }}>
        <div
          style={{
            display: "flex",
            fontSize: "12px",
            color: "var(--faint)",
            marginBottom: "4px",
          }}
        >
          <span>{label}</span>
          <span className="mono" style={{ marginLeft: "auto" }}>
            {s.used} / {s.limit ?? "∞"}
          </span>
        </div>
        <div className="meter">
          <div
            className="meter__fill"
            style={{
              width:
                s.limit && s.limit > 0
                  ? `${Math.min(100, (s.used / s.limit) * 100)}%`
                  : s.used > 0
                    ? "6%"
                    : "0%",
            }}
          />
        </div>
      </div>
    );
  return (
    <section className="panel">
      <div className="panel__head">
        <span className="panel-title">Your tier</span>
        <span className="tag-chip">{me.role}</span>
        {e.operator_bonus_applied && (
          <span className="caveat">collector bonus</span>
        )}
      </div>
      <div className="panel__body">
        {meterRow("player recordings", e.player_slots)}
        {meterRow("clan watches · activity", e.activity_clans)}
        {meterRow("clan watches · comprehensive", e.comprehensive_clans)}
        {meterRow("collections", e.collections)}
        <div
          style={{ fontSize: "12px", color: "var(--faint)", marginTop: "12px" }}
        >
          <span className="mono">{e.mcp_calls_per_day ?? "∞"}</span> tool calls
          / day · <span className="mono">{e.live_fetches_per_day ?? "∞"}</span>{" "}
          live fetches
        </div>
        {higher.length > 0 && (
          <form
            style={{
              display: "flex",
              gap: "6px",
              marginTop: "12px",
              flexWrap: "wrap",
            }}
            onSubmit={async (ev) => {
              ev.preventDefault();
              const r = await api.requestRole(reqRole, note || undefined);
              setSent(
                r.ok
                  ? "Request sent — reviewed by hand."
                  : (r.data?.message ?? "Could not send."),
              );
            }}
          >
            <select
              value={reqRole}
              onChange={(ev) => setReqRole(ev.target.value)}
              style={{ flex: "1 1 100px", width: "auto" }}
            >
              <option value="">upgrade to…</option>
              {higher.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              placeholder="why?"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              style={{ flex: "2 1 120px" }}
            />
            <button className="btn btn--quiet" disabled={!reqRole}>
              Request
            </button>
            {sent && (
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--dim)",
                  flexBasis: "100%",
                }}
              >
                {sent}
              </span>
            )}
          </form>
        )}
      </div>
      <div className="panel__note">
        Tiers set what Elixir records for you and your daily call budget — never
        what you can read.
      </div>
    </section>
  );
}

function Timezone({ me, refresh }) {
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];
  return (
    <section className="panel">
      <div className="panel__head">
        <span className="panel-title">Timezone</span>
      </div>
      <div className="panel__body">
        <select
          value={me.timezone ?? ""}
          onChange={async (e) => {
            await api.setTimezone(e.target.value);
            refresh();
          }}
        >
          <option value="">UTC (default)</option>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
      <div className="panel__note">
        Storage stays UTC; your zone shapes date windows and local times in tool
        responses.
      </div>
    </section>
  );
}

/* ── Agents ──────────────────────────────────────────────── */

function Agents() {
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
            <span className="panel-title">Connected agents</span>
          </div>
          {connections?.length === 0 && (
            <div className="panel__body" style={{ color: "var(--faint)" }}>
              No agents connected yet.
            </div>
          )}
          {connections?.length > 0 && (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>CLIENT</th>
                    <th>CONNECTED</th>
                    <th>LAST ACTIVE</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {connections.map((c) => (
                    <tr key={c.family_id}>
                      <td>{c.client_name ?? "agent"}</td>
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
            <span className="panel-title">Connect another agent</span>
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
              Add it as a remote MCP server in your agent of choice — the OAuth
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

/* ── Usage ───────────────────────────────────────────────── */

function Usage({ me }) {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.usage().then((r) => r.ok && setUsage(r.data));
  }, []);
  if (!usage) return <p style={{ color: "var(--faint)" }}>Loading…</p>;
  const max = Math.max(...(usage.days ?? []).map((d) => d.calls), 1);
  return (
    <div className="cols">
      <div className="cols__main">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Daily tool calls</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11.5px",
                color: "var(--dim)",
              }}
            >
              {usage.today_calls} of {usage.quota_max ?? "∞"} today
            </span>
          </div>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>DAY</th>
                  <th className="num">CALLS</th>
                  <th className="num">ERRORS</th>
                  <th style={{ width: "40%" }}></th>
                </tr>
              </thead>
              <tbody>
                {(usage.days ?? []).map((d) => (
                  <tr key={d.day}>
                    <td className="mono">{d.day}</td>
                    <td className="num">{d.calls}</td>
                    <td className="num">
                      {d.errors ? (
                        <span style={{ color: "var(--red)" }}>{d.errors}</span>
                      ) : (
                        <span className="nil">—</span>
                      )}
                    </td>
                    <td>
                      <div className="meter">
                        <div
                          className="meter__fill"
                          style={{ width: `${(d.calls / max) * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel__note">
            Live CR fetches today: {usage.live_today ?? 0} of{" "}
            {usage.live_max ?? me?.entitlements?.live_fetches_per_day ?? "∞"} —
            the live lane spends the shared CR budget; recorded reads do not.
          </div>
        </section>
      </div>
      <div className="cols__rail">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Most used tools</span>
            <span className="caveat">7 days</span>
          </div>
          <div className="panel__body">
            {(usage.top_tools ?? []).map((t) => {
              const tmax = Math.max(
                ...(usage.top_tools ?? []).map((x) => x.calls),
                1,
              );
              return (
                <div key={t.tool} style={{ marginBottom: "10px" }}>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "12px",
                      marginBottom: "4px",
                    }}
                  >
                    <code>{t.tool}</code>
                    <span
                      className="mono"
                      style={{ marginLeft: "auto", color: "var(--dim)" }}
                    >
                      {t.calls}
                    </span>
                  </div>
                  <div className="meter">
                    <div
                      className="meter__fill"
                      style={{ width: `${(t.calls / tmax) * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Feedback ────────────────────────────────────────────── */

function Feedback({ navigate }) {
  const [items, setItems] = useState(null);
  const [category, setCategory] = useState("general");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const load = () =>
    api
      .myFeedback()
      .then((r) => r.ok && setItems(r.data.feedback ?? r.data.items ?? []));
  useEffect(() => {
    load();
  }, []);
  return (
    <div className="cols">
      <div className="cols__main">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Your feedback</span>
            <span
              className="mono"
              style={{
                marginLeft: "auto",
                fontSize: "11px",
                color: "var(--dim)",
              }}
            >
              never actioned invisibly
            </span>
          </div>
          {items?.length === 0 && (
            <div className="panel__body" style={{ color: "var(--faint)" }}>
              Nothing filed yet — your agent can file too, with{" "}
              <code>elixir_feedback</code>.
            </div>
          )}
          {(items ?? []).map((f) => (
            <div
              key={f.feedback_id}
              style={{
                padding: "12px 16px",
                borderTop: "1px solid var(--edge-soft)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span
                  className="mono"
                  style={{ color: "var(--dim)", fontSize: "11.5px" }}
                >
                  #{f.feedback_id}
                </span>
                <span className="tag-chip">{f.category}</span>
                <span
                  className={`chip ${
                    f.status === "done"
                      ? "chip--active"
                      : f.status === "new"
                        ? "chip--pending"
                        : ""
                  }`}
                >
                  {f.status}
                </span>
                {f.shipped_in && (
                  <a
                    className="mono"
                    style={{ fontSize: "11.5px" }}
                    onClick={() => navigate("/data/changelog")}
                  >
                    shipped in {f.shipped_in} ›
                  </a>
                )}
                <span
                  className="mono"
                  style={{
                    marginLeft: "auto",
                    fontSize: "11px",
                    color: "var(--dim)",
                  }}
                >
                  {f.created_at?.slice(0, 10)}
                </span>
              </div>
              <div
                style={{
                  fontSize: "12.5px",
                  marginTop: "6px",
                  color: "var(--muted)",
                }}
              >
                {f.message}
              </div>
              {f.response && (
                <div
                  style={{
                    marginTop: "8px",
                    paddingLeft: "12px",
                    borderLeft: "2px solid var(--edge-strong)",
                    fontSize: "12.5px",
                    lineHeight: 1.55,
                  }}
                >
                  {f.response}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
      <div className="cols__rail">
        <section className="panel">
          <div className="panel__head">
            <span className="panel-title">Send feedback</span>
          </div>
          <div
            className="panel__body"
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {sent ? (
              <div className="notice">Received — thank you.</div>
            ) : (
              <>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {[
                    "general",
                    "bug",
                    "data_quality",
                    "feature",
                    "praise",
                    "other",
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <textarea
                  rows={5}
                  placeholder="Wrong-looking data, missing capability, praise…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div>
                  <button
                    className="btn"
                    disabled={!message.trim()}
                    onClick={async () => {
                      const r = await api.sendFeedback(message, category);
                      if (r.ok) {
                        setSent(true);
                        load();
                      }
                    }}
                  >
                    Send
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
