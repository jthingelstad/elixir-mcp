/**
 * What a clan's policy can do today: each judgment it asks for, as live,
 * needing more evidence (and what), not enforceable, or off. The Policy
 * page shows it in one box, so a setting never reads as a promise the
 * record cannot keep (#426). Pure: the saved values, the clan's size and
 * the latest evaluation's review instants in; lines out.
 */

import { MIN_MEMBERS, ranksElder } from "./policy.mjs";
import { REMOVAL_ENFORCEABLE, REMOVAL_NOT_ENFORCEABLE } from "./inactivity.mjs";

export const CAPABILITY_STATUS = {
  live: "Live",
  needs_evidence: "Needs more evidence",
  not_enforceable: "Not enforceable",
  off: "Off",
};

/**
 * @param {object} values  the saved policy's values
 * @param {{ set?: boolean, members?: number|null, boundaries?: string[]|null }} at
 *   `members` the clan's last known size (null when unknown); `boundaries`
 *   the weekly review instants of the latest evaluation (null when none)
 */
export function policyCapabilities(
  values,
  { set = true, members = null, boundaries = null } = {},
) {
  const small = members !== null && members < MIN_MEMBERS;
  const needs = (what) => ({ status: "needs_evidence", detail: what });
  const tooFew = needs(
    `Needs ${MIN_MEMBERS} members; the clan has ${members}. Reviews and Actions wait until then.`,
  );
  const line = (key, label, verdict) => ({
    key,
    label,
    ...verdict,
    status_label: CAPABILITY_STATUS[verdict.status],
  });
  const live = (detail) => ({ status: "live", detail });
  const off = (detail) => ({ status: "off", detail });
  const gated = (verdict) =>
    !set
      ? needs("Nothing runs until a leader saves the policy.")
      : small && verdict.status === "live"
        ? tooFew
        : verdict;

  const elder = !ranksElder(values)
    ? off("Leaders choose Elders by hand.")
    : boundaries && boundaries.length === 0
      ? needs(
          "Needs one finished review week in the record before anyone is judged.",
        )
      : live(
          "Promotion and demotion Actions come from sustained weekly reviews of what the clan counts.",
        );
  const removal = !values.removal_enabled
    ? off("Removal suggestions are off.")
    : REMOVAL_ENFORCEABLE
      ? live("Removal Actions follow the inactivity clock.")
      : {
          status: "not_enforceable",
          detail: `${REMOVAL_NOT_ENFORCEABLE} Leaders see the clock on the board as inactivity triage; no removal Action is raised.`,
        };
  const away =
    !values.removal_enabled || !values.away_suggestions_enabled
      ? off("Quiet members are not asked.")
      : live(
          "A member whose measured profile-counter window reaches at risk is asked; a member without two comparable profile observations is not.",
        );
  const departures = values.departures_enabled
    ? live(
        "When a member leaves and no Action explains it, leaders are asked: kicked, left or ignore.",
      )
    : off("Departures are not asked about.");
  const welcome = values.welcome_enabled
    ? live("Elders and leaders get an Action to welcome each newcomer.")
    : off("Newcomers are not welcomed by an Action.");

  return [
    line("elder", "Promote and demote Elders", gated(elder)),
    line("removal", "Remove inactive members", gated(removal)),
    line("away", "Ask quiet members if they are away", gated(away)),
    line("departures", "Ask how a member left", gated(departures)),
    line("welcome", "Welcome newcomers", gated(welcome)),
  ];
}
