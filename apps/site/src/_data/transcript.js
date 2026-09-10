/**
 * The home page transcript: three scripted exchanges, one per chip.
 *
 * The site's signature element and its whole argument in one box — a
 * real question, the answer, and the citation under the answer naming
 * what was read. The same three scripts appear on the use-case pages;
 * they are lifted from usecases.js rather than written twice.
 *
 * The tools under the window link to their own reference page, so a
 * reader can check that every one of them exists.
 */
export default [
  {
    key: "play",
    label: "Your play",
    tool: "players_timeline · battles_decks · battles_query",
    lines: [
      {
        role: "user",
        text: "Am I actually getting better, or just grinding?",
      },
      {
        role: "agent",
        text: "Better, but only with one deck. Over your last 30 days you are 61% with Hog 2.6 (51–33) and 42% with Log bait (16–22) — and Log bait is a third of your games. Your crown rate in the first 60 seconds went up 8 points since July; your losses now cluster after 2:30, which reads as elixir management late rather than a bad opening.",
        cite: "from 1,284 of your recorded battles",
      },
      {
        role: "user",
        text: "So what do I drop?",
      },
      {
        role: "agent",
        text: "Log bait against Hog decks — you are 3–11 in that matchup, your worst on record. Same eight cards do fine against beatdown, so it is the matchup, not the deck.",
        cite: "84 matchups, recorded not sampled",
      },
    ],
  },
  {
    key: "clan",
    label: "Your clan",
    tool: "war_current · clans_roster · war_history",
    lines: [
      {
        role: "user",
        text: "How did POAP KINGS do in last week's river race?",
      },
      {
        role: "agent",
        text: "Second of five, 43,180 fame — 1,900 behind Royal Rumble. Torch and Kiwi carried it with 5,200 and 4,880. Three members used no decks on war day 2, which cost roughly 2,100 fame; two of them have missed a day in each of the last four races.",
        cite: "from 27 recorded war weeks",
      },
      {
        role: "user",
        text: "Who should I talk to before the next one?",
      },
      {
        role: "agent",
        text: "Bruno and Vex — both are averaging 2.4 of 4 decks over the last month while sitting mid-roster on trophies, so it is availability rather than skill. Sable is the opposite: 4 of 4 every day, bottom third on fame. That one is a deck problem, not a discipline one.",
        cite: "per-member participation, four races",
      },
    ],
  },
  {
    key: "friends",
    label: "Your friends",
    tool: "players_profile · players_timeline · elixir_events",
    lines: [
      {
        role: "user",
        text: "What has Kiwi been up to? He said he was climbing.",
      },
      {
        role: "agent",
        text: "He is. Kiwi is up 640 trophies since mid-August, best ever 7,412, and he switched to Hog 2.6 three weeks ago — 68% with it since. He played 46 battles yesterday, which is his heaviest day on record.",
        cite: "daily snapshots since 2026-05-19",
      },
      {
        role: "user",
        text: "Anything I should know before we duo?",
      },
      {
        role: "agent",
        text: "He is on your deck now, so you will collide on Hog and Musketeer. His last five 2v2s were all with Torch — you have not played together since July 14.",
        cite: "tracked because you added him",
      },
    ],
  },
];
