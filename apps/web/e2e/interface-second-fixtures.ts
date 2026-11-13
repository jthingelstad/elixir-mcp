export const ACTIVITY_CHANNEL = {
  clan_tag: "#0QC8RCGY",
  connection: {
    enabled: true,
    webhook: "discord.com/api/webhooks/1…fixture",
    enabled_at: "2026-10-10T12:00:00Z",
    disabled_reason: null,
    categories: {},
    rewrite: true,
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
  // The clan's one voice (2026-10-20), shown here, set in Settings.
  voice: "Warm and concise.",
  voice_max: 400,
  editor_runs_per_day: 50,
};

export const RECRUIT = {
  clan_tag: "#0QC8RCGY",
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
      body: "We play Clan Wars and help each other grow.\n\nActive players with 7,500 trophies are welcome. One spot is open.\n\nSearch #0QC8RCGY in game.",
    },
    post: {
      title: "Example Clan #0QC8RCGY — Steady wars [7500]",
      body: "We play Clan Wars and help each other grow.\n\nRequired Trophies: [7500]\n\nSearch #0QC8RCGY in game.",
    },
  },
  problems: [],
  versions: [],
  fields: {},
};

export const EMAILS = {
  kinds: [
    ["tracking_report", "Your digest", "Home", "Wednesday"],
    ["collector_activity", "Collector activity", "Collectors", "Sunday"],
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
      send_id: "fixture-digest",
      kind: "tracking_report",
      subject: "Your week: 3 people you follow played",
      sent_at: "2026-10-14T14:00:00Z",
    },
    {
      send_id: "fixture-collector",
      kind: "collector_activity",
      subject: "Collector activity: 1,204 battles recorded",
      sent_at: "2026-10-12T14:00:00Z",
    },
  ],
};
