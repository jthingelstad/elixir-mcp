import { Icon, Link, ago, stamp, useClock } from "@elixir-mcp/ui";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { CONSOLE } from "../lib/console.js";
import { recordJourney } from "../lib/record-journey.js";
import {
  QuestionSuggestions,
  starterQuestions,
} from "./QuestionSuggestions.jsx";

const n = (v) => (Number.isFinite(v) ? v.toLocaleString() : "unknown");
const hasBattles = hasBattleEvidence;

/** Readiness is derived from the record, including a successful data read:
 * an OAuth connection alone does not show that the client's setup works. */
function readiness(data) {
  const p = data.player;
  const c = data.connection;
  const clan = data.clan;
  const captured = hasBattles(p);
  return [
    {
      label: "Player tag saved",
      done: Boolean(p),
      detail: p
        ? `${p.name ?? "your player"} ${p.player_tag} · ${p.is_primary === false ? (p.relationship ?? "tracked") : "primary"}${p.recording_status ? ` · recording ${p.recording_status}` : ""}`
        : "nothing here defaults to you",
      action: p ? "Manage recording" : "Add your player",
      showAction: Boolean(
        p?.recording_status && p.recording_status !== "active",
      ),
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "We have a profile for them",
      done: Boolean(p?.profile_available),
      detail: p?.profile_available
        ? p.profile_observed_at
          ? `snapshot ${ago(p.profile_observed_at)}`
          : "snapshot recorded · observation time unavailable"
        : p
          ? "no profile snapshot available yet"
          : "add your player to start recording",
      action: p ? "Check recording" : null,
      to: `${CONSOLE}/account/tracking`,
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
              ? "No battles captured in the last 30 days · capture may be incomplete"
              : "recent battle counts unavailable",
      action: p ? "Check recording" : null,
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "Clan war history (optional)",
      done: Boolean(clan),
      detail: clan
        ? `${clan.name ?? clan.clan_tag} · ${n(clan.war_weeks)} war weeks`
        : "no recorded clan war history available",
      action: p ? "Clan recording" : null,
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "AI client connection (optional)",
      done: (c.active_connections ?? 0) > 0,
      detail:
        c.active_connections == null
          ? "connection status unavailable"
          : c.active_connections === 0
            ? "no connections yet"
            : c.last_data_read_at
              ? `${c.active_connections} connected · last read ${ago(c.last_data_read_at)}`
              : `${c.active_connections} connected · no successful data read in the last 7 days`,
      action: "Connect your client",
      to: `${CONSOLE}/account/connections`,
    },
    {
      label: "AI client data reads (optional)",
      done: Boolean(c.last_data_read_at),
      detail: c.last_data_read_at
        ? `successful data read ${ago(c.last_data_read_at)}`
        : "last_data_read_at" in c
          ? "no successful data read in the last 7 days · a connection alone does not confirm a data read"
          : "recent data reads unavailable",
      action: c.active_connections > 0 ? "Connection help" : null,
      to: "/docs/quickstart",
    },
  ];
}

export function FirstAnswer({ claimsKey, playerTag, compact = false }) {
  const { zone } = useClock();
  const { data, loading, error, refresh } = useFirstAnswer(claimsKey, {
    playerTag,
  });
  const steps = data ? readiness(data) : [];
  const next = data ? recordJourney(data) : null;
  const questions = data ? starterQuestions(data).slice(0, 1) : [];
  return (
    <section className="mb-6" aria-labelledby="first-answer-title">
      <div className="flex flex-wrap items-baseline gap-2 pb-3">
        <h2 id="first-answer-title" className="text-[14px] font-semibold">
          Your recording
        </h2>
        <span className="text-[12.5px] text-ink-faint wide:ml-auto">
          {loading
            ? "checking the record…"
            : (next?.text ?? "Recording status is unavailable.")}
        </span>
      </div>
      {next && (
        <p className="mb-3 font-semibold" role="status">
          {next.state}
        </p>
      )}
      {data?.player?.recording_status === "active" &&
        (!data.player.profile_available || !hasBattles(data.player)) && (
          <p className="mb-3 text-[12.5px] text-ink-faint">
            This page checks again about once a minute while open. Check again
            reads the saved record; it does not force a game fetch.
          </p>
        )}
      {next?.failedAt && (
        <p className="mb-3 text-ink-faint">
          Failed attempt {ago(next.failedAt)}. A failed fetch does not establish
          that the tag is invalid.
        </p>
      )}
      {next?.partial && (
        <p className="mb-3 text-ink-body">
          Incomplete capture between{" "}
          {stamp(next.partial.observed_from, zone, { year: true })} and{" "}
          {stamp(next.partial.observed_to, zone, { year: true })}:{" "}
          {n(next.partial.captured_battles)} of{" "}
          {n(next.partial.expected_battles)} battles recorded. Other time
          remains unknown.
        </p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {next && !(compact && next.action === "Check recording status") && (
          <Link className="btn btn--primary" to={next.to}>
            {next.action} ›
          </Link>
        )}
        {next?.profile && (
          <Link to={next.profile.to}>{next.profile.action} ›</Link>
        )}
        {data?.clan && !compact && (
          <Link
            to={
              data.clan.latest_week
                ? `${CONSOLE}/explore/week/${data.clan.clan_tag.replace(/^#/, "")}~${data.clan.latest_week.season_id}~${data.clan.latest_week.section_index}`
                : `${CONSOLE}/explore/list/weeks:${data.clan.clan_tag.replace(/^#/, "")}`
            }
          >
            {data.clan.latest_week
              ? "View recorded war week"
              : "Browse recent war weeks"}{" "}
            ›
          </Link>
        )}
        <button className="btn btn--sm" onClick={refresh} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
      {error && (
        <div className="callout callout--warn" role="alert">
          <Icon name="circle-dashed" size={17} />
          <span>
            Could not check your recorded data. Use Check again to retry. Your
            saved players and any previously read evidence are unaffected.
          </span>
        </div>
      )}
      <div className="flex flex-col">
        {steps.slice(0, compact ? 3 : 4).map((s) => (
          <div
            key={s.label}
            className="flex items-start gap-3 border-b border-line-row py-3"
          >
            <span className={s.done ? "text-ok" : "text-ink-quiet-icon"}>
              <Icon name={s.done ? "circle-check" : "circle-dashed"} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[14px] text-ink-body">{s.label}</span>
                <span className="text-[12.5px] text-ink-faint">{s.detail}</span>
              </div>
              {(!s.done || s.showAction) && s.action && (
                <Link className="inline-block pt-1 text-[12.5px]" to={s.to}>
                  {s.action} ›
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
      {!compact && data && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13.5px]">
            AI clients (optional)
          </summary>
          <p className="mt-3 text-ink-faint">
            Read your recorded profile and battles in this browser. Connecting
            an AI client is optional.
          </p>
          {steps.slice(4).map((s) => (
            <p className="mt-3" key={s.label}>
              <span>{s.label}</span>: <span>{s.detail}</span>
              {(!s.done || s.showAction) && s.action && (
                <>
                  {" "}
                  · <Link to={s.to}>{s.action} ›</Link>
                </>
              )}
            </p>
          ))}
          {questions.length > 0 && (
            <div className="first-answer mt-4">
              <h3 className="mb-2 font-semibold">
                Ask an AI client (optional)
              </h3>
              <p className="mb-3 text-ink-body">
                {data.connection.active_connections > 0
                  ? "Copy this question into your connected AI client. A successful data read will appear above."
                  : "If you want to ask an AI client, connect one and copy this question into that chat. You can use Ladder without connecting a client."}
              </p>
              <QuestionSuggestions
                key={questions[0].prompt}
                questions={questions}
              />
              <Link
                className="inline-block pt-3"
                to={`${CONSOLE}/account/connections`}
              >
                More questions and your connections ›
              </Link>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
