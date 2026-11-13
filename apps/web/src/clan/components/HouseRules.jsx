import { noun } from "@elixir-mcp/ui";
import { ranksElder, removalDay, setMinimums } from "@elixir-mcp/clan-engine";

/**
 * A clan's policy as its house rules: one card a rule, its numbers big
 * enough to read at a glance, then the policy's own sentences (the engine's
 * `describePolicy`, unchanged). The numbers are read from the saved values
 * when the view has them (Policy); without them (Standing) a card is its
 * sentences alone. Each card has an address, `#rule-<key>`, so Standing
 * can point at the rule behind a member's group.
 */

/** The order a player reads them in, and the card's title. */
const ORDER = ["about", "minimums", "removal", "elder", "counts", "welcome"];
const TITLE = {
  about: "About this clan",
  minimums: "Minimums",
  removal: "When you go quiet",
  elder: "Becoming an Elder",
  counts: "What this clan counts",
  welcome: "Newcomers",
};

export const ruleId = (key) => `rule-${key}`;
export const ruleTitle = (section) => TITLE[section.key] ?? section.title;

const num = (v) => Number(v).toLocaleString("en-US");
const pct = (share) => `${Math.round(Number(share) * 100)}%`;

/** A minimum as a number and what it counts. */
const MINIMUM = {
  war: (v) => [num(v), noun(v, "war deck")],
  ranked: (v) => [num(v), noun(v, "ranked battle")],
  donations: (v) => [num(v), "donations a week"],
  trophies: (v) => [num(v), "trophies"],
};

/** The big numbers on one card, read from the saved values. */
function numbersFor(key, values) {
  if (!values) return null;
  if (key === "minimums") {
    const set = Object.entries(setMinimums(values));
    if (!set.length) return null;
    return {
      join: values.minimums_rule === "all" ? "and" : "or",
      tiles: set.map(([c, v]) => MINIMUM[c](v)),
    };
  }
  if (key === "removal" && values.removal_enabled) {
    const tiles = [
      [
        num(values.at_risk_days),
        `${noun(values.at_risk_days, "day")} with no battle: at risk`,
      ],
      [
        num(removalDay(values)),
        `${noun(removalDay(values), "day")}: the Leaders decide`,
      ],
    ];
    if (values.away_max_days > 0)
      tiles.push([
        num(values.away_max_days),
        `${noun(values.away_max_days, "day")} you can mark away`,
      ]);
    return { tiles };
  }
  if (key === "elder" && values.elder_mode === "categories") {
    return {
      tiles: [
        [
          num(values.tenure_min_days),
          `${noun(values.tenure_min_days, "day")} in the clan first`,
        ],
        [
          num(values.promote_qualifying_weeks),
          `weekly ${noun(values.promote_qualifying_weeks, "review")} to be promoted`,
        ],
        [
          `${pct(values.band_floor_share)} to ${pct(values.band_ceiling_share)}`,
          "of the roster are Elders",
        ],
      ],
    };
  }
  return null;
}

/**
 * Who sees what about you under each rule (Jamie, 2026-11-13), read from
 * the saved values and true to what the server enforces:
 *  - the week's numbers are every member's (`weekView`);
 *  - where everyone stands is on Standing when Elder is ranked and the
 *    policy shows it (`members_see_standing`; `standing()` always shows a
 *    leader), else only your own line;
 *  - your days without a battle, your clock and your hold or away are
 *    yours and the leaders' (`standing().you`, `manageView`), and a
 *    removal Action reaches the clan's Discord when leaders connect one
 *    (`discordShareable`); completed promotions, demotions and removals
 *    are shared with the clan (`sharing.mjs`);
 *  - a welcome Action, naming the newcomer, is for Elders and leaders.
 * Null without saved values (Standing shows the rules alone).
 */
export function seesFor(key, values) {
  if (!values) return null;
  const ranked = ranksElder(values);
  const board = ranked && Boolean(values.members_see_standing);
  const done =
    "A promotion or demotion is shared with the clan once it's done.";
  if (key === "about")
    return "Nothing here is about you: every member reads it, and so does Elixir's clan directory.";
  if (key === "counts")
    return "Every member sees your war decks, donations and battles each week.";
  if (key === "minimums")
    return board
      ? "Every member sees on Standing where you are against them."
      : "Only you and the Leader and Co-Leaders see where you are against them.";
  if (key === "elder")
    return !ranked
      ? done
      : board
        ? `Every member sees on Standing who's rising and who's slipping, with their numbers. ${done}`
        : `Only you and the Leader and Co-Leaders see where you stand. ${done}`;
  if (key === "removal")
    return `Only you and the Leader and Co-Leaders see your days without a battle, whether you're at risk${
      values.away_max_days > 0 ? ", and your away" : ""
    }. If they post the clan's Actions to Discord, a removal goes there too. A removal is shared with the clan once it's done.`;
  if (key === "welcome")
    return "Elders and the Leader and Co-Leaders get an Action naming you when you join.";
  return null;
}

function Numbers({ numbers }) {
  return (
    <ul className="kit-rule__nums">
      {numbers.tiles.map(([big, what], i) => (
        <li key={what} className="kit-rule__num">
          {i > 0 && numbers.join ? (
            <span className="kit-rule__join" aria-hidden="true">
              {numbers.join}
            </span>
          ) : null}
          <span className="kit-rule__big">{big}</span>
          <span className="kit-rule__what">
            {i > 0 && numbers.join ? (
              <span className="sr-only">{numbers.join} </span>
            ) : null}
            {what}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What Elder weighs, heaviest first, as bars. */
function Weights({ weights }) {
  return (
    <ul className="kit-rule__weights">
      {weights.map((w) => {
        const share = Math.round(w.share * 100);
        return (
          <li key={w.key}>
            <span className="kit-rule__weight">
              <span>{w.label}</span>
              <b>{share}%</b>
            </span>
            <svg
              className="kit-rule__bar"
              viewBox="0 0 100 8"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <rect width="100" height="8" className="fill-ground-sunken" />
              <rect width={share} height="8" className="fill-accent" />
            </svg>
          </li>
        );
      })}
    </ul>
  );
}

/** The sections in reading order, any the order does not know kept last. */
export function ordered(how) {
  const rank = (s) => {
    const i = ORDER.indexOf(s.key);
    return i === -1 ? ORDER.length : i;
  };
  return [...(how ?? [])].sort((a, b) => rank(a) - rank(b));
}

/** One rule: its title, its numbers, its sentences. */
function Rule({ section, values, weights, mark, sees }) {
  const numbers = numbersFor(section.key, values);
  const who = sees ? seesFor(section.key, values) : null;
  const id = ruleId(section.key);
  return (
    <article
      id={id}
      className={`kit-rule kit-rule--${section.key}`}
      aria-labelledby={`${id}-title`}
      data-mark={mark ? "true" : undefined}
    >
      <h3 id={`${id}-title`} className="kit-rule__title">
        {ruleTitle(section)}
        {mark ? <span className="kit-rule__mark">{mark}</span> : null}
      </h3>
      {numbers ? <Numbers numbers={numbers} /> : null}
      {section.key === "elder" && weights?.length ? (
        <Weights weights={weights} />
      ) : null}
      <div className="kit-rule__lines">
        {section.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      {who ? <p className="kit-rule__sees">{who}</p> : null}
    </article>
  );
}

/** Every rule of a policy, one card each; `sees` adds who sees what
 *  about you under each (Policy, which has the saved values). */
export function HouseRules({
  how,
  values = null,
  weights = null,
  mark = {},
  sees = false,
}) {
  return (
    <div className="kit-rules">
      {ordered(how).map((section) => (
        <Rule
          key={section.key}
          section={section}
          values={values}
          weights={weights}
          mark={mark[section.key]}
          sees={sees}
        />
      ))}
    </div>
  );
}
