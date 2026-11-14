import { ErrorState, Icon, Link, TagText, ago, useClock } from "@elixir-mcp/ui";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { nextPoll, useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { SETTINGS } from "../lib/settings.js";
import { recordJourney } from "../lib/record-journey.js";

const n = (v) => (Number.isFinite(v) ? v.toLocaleString() : "unknown");
const hasBattles = hasBattleEvidence;

/** Only a player who is you (your primary or an alt) can be proved
 *  yours; a friend or a watched player has nothing to verify. */
const provable = (p) =>
  !p || p.is_primary !== false || p.relationship === "alt";

/** Readiness is derived from the record, including a successful data read:
 * the record's own steps, on the tracked player's page. */
function readiness(data, notFound = false) {
  const p = data.player;
  const captured = hasBattles(p);
  return [
    {
      label: "Player tag saved",
      done: Boolean(p),
      detail: p
        ? `${p.name ?? "your player"} ${p.player_tag} · ${p.is_primary === false ? (p.relationship ?? "followed") : "primary"}${
            // A tag the game does not know records nothing, so it is
            // never "recording active" (2026-10-08).
            notFound
              ? " · tag not found"
              : p.recording_status
                ? ` · recording ${p.recording_status}`
                : ""
          }`
        : "nothing here defaults to you",
      action: p ? "Manage recording" : "Add your player",
      showAction: Boolean(
        p?.recording_status && p.recording_status !== "active",
      ),
      to: `${SETTINGS}/players`,
    },
    {
      label: "We have a profile for them",
      done: Boolean(p?.profile_available),
      detail: p?.profile_available
        ? p.profile_observed_at
          ? `read ${ago(p.profile_observed_at)}`
          : "read, at a time Elixir did not keep"
        : p
          ? "no profile read yet"
          : "add your player to start recording",
      action: p ? "Check recording" : null,
      to: `${SETTINGS}/players`,
    },
    {
      label: "Battles on record",
      done: captured,
      detail: !p
        ? "add your player to start recording"
        : p.battles_30d === 0 && p.last_battle_at
          ? "older retained battles · none in the last 30 days"
          : captured
            ? `${n(p.battles_30d)} in the last 30 days · ${n(p.battles_7d)} in the last 7`
            : p.battles_30d === 0
              ? "No battles recorded in the last 30 days · some may not have been read"
              : "recent battle counts unavailable",
      action: p ? "Check recording" : null,
      to: `${SETTINGS}/players`,
    },
    // Clan's role powers wait for Verify (VISION priority 1), so it sits
    // with the record's own steps, before anything optional.
    provable(p) && {
      label: "Player verified (needed to act in Clan)",
      done: Boolean(p?.verified),
      detail: p?.verified
        ? p.verified_at
          ? `verified ${ago(p.verified_at)}`
          : "verified"
        : p
          ? "not verified · one battle proves the player is yours"
          : "add your player first",
      action: p ? "Verify your player" : null,
      to: `${SETTINGS}/players/verify`,
    },
  ].filter(Boolean);
}

/**
 * The recording's first answer. A page that needs the same status for
 * itself (FollowedRecord) reads it once and passes `answer`; `fix` is
 * that page's inline correction, shown inside the "Tag not found"
 * callout. Without `fix`, the callout links to it (`#fix-tag`).
 */
export function FirstAnswer({
  claimsKey,
  playerTag,
  answer = null,
  fix = null,
}) {
  const { when } = useClock();
  const own = useFirstAnswer(claimsKey, { playerTag, enabled: !answer });
  const { data, loading, error, refresh } = answer ?? own;
  const next = data ? recordJourney(data) : null;
  const notFound = Boolean(next?.notFound);
  const shown = data ? readiness(data, notFound) : [];
  const wait = data ? nextPoll(data) : null;
  return (
    <section className="mb-6" aria-labelledby="first-answer-title">
      <div className="flex flex-wrap items-baseline gap-2 pb-3">
        <h2
          id="first-answer-title"
          className="text-(length:--t-panel-head) font-semibold"
        >
          Your recording
        </h2>
        <span className="text-mono text-ink-faint wide:ml-auto">
          <TagText>
            {loading
              ? "checking the record…"
              : (next?.text ?? "Recording status is unavailable.")}
          </TagText>
        </span>
      </div>
      {notFound ? (
        // The one failure the game names: said as an error, at once, with
        // the fix beside it (2026-10-08).
        <div className="callout callout--bad mb-3" role="alert">
          <Icon name="x" size={17} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{next.state}</p>
            <p>
              Clash Royale answered “not found” for{" "}
              <span className="mono">{data.player.player_tag}</span>{" "}
              {ago(next.failedAt)}, so nothing is being recorded. Check the tag:
              in the game it is on the player&rsquo;s profile, below the name.
              Elixir asks the game again in about a day, in case the tag is
              brand new.
            </p>
            {fix ?? (
              <Link className="btn btn--sm mt-2" to={`${next.to}#fix-tag`}>
                {next.action} ›
              </Link>
            )}
          </div>
        </div>
      ) : (
        next && (
          <p className="mb-3 font-semibold" role="status">
            {next.state}
          </p>
        )
      )}
      {wait != null && !notFound && (
        <p className="mb-3 text-mono text-ink-faint">
          {wait < 60_000
            ? "This page checks again every few seconds for the first minutes after an add, then about once a minute while open."
            : "This page checks again about once a minute while open."}{" "}
          Check again reads the saved record; it does not force a game fetch.
        </p>
      )}
      {next?.failedAt && !notFound && (
        <p className="mb-3 text-ink-faint">
          Failed attempt {ago(next.failedAt)}. A failed fetch does not establish
          that the tag is invalid.
        </p>
      )}
      {next?.partial && (
        <p className="mb-3 text-ink-body">
          Not every battle was read between {when(next.partial.observed_from)}{" "}
          and {when(next.partial.observed_to)}:{" "}
          {n(next.partial.captured_battles)} of{" "}
          {n(next.partial.expected_battles)} battles recorded. Other time
          remains unknown.
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {next && !notFound && next.action !== "Check recording status" && (
          <Link className="btn btn--primary" to={next.to}>
            {next.action} ›
          </Link>
        )}
        {next?.profile && (
          <Link to={next.profile.to}>{next.profile.action} ›</Link>
        )}
        <button className="btn btn--sm" onClick={refresh} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
      {error && (
        <ErrorState title="Your recorded data could not be read just now">
          Your saved players and any previously read evidence are unaffected.
          Use Check again to retry.
        </ErrorState>
      )}
      <div className="flex flex-col">
        {shown.map((s) => (
          <div key={s.label} className="flex items-start gap-3 py-3">
            <span className={s.done ? "text-ok" : "text-ink-quiet-icon"}>
              <Icon name={s.done ? "circle-check" : "circle-dashed"} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-(length:--t-panel-head) text-ink-body">
                  {s.label}
                </span>
                <span className="text-mono text-ink-faint">
                  <TagText>{s.detail}</TagText>
                </span>
              </div>
              {(!s.done || s.showAction) && s.action && (
                <Link className="inline-block pt-1 text-mono" to={s.to}>
                  {s.action} ›
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
