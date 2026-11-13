# 2026-11-13 — The app's first steps in the game's voice

Copy only, for "Player-facing words sound like the game" (Jamie,
2026-11-13; DECISIONS and the Voice section of `AGENTS.md`, in #863).
The sign-in form's hints, Home's first steps and welcome steps, the
first-read lines (`NewAccount.jsx`, `Today.jsx`, `record-journey.js`,
`follow.jsx`, Stats' `Pending.jsx`), Find's head and People to follow now
read short and friendly, in the game's words.

The clanmate invite (`src/lib/invite.js`) was also untrue: it promised
the clan's week "by email every Monday" and pitched Elixir as a battle
history keeper. It now tells the social layer and the clan's week in the
weekly digest; the chat line still fits the game's 200 characters and
passes the chat filter (`invite.test.js`).

Layout, class names and components are untouched. MCP and the JSON API
unchanged.
