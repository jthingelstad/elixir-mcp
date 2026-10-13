/**
 * A person's own view of their clan, shaped once for both places that
 * show it: Clan's "You here" page and the person's own connection
 * (`clans_my_view`, #535, docs/notes/2026-10-13-w3-my-clan-view.md).
 * Exactly the three things Jamie named (2026-10-12): the policy summary,
 * their own standing line, and the Actions waiting for them. Never
 * another member's line or clock, and never a removal Action. Pure.
 */

import { canAct, actionLabel } from "./actions.mjs";
import { declaredGoals } from "./goals.mjs";
import {
  MIN_MEMBERS,
  RETIRED_FIELDS,
  countedCategories,
  defaults,
  ranksElder,
} from "./policy.mjs";
import {
  nextSteps,
  participationPhrase,
  standingForMembers,
} from "./render.mjs";

/** A saved version's values as they run today: a field added since the
 *  version was saved takes its starting value; a field retired since is
 *  dropped. */
export function effectivePolicyValues(saved) {
  return Object.fromEntries(
    Object.entries({ ...defaults(), ...(saved ?? {}) }).filter(
      ([k]) => !RETIRED_FIELDS.includes(k),
    ),
  );
}

/** What the chrome needs to know about the clan's policy: whether one is
 *  set and active, and the switches that decide which pages exist. Active:
 *  saved, and the clan not known to be below the minimum. */
export function policySummaryOf({ set, version, values, members }) {
  const active = set && !(members !== null && members < MIN_MEMBERS);
  return {
    set,
    active,
    version,
    members,
    min_members: MIN_MEMBERS,
    ranks_elder: active && ranksElder(values),
    removal: active && values.removal_enabled,
    away: active && values.removal_enabled && values.away_max_days > 0,
    members_see_standing: active && values.members_see_standing === true,
  };
}

/**
 * The person's own standing line under the clan's policy, from a verdict
 * set (a live evaluation, or the saved snapshot). `null` when the set
 * holds no verdict for them. The engine's `recommended` removal state is
 * shown as `at_risk`, as Clan's own page shows it: a removal is a
 * leaders' Action and nobody below co-leader sees one.
 */
export function ownStandingLine({ verdicts, playerTag, values, version }) {
  const mine = verdicts?.members?.find((m) => m.player_tag === playerTag);
  if (!mine) return null;
  const ranked = ranksElder(values);
  const rows = ranked ? standingForMembers(verdicts, values) : [];
  const minimums = mine.facts.minimums;
  return {
    version,
    goals: declaredGoals(values),
    counted: countedCategories(values),
    ranks_elder: ranked,
    status: rows.find((r) => r.player_tag === playerTag)?.status ?? null,
    evidence: participationPhrase(mine, values),
    next: nextSteps(mine, values),
    minimums: {
      set: minimums.set,
      met: minimums.met,
      passes: minimums.passes,
      unknown: minimums.unknown,
      rule: values.minimums_rule,
      window_weeks: values.minimums_window_weeks,
    },
    tenure_min_days: ranked ? values.tenure_min_days : null,
    inactivity: values.removal_enabled
      ? {
          state:
            mine.removal.state === "recommended"
              ? "at_risk"
              : mine.removal.state,
          days_idle: mine.facts.days_idle,
          at_risk_days: values.at_risk_days,
          judgment: mine.judgment.removal,
          activity_evidence: mine.facts.activity_evidence,
        }
      : null,
  };
}

/**
 * The open Actions this person may take, as the lines Clan's list shows,
 * newest first: never a removal (for anyone, a leader who would decide it
 * included), never the evidence, the log or the words. `number` is null
 * for an Action Clan has not numbered yet; reading never numbers one.
 */
export function actionsWaitingFor(cards, who) {
  return (cards ?? [])
    .filter(
      (c) => c.status === "proposed" && c.type !== "removal" && canAct(c, who),
    )
    .sort((a, b) =>
      a.raised_at < b.raised_at ? 1 : a.raised_at > b.raised_at ? -1 : 0,
    )
    .map((c) => ({
      number: Number.isInteger(c.number) ? c.number : null,
      type: c.type,
      label: actionLabel(c),
      subject_name: c.player_name ?? null,
      raised_at: c.raised_at ?? null,
    }));
}
