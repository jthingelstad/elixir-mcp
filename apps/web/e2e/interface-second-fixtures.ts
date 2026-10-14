export const ACTIVITY_CHANNEL = {
  clan_tag: "#2PQRJ8LV",
  connection: {
    enabled: true,
    webhook: "discord.com/api/webhooks/1…fixture",
    enabled_at: "2026-10-10T12:00:00Z",
    disabled_reason: null,
    categories: {},
    rewrite: true,
    voice: "Warm and concise.",
    set_by_name: "Ada",
    updated_at: "2026-10-10T12:00:00Z",
    delivery: null,
  },
  policy: {
    ready: true,
    defaults: { members: true, milestones: true, war: true },
    ruled_out: {},
  },
  categories: [
    {
      key: "members",
      label: "Members",
      why: "Joins, departures and role changes.",
    },
    {
      key: "milestones",
      label: "Milestones",
      why: "Members’ milestones and awards.",
    },
    {
      key: "war",
      label: "Clan Wars",
      why: "The bracket and the week’s result.",
    },
  ],
  in_effect: { members: true, milestones: true, war: true },
  model: {
    available: true,
    set: true,
    refused: false,
    name: "Claude Sonnet 5.5",
  },
  voice_max: 400,
  editor_runs_per_day: 50,
};

export const RECRUIT = {
  clan_tag: "#2PQRJ8LV",
  can_edit: true,
  pitch: {
    tagline: "Steady wars, friendly chat",
    about: "We play Clan Wars and help each other grow.",
    points: ["Wars every week", "A friendly clan to grow with"],
    looking_for: "Active players who enjoy showing up for the clan.",
  },
  pitch_version: 1,
  facts: {
    name: "Example Clan",
    type: "inviteOnly",
    members: 49,
    open_slots: 1,
    required_trophies: 7500,
    war_trophies: 3210,
    clan_score: 61234,
    donations_per_week: 8400,
    top_trophies: [],
    top_donors: [],
    source: "live",
  },
  facts_read_at: "2026-10-14T08:00:00Z",
  pending: null,
  copy: {
    personal: {
      subject: "Join Example Clan",
      body: "We play Clan Wars and help each other grow.\n\nActive players with 7,500 trophies are welcome. One spot is open.\n\nSearch #2PQRJ8LV in game.",
    },
    post: {
      title: "Example Clan #2PQRJ8LV — Steady wars [7500]",
      body: "We play Clan Wars and help each other grow.\n\nRequired Trophies: [7500]\n\nSearch #2PQRJ8LV in game.",
    },
  },
  problems: [],
  versions: [],
  fields: {},
};

export const EMAILS = {
  kinds: [
    ["clan_report", "Clan report", "Clan", "Monday"],
    ["arena_week", "Your week in the Arena", "Ladder", "Tuesday"],
    ["tracking_report", "Your friends this week", "Friends", "Wednesday"],
    ["collector_activity", "Collector activity", "Collectors", "Sunday"],
    ["milestone", "Milestones", "Ladder", null],
    ["clan_actions_waiting", "Clan actions waiting", "Clan", null],
    ["feedback_answer", "Answers to your feedback", "Account", null],
  ].map(([kind, label, product, weekday]) => ({
    kind,
    label,
    product,
    enabled: true,
    applies: true,
    sends: weekday ? { weekday, time: "9:00 am", zone: "Central" } : null,
    last_send_id: null,
  })),
  recent: [
    {
      send_id: "fixture-arena",
      kind: "arena_week",
      subject: "Your week in the Arena: Trophy Road 5–4",
      sent_at: "2026-10-13T14:00:00Z",
    },
    {
      send_id: "fixture-clan",
      kind: "clan_report",
      subject: "Example Clan: the week’s war and arrivals",
      sent_at: "2026-10-12T14:00:00Z",
    },
  ],
};
