import { Disclosure, Icon, Link, useClock } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { useUsage } from "../../lib/queries.js";
import { quotaReading } from "../../lib/quota.js";
import { CONSOLE } from "../../lib/console.js";
import { TimelineDiscordState } from "./TimelineDiscord.jsx";
import { discordOutcome, discordStartHref } from "../../discord.js";

/**
 * Profile — the account you are signed in as, all on one page.
 *
 * Who you are (address, read-only; tier; how you sign in; the timezone,
 * which is editable here), then what the tier gives you (the limits
 * table and how the next tier is earned), then today's quota with the
 * reset time. Settings & tier was folded into this page (Jamie,
 * 2026-09-10): two pages for one account was one too many. Overview
 * reports the same slot numbers through the same component, and Usage
 * reads the same quota through lib/quota.js, so nothing here can
 * disagree with them.
 */
export function Profile({ me, refresh, navigate }) {
  const { data: usage = null } = useUsage();
  const { zone } = useClock();
  const [tzError, setTzError] = useState(null);
  const e = me?.entitlements;
  const quota = usage ? quotaReading(usage, zone) : null;
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];

  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Profile</h1>
        <p className="page__lede">
          Your account, preferences and recording limits.
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
            note="Used for sign-in and email."
          />
          <Field
            label="Sign-in"
            value={
              me?.discord
                ? "Email link, a six-digit code, or Discord"
                : "Email link, or a six-digit code"
            }
          />
          <DiscordField me={me} refresh={refresh} />
          <Field
            label="Timezone"
            value={
              <select
                aria-label="Timezone"
                value={me?.timezone ?? ""}
                onChange={async (ev) => {
                  setTzError(null);
                  const r = await api.setTimezone(ev.target.value);
                  if (!r?.ok)
                    setTzError(
                      r?.data?.message ?? "That timezone could not be saved.",
                    );
                  refresh();
                }}
                style={{ width: "auto" }}
              >
                <option value="">UTC (default)</option>
                {/* A zone saved from another browser stays listed even
                    when this browser's list lacks it (Asia/Kolkata). */}
                {[
                  ...(me?.timezone && !timezones.includes(me.timezone)
                    ? [me.timezone]
                    : []),
                  ...timezones,
                ].map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            }
            note={tzError ?? "Used throughout Elixir."}
          />
        </div>
        <Disclosure title="Time zone details">
          <p className="page-head__note m-0">
            Your zone sets console times, how a date in a question resolves,
            local times in tool responses and the days your mail names. Storage
            stays UTC.
          </p>
        </Disclosure>
      </section>

      {/* Email and Devices are their own pages (Jamie, 2026-09-19):
          each is a subject, and the profile is who you are and what
          your tier gives you. */}
      <section className="panel mb-[14px]">
        <SubpageLink
          navigate={navigate}
          to={`${CONSOLE}/account/profile/email`}
          icon="mail"
          title="Emails from Elixir"
          note="Preferences and sent records"
        />
        <SubpageLink
          navigate={navigate}
          to={`${CONSOLE}/account/timeline`}
          icon="bell"
          title="Timeline to Discord"
          note={<TimelineDiscordState />}
        />
        <SubpageLink
          navigate={navigate}
          to={`${CONSOLE}/account/profile/devices`}
          icon="monitor-smartphone"
          title="Devices"
          note="Signed-in browsers and devices"
        />
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
          <Link
            style={{ marginLeft: "auto", fontSize: "13px" }}
            to={`${CONSOLE}/account/usage`}
          >
            Where it went ›
          </Link>
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
            Run a collector to earn the Family tier.
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

function SubpageLink({ to, icon, title, note }) {
  return (
    <Link
      className="flex items-center gap-3 px-4 py-[13px] border-t border-line-soft first:border-t-0 text-inherit"
      to={to}
    >
      <span className="flex text-accent-bright">
        <Icon name={icon} size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] text-ink">{title}</span>
        <span className="block text-[12.5px] text-ink-faint">{note}</span>
      </span>
      <span className="ml-auto flex items-center text-ink-link">
        <Icon name="arrow-right" size={15} />
      </span>
    </Link>
  );
}

/** The Discord linked to this account (#531): connect one, or disconnect
 *  it. Shown when Discord sign-in is configured, or a link exists. */
function DiscordField({ me, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // What a link round trip that came back here says, read once.
  const [came] = useState(() =>
    discordOutcome(
      typeof window === "undefined" ? "" : window.location.search,
      "link",
    ),
  );
  const linked = me?.discord ?? null;
  if (!linked && me?.features?.discord_login !== true) return null;
  return (
    <Field
      label="Discord"
      value={
        linked ? (
          <>
            {linked.username}{" "}
            <button
              type="button"
              className="link ml-2"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await api.unlinkDiscord();
                if (!r?.ok) setError("Discord could not be disconnected.");
                await refresh();
                setBusy(false);
              }}
            >
              Disconnect
            </button>
          </>
        ) : (
          <a className="link" href={discordStartHref({ intent: "link" })}>
            Connect Discord
          </a>
        )
      }
      note={
        error ??
        came?.text ??
        "Sign in with it, and a clan's Discord agent knows it is you."
      }
    />
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
    ["Agents", undefined, e.agents?.limit],
  ];
  return (
    <div className="table__scroll" tabIndex={0}>
      <table className="table" style={{ minWidth: "380px" }}>
        <thead>
          <tr>
            <th>What</th>
            <th style={{ textAlign: "right" }}>Using</th>
            <th style={{ textAlign: "right" }}>
              {String(me?.role ?? "Your tier").replace(/^./, (c) =>
                c.toUpperCase(),
              )}{" "}
              allows
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

/** How the tier is held (#530): Member is signup, Leader and Family are
 *  earned in the game and read on every request, Partner is granted. */
const TIER_GROUND = {
  member: "Member is signup.",
  leader:
    "Earned: one of your verified players leads or co-leads a clan you track.",
  family: "Earned: you run an active collector.",
  partner: "Granted by Jamie.",
  admin: "Granted by Jamie.",
  owner: "The owner.",
};

/** The next earned tier and what earns it; Partner is never asked for. */
const NEXT_TIER = {
  member: [
    ["leader", "Verify a player who leads or co-leads a clan you track."],
    ["family", "Run a collector for Elixir."],
  ],
  leader: [["family", "Run a collector for Elixir."]],
};

function TierPanel({ me, entitlements: e, usage }) {
  const next = NEXT_TIER[me?.role] ?? [];
  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head" style={{ flexWrap: "wrap" }}>
        <span className="panel-title">Your tier</span>
        {/* The one place gold is a badge: it names what is yours. */}
        <span className="chip chip--tier">{me?.role}</span>
        <span className="text-[12.5px] text-ink-faint">
          {TIER_GROUND[me?.role] ?? ""}
        </span>
      </div>
      <div className="panel__body">
        <Disclosure title="Recording and call limits">
          <TierLimits me={me} entitlements={e} usage={usage} />
        </Disclosure>
        {next.length > 0 && (
          <ul className="mt-4 mb-0 pl-5 text-[13px] text-ink-body">
            {next.map(([tier, how]) => (
              <li key={tier}>
                <span className="mono">{tier}</span>: {how}{" "}
                <a href="/docs/roles#upgrades">How it works</a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="panel__note">
        Tiers set what Elixir records for you, your daily budgets, and how many
        agents you can have — never what you can read.
      </div>
    </section>
  );
}
