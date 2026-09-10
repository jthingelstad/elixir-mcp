/**
 * Eleven use cases, each a real page.
 *
 * The transcript is the point of every one: what somebody actually asks,
 * what the agent answers, and the citation under the answer saying what
 * it read. "What it reads" names the recorded data behind it, and "To
 * set this up" is the two or three steps — so a reader can tell what is
 * a promise from what is already true.
 *
 * Copy is the 2026-09-09 design pass. The numbers inside a transcript
 * are illustrative and the page says so.
 */
export default [
  {
    group: "For players",
    cases: [
      {
        key: "play",
        label: "Understand your play",
        icon: "trending-up",
        title: "Understand your own play",
        lede: "Not “you won 61%” — which deck, which matchup, which minute of the match, and whether last month's change actually worked.",
        reads: [
          "Every battle recorded for you, with decks and crowns",
          "Daily profile snapshots since you were added",
          "Deck and matchup performance across the whole corpus",
        ],
        setup: ["Track your player", "Connect a client"],
        script: {
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
        group: "For players",
      },
      {
        key: "deck",
        label: "Pick your next deck",
        icon: "layers",
        title: "Pick your next deck",
        lede: "What is winning at your trophy range, weighted by recorded results rather than by how often you see it on a stream.",
        reads: [
          "Meta decks and cards by segment",
          "Matchup win rates from recorded battles",
          "Your own card levels",
        ],
        setup: ["Track your player", "Read the methodology"],
        script: {
          tool: "battles_meta_decks · battles_decks · cards_catalog",
          lines: [
            {
              role: "user",
              text: "What should I play next season? I'm bored of Hog.",
            },
            {
              role: "agent",
              text: "Two candidates from what is actually winning at your trophy range, not what is popular: Miner control (57% over 2,140 recorded battles there) and Golem beatdown (54%, but 11 minutes of average match time — slower nights). Six of Miner control's eight cards are ones you already run at level 14, so it is the cheaper switch.",
              cite: "44,118 battles · your card levels",
            },
          ],
        },
        group: "For players",
      },
      {
        key: "ladder",
        label: "Push with evidence",
        icon: "trophy",
        title: "Push with evidence",
        lede: "Trophy pushes fail for boring, findable reasons. A record of every session makes the pattern visible instead of anecdotal.",
        reads: [
          "Your battle timeline with timestamps in your zone",
          "Daily trophy and best-trophy snapshots",
          "Streaks and session shape",
        ],
        setup: ["Track your player", "Set your timezone"],
        script: {
          tool: "players_timeline · battles_query",
          lines: [
            {
              role: "user",
              text: "I want to hit 8,000. What is actually stopping me?",
            },
            {
              role: "agent",
              text: "Tilt, on the record. Your win rate is 58% in your first five games of a session and 41% after game eight — and 71% of your recorded losing streaks of three or more start after 10pm your time. You have hit 7,412 twice and given it back within two days both times.",
              cite: "daily snapshots since 2026-03-11",
            },
          ],
        },
        group: "For players",
      },
      {
        key: "friends",
        label: "Follow your friends",
        icon: "users",
        title: "Follow your friends",
        lede: "The people you play with, tracked because you asked — climbs, deck switches, heavy days, and when you last teamed up.",
        reads: [
          "Battles and snapshots for players you track",
          "Relationship and nickname you set per player",
          "Notifications when something changes",
        ],
        setup: ["Track a friend's tag", "Turn on notifications"],
        script: {
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
        group: "For players",
      },
    ],
  },
  {
    group: "For clan leaders",
    cases: [
      {
        key: "clan",
        label: "Win your river race",
        icon: "swords",
        title: "Win your river race",
        lede: "Fame by member, attacks used by day, and the corrected history of races the game's own API has already forgotten.",
        reads: [
          "River races recorded weekly, corrected as they run",
          "Per-member fame, boat attacks and decks used",
          "Clan facts every 15 minutes",
        ],
        setup: ["Track your clan", "Choose a recording scope"],
        script: {
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
        group: "For clan leaders",
      },
      {
        key: "roster",
        label: "Keep the roster healthy",
        icon: "heart-pulse",
        title: "Keep the roster healthy",
        lede: "Who is drifting away, who is carrying, and who joined and never got going — before it shows up as a lost race.",
        reads: [
          "Roster snapshots and member history",
          "Donations, war attacks and battle activity per member",
          "Comprehensive scope records every member's battles",
        ],
        setup: ["Track your clan, comprehensive", "Read about scopes"],
        script: {
          tool: "clans_roster · war_history · players_timeline",
          lines: [
            {
              role: "user",
              text: "Who is quietly falling off in POAP KINGS?",
            },
            {
              role: "agent",
              text: "Three. Vex has not played a battle in 9 days after 14 months of daily play. Bruno's donations dropped from 240 a week to 40 while his war attacks stayed full — usually a sign someone is playing less but still showing up. Juno joined 3 weeks ago and has never used all four war decks.",
              cite: "47 members · 27 war weeks",
            },
          ],
        },
        group: "For clan leaders",
      },
      {
        key: "scout",
        label: "Scout the other clan",
        icon: "binoculars",
        title: "Scout the other clan",
        lede: "Any clan Elixir has recorded can be read by anyone. Reading is universal — a tier only changes what we record for you.",
        reads: [
          "Their recorded races and standings",
          "Participation and fame distribution",
          "Decks their top members actually play",
        ],
        setup: ["Look up a clan tag", "Read the privacy posture"],
        script: {
          tool: "clans_roster · war_history · battles_meta_decks",
          lines: [
            {
              role: "user",
              text: "We race Royal Rumble this week. What do I need to know?",
            },
            {
              role: "agent",
              text: "They finish strong: 4 of their last 5 races were won on day 4, and their top three do 60% of their fame. Two of those three are on Golem beatdown. Their weakness is coverage — they average 31 of 41 members participating, so an early lead has held up against them twice.",
              cite: "their 19 recorded races",
            },
          ],
        },
        group: "For clan leaders",
      },
      {
        key: "recap",
        label: "Write the weekly recap",
        icon: "pen-line",
        title: "Write the weekly recap",
        lede: "The numbers are already recorded; the writing is the only work. Your agent drafts it and you paste it into clan chat.",
        reads: [
          "The completed race, member by member",
          "Clan score and trophy movement over the week",
          "Comparisons against your own past races",
        ],
        setup: ["Track your clan", "Connect a client"],
        script: {
          tool: "war_current · war_history · clans_standings",
          lines: [
            {
              role: "user",
              text: "Write the Sunday recap for our clan chat.",
            },
            {
              role: "agent",
              text: "“Second of five, 43,180 fame — our best result since S133. Torch (5,200) and Kiwi (4,880) carried. We lost roughly 2,100 fame to missed war-day-2 attacks. Clan score is up 118 on the week; three members crossed 7,000 trophies.” Want it shorter, or with every member's fame listed?",
              cite: "generated from the recorded race",
            },
          ],
        },
        group: "For clan leaders",
      },
    ],
  },
  {
    group: "For builders",
    cases: [
      {
        key: "discord",
        label: "Answer your clanmates",
        icon: "bot",
        title: "Answer your clanmates",
        lede: "An agent acts for one clan rather than for you: its own door, its own key, its own feed — and a map from a Discord id to a player tag.",
        reads: [
          "Recorded history for the clan it acts for",
          "Its own identity map, built with elixir_identify",
          "Its own event feed",
        ],
        setup: ["Create an agent", "Read the agents doc"],
        script: {
          tool: "elixir_identify · players_profile · war_current",
          lines: [
            {
              role: "user",
              text: "Can my clanmates ask this in our Discord, without me in the loop?",
            },
            {
              role: "agent",
              text: "That is what an agent is for. You create one for POAP KINGS, it gets its own door and key, and it maps each Discord user to their player tag the first time they ask. They get answers about their own record; nothing about your account is visible to it.",
              cite: "agents act for a clan, not for you",
            },
          ],
        },
        group: "For builders",
      },
      {
        key: "publish",
        label: "Publish your own stats",
        icon: "share-2",
        title: "Publish your own stats",
        lede: "Build a clan site or a bot on the record instead of on a second Clash key. Pull at build time; no scraping, no push.",
        reads: [
          "Clan daily series and war participation",
          "Player profiles projected from recorded payloads",
          "The same tools your agent uses",
        ],
        setup: ["Read the integrations doc", "Request a service key"],
        script: {
          tool: "clans_standings · war_history · players_profile",
          lines: [
            {
              role: "user",
              text: "I want our clan site to show war history nobody else has.",
            },
            {
              role: "agent",
              text: "Read it over the same seam your agent uses — clan daily series, per-member war participation, and races past the 20-week window the game's own API forgets. Your site holds a service key and pulls what it needs at build time; no scraping, no second Clash key.",
              cite: "27 war weeks, growing weekly",
            },
          ],
        },
        group: "For builders",
      },
      {
        key: "collector",
        label: "Run a collector",
        icon: "server",
        title: "Run a collector",
        lede: "Volunteer a machine that fetches for the corpus. It is named for a card, credited to you, and it raises what Elixir records for you.",
        reads: [
          "Your collector's fetch series and endpoint mix",
          "Points, credits, errors and version",
          "The shared request budget it works inside",
        ],
        setup: ["Read the operators guide", "Raise your hand"],
        script: {
          tool: "elixir_collectors · elixir_coverage",
          lines: [
            {
              role: "user",
              text: "What do I get for running a collector?",
            },
            {
              role: "agent",
              text: "You add fetch capacity to the corpus and get a bump in what Elixir records for you. Your machine polls on a schedule inside one shared request budget — three are running now, and the console shows your fetch series, endpoint mix, errors and version.",
              cite: "3 collectors active",
            },
          ],
        },
        group: "For builders",
      },
    ],
  },
];
