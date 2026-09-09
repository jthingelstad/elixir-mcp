import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import {
  QuestionSuggestions,
  starterQuestions,
} from "./QuestionSuggestions.jsx";

function when(value, timezone) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: timezone,
        timeZoneName: "short",
      })
    : "unknown";
}

export function FirstAnswer({ claimsKey, navigate, timezone }) {
  const { data, loading, error, refresh } = useFirstAnswer(claimsKey);

  const p = data?.player;
  const c = data?.connection;
  const prompts = data ? starterQuestions(data) : [];
  const captured =
    p?.profile_available || p?.battles_30d > 0 || p?.last_battle_at;
  return (
    <section
      className="panel first-answer"
      aria-labelledby="first-answer-title"
    >
      <div className="panel__head">
        <h2 className="panel-title" id="first-answer-title">
          Your next useful question
        </h2>
        <button className="btn--text" disabled={loading} onClick={refresh}>
          Check again
        </button>
      </div>
      <div className="panel__body">
        {loading && <p role="status">Checking your recorded data…</p>}
        {error && (
          <p role="alert">
            Could not check your recorded data. Try again; your players and
            settings are still available below.
          </p>
        )}
        {data && (
          <>
            <ol className="first-answer__steps">
              <li>
                <strong>1. Add your player</strong>
                <span>
                  {p
                    ? `${p.name ?? "Your primary"} · ${p.player_tag}`
                    : "Start with your Clash Royale player tag."}
                </span>
              </li>
              <li>
                <strong>2. Capture some history</strong>
                <span>
                  {!p
                    ? "Capture starts after you add a player."
                    : captured
                      ? "Recorded data is available."
                      : "Waiting for the first capture"}
                </span>
              </li>
              <li>
                <strong>3. Ask your client</strong>
                <span>
                  {c.active_connections > 0
                    ? `${c.active_connections} authorized connection${c.active_connections === 1 ? "" : "s"}`
                    : "Connect a personal MCP client."}
                </span>
              </li>
            </ol>
            {!p ? (
              <button
                className="btn"
                onClick={() =>
                  document.getElementById("add-player-tag")?.focus()
                }
              >
                Add your player
              </button>
            ) : (
              <>
                {!captured && (
                  <p>
                    Recording is {p.recording_status ?? "off"}. Your first
                    capture arrives after a collector poll; you can connect your
                    client while you wait. This panel checks again every minute
                    while open.
                  </p>
                )}
                {captured && (
                  <>
                    <p className="first-answer__sample">
                      <strong>
                        {p.battles_7d} recorded battles in the last 7 days
                      </strong>{" "}
                      · {p.battles_30d} in the last 30 days. This is a recorded
                      sample, not a promise of complete history.
                    </p>
                    <p className="first-answer__times">
                      Profile observed: {when(p.profile_observed_at, timezone)}
                      <br />
                      Battle log observed:{" "}
                      {when(p.battlelog_observed_at, timezone)}
                    </p>
                    {p.recording_status !== "active" && (
                      <p className="notice">
                        Your recording is {p.recording_status ?? "off"}. These
                        questions use retained history; check the player’s
                        recording below.
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            <div className="first-answer__actions">
              <button
                className="btn"
                onClick={() => navigate("/account/connections")}
              >
                {c.active_connections > 0
                  ? "Manage connections"
                  : "Connect your client"}
              </button>
              <a href="/docs/quickstart">Connection instructions</a>
              {captured && (
                <button
                  className="btn--text"
                  onClick={() =>
                    navigate(
                      `/explore/player/${encodeURIComponent(p.player_tag)}`,
                    )
                  }
                >
                  View the recorded data
                </button>
              )}
            </div>
            {prompts.length > 0 && (
              <>
                <p>
                  Copy a question into your personal MCP client. Each one asks
                  for the evidence behind the answer.
                </p>
                <QuestionSuggestions
                  key={prompts.map((q) => q.prompt).join("\n")}
                  questions={prompts}
                />
              </>
            )}
            <p className="first-answer__readout">
              {c.successful_data_calls_7d > 0
                ? `${c.successful_data_calls_7d} successful data reads on ${c.data_read_days_7d} UTC days in the last 7 days. Latest: ${when(c.last_data_read_at, timezone)}.`
                : "No successful personal MCP data reads observed in the last 7 days yet."}{" "}
              <button
                className="btn--text"
                onClick={() => navigate("/account/activity")}
              >
                Review activity
              </button>
            </p>
            <details className="first-answer__readout">
              <summary>What these counts tell you</summary>
              <p>
                This counts successful player, battle and war tool responses
                across your personal connections, including empty results. It
                does not confirm that an answer was useful. Website previews and
                separate bots are excluded.
              </p>
            </details>
          </>
        )}
      </div>
    </section>
  );
}
