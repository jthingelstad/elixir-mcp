/** Offline mail specimens. These are render inputs, never recipients or sends. */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  JSON.parse(
    readFileSync(path.join(here, "../fixtures", `${name}.json`), "utf8"),
  );
const product = (name, kind, facts) => ({ name, kind, facts });
const relay = (name, message) => ({ name, kind: message.kind, message });

/** The gallery is what Elixir sends: one specimen per kind still sent
 *  (packages/mail/fixtures) and its variants. A sent mail's record shows
 *  the archived HTML, so no retired kind needs a renderer or a specimen.
 *  @returns {Array<{name: string, kind: string, facts?: any, message?: any}>} */
export function mailPreviewCases() {
  const dir = path.join(here, "../fixtures");
  const cases = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) =>
      product(
        f.slice(0, -5),
        f.slice(0, -5),
        JSON.parse(readFileSync(path.join(dir, f), "utf8")),
      ),
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
  return cases;
}
