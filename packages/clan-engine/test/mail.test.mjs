import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionReason,
  actionsWaitingMail,
  MAIL_MAX_LINES,
} from "../src/mail.mjs";
import { ACTION_TYPES } from "../src/actions.mjs";

const people = [
  { player_tag: "#L", name: "Lead", role: "leader" },
  { player_tag: "#C", name: "Co", role: "coLeader" },
  { player_tag: "#E", name: "Eld", role: "elder" },
  { player_tag: "#M", name: "Mem", role: "member" },
  { player_tag: "#Q", name: "Quiet", role: "member" },
];
const card = (id, type, extra = {}) => ({
  card_id: id,
  type,
  status: "proposed",
  raised_at: "2026-09-26T11:00:00.000Z",
  player_tag: "#Q",
  player_name: "Quiet",
  ...extra,
});
const base = {
  clanTag: "#0QC8RCGY",
  clanName: "Example Clan",
  appUrl: "https://elixir.test/clan/",
};

test("only people who can act on an action are sent it", () => {
  const mail = actionsWaitingMail({
    ...base,
    people,
    cards: [
      card("r1", "removal"),
      card("w1", "welcome", { player_tag: "#N", player_name: "Newbie" }),
      card("a1", "away", {
        player_tag: "#Q",
        audience: { kind: "member", player_tag: "#Q" },
      }),
      card("x1", "promotion", { status: "done" }),
    ],
  });
  const to = Object.fromEntries(mail.map((m) => [m.player_tag, m]));
  assert.deepEqual(Object.keys(to).sort(), ["#C", "#E", "#L", "#Q"]);
  assert.deepEqual(to["#L"].card_ids.sort(), ["r1", "w1"]);
  assert.deepEqual(to["#E"].card_ids, ["w1"], "an elder never sees a removal");
  assert.deepEqual(to["#Q"].card_ids, ["a1"], "a member only their own");
  assert.equal(to["#M"], undefined);
  assert.equal(
    to["#L"].subject,
    "2 actions in Example Clan: welcome Newbie, remove Quiet",
  );
  assert.equal(to["#E"].subject, "Welcome a newcomer: Newbie (Example Clan)");
  assert.equal(to["#Q"].lines[0].title, "Going to be away?");
  assert.equal(to["#Q"].lines[0].new, true);
  assert.equal(to["#L"].link, "https://elixir.test/clan/0QC8RCGY/feed");
});

test("a person is emailed only when something became theirs since their last email; the email lists all of it", () => {
  const cards = [
    card("old", "removal", { raised_at: "2026-09-20T11:00:00.000Z" }),
    card("new", "welcome", { player_tag: "#N", player_name: "Newbie" }),
  ];
  const mail = actionsWaitingMail({
    ...base,
    people,
    cards,
    lastMailed: {
      "#L": "2026-09-21T11:05:00.000Z",
      "#C": "2026-09-26T11:05:00.000Z",
    },
  });
  const to = Object.fromEntries(mail.map((m) => [m.player_tag, m]));
  assert.deepEqual(to["#L"].new_card_ids, ["new"]);
  assert.deepEqual(
    to["#L"].lines.map((l) => [l.title, l.new]),
    [
      ["Welcome a newcomer: Newbie", true],
      ["Remove from the clan: Quiet", false],
    ],
  );
  assert.equal(to["#C"], undefined, "nothing new since their last email");
  // Nothing new for anyone, nothing sent.
  assert.deepEqual(
    actionsWaitingMail({
      ...base,
      people,
      cards: [cards[0]],
      lastMailed: {
        "#L": "2026-09-21T00:00:00Z",
        "#C": "2026-09-21T00:00:00Z",
      },
    }),
    [],
  );
});

test("a long list is capped and counted", () => {
  const many = Array.from({ length: MAIL_MAX_LINES + 3 }, (_, i) =>
    card(`r${i}`, "removal", { player_name: `P${i}` }),
  );
  const [m] = actionsWaitingMail({
    ...base,
    people: [people[0]],
    cards: many,
  });
  assert.equal(m.lines.length, MAIL_MAX_LINES + 1);
  assert.equal(m.lines.at(-1), "And 3 more.");
});

test("a line links by the action's number and never says it; one action waiting opens its own page, several open Today", () => {
  const mail = actionsWaitingMail({
    ...base,
    people,
    cards: [
      card("r1", "removal", { number: 37 }),
      card("w1", "welcome", {
        number: 38,
        player_tag: "#N",
        player_name: "Newbie",
      }),
    ],
  });
  const to = Object.fromEntries(mail.map((m) => [m.player_tag, m]));
  assert.deepEqual(to["#L"].lines.map((l) => [l.number, l.title]).sort(), [
    [37, "Remove from the clan: Quiet"],
    [38, "Welcome a newcomer: Newbie"],
  ]);
  assert.equal(to["#L"].link, "https://elixir.test/clan/0QC8RCGY/feed");
  assert.equal(to["#E"].subject, "Welcome a newcomer: Newbie (Example Clan)");
  assert.equal(to["#E"].link, "https://elixir.test/clan/0QC8RCGY/actions/38");
});

test("the reason says why it waits, within the door's limit", () => {
  const removal = card("r", "removal", {
    evidence: {
      rationale: {
        headline:
          "12 days without a battle. This clan counts a member at risk at 5 and acts at 8.",
      },
    },
  });
  const said = actionReason(removal);
  assert.match(said, /^12 days without a battle\./);
  assert.match(said, /Modes the battle log/);
  assert.ok(said.length <= 160);
  // The caveat comes off first.
  const long = "x".repeat(140);
  assert.equal(
    actionReason(
      card("r", "removal", { evidence: { rationale: { headline: long } } }),
    ),
    long,
  );
  assert.match(
    actionReason(
      card("w", "welcome", {
        evidence: { joined_at: "2026-10-20T15:00:00.000Z" },
      }),
    ),
    /^Joined \{\{when:2026-10-20T15:00:00\.000Z\}\}\. Welcome them/,
  );
  assert.match(
    actionReason(
      card("a", "away", { evidence: { days_idle: 9.4, away_max_days: 14 } }),
    ),
    /^9 days since your last recorded battle\. Mark yourself away, for up to 14 days\./,
  );
  // An action with no words for why: no line, never a guess.
  assert.equal(actionReason(card("p", "promotion")), "");
  for (const type of Object.keys(ACTION_TYPES))
    assert.ok(actionReason(card("x", type)).length <= 160, type);
});

test("the subject that lists several keeps whole names, then counts the rest", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    card(`r${i}`, "removal", { player_name: `Member Name ${i}` }),
  );
  const [m] = actionsWaitingMail({
    ...base,
    people: [people[0]],
    cards: many,
  });
  assert.ok(m.subject.length <= 120);
  assert.match(
    m.subject,
    /^12 actions in Example Clan: remove Member Name \d+,/,
  );
  assert.match(m.subject, /, and \d+ more$/);
});
