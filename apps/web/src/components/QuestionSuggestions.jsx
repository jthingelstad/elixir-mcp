import { useState } from "react";

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

export function starterQuestions({ player, clan }) {
  const result = questions(player);
  if (clan)
    result.push({
      title: "Review your clan's war week",
      prompt: `Summarize the latest recorded war week for clan ${clan.clan_tag}: standings and participation. State the season and week, check source freshness, and explain any missing data or unfinished race. Distinguish individual points from clan fame.`,
    });
  return result;
}

export function QuestionSuggestions({ questions }) {
  const [copied, setCopied] = useState(null);
  const [manual, setManual] = useState(null);
  return (
    <>
      <div className="first-answer__questions">
        {questions.map((q) => (
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
              <p role="status">Copied — paste into your connected client.</p>
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
  );
}
