import { Icon, Link, ago } from "@elixir-mcp/ui";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";
import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { CONSOLE } from "../lib/console.js";
import {
  QuestionSuggestions,
  starterQuestions,
} from "./QuestionSuggestions.jsx";

const n = (v) => (Number.isFinite(v) ? v.toLocaleString() : "unknown");
const hasBattles = hasBattleEvidence;

/** The next useful destination follows saved capture, not optional setup. */
function nextStep(data) {
  const p = data.player;
  if (!p)
    return {
      text: "Start with your player tag in Tracking.",
      action: "Go to Tracking",
      to: `${CONSOLE}/account/tracking`,
    };
  if (p.profile_available || hasBattles(p))
    return {
      text:
        p.recording_status && p.recording_status !== "active"
          ? "Your retained record is available. Check recording status in Tracking."
          : "Open your recorded profile or battles in Ladder.",
      action: "Open Ladder",
      to: "/ladder",
    };
  return {
    text:
      p.recording_status === "active"
        ? "Waiting for the first profile or battle capture. Check recording in Tracking."
        : "No profile or battles are available yet. Check recording status in Tracking.",
    action: "Check recording status",
    to: `${CONSOLE}/account/tracking`,
  };
}

/** Readiness is derived from the record, including a successful data read:
 * an OAuth connection alone does not show that the client's setup works. */
function readiness(data) {
  const p = data.player;
  const c = data.connection;
  const clan = data.clan;
  const captured = hasBattles(p);
  return [
    {
      label: "Add the player you play as",
      done: Boolean(p),
      detail: p
        ? `${p.name ?? "your player"} ${p.player_tag} · primary${p.recording_status ? ` · recording ${p.recording_status}` : ""}`
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

export function FirstAnswer({ claimsKey }) {
  const { data, loading, error, refresh } = useFirstAnswer(claimsKey);
  const steps = data ? readiness(data) : [];
  const next = data ? nextStep(data) : null;
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
      <p className="mb-3 text-[12.5px] text-ink-faint">
        Read your record in Ladder with this account. Clan war history and
        connecting an AI client are optional.
      </p>
      {next && (
        <Link className="mb-3 inline-block text-[12.5px]" to={next.to}>
          {next.action} ›
        </Link>
      )}
      {error && (
        <div className="callout callout--warn" role="alert">
          <Icon name="circle-dashed" size={17} />
          <span>
            Could not check your recorded data.{" "}
            <button className="btn btn--sm" onClick={refresh}>
              Check again
            </button>{" "}
            Your players below are unaffected.
          </span>
        </div>
      )}
      <div className="flex flex-col">
        {steps.map((s) => (
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
      {questions.length > 0 && (
        <div className="first-answer mt-4">
          <h3 className="mb-2 font-semibold">Ask an AI client (optional)</h3>
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
    </section>
  );
}
