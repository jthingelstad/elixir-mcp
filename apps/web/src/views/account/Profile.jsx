import { api } from "../../api.js";

/**
 * Profile — who you are signed in as.
 *
 * Read-only, apart from the timezone: the address (kept for the mail we
 * send you, never on a public surface), the tier, how you sign in, and
 * the timezone every date window and local time in a tool response is
 * read in. No design of its own yet (Jamie, 2026-09-10): the rail's
 * identity block leads here, and the tier's controls stay on Settings
 * & tier.
 */
export function Profile({ me, refresh }) {
  const timezones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : ["UTC"];
  return (
    <>
      <div style={{ marginBottom: "18px" }}>
        <h1 className="page__title">Profile</h1>
        <p className="page__lede">
          The account you are signed in as. What it records, and its budget, are
          on Settings &amp; tier.
        </p>
      </div>

      <section className="panel" style={{ maxWidth: "640px" }}>
        <div className="panel__head">
          <span className="panel-title">Account</span>
          <span className="chip chip--tier" style={{ marginLeft: "auto" }}>
            {me?.role}
          </span>
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
            label="Tier"
            value={me?.role}
            note="changes on Settings & tier"
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
            }
            note="sets day boundaries in your charts and local times in tool responses; storage stays UTC"
          />
        </div>
      </section>
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
