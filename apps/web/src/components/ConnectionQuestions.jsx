import { useFirstAnswer } from "../hooks/useFirstAnswer.js";
import {
  QuestionSuggestions,
  starterQuestions,
} from "./QuestionSuggestions.jsx";

export function ConnectionQuestions({ claimsKey, navigate }) {
  const { data, loading, error, refresh } = useFirstAnswer(claimsKey);
  const questions = data ? starterQuestions(data) : [];
  return (
    <section
      className="panel first-answer"
      aria-labelledby="connection-questions-title"
    >
      <div className="panel__head">
        <h2 className="panel-title" id="connection-questions-title">
          Try asking…
        </h2>
        <button className="btn--text" onClick={refresh} disabled={loading}>
          Check again
        </button>
      </div>
      <div className="panel__body">
        {loading && (
          <p role="status">Finding questions for your recorded data…</p>
        )}
        {error && (
          <p role="alert">
            Could not check your recorded data. Use Check again to retry.
          </p>
        )}
        {data && (
          <>
            {questions.length > 0 && (
              <p>
                {data.connection.active_connections > 0
                  ? "Copy a question, then paste it into the AI client you connected. Your client will use Elixir MCP to look up the answer."
                  : "Once you connect your AI client, copy a question below and paste it into that chat."}
              </p>
            )}
            {questions.length > 0 ? (
              <>
                <p className="first-answer__times">
                  Suggested from the history currently recorded for your
                  account. Each question asks your client to check the evidence
                  and explain gaps.
                </p>
                <QuestionSuggestions
                  key={questions.map((q) => q.prompt).join("\n")}
                  questions={questions}
                />
              </>
            ) : data.player ? (
              <>
                <p>
                  Waiting for the first capture for{" "}
                  <strong>{data.player.name ?? data.player.player_tag}</strong>.
                  Questions will appear when a profile or battle history is
                  recorded.
                </p>
                <p className="first-answer__times">
                  You can connect your client while you wait. This panel checks
                  again every minute while open.
                </p>
              </>
            ) : (
              <>
                <p>
                  Add your Clash Royale player tag to start recording. Then come
                  back for questions your history can answer.
                </p>
                <button
                  className="btn"
                  onClick={() => navigate("/account/overview")}
                >
                  Add your player
                </button>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
