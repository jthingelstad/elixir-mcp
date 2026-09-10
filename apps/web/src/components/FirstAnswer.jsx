import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { Icon } from "./Icon.jsx";

/**
 * "What your agent can answer" — the readiness list on Overview.
 *
 * Five lines, each one a thing that has to be true before an agent can
 * answer about YOU rather than about the corpus, and each one carrying
 * the evidence for its own state. Readiness is derived from the record
 * (services/web-api/src/first-answer.mjs), never from a second
 * onboarding state that would then have to be kept in step with it.
 *
 * This replaced a panel that did the same job in three steps plus a
 * sample paragraph, two timestamps, four actions, a prompt list and a
 * disclosure. The prompts and the read-out live on Connections, which is
 * where you go when a connection is the thing you are working on.
 */
function ago(value) {
  if (!value) return null;
  const s = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const n = (v) => (v ?? 0).toLocaleString();

/** The five lines, given what the record says. Each returns its own
 *  detail for both states, because "not yet" is only useful if it says
 *  what it is waiting for. */
function readiness(data) {
  const p = data?.player;
  const c = data?.connection;
  const clan = data?.clan;
  const captured = Boolean(p && (p.battles_30d > 0 || p.last_battle_at));
  return [
    {
      label: "Add the player you play as",
      done: Boolean(p),
      detail: p
        ? `${p.name ?? "your player"} ${p.player_tag} · primary`
        : "nothing here defaults to you",
    },
    {
      label: "We have a profile for them",
      done: Boolean(p?.profile_available),
      detail: p?.profile_available
        ? `snapshot ${ago(p.profile_observed_at) ?? "recorded"}`
        : "arrives on the first poll",
    },
    {
      label: "Enough battles to answer questions",
      done: captured,
      detail: captured
        ? `${n(p.battles_30d)} in the last 30 days · ${n(p.battles_7d)} in the last 7`
        : "0 recorded",
    },
    {
      label: "Add a clan for war history",
      done: Boolean(clan),
      detail: clan
        ? `${clan.name ?? clan.clan_tag} · ${n(clan.war_weeks)} war weeks`
        : "your player's clan is offered once we see it",
    },
    {
      label: "Connect a client",
      done: (c?.active_connections ?? 0) > 0,
      detail:
        (c?.active_connections ?? 0) === 0
          ? "no connections yet"
          : c.last_data_read_at
            ? // A quiet connection and a broken one look the same from
              // here, so say when one last read rather than only that
              // one exists.
              `${c.active_connections} connected · last read ${ago(c.last_data_read_at)}`
            : `${c.active_connections} connected · nothing has read yet`,
    },
  ];
}

export function FirstAnswer({ claimsKey }) {
  const { data, loading, error, refresh } = useFirstAnswer(claimsKey);
  const steps = data ? readiness(data) : [];
  const ready = steps.filter((s) => s.done).length;

  return (
    <section style={{ marginBottom: "22px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "10px",
          padding: "0 0 13px",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: "14px", fontWeight: 600 }}>
          What your agent can answer
        </span>
        {data && (
          <span
            className="mono"
            style={{ color: "var(--ink-faint)", whiteSpace: "nowrap" }}
          >
            {ready} of {steps.length}
          </span>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: "12.5px",
            color: "var(--ink-faint)",
          }}
        >
          {loading
            ? "checking the record…"
            : ready === steps.length && data
              ? "Your agent can answer about you, your clan and your friends."
              : "Your agent can already read the corpus. These are what it needs to answer about you."}
        </span>
      </div>

      {error && (
        <div className="callout callout--warn" role="alert">
          <Icon name="circle-dashed" size={17} />
          <span>
            Could not check your recorded data.{" "}
            <button className="btn btn--sm" onClick={refresh}>
              Check again
            </button>{" "}
            Your players and tier below are unaffected.
          </span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column" }}>
        {steps.map((s) => (
          <div
            key={s.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "11px 2px",
              borderBottom: "1px solid var(--line-row)",
            }}
          >
            <span
              style={{
                color: s.done ? "var(--ok)" : "var(--ink-quiet-icon)",
                display: "flex",
              }}
            >
              <Icon name={s.done ? "circle-check" : "circle-dashed"} />
            </span>
            <span
              style={{
                fontSize: "14px",
                color: s.done ? "var(--ink-body)" : "var(--ink)",
              }}
            >
              {s.label}
            </span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: "12.5px",
                color: "var(--ink-faint)",
                textAlign: "right",
              }}
            >
              {s.detail}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
