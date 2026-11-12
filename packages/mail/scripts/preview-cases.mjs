/** Offline mail specimens. These are render inputs, never recipients or sends. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isRetiredEmailKind } from "@elixir-mcp/contracts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  JSON.parse(
    readFileSync(path.join(here, "../fixtures", `${name}.json`), "utf8"),
  );
const product = (name, kind, facts) => ({ name, kind, facts });
const relay = (name, message) => ({ name, kind: message.kind, message });

/** The gallery is what Elixir sends. A retired kind's specimens (the
 *  clan report, Arena week and milestone, folded into the digest on
 *  2026-11-12) are asked for by name: a stored issue still renders on its
 *  record, so the escaping tests keep reading them.
 *  @param {{retired?: boolean}} [opts]
 *  @returns {Array<{name: string, kind: string, facts?: any, message?: any}>} */
export function mailPreviewCases({ retired = false } = {}) {
  const cases = ["../fixtures", "../test/fixtures"].flatMap((dir) =>
    readdirSync(path.join(here, dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) =>
        product(
          f.slice(0, -5),
          f.split("-")[0].replace(".json", ""),
          JSON.parse(readFileSync(path.join(here, dir, f), "utf8")),
        ),
      ),
  );
  const clan = read("clan_report");
  const noWar = { ...clan, war: { present: false }, trend: null };
  cases.push(product("clan_report-no-war", "clan_report", noWar));
  cases.push(
    product("clan_report-activity", "clan_report", {
      ...noWar,
      clan: { ...clan.clan, scope: "activity" },
      headline: {
        ...clan.headline,
        battles: null,
        active: null,
        sessions: null,
      },
      presence: null,
      week_moves: null,
      standouts: [],
      coverage:
        "Activity scope records rosters and wars, not members’ battles. Battle activity is unknown.",
    }),
  );
  cases.push(
    product("clan_report-partial", "clan_report", {
      ...clan,
      coverage:
        "Recording began partway through this week. The record does not cover the full period; missing activity is unknown.",
      trend: null,
    }),
  );
  const arena = read("arena_week");
  cases.push(
    product("arena_week-alt-only", "arena_week", {
      ...arena,
      primary: {
        ...arena.primary,
        totals: { battles: 0, wins: 0, losses: 0, by_family: [] },
        trophies: null,
        modes: [],
        deck: null,
        form: null,
        opponents: { distinct: 0, again: [] },
        coverage:
          "No primary-player battles recorded. The other players’ records are shown below.",
      },
      progress: [],
    }),
  );
  const families = [
    arena.primary.totals.by_family[0],
    { mode: "casual", battles: 8, wins: 3, losses: 5 },
    { mode: "ranked", battles: 6, wins: 4, losses: 2 },
    arena.primary.totals.by_family.find((x) => x.mode === "war"),
  ];
  cases.push(
    product("arena_week-many-modes", "arena_week", {
      ...arena,
      primary: {
        ...arena.primary,
        totals: {
          battles: families.reduce((n, m) => n + m.battles, 0),
          wins: families.reduce((n, m) => n + m.wins, 0),
          losses: families.reduce((n, m) => n + m.losses, 0),
          by_family: families,
        },
      },
    }),
  );
  const digest = read("tracking_report");
  cases.push(
    product("tracking_report-daily", "tracking_report", {
      ...digest,
      cadence: "daily",
      window: {
        from: "2026-11-10T14:30:00.000Z",
        to: "2026-11-11T14:30:00.000Z",
      },
      people: digest.people.slice(0, 1),
      clans: [],
      coverage:
        "You follow 5 people; 1 has something recorded this day. A gap means unknown. It does not mean they didn’t play.",
    }),
  );
  cases.push(
    product("tracking_report-you-only", "tracking_report", {
      ...digest,
      people: [],
      clans: [],
      following: 0,
      coverage:
        "You follow nobody yet, so this week is yours alone. A gap means unknown. It does not mean they didn’t play.",
    }),
  );
  const collector = read("collector_activity");
  cases.push(
    product("collector_activity-silent", "collector_activity", {
      ...collector,
      collectors: [
        {
          ...collector.collectors[0],
          state: "silent",
          since: "2026-10-12T04:20:00Z",
          fetches: 0,
          adding_fetches: 0,
        },
      ],
      totals: {
        ...collector.totals,
        fetches: 0,
        of_fleet: 0,
        saved_share: null,
      },
      tier: { role: "member", granted: false, family_earned: false },
      fleet_note: null,
    }),
  );
  const upgrade = {
    event: "upgrade",
    name: "Example collector",
    from_version: "v3.0.4",
    to_version: "v3.0.6",
    observed_at: "2026-10-12T04:20:00Z",
    signature_state: "signed",
    release: {
      reason: "Improves recovery after a connection is interrupted.",
      changes:
        "Fetches resume after a temporary network interruption.\nThe updater preserves its previous signed binary for rollback.\n" +
        "Release details remain available in the published notes. ".repeat(12),
      release_url:
        "https://github.com/jthingelstad/elixir-mcp-collector/releases/tag/v3.0.6",
    },
  };
  cases.push(
    product("collector_activity-upgrade", "collector_activity", upgrade),
  );
  cases.push(
    product("collector_activity-upgrade-missing", "collector_activity", {
      ...upgrade,
      signature_state: "unverified",
      release: null,
    }),
  );
  cases.push(
    product("collector_activity-upgrade-test", "collector_activity", {
      ...upgrade,
      test: true,
      signature_state: "not_recorded",
    }),
  );
  const milestone = read("milestone");
  const first = milestone.milestones[0];
  const moments = [
    ["ranked_promotion", "reached Master I", "Master I"],
    ["best_trophies_band", "set a new best: 8,000 trophies", "8,000 trophies"],
    ["career_wins_step", "reached 5,000 career wins", "5,000 career wins"],
    [
      "collection_level_step",
      "reached collection level 50",
      "Collection level 50",
    ],
    ["legendary_badge_earned", "earned a legendary badge", "Legendary badge"],
    [
      "card_form_unlocked",
      "unlocked an Evolution",
      "",
      { id: 26000000, name: "Knight", form: "evolution" },
    ],
    [
      "card_form_unlocked",
      "unlocked a Hero",
      "",
      { id: 26000018, name: "Mini P.E.K.K.A", form: "hero" },
    ],
  ];
  for (const [i, [kind, text, big, card]] of moments.entries())
    cases.push(
      product(`milestone-${i}-${kind}`, "milestone", {
        ...milestone,
        also: [],
        milestones: [
          {
            ...first,
            kind,
            headline: `RiverFox ${text}`,
            big,
            big_label: "",
            lines: [],
            battle: null,
            card,
            subject: { ...first.subject, name: "RiverFox" },
          },
        ],
      }),
    );
  const feedback = read("feedback_answer");
  for (const status of ["seen", "planned", "needs_info", "declined"])
    cases.push(
      product(`feedback_answer-${status}`, "feedback_answer", {
        ...feedback,
        status,
        shipped_in: null,
        message:
          "The Arena week is missing the deck I played on Saturday. ".repeat(
            16,
          ),
        response:
          status === "needs_info"
            ? "Which player and mode were you looking at?\n\nReply on the linked page so we can check the same record."
            : "We checked the recorded battles for that week.\n\n" +
              "A gap between captures can leave a battle out. The coverage note explains the part of the record that is available. ".repeat(
                8,
              ),
      }),
    );
  cases.push(
    product("feedback_answer-question-shipped", "feedback_answer", {
      ...feedback,
      status: "needs_info",
      shipped_in: "11.13.0",
      response:
        "The correction shipped in this release. Is the same deck still missing when you open that week?",
    }),
  );
  const actions = read("clan_actions_waiting");
  cases.push(
    product("clan_actions_waiting-one", "clan_actions_waiting", {
      ...actions,
      subject: "Welcome: RiverFox (POAP KINGS)",
      lines: [
        {
          title: "Welcome: RiverFox",
          reason:
            "Joined {{when:2026-09-25T15:04:00.000Z}}. Welcome them in clan chat, then mark it done.",
          number: 41,
          new: true,
        },
      ],
    }),
  );
  cases.push(
    product("clan_actions_waiting-many", "clan_actions_waiting", {
      ...actions,
      subject:
        "15 actions in POAP KINGS: remove Example player 0, remove Example player 1, and 13 more",
      lines: [
        ...Array.from({ length: 10 }, (_, i) => ({
          title: `Remove from the clan: Example player ${i}`,
          reason:
            "12 days without a battle. This clan counts a member at risk at 5 and acts at 8.",
          number: 60 - i,
          new: i < 2,
        })),
        "And 5 more.",
      ],
    }),
  );
  cases.push(
    relay("login", { kind: "login", code: "482913", token: "preview" }),
  );
  cases.push(
    relay("login-client-link", {
      kind: "login",
      code: "482913",
      token: "preview",
      client_name: "Example agent",
    }),
  );
  cases.push(relay("login-code-only", { kind: "login", code: "482913" }));
  cases.push(
    relay("login-oauth", {
      kind: "login",
      code: "482913",
      client_name: "Elixir Drop",
    }),
  );
  cases.push(relay("welcome", { kind: "welcome" }));
  for (const notify_kind of [
    "feedback",
    "gateway_request",
    "gateway_quarantined",
    "gateway_silent",
    "generic",
  ])
    cases.push(
      relay(`owner_notify-${notify_kind}`, {
        kind: "owner_notify",
        notify_kind: notify_kind === "generic" ? undefined : notify_kind,
        note: "An example service notice. The linked page carries the current details.",
        detail:
          notify_kind === "gateway_silent"
            ? {
                collector: "Example collector with a long label",
                status: "active",
                last_heartbeat_at: "2026-10-12T04:20:00.000Z",
                last_success_at: "2026-10-12T04:19:58.000Z",
              }
            : {
                category: "bug",
                surface: "web",
                from: "example agent",
                feedback_id: "1234567890",
              },
      }),
    );
  return retired
    ? cases
    : cases.filter((x) => x.message || !isRetiredEmailKind(x.kind));
}
