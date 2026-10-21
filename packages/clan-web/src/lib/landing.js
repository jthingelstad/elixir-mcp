/**
 * Where arriving at a clan lands. Jamie, 2026-10-20, asked whether
 * leaders should land on Actions instead of Roster: "If there are
 * actions to take, yes. Otherwise no." A leader or co-leader with Actions
 * waiting for them lands on Actions; everyone else, and a leader with
 * none waiting, on the roster.
 *
 * Only an arrival with no section is a landing: `/clan`, `/clan/<TAG>`,
 * picking a clan, coming back from sign-in or the notice after it. An
 * address that names a section (`/clan/<TAG>/roster`, a member, an
 * action) always opens that section, and so does a roster search
 * (`/clan/<TAG>?find=`), which names the roster.
 */
import { useEffect, useState } from "react";
import { appPath, clanPath, tagOf } from "./base.js";
import { waitingFor } from "./rail.js";

const LEADERS = new Set(["leader", "coLeader"]);

/** Whether a clan entry (`me.selected` or one of `me.clans`) is led by
 *  the person: leader or co-leader, as verified. An unverified player
 *  is a member here, so its in-game role does not count. */
const leads = (clan) =>
  Boolean(clan) && clan.verified !== false && LEADERS.has(clan.role);

/** Whether the person lands on Actions in their selected clan: they lead
 *  it and Actions wait for them, as the rail counts them. */
export function landsOnActions(me) {
  const clan = me?.ok ? me.selected : null;
  return leads(clan) && waitingFor(me) > 0;
}

/** The address a landing goes to for a clan: its Actions, or its own
 *  address, where the roster is. `open_actions` is the selected clan's,
 *  so another clan's landing is its own address, which decides once
 *  that clan is selected. */
export function landingPath(me, clanTag = me?.selected?.clan_tag) {
  const base = clanPath(clanTag);
  return me?.selected?.clan_tag === clanTag && landsOnActions(me)
    ? `${base}/actions`
    : base;
}

/** The tag of a clan's own address with no section (`/clan/<TAG>`), or
 *  null for any other path. */
export function landingTag(path) {
  const m = /^\/([^/]+)\/?$/.exec(appPath(path) ?? "");
  return m ? tagOf(m[1]) : null;
}

/**
 * What a clan's own address shows: null when the path is not a landing
 * (a section, not one of the person's clans), else "actions" (go
 * there), "roster", or "wait" while the clan is being selected for a
 * person who leads it, so the roster never shows before Actions. Anyone
 * who does not lead the clan sees the roster at once, and a roster
 * search (`search`) is the roster.
 */
export function landingAt(me, path, { search = false } = {}) {
  const tag = landingTag(path);
  if (!tag || !me?.ok) return null;
  const clan = (me.clans ?? []).find((c) => c.clan_tag === tag);
  if (!clan) return null;
  if (search) return "roster";
  if (me.selected?.clan_tag === tag)
    return landsOnActions(me) ? "actions" : "roster";
  return leads(clan) ? "wait" : "roster";
}

/**
 * `landingAt`, decided once per arrival: when the session is re-read
 * later (a refresh, a decision elsewhere) or a roster search is cleared,
 * a person already reading the roster stays on it rather than being
 * moved to Actions.
 */
export function useLanding(me, path, options) {
  const now = landingAt(me, path, options);
  const [held, setHeld] = useState(null);
  const kept = held?.path === path ? held.choice : null;
  const settled = now === "actions" || now === "roster" ? now : null;
  useEffect(() => {
    if (!kept && settled) setHeld({ path, choice: settled });
  }, [kept, settled, path]);
  return now === null ? null : (kept ?? now);
}
