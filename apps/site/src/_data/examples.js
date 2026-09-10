/**
 * Eleven examples, each a real page (the design's "use cases"; Jamie
 * renamed the section Examples on 2026-09-10).
 *
 * The transcripts are REAL (2026-09-10): each question was put to the
 * live door as King Thing (#20JJJ2CCRU, POAP KINGS #J2RGCRVG), the
 * tools under each window are the ones that were actually called, and
 * every number in an answer came back from them that morning. The
 * three "For builders" exchanges read the documentation through
 * elixir_docs, which serves the same Markdown the site renders. Answers
 * are written the way a model writes them - Markdown, with the
 * provenance in the prose rather than a citation chip - so the page
 * shows what a connected client would actually show.
 *
 * Naming follows Jamie's rule: King Thing is the example player, his
 * tracked friends stand in for other players, POAP KINGS for every
 * clan, and any POAP KINGS member may be named.
 *
 * "What it reads" names the recorded data behind the answer, and "To
 * set this up" the steps - so a reader can tell what is a promise from
 * what is already true.
 */
export default [
  {
    group: "For players",
    cases: [
      {
        key: "play",
        icon: "trending-up",
        label: "Understand your play",
        title: "Understand your own play",
        lede: "Not “you won 61%” — which deck, which mode, which week, and whether the grind is actually paying off.",
        reads: [
          "Every battle recorded for you, with decks and outcomes",
          "Daily profile snapshots since you were added",
          "Your record per deck and per game mode, by week",
        ],
        setup: ["Track your player", "Connect a client"],
        script: {
          tool: "players_timeline · battles_decks · battles_performance",
          lines: [
            {
              role: "user",
              text: "Am I actually getting better, or just grinding?",
            },
            {
              role: "agent",
              text: "Mostly grinding, with one bright spot. I looked at your last 30 days — 79 recorded battles since August 11.\n\n**By week** your win rate has bounced rather than climbed: 61% → 63% → 48% → 80% → 45%. Your trophies have gone nowhere: 12,593 five weeks ago, 12,562 today.\n\n**By deck** is where the story is:\n\n- **Witch / Royal Hogs / Inferno Dragon** — your main deck, 54 battles, 68% of your games: 25–29, **46%**\n- **Mortar / Golden Knight / Electro Dragon** — 13 battles: 11–2, **85%**\n\nThe deck you play least is the one that wins. That is not grinding paying off; that is a deck choice.",
            },
            { role: "user", text: "So what do I drop?" },
            {
              role: "agent",
              text: "Not a card — a mode. Your main deck's problem is **Ladder specifically**: 25–29 there, but 19–6 (76%) in 1v1 war battles and 9–3 in duels over the same window, on the same eight cards.\n\nTwo things I would try, in order:\n\n1. Take the Mortar deck to Ladder for a week and see whether 11–2 survives a bigger sample. Thirteen games is a hint, not a verdict.\n2. If it does, keep the Witch deck for war, where it is already winning.",
            },
          ],
        },
      },
      {
        key: "deck",
        icon: "layers",
        label: "Pick your next deck",
        title: "Pick your next deck",
        lede: "What is winning in the recorded corpus, weighted by results rather than by how often you see it on a stream — with the sample sizes attached.",
        reads: [
          "Meta decks by segment: the corpus, your clan, or one player",
          "Win rates from recorded battles, shrunk toward the corpus mean",
          "Your own deck history",
        ],
        setup: ["Track your player", "Read the methodology"],
        script: {
          tool: "battles_meta_decks · battles_decks",
          lines: [
            {
              role: "user",
              text: "What should I play next season? I'm bored of my Witch deck.",
            },
            {
              role: "agent",
              text: "Honest answer first: the corpus can tell you what is *winning*, not what will win for you. Over the last 28 days — 9,938 decided Ladder battles on record — the decks with the best win rates are all played by **one pilot each**, 60–65% over 30–68 games, so they say more about that player than about the deck.\n\nThe widely played decks tell the opposite story: the most common Ladder deck in the corpus, **X-Bow / Tesla / Archers** (42 different players), wins only 42%. Popular is not the same as good.\n\nTwo decks are worth a look because they overlap what you already play:\n\n- **Witch / Skeleton King / Inferno Dragon / Mega Knight / Royal Hogs / Baby Dragon / Arrows / Ronin** — a POAP KINGS clanmate is 25–2 with it this month, and six of its eight cards are in your rotation already.\n- **Mortar / Golden Knight / Electro Dragon** — your own second deck, 11–2. You may not need a new deck; you may need to play the one you are winning with.\n\nSample sizes are small everywhere here. Treat this as where to look, not a ranking.",
            },
          ],
        },
      },
      {
        key: "ladder",
        icon: "trophy",
        label: "Push with evidence",
        title: "Push with evidence",
        lede: "Trophy pushes stall for boring, findable reasons. A record of every battle makes the pattern visible instead of anecdotal.",
        reads: [
          "Your battle record by mode and by week",
          "Daily trophy and best-trophy snapshots",
          "Net trophies per week, war modes excluded",
        ],
        setup: ["Track your player", "Set your timezone"],
        script: {
          tool: "players_profile · players_timeline · battles_performance",
          lines: [
            {
              role: "user",
              text: "I want to get back to my best trophies. What is actually stopping me?",
            },
            {
              role: "agent",
              text: "Your best is **12,622** and you are at **12,562** — 60 away, a gap that keeps closing and reopening. Net trophies over the last five weeks: +32, −57, +6, −32, +52. You have been oscillating, not sinking.\n\nWhat the record shows since August 11:\n\n- Ladder is the only mode you lose in: **25–29 (46%)**, against 76% in war 1v1s and 75% in duels.\n- Every one of those Ladder games was on your main Witch / Royal Hogs deck. Your Mortar deck, 11–2 overall, has barely touched Ladder.\n- Volume is low and steady, 11–28 battles a week. At 46% that is a coin flip per session.\n\nNothing here says tilt or time of day — there are not enough Ladder games to split by session honestly. The one lever the data supports: take the deck that is winning to Ladder, and give it 30 games before judging.",
            },
          ],
        },
      },
      {
        key: "friends",
        icon: "users",
        label: "Follow your friends",
        title: "Follow your friends",
        lede: "The people you play with, tracked because you asked — what they are on, how much they are playing, and what changed since you last looked.",
        reads: [
          "Profiles and daily snapshots for the players you track",
          "Their recorded decks and results",
          "Your notification feed, which nods when something changes",
        ],
        setup: ["Track a friend's tag", "Turn on notifications"],
        script: {
          tool: "players_profile · players_timeline · battles_decks · elixir_events",
          lines: [
            {
              role: "user",
              text: "What has Levi been up to? He said he was climbing.",
            },
            {
              role: "agent",
              text: "He is at the ceiling. **King Levy is sitting at 14,000 trophies**, the Trophy Road cap, and has been there in every weekly snapshot since mid-August — so there is nowhere left to climb on Ladder. What he *has* been doing:\n\n- **72 battles in the last four weeks** (4,254 → 4,326 lifetime), a steady 15–30 a week.\n- Donations are up: 453, 319, 354 and 403 on the last four weekly counters.\n- Since August 16 he is on one deck almost exclusively — **Witch / Mini P.E.K.K.A / Elite Barbarians / Dart Goblin / Skeleton Barrel** — 36–28 (56%) with it.\n\nHis best league season on record is 5,316 from May 2022, so if he says climbing he means Path of Legends, not trophies.",
            },
            {
              role: "user",
              text: "Anything I should know before we play together?",
            },
            {
              role: "agent",
              text: "Two things from the record:\n\n1. You will collide on cards — he runs Witch, Mini P.E.K.K.A and Arrows, the same as your main deck.\n2. Your feed shows his battles landing in evening batches (2 on September 5, 8 on September 6), and the game last saw him at 02:59Z on the 10th — he plays late, your time.\n\nHe is a co-leader four years into the game. He will be fine.",
            },
          ],
        },
      },
    ],
  },
  {
    group: "For clan leaders",
    cases: [
      {
        key: "clan",
        icon: "swords",
        label: "Win your river race",
        title: "Win your river race",
        lede: "The finished race, the one that just opened, and who has battled so far today — from a record the game's own API forgets after twenty weeks.",
        reads: [
          "River races recorded weekly, corrected as they run",
          "Per-member points, decks used and boat attacks",
          "Clan facts every 15 minutes",
        ],
        setup: ["Track your clan", "Choose a recording scope"],
        script: {
          tool: "war_current · war_history · clans_roster",
          lines: [
            {
              role: "user",
              text: "How did POAP KINGS do in last week's river race?",
            },
            {
              role: "agent",
              text: "**First of five, for the ninth race running.**\n\nLast week was Colosseum — Season 135, Week 4 — and the boat finished at **38,700 fame** for **+100 clan trophies**. The four regular weeks before it all ended the same way: POAP KINGS hit the 10,000-fame line early every time, +20 each. Season 134 was a clean sweep too, with a 51,900-fame Colosseum.\n\nThis week's race (Season 136, Week 1) opened this morning against **De stichting, Legend Royale, Happy Win and Les champs** — none of whom we have raced before.",
            },
            { role: "user", text: "Who has carried so far this week?" },
            {
              role: "agent",
              text: "War day 1 has been open a couple of hours, so this is *so far*, not final:\n\n- **Sandeep** — 800 points, all four decks used\n- **Aaqib Javed** and **Mega Goblin** — 600 each, all four decks\n- **ryguy67** — 425 with three decks and a boat attack\n- **I Hate Witch** and **Andy** — started, not finished\n\nThat is 6 of the 45 in the race roster with a battle in; 39 have not touched it yet, which is normal this early. Four members are not in the race roster at all — the game leaves out anyone it had not seen since before the race started.",
            },
          ],
        },
      },
      {
        key: "roster",
        icon: "heart-pulse",
        label: "Keep the roster healthy",
        title: "Keep the roster healthy",
        lede: "Who is drifting, who just arrived, and who the game itself has stopped counting — before it shows up as a lost race.",
        reads: [
          "Roster snapshots with the game's own last-seen date per member",
          "Join, leave and role events as they are observed",
          "Each member's recorded record over the last 30 days",
        ],
        setup: ["Track your clan, comprehensive", "Read about scopes"],
        script: {
          tool: "clans_roster · elixir_events · clans_standings",
          lines: [
            {
              role: "user",
              text: "Who is quietly falling off in POAP KINGS?",
            },
            {
              role: "agent",
              text: "Three members, by the game's own last-seen date rather than by our recording:\n\n- **pax** — last seen in game August 29, no recorded battle since. Was an elder; moved to member on September 7.\n- **Th15_Guy** — last seen August 31; 26 recorded battles in the last 30 days at 31%. Also moved from elder on the 7th.\n- **Ditaka** — last seen September 3, quiet for a week.\n\nThe game left all three out of this week's race roster, which is its way of saying the same thing. Before that, pax was not an outlier at all — 158 recorded battles in the window — so this reads as a break, not a fade.\n\nOn the other side of the ledger: **NOBITA** joined September 4 and already has 309 donations this week, and **Brotherinpants** joined on the 8th. The roster stands at 49 of 50.",
            },
          ],
        },
      },
      {
        key: "scout",
        icon: "binoculars",
        label: "Scout the other clan",
        title: "Scout the other clan",
        lede: "Every race captures all five clans in the bracket, so rivals accumulate a record whether or not anyone asked us to track them.",
        reads: [
          "Rival fingerprints from every race shared with a recorded clan",
          "This week's standings and roster",
          "Your own war history for the comparison",
        ],
        setup: ["Look up a clan tag", "Read the privacy posture"],
        script: {
          tool: "war_rivals · war_current · war_history",
          lines: [
            {
              role: "user",
              text: "We're racing De stichting, Legend Royale, Happy Win and Les champs this week. What do I need to know?",
            },
            {
              role: "agent",
              text: "Less than I would like — this is the first race Elixir has seen any of them in. The rivals report only accumulates from races shared with a recorded clan, so all four have exactly one sighting, and it is this one. By Sunday I will have their whole race: fame by day, finish times, and whether they close strong.\n\nWhat I can tell you is what they are up against. POAP KINGS has won **nine straight races** on record — five in Season 135 including a 38,700 Colosseum, four in Season 134 including a 51,900 one — and every regular week ended early at the finish line.\n\nAsk me again on war day 3 and I will put their fame curve next to ours.",
            },
          ],
        },
      },
      {
        key: "recap",
        icon: "pen-line",
        label: "Write the weekly recap",
        title: "Write the weekly recap",
        lede: "The numbers are already recorded; the writing is the only work. Your agent drafts it and you paste it into clan chat.",
        reads: [
          "The completed race and the season it closed",
          "The clan's 30-day ladder table",
          "Roster changes over the week",
        ],
        setup: ["Track your clan", "Connect a client"],
        script: {
          tool: "war_history · clans_standings · clans_roster",
          lines: [
            {
              role: "user",
              text: "Write the Sunday recap for our clan chat.",
            },
            {
              role: "agent",
              text: "Here is a draft you can paste:\n\n> **POAP KINGS — Season 135 wrap**\n>\n> Colosseum week: **1st of 5, 38,700 fame, +100 clan trophies.** That closes out a perfect season — five races, five firsts, every regular week finished early.\n>\n> Ladder form over the last 30 days (recorded battles, 10+ decided): clan median win rate **52.8%** across 48 ranked members. Top of the table: **sniperhendo 70%** (78–34), **1spaceO2 65%**, **Kurd Paraw 62%**. Volume award goes to **Vijay** with 1,334 recorded battles.\n>\n> Welcome to **NOBITA** and **Brotherinpants**. Season 136 opened this morning against De stichting, Legend Royale, Happy Win and Les champs — the first time we have met any of them.\n\nWant it shorter, or with every member's points listed?",
            },
          ],
        },
      },
    ],
  },
  {
    group: "For builders",
    cases: [
      {
        key: "discord",
        icon: "bot",
        label: "Answer your clanmates",
        title: "Answer your clanmates",
        lede: "An agent acts for one clan rather than for you: its own door, its own key, its own feed — and a map from a Discord id to a player tag.",
        reads: [
          "The documentation itself, served over MCP",
          "Recorded history for the clan the agent acts for",
          "Its own identity map, built once per person",
        ],
        setup: ["Create an agent", "Read the agents doc"],
        script: {
          tool: "elixir_docs",
          lines: [
            {
              role: "user",
              text: "Can my clanmates ask this in our Discord, without me in the loop?",
            },
            {
              role: "agent",
              text: "Yes — that is what an **agent** is for. I read the Agents page of the documentation; the shape is:\n\n- An agent *acts for a clan, not for a person*: its own identity, its own key and URL (`https://elixir.poapkings.com/a/<public_id>/mcp`), its own event cursor and feedback inbox. Nothing it does lands in your history.\n- You create it under **Connections → Agents → Create agent** with a name and the clan tag. The key is shown once; only its hash is stored.\n- It spends *your* daily call budget, and every tier can create agents — 3, 5, 10 or 25 depending on tier.\n- When a member first asks “how am I doing”, the bot calls `elixir_identify` once with their Discord id and player tag. After that `on_behalf_of` resolves them with no lookup.\n\nSo the loop is: you create the agent, your bot holds the key, and your clanmates talk to the bot. There is a reference bot already running in POAP KINGS' Discord if you want the pattern.",
            },
          ],
        },
      },
      {
        key: "publish",
        icon: "share-2",
        label: "Publish your own stats",
        title: "Publish your own stats",
        lede: "Build a clan site or a bot on the record instead of on a second Clash key. Pull at build time; no scraping, no push.",
        reads: [
          "The documentation itself, served over MCP",
          "Every recorded river race, past the API's 20-week window",
          "The clan's 30-day ladder table",
        ],
        setup: ["Read the integrations doc", "Request a service key"],
        script: {
          tool: "elixir_docs · war_history · clans_standings",
          lines: [
            {
              role: "user",
              text: "I want our clan site to show war history nobody else has.",
            },
            {
              role: "agent",
              text: "You can build that on the record instead of on a second Clash key. Two ways in, per the docs:\n\n1. **An agent connection** — the same tools I am using, over MCP with the agent's key. Good for a site that renders at build time.\n2. **An integration** — a platform identity with its own REST key at `https://elixir.poapkings.com/api/v1`, provisioned by an admin, with its own budgets. That is how Elixir Drop reads the hub. Keys are `svt_…`, shown once, and never belong in a browser.\n\nWhat you would be publishing that the game's own API forgets: **every recorded river race**. POAP KINGS' record runs from Season 134, Week 1 to today — nine finished races, all firsts — plus a 30-day ladder table for the clan (48 ranked members, median win rate 52.8%).\n\nI searched the documentation for “service key”: it is covered on the Protocol, Connections and Integrations pages. Start with Integrations.",
            },
          ],
        },
      },
      {
        key: "collector",
        icon: "server",
        label: "Run a collector",
        title: "Run a collector",
        lede: "Volunteer a machine that fetches for the corpus. It is named for a card, credited to you, and it raises what Elixir records for you.",
        reads: [
          "The collector fleet: points, credits, last success",
          "Coverage on your own tag: polls, captures, completeness",
          "The operators guide, served over MCP",
        ],
        setup: ["Read the operators guide", "Raise your hand"],
        script: {
          tool: "elixir_collectors · elixir_coverage · elixir_docs",
          lines: [
            {
              role: "user",
              text: "What do I get for running a collector?",
            },
            {
              role: "agent",
              text: "Quota, mostly — and a more complete record of your own tag.\n\n**The fleet right now:** three collectors, all active. Ram Rider (11,114 fetch points, 1,111 quota credits earned), Tesla (8,378 / 837) and Wall Breakers (1,961 / 196). All three fetched within the last minute.\n\n**What you earn:** every 10 fetches adds one daily tool call to your budget, capped at 4× your tier's base, plus bonus recording slots. The budget they work inside is shared — more collectors are resilience, never more Clash API quota.\n\n**What it costs:** a machine that is usually on with a static IP, and your own Clash Royale API key allowlisted to it. Per the operators guide the collector holds exactly two secrets and has no cloud access.\n\n**Why it matters to you:** coverage on your tag today is complete — 5 of 5 expected battles captured in the latest interval, 100% over the 78 hours we could measure — because three machines are polling. That is the thing you would be adding to.",
            },
          ],
        },
      },
    ],
  },
];
