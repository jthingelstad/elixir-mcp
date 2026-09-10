import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { quotaReading } from "../../lib/quota.js";

/**
 * Profile — the account you are signed in as, all on one page.
 *
 * Who you are (address, read-only; tier; how you sign in; the timezone,
 * which is editable here), then what the tier gives you (the limits
 * table and the upgrade request), then today's quota with the reset
 * time and a way to earn more. Settings & tier was folded into this page (Jamie,
 * 2026-09-10): two pages for one account was one too many. Overview
 * reports the same slot numbers through the same component, and Usage
 * reads the same quota through lib/quota.js, so nothing here can
 * disagree with them.
 */
export function Profile({ me, refresh, navigate }) {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.usage().then((r) => r.ok && setUsage(r.data));
  }, []);
  const e = me?.entitlements;
  const quota = usage ? quotaReading(usage) : null;
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Profile</h1>
        <p className="page__lede">
          Who you are signed in as, what your tier records for you, and
          today&rsquo;s budget. Reading is universal; the tier only changes what
          we record.
        </p>
      </div>

      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head">
          <span className="panel-title">Account</span>
        </div>
        <div style={{ padding: "4px 0" }}>
          <Field
            label="Email"
            value={
              me?.email ?? (
                <span style={{ color: "var(--ink-faint)" }}>
                  not on file yet — it is recorded at your next sign-in
                </span>
              )
            }
            note="the address we send mail to; never shown anywhere public"
          />
          <Field
            label="Sign-in"
            value="Email link, or a six-digit code"
            note="no password to keep"
          />
          <Field
            label="Timezone"
            value={
              <select
                aria-label="Timezone"
                value={me?.timezone ?? ""}
                onChange={async (ev) => {
                  await api.setTimezone(ev.target.value);
                  refresh();
                }}
                style={{ width: "auto" }}
              >
                <option value="">UTC (default)</option>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            }
            note="sets day boundaries in your charts and local times in tool responses; storage stays UTC"
          />
        </div>
      </section>

      <TierPanel me={me} entitlements={e} usage={usage} />

      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head" style={{ flexWrap: "wrap" }}>
          <span className="panel-title">Your quota</span>
          {quota && (
            <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
              {quota.resets}
            </span>
          )}
          <a
            style={{ marginLeft: "auto", fontSize: "13px" }}
            href="/account/usage"
            onClick={(ev) => {
              ev.preventDefault();
              navigate("/account/usage");
            }}
          >
            Where it went ›
          </a>
        </div>
        <div
          className="panel__body"
          style={{ display: "flex", gap: "18px", flexWrap: "wrap" }}
        >
          {quota ? (
            <>
              <QuotaMeter label="Calls" line={quota.calls} />
              <QuotaMeter label="Live fetches" line={quota.fetches} />
            </>
          ) : (
            <span style={{ color: "var(--ink-faint)", fontSize: "13px" }}>
              Reading today&rsquo;s spend…
            </span>
          )}
        </div>
        <a
          href="/docs/operators"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            borderTop: "1px solid var(--line-soft)",
            padding: "13px 16px",
            color: "inherit",
          }}
        >
          <span style={{ color: "var(--accent-bright)", display: "flex" }}>
            <Icon name="server" size={17} />
          </span>
          <span style={{ fontSize: "13.5px", color: "var(--ink-body)" }}>
            Need more quota? Run a collector.
          </span>
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "7px",
              fontSize: "13.5px",
              color: "var(--ink-link)",
            }}
          >
            Operators guide <Icon name="arrow-right" size={15} />
          </span>
        </a>
      </section>

      <a
        href="/docs/roles"
        className="panel"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "14px 16px",
          color: "inherit",
        }}
      >
        <span style={{ color: "var(--accent-bright)", display: "flex" }}>
          <Icon name="file-text" size={17} />
        </span>
        <span style={{ fontSize: "14px", color: "var(--ink-body)" }}>
          What each tier records
        </span>
        <span
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "7px",
            fontSize: "13.5px",
            color: "var(--ink-link)",
          }}
        >
          Docs ▸ Tiers <Icon name="arrow-right" size={15} />
        </span>
      </a>
    </>
  );
}

function Field({ label, value, note }) {
  return (
    <div
      style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "baseline",
        gap: "14px",
        flexWrap: "wrap",
        borderTop: "1px solid var(--line-soft)",
      }}
    >
      <span
        style={{
          flex: "0 0 96px",
          fontSize: "12.5px",
          color: "var(--ink-faint)",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: "13.5px", color: "var(--ink)" }}>{value}</span>
      {note && (
        <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
          {note}
        </span>
      )}
    </div>
  );
}

function QuotaMeter({ label, line }) {
  return (
    <div style={{ flex: "1 1 240px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "8px",
          marginBottom: "8px",
          fontSize: "13.5px",
        }}
      >
        <span style={{ color: "var(--ink-body)" }}>{label}</span>
        <span style={{ fontSize: "12px", color: "var(--ink-faint)" }}>
          per day
        </span>
        <span
          className={"meter__value" + (line.full ? " meter__value--full" : "")}
          style={{ marginLeft: "auto" }}
        >
          {line.label}
        </span>
      </div>
      <div className="meter">
        <div className="meter__fill" style={{ width: `${line.pct}%` }} />
      </div>
    </div>
  );
}

/**
 * What your tier allows, as the ladder publishes it.
 *
 * This was four slot meters, which showed a quarter of the ladder and
 * none of the numbers a reader had just seen on /docs/roles — so the
 * page that is ABOUT your tier disagreed with the page that documents
 * tiers (Jamie, 2026-09-10). Same eight rows, same order, same source:
 * packages/contracts/roles.ts through /api/me. A dash where a tier has
 * none of something, "unlimited" where there is no ceiling, and what you
 * are using beside it wherever we count it.
 */
function TierLimits({ me, entitlements: e, usage }) {
  if (!e) return null;
  const cap = (v) => (v == null ? "unlimited" : v === 0 ? "—" : fmt(v));
  const rows = [
    ["Player recordings", e.player_slots?.used, e.player_slots?.limit],
    [
      "Clan watches · activity",
      e.activity_clans?.used,
      e.activity_clans?.limit,
    ],
    [
      "Clan watches · comprehensive",
      e.comprehensive_clans?.used,
      e.comprehensive_clans?.limit,
    ],
    ["Tool calls / day", usage?.today_calls, e.mcp_calls_per_day],
    ["Live CR fetches / day", usage?.live_today, e.live_fetches_per_day],
    ["Collections you curate", e.collections?.used, e.collections?.limit],
    ["Integrations", undefined, e.integrations?.limit],
    ["Agents", undefined, e.agents?.limit],
  ];
  return (
    <div className="table__scroll">
      <table className="table" style={{ minWidth: "380px" }}>
        <thead>
          <tr>
            <th>WHAT</th>
            <th style={{ textAlign: "right" }}>USING</th>
            <th style={{ textAlign: "right" }}>
              {String(me?.role ?? "your tier").toUpperCase()} ALLOWS
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, used, limit]) => (
            <tr key={label}>
              <td>{label}</td>
              <td
                className="mono"
                style={{
                  textAlign: "right",
                  color:
                    limit != null && limit !== 0 && used >= limit
                      ? "var(--warn)"
                      : undefined,
                }}
              >
                {used == null ? "—" : fmt(used)}
              </td>
              <td className="mono" style={{ textAlign: "right" }}>
                {cap(limit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : String(n));

function TierPanel({ me, entitlements: e, usage }) {
  const [asking, setAsking] = useState(false);
  const [reqRole, setReqRole] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState("");
  const ladder = ["member", "leader", "family", "partner"];
  const higher = ladder.slice(ladder.indexOf(me?.role) + 1);
  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head" style={{ flexWrap: "wrap" }}>
        <span className="panel-title">Your tier</span>
        {/* The one place gold is a badge: it names what is yours. */}
        <span className="chip chip--tier">{me?.role}</span>
        <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
          Granted by hand.
          {e?.operator_bonus_applied && " Collector bonus applied."}
        </span>
        {higher.length > 0 && (
          <button
            type="button"
            className="btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setAsking((v) => !v)}
          >
            Ask for more slots <Icon name="arrow-right" size={15} />
          </button>
        )}
      </div>
      <div className="panel__body">
        <TierLimits me={me} entitlements={e} usage={usage} />
        {asking && (
          <form
            style={{
              display: "flex",
              gap: "6px",
              marginTop: "16px",
              flexWrap: "wrap",
              alignItems: "center",
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
              aria-label="Tier to request"
              value={reqRole}
              onChange={(ev) => setReqRole(ev.target.value)}
              style={{ flex: "1 1 120px", width: "auto" }}
            >
              <option value="">upgrade to…</option>
              {higher.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              aria-label="Why"
              placeholder="why?"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              style={{ flex: "2 1 160px" }}
            />
            <button className="btn btn--primary" disabled={!reqRole}>
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
