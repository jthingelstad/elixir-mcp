import { useState } from "react";
import { api } from "../../api.js";
import { keys, useEmailPrefs, useInvalidate } from "../../lib/queries.js";

const BLURB = {
  clan_report:
    "Monday: your clan's week, war result, joins and leaves, the roster.",
  arena_week:
    "Tuesday: your own battles by mode, decks, who you faced. Skipped on a quiet week.",
  tracking_report:
    "Wednesday: everyone you track, you in full, watchers in a line.",
  top_100: "Thursday: one shared read of the global Path of Legends top 100.",
  collector_activity:
    "Sunday: what your collectors fetched and earned. Only if you run one.",
  milestone:
    "As it happens: a new arena, a promotion, a first. Never a move down.",
};

/** The six product emails, each a switch, each with a way to see it now.
 *  Absent preference means on; the switch writes only a change. */
export function EmailPanel() {
  const { data, isLoading } = useEmailPrefs();
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const kinds = data?.kinds ?? [];
  const flip = async (kind, enabled) => {
    setBusy(kind);
    try {
      await api.setEmailPref(kind, enabled);
      await invalidate(keys.email);
    } finally {
      setBusy(null);
    }
  };
  const sendNow = async (kind, label) => {
    setBusy(kind);
    setNote(null);
    try {
      const r = await api.sendEmailNow(kind);
      const d = r.data ?? {};
      setNote(
        d.sent
          ? `${label} is on its way to your inbox.`
          : d.reason === "nothing_to_say"
            ? `${label} has nothing to say for you this week, so nothing was sent.`
            : d.reason === "off_or_ineligible"
              ? `${label} is off, or does not apply to your account.`
              : `${label} could not be composed${d.detail ? `: ${d.detail}` : "."}`,
      );
      await invalidate(keys.email);
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="panel" style={{ marginBottom: "14px" }}>
      <div className="panel__head" style={{ flexWrap: "wrap" }}>
        <span className="panel-title">Email</span>
        <span style={{ fontSize: "12.5px", color: "var(--ink-faint)" }}>
          all on by default; every issue carries a one-click off
        </span>
      </div>
      {isLoading && (
        <p style={{ padding: "12px 16px", color: "var(--ink-faint)" }}>
          Loading…
        </p>
      )}
      {kinds.map((k) => (
        <div
          key={k.kind}
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "14px",
            flexWrap: "wrap",
            borderTop: "1px solid var(--line-soft)",
            opacity: k.applies ? 1 : 0.55,
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flex: "1 1 260px",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={k.enabled}
              disabled={busy === k.kind}
              onChange={(ev) => flip(k.kind, ev.target.checked)}
              aria-label={`${k.label} email`}
            />
            <span>
              <span style={{ fontSize: "13.5px", color: "var(--ink)" }}>
                {k.label}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: "12.5px",
                  color: "var(--ink-faint)",
                }}
              >
                {BLURB[k.kind]}
              </span>
            </span>
          </label>
          <button
            type="button"
            className="btn btn--sm"
            disabled={busy === k.kind || !k.applies}
            onClick={() => sendNow(k.kind, k.label)}
            title="Compose this email for your account now and send it to your address"
          >
            {busy === k.kind ? "Working…" : "Send me this now"}
          </button>
        </div>
      ))}
      {note && (
        <p
          style={{
            padding: "10px 16px 4px",
            fontSize: "12.5px",
            color: "var(--ink-dim)",
          }}
        >
          {note}
        </p>
      )}
      {data?.recent?.length > 0 && (
        <div
          style={{
            padding: "8px 16px 12px",
            borderTop: "1px solid var(--line-soft)",
            fontSize: "12.5px",
            color: "var(--ink-faint)",
          }}
        >
          Recent:{" "}
          {data.recent
            .slice(0, 6)
            .map(
              (r) =>
                `${r.subject ?? r.kind} (${new Date(r.sent_at).toLocaleDateString()})`,
            )
            .join(" · ")}
        </div>
      )}
    </section>
  );
}
