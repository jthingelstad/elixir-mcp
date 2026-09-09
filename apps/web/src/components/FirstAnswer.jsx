import { useEffect, useState } from "react";
import { api } from "../api.js";

function when(value, timezone) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        timeZone: timezone,
        timeZoneName: "short",
      })
    : "unknown";
}

function questions(player) {
  if (!player) return [];
  const tag = player.player_tag;
  const evidence =
    "Check capture coverage and source freshness first. Show sample sizes, separate game modes, and explain gaps or thin samples without treating them as my complete history.";
  const result = [];
  if (player.battles_30d > 0) {
    const days = player.battles_7d > 0 ? 7 : 30;
    result.push({
      title: "Review your recorded battles",
      prompt: `Summarize the recorded battles for ${tag} in the last ${days} days: wins, losses, and the decks I played most. ${evidence}`,
    });
  } else if (player.profile_available) {
    result.push({
      title: "Start with your player snapshot",
      prompt: `Summarize the latest recorded profile for ${tag}, including trophies and clan. Tell me when it was observed and what history is available. Do not infer progress from a single snapshot.`,
    });
  } else if (player.last_battle_at) {
    result.push({
      title: "Review your retained history",
      prompt: `Show the most recent recorded battles for ${tag}, even if they are older than 30 days. State the dates and explain what this retained history can tell me. ${evidence}`,
    });
  }
  if (player.distinct_decks_7d >= 2) {
    result.push({
      title: "Compare your decks",
      prompt: `Compare the decks recorded for ${tag} in the last 7 days. Which did I play most, and how did their results differ? ${evidence} Do not treat a small winning sample as proof that a deck is better.`,
    });
  }
  if (player.battles_7d > 0 && player.battles_previous_7d > 0) {
    result.push({
      title: "Compare two recorded weeks",
      prompt: `Compare the recorded results for ${tag} in the last 7 days with the preceding 7 days. ${evidence} Describe the differences without claiming they prove improvement.`,
    });
  }
  return result;
}

export function FirstAnswer({ claimsKey, navigate, timezone }) {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(null);
  const [manual, setManual] = useState(null);
  useEffect(() => {
    let active = true;
    let timer;
    setLoading(true);
    setError(false);
    setData(null);
    setCopied(null);
    setManual(null);
    api
      .firstAnswer()
      .then((r) => {
        if (!r.ok || !r.data.connection || !("player" in r.data))
          throw new Error("unavailable");
        if (!active) return;
        setData(r.data);
        if (
          r.data.player &&
          (!(
            r.data.player.profile_available ||
            r.data.player.last_battle_at ||
            r.data.player.battles_30d > 0
          ) ||
            !r.data.connection.last_data_read_at)
        ) {
          timer = setTimeout(() => {
            if (document.visibilityState === "visible")
              setAttempt((n) => n + 1);
          }, 60_000);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const onFocus = () => setAttempt((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [claimsKey, attempt]);

  const p = data?.player;
  const c = data?.connection;
  const prompts = questions(p);
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
        <button
          className="btn--text"
          disabled={loading}
          onClick={() => setAttempt((n) => n + 1)}
        >
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
                <div className="first-answer__questions">
                  {prompts.map((q) => (
                    <article key={q.title}>
                      <h3>{q.title}</h3>
                      <details>
                        <summary>View full question</summary>
                        <p>{q.prompt}</p>
                      </details>
                      <button
                        className="btn"
                        aria-label={`Copy question: ${q.title}`}
                        onClick={async () => {
                          setCopied(null);
                          setManual(null);
                          try {
                            await navigator.clipboard.writeText(q.prompt);
                            setCopied(q.title);
                          } catch {
                            setManual(q.prompt);
                          }
                        }}
                      >
                        Copy question
                      </button>
                      {copied === q.title && (
                        <p role="status">
                          Copied — paste into your connected client.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
                {manual && (
                  <label className="first-answer__manual">
                    Select and copy this question:
                    <textarea
                      aria-label="Question to copy"
                      readOnly
                      value={manual}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
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
