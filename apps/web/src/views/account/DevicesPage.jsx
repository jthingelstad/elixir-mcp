import { ago } from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { keys, useInvalidate, useSessions } from "../../lib/queries.js";

/**
 * Profile → Devices: every session that can still act as you, this one marked,
 * each with a sign-out, and one for everywhere else (0083, Jamie's ask
 * 2026-09-12 after the sign-in review). "Everywhere else" keeps this
 * session, so the list can be read afterwards to see that it worked;
 * the sign-out button in the rail ends this one.
 *
 * Sessions slide thirty days from last use and end at ninety; the
 * expiry shown is the sliding one, which every use of that device
 * moves.
 */
export function DevicesPage({ navigate }) {
  const query = useSessions();
  const sessions = query.data?.sessions ?? null;
  // When the data was read: 0 until it is, and nothing below uses it
  // before then.
  const now = query.dataUpdatedAt;
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidate();
  const load = () => invalidate(keys.sessions);
  const others = sessions?.filter((s) => !s.current) ?? [];
  const where = (s) =>
    [s.from, s.country].filter(Boolean).join(" · ") || "address not seen";
  return (
    <>
      <div className="page__crumb">
        <a onClick={() => navigate("/account/profile")}>‹ Profile</a>
      </div>
      <div className="mb-[18px]">
        <h1 className="page__title">Devices</h1>
        <p className="page__lede">
          Every session that can still act as you, this one marked. Agents and
          connected clients are separate and live under Connections.
        </p>
      </div>
      <section className="panel" style={{ marginBottom: "14px" }}>
        <div className="panel__head" style={{ flexWrap: "wrap" }}>
          <span className="panel-title">Signed in</span>
          <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
            {sessions
              ? `${sessions.length} signed in`
              : "reading your sessions…"}
          </span>
          {others.length > 0 && (
            <button
              className="btn btn--sm btn--danger"
              style={{ marginLeft: "auto" }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await api.revokeSessionsEverywhere();
                await load();
                setBusy(false);
              }}
            >
              {busy ? "Signing out…" : "Sign out everywhere else"}
            </button>
          )}
        </div>
        <div style={{ padding: "4px 0" }}>
          {sessions?.map((s) => (
            <div
              key={s.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 16px",
                borderTop: "1px solid var(--line-soft)",
                fontSize: "13.5px",
              }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ color: "var(--ink)" }}>
                  {s.client ?? "Unknown device"}
                  {s.current && (
                    <span
                      className="chip chip--ok"
                      style={{ marginLeft: "8px", fontSize: "11px" }}
                    >
                      this device
                    </span>
                  )}
                </div>
                <div style={{ color: "var(--ink-faint)", fontSize: "12.5px" }}>
                  {where(s)} · last used {ago(s.last_seen_at, now)} · signed in{" "}
                  {ago(s.created_at, now)}
                </div>
              </div>
              {!s.current && (
                <button
                  className="btn btn--sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await api.revokeSession(s.id);
                    await load();
                    setBusy(false);
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
        <p
          className="footnote"
          style={{ margin: 0, padding: "10px 16px 14px", textWrap: "pretty" }}
        >
          A sign-in lasts thirty days from its last use and ninety at most.
          Signing out here ends that device&rsquo;s session at once; agents and
          connected clients are separate and live under Connections.
        </p>
      </section>
    </>
  );
}
