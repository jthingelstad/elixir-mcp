import { Icon, Link, ago } from "@elixir-mcp/ui";
import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import { CONSOLE } from "../lib/console.js";
import {
  QuestionSuggestions,
  starterQuestions,
} from "./QuestionSuggestions.jsx";

const n = (v) => (v ?? 0).toLocaleString();

/** Readiness is derived from the record, including a successful data read:
 * an OAuth connection alone does not show that the client's setup works. */
function readiness(data) {
  const p = data.player;
  const c = data.connection;
  const clan = data.clan;
  const captured = Boolean(p && (p.battles_30d > 0 || p.last_battle_at));
  return [
    {
      label: "Add the player you play as",
      done: Boolean(p),
      detail: p
        ? `${p.name ?? "your player"} ${p.player_tag} · primary`
        : "nothing here defaults to you",
      action: "Add your player",
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "We have a profile for them",
      done: Boolean(p?.profile_available),
      detail: p?.profile_available
        ? `snapshot ${ago(p.profile_observed_at) ?? "recorded"}`
        : "arrives on the first poll",
      action: p ? "Check recording" : null,
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "Battles recorded for your questions",
      done: captured,
      detail: captured
        ? `${n(p.battles_30d)} in the last 30 days · ${n(p.battles_7d)} in the last 7`
        : "0 recorded · a profile is enough to start",
      action: p ? "Check recording" : null,
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "Add a clan for war history",
      done: Boolean(clan),
      detail: clan
        ? `${clan.name ?? clan.clan_tag} · ${n(clan.war_weeks)} war weeks`
        : "optional · your player's clan is offered once we see it",
      action: p ? "Track your clan" : null,
      to: `${CONSOLE}/account/tracking`,
    },
    {
      label: "Connect a client",
      done: (c.active_connections ?? 0) > 0,
      detail:
        (c.active_connections ?? 0) === 0
          ? "no connections yet"
          : c.last_data_read_at
            ? `${c.active_connections} connected · last read ${ago(c.last_data_read_at)}`
            : `${c.active_connections} connected · nothing has read yet`,
      action: "Connect your client",
      to: `${CONSOLE}/account/connections`,
    },
    {
      label: "Your client has read data",
      done: Boolean(c.last_data_read_at),
      detail: c.last_data_read_at
        ? `successful data read ${ago(c.last_data_read_at)}`
        : "a connection alone does not confirm a data read",
      action: c.active_connections > 0 ? "Connection help" : null,
      to: "/docs/quickstart",
    },
  ];
}

export function FirstAnswer({ claimsKey }) {
  const { data, loading, error, refresh } = useFirstAnswer(claimsKey);
  const steps = data ? readiness(data) : [];
  const ready = steps.filter((s) => s.done).length;
  const questions = data ? starterQuestions(data).slice(0, 1) : [];
  return (
    <section className="mb-6" aria-labelledby="first-answer-title">
      <div className="flex flex-wrap items-baseline gap-2 pb-3">
        <h2 id="first-answer-title" className="text-[14px] font-semibold">
          What your agent can answer
        </h2>
        {data && (
          <span className="mono whitespace-nowrap text-ink-faint">
            {ready} of {steps.length}
          </span>
        )}
        <span className="text-[12.5px] text-ink-faint wide:ml-auto">
          {loading
            ? "checking the record…"
            : data?.connection.last_data_read_at
              ? "Your client has successfully read Elixir data."
              : "You can start with a profile while battle history grows."}
        </span>
      </div>
      <p className="mb-3 text-[12.5px] text-ink-faint">
        Ladder and Clan use this same account. Connecting an AI client is
        optional.
      </p>
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
              {!s.done && s.action && (
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
          <h3 className="mb-2 font-semibold">Start with your record</h3>
          <p className="mb-3 text-ink-body">
            {data.connection.active_connections > 0
              ? "Copy this question into your connected AI client. Its first successful data read will appear above."
              : "Connect your AI client, then copy this question into that chat."}
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
