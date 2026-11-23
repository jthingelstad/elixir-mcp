/** Help for the Settings pages, keyed by settingsHere's `page`. */
export const SETTINGS_HELP = {
  profile: {
    title: "Profile settings",
    docs: "profile",
    lines: [
      "Profile is who you are here: your email, your main player, your time zone and your limits. Every time Elixir prints is on your zone.",
    ],
  },
  seen: {
    title: "What members see",
    docs: "profile:seen",
    lines: [
      "Who sees what of you: other members, someone you send a link to, and only you. Each line is what Elixir does today.",
      "The lens draws your main player's latest battle with the battle page itself, as a member sees it and as someone with the link sees it.",
    ],
  },
  "sign-ins": {
    title: "Sign-ins & devices",
    docs: "profile:devices",
    lines: [
      "Every browser signed in to your account, and what happened on the account lately. Sign out a device you don't recognise.",
    ],
  },
  players: {
    title: "Players & following",
    docs: "players",
    lines: [
      "The players and clans you added. Added means recorded. Each one that Elixir records only for you takes a slot.",
      "Your main player is who your Profile, Stats and Timeline open on. Verify is what makes a player yours: one battle proves it.",
    ],
  },
  player: {
    title: "A player you follow",
    docs: "players:record",
    lines: [
      "What Elixir holds for this player, how fresh it is, and how you relate to them. The grid counts recorded battles. A day with no read is unknown, never a day they did not play.",
    ],
  },
  verify: {
    title: "Verify",
    docs: "verify",
    lines: [
      "Verify proves a player is yours. Elixir names a deck, you play one battle with it in any mode, and the battle log shows it.",
    ],
  },
  emails: {
    title: "Emails",
    docs: "profile:email",
    lines: [
      "Each mail Elixir can send, and whether it comes to you. Sign-in codes are not on the list: they always send.",
    ],
  },
  notifications: {
    title: "Notification settings",
    docs: "profile:notifications",
    lines: [
      "Turn on notifications on this phone or computer, and pick what comes: cheers on your play, new followers, Clan Actions and answers to your feedback. Counts only, never who.",
    ],
  },
  sent: {
    title: "Sent to you",
    docs: "activity:emails",
    lines: ["Every mail Elixir sent you. Open one to read it as it was sent."],
  },
  email: {
    title: "One email",
    docs: "activity:email",
    lines: [
      "This mail as it was sent. If something in it was wrong or missing, report it from here and it rides along.",
    ],
  },
  connections: {
    title: "Connections",
    docs: "connections:clients",
    lines: [
      "The apps you signed in to Elixir. Each one acts as you.",
      "A credential that no longer works shows here when something is still presenting it.",
    ],
  },
  discord: {
    title: "Discord",
    docs: "connections:clients",
    lines: [
      "Your Discord link, and where your timeline posts. The link is for signing in. Your timeline goes only to a channel you choose.",
    ],
  },
  usage: {
    title: "Usage and limits",
    docs: "usage",
    lines: [
      "What your calls spent today and what your role allows. The daily budget resets at midnight UTC.",
    ],
  },
  requests: {
    title: "Requests",
    docs: "activity:requests",
    lines: [
      "Every call your connections made, newest first. Open one to see its request, its answer and where the time went.",
    ],
  },
  call: {
    title: "One call",
    docs: "activity:call",
    lines: [
      "One call as Elixir recorded it. Bodies are kept for a limited time, and the record says when one has aged out.",
    ],
  },
  feedback: {
    title: "Feedback",
    docs: "feedback",
    lines: [
      "What you have told us and what we did about it. Every item gets a response, here and by email if that's on.",
    ],
  },
  "feedback-item": {
    title: "One feedback item",
    docs: "feedback",
    lines: [
      "One note and its answer. A filed note cannot be edited. A reply is a new note, linked to this one.",
    ],
  },
  collectors: {
    title: "Collectors",
    docs: "status:collectors",
    lines: [
      "The machines you run for Elixir. While one is active it raises your limits to Family.",
    ],
  },
  collector: {
    title: "Your collector",
    docs: "status:collector",
    lines: [
      "Heartbeat says the machine is alive. Data freshness says it last delivered. A fresh heartbeat with stale data is idle, not broken.",
    ],
  },
  raise: {
    title: "Run a collector",
    docs: "status:collectors",
    lines: [
      "Name the machine, pick its card and raise your hand. The token waits on the collector's page, to reveal once.",
    ],
  },
};
