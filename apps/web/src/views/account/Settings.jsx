import { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Icon } from "../../components/Icon.jsx";
import { SlotMeters } from "../../components/SlotMeter.jsx";
import { quotaReading } from "../../lib/quota.js";

/**
 * Settings & tier — the tier reading with its controls, and the account
 * settings that are not about a player.
 *
 * Split out of Overview by the 2026-09-09 design, and drawn the way it
 * draws it: three stacked sections (your tier, your quota, account) and
 * a link card to the tier matrix in the docs. Overview reports the same
 * slot numbers through the same component, and Usage reads the same
 * quota through lib/quota.js, so the three cannot disagree.
 *
 * The console links out to reference rather than restating it: what
 * each tier records lives in the docs.
 */
export function Settings({ me, refresh, navigate }) {
  const [usage, setUsage] = useState(null);
  useEffect(() => {
    api.usage().then((r) => r.ok && setUsage(r.data));
  }, []);
  const e = me?.entitlements;
  const quota = usage ? quotaReading(usage) : null;

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Settings &amp; tier</h1>
        <p className="page__lede">
          Your tier decides how much we record for you. Reading is universal.
        </p>
      </div>

      <TierPanel me={me} entitlements={e} />

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

      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head">
          <span className="panel-title">Account</span>
        </div>
        <div style={{ padding: "4px 0" }}>
          {/* We never store the address itself — account.email_hash is a
              sha256 and the session carries only an id — so the row says
              how you sign in rather than showing an email we do not
              have. */}
          <Field
            label="Sign-in"
            value="Email link, or a six-digit code"
            note="the address is kept only as a hash"
          />
          <Field
            label="Timezone"
            value={<Timezone me={me} refresh={refresh} />}
            note="sets day boundaries in your charts and local times in tool responses; storage stays UTC"
          />
        </div>
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
      }}
    >
      <span
        style={{
          flex: "0 0 110px",
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

function TierPanel({ me, entitlements: e }) {
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
        <SlotMeters entitlements={e} />
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

function Timezone({ me, refresh }) {
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];
  return (
    <select
      aria-label="Timezone"
      value={me?.timezone ?? ""}
      onChange={async (e) => {
        await api.setTimezone(e.target.value);
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
  );
}
