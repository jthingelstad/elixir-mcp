import { useState } from "react";
import { api } from "../../api.js";

/**
 * Settings & tier — the tier reading with its controls, and the account
 * settings that are not about a player.
 *
 * Split out of Overview by the 2026-09-09 design. Overview reports the
 * same slot numbers; they are read from the same entitlements object so
 * the two cannot disagree.
 *
 * The console links out to reference rather than restating it: the tier
 * matrix lives in the docs, and the strip at the foot of this page is
 * how you get there.
 */
export function Settings({ me, refresh }) {
  return (
    <>
      <div style={{ marginBottom: "20px" }}>
        <h1 className="page__title">Settings &amp; tier</h1>
        <p className="page__lede">
          What Elixir records for you, and how this account reads dates.
        </p>
      </div>
      <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <TierRail me={me} />
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <Timezone me={me} refresh={refresh} />
        </div>
      </div>
    </>
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
            color: "var(--ink-faint)",
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
          style={{
            fontSize: "12px",
            color: "var(--ink-faint)",
            marginTop: "12px",
          }}
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
                  color: "var(--ink-faint)",
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
