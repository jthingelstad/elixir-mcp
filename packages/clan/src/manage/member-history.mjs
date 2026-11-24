/**
 * One member's history in one clan, for the leaders' member page (Run ›
 * Members › a member, 2026-11-23). Every entry is something the record or
 * the clan's ledger holds; nothing is inferred, and a source that cannot
 * say leaves a named gap rather than a guess.
 *
 * Sources, each read once by the service and passed in:
 * - participation (clans_participation, 8 weeks): the current or latest
 *   stint's join, the first recorded join, role changes inside the window,
 *   each race week's war decks, and a leave for a former member;
 * - the roster's recent events (clans_roster, the newest 20 clan-wide):
 *   joins, leaves and role changes for this member, older ones included;
 * - the ledger: the member's actions and how each was decided, the
 *   exception now in force, notes (both tiers) and award grants.
 *
 * Entries are `{ id, kind, groups, at, ... }`, newest first. `groups` names
 * the page's filters an entry shows under (role, actions, war, awards,
 * notes); the words are the page's.
 */

import { actionLabel } from "@elixir-mcp/clan-engine";

const DAY_MS = 86400_000;
/** A role change and the Done that asked for it are one entry when the
 *  change is seen within this long after the Done. */
const DONE_TO_ROLE_MS = 3 * DAY_MS;
/** Two observations of one membership event this close are the same one. */
const SAME_EVENT_MS = 60 * 60_000;

const ms = (iso) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? null : t;
};

const ROLE_RANK = { member: 0, elder: 1, coLeader: 2, leader: 3 };

/** The member's row in a participation read: current first, then former. */
export function participationRow(part, playerTag) {
  const current = (part?.members ?? []).find((m) => m.player_tag === playerTag);
  if (current) return { row: current, current: true };
  const former = (part?.former_members ?? []).find(
    (m) => m.player_tag === playerTag,
  );
  return former ? { row: former, current: false } : null;
}

/**
 * The page's header for this member: who they are and how long they have
 * been in the clan, from participation, else the roster, else the names
 * the ledger knows. Null when none of them knows the tag.
 */
export function memberHeader({ part, roster, playerTag, knownName, now }) {
  const found = participationRow(part, playerTag);
  const onRoster = (roster?.members ?? []).find(
    (m) => m.player_tag === playerTag,
  );
  if (!found && !onRoster && !knownName) return null;
  const row = found?.row ?? null;
  const joined = row?.joined_observed_at ?? null;
  const firstRoster = ms(part?.first_roster_observed_at);
  const tenureKnown = found?.current
    ? Boolean(row.tenure_known)
    : Boolean(joined && firstRoster !== null && ms(joined) > firstRoster);
  const inClan = found ? found.current : Boolean(onRoster);
  return {
    player_tag: playerTag,
    name: row?.name ?? onRoster?.name ?? knownName ?? null,
    role: inClan
      ? (row?.role ?? onRoster?.role ?? null)
      : (row?.role_at_departure ?? null),
    in_clan: inClan,
    joined_observed_at: joined,
    first_joined_at: row?.first_joined_at ?? joined,
    left_observed_at: found && !found.current ? row.left_observed_at : null,
    tenure_known: tenureKnown,
    days_in_clan:
      inClan && joined
        ? Math.max(0, Math.floor((now - ms(joined)) / DAY_MS))
        : null,
    last_battle_time: row?.last_battle_time ?? null,
  };
}

/** Everything the member page's history shows, newest first. */
export function buildMemberHistory({
  playerTag,
  part,
  roster,
  cards = [],
  exceptions = [],
  notes = [],
  grants = [],
  now,
}) {
  const entries = [];
  const add = (e) => {
    if (ms(e.at) === null) return;
    entries.push(e);
  };
  const found = participationRow(part, playerTag);
  const row = found?.row ?? null;
  const firstRoster = ms(part?.first_roster_observed_at);
  const knownSince = part?.first_roster_observed_at ?? null;

  // ---- membership -------------------------------------------------------
  const joins = []; // [ms] already told, to fold the roster's copy in
  const leaves = [];
  if (row) {
    const first = ms(row.first_joined_at ?? row.joined_observed_at);
    const current = ms(row.joined_observed_at);
    if (first !== null) {
      if (firstRoster !== null && first <= firstRoster)
        add({
          id: "known-since",
          kind: "known_since",
          groups: ["role"],
          at: knownSince,
        });
      else {
        add({
          id: `joined-${first}`,
          kind: "joined",
          groups: ["role"],
          at: new Date(first).toISOString(),
          again: false,
        });
        joins.push(first);
      }
    }
    if (current !== null && first !== null && current > first) {
      add({
        id: `joined-${current}`,
        kind: "joined",
        groups: ["role"],
        at: new Date(current).toISOString(),
        again: true,
      });
      joins.push(current);
    }
    if (!found.current && ms(row.left_observed_at) !== null) {
      add({
        id: `left-${ms(row.left_observed_at)}`,
        kind: "left",
        groups: ["role"],
        at: row.left_observed_at,
        role: row.role_at_departure ?? null,
      });
      leaves.push(ms(row.left_observed_at));
    }
  }

  // ---- role changes -----------------------------------------------------
  const roleChanges = [];
  for (const c of row?.role_changes ?? [])
    if (ms(c.observed_at) !== null)
      roleChanges.push({
        at: c.observed_at,
        role_before: c.role_before ?? null,
        role_after: c.role_after ?? null,
      });

  // The roster's newest events reach further back than the window.
  for (const e of roster?.recent_events ?? []) {
    if (e?.detail?.player_tag !== playerTag) continue;
    const t = ms(e.at);
    if (t === null) continue;
    const near = (list) => list.some((x) => Math.abs(x - t) <= SAME_EVENT_MS);
    if (e.type === "member_joined" && !near(joins)) {
      if (firstRoster !== null && t <= firstRoster) continue;
      joins.push(t);
      add({
        id: `joined-${t}`,
        kind: "joined",
        groups: ["role"],
        at: e.at,
        again: false,
      });
    } else if (e.type === "member_left" && !near(leaves)) {
      leaves.push(t);
      add({
        id: `left-${t}`,
        kind: "left",
        groups: ["role"],
        at: e.at,
        role: e.detail.role_at_departure ?? null,
      });
    } else if (
      e.type === "role_changed" &&
      !roleChanges.some(
        (r) =>
          Math.abs(ms(r.at) - t) <= SAME_EVENT_MS &&
          r.role_after === (e.detail.role_after ?? null),
      )
    )
      roleChanges.push({
        at: e.at,
        role_before: e.detail.role_before ?? null,
        role_after: e.detail.role_after ?? null,
      });
  }
  // A join with no first-known day before it: the earliest join of all is
  // the first one, any later is a rejoin.
  const joinEntries = entries
    .filter((e) => e.kind === "joined")
    .sort((a, b) => ms(a.at) - ms(b.at));
  const startedKnown = entries.some((e) => e.kind === "known_since");
  joinEntries.forEach((e, i) => {
    e.again = startedKnown || i > 0;
  });

  // ---- actions ----------------------------------------------------------
  const mine = cards.filter((c) => c.player_tag === playerTag);
  const doneRoleCards = mine.filter(
    (c) =>
      c.status === "done" &&
      (c.type === "promotion" || c.type === "demotion") &&
      ms(c.decided_at) !== null,
  );
  const matched = new Set();
  for (const r of roleChanges) {
    const t = ms(r.at);
    const up =
      (ROLE_RANK[r.role_after] ?? -1) > (ROLE_RANK[r.role_before] ?? -1);
    const card = doneRoleCards.find(
      (c) =>
        !matched.has(c.card_id) &&
        (c.type === "promotion") === up &&
        t >= ms(c.decided_at) - SAME_EVENT_MS &&
        t - ms(c.decided_at) <= DONE_TO_ROLE_MS,
    );
    if (card) matched.add(card.card_id);
    add({
      id: `role-${t}-${r.role_after}`,
      kind: "role_changed",
      groups: card ? ["role", "actions"] : ["role"],
      at: r.at,
      role_before: r.role_before,
      role_after: r.role_after,
      action: card ? actionRef(card) : null,
    });
  }
  for (const c of mine) {
    // Every decline a reopening set aside, then the reopening itself.
    for (const [i, r] of (c.reopenings ?? []).entries()) {
      const d = r.decline ?? {};
      if (ms(d.decided_at) !== null)
        add({
          ...actionEntry(c, "declined", d.decided_at),
          id: `action-${c.card_id}-declined-${i}`,
          by: person(d.decided_by, d.decided_by_name),
          reason: d.decline_reason ?? null,
          note: d.decision_note ?? null,
        });
      add({
        ...actionEntry(c, "reopened", r.at),
        id: `action-${c.card_id}-reopened-${i}`,
        by: person(r.by?.tag, r.by?.name),
      });
    }
    if (c.status === "proposed") {
      add({
        ...actionEntry(c, "proposed", c.raised_at),
        id: `action-${c.card_id}-open`,
      });
      continue;
    }
    if (matched.has(c.card_id)) continue;
    if (c.status === "withdrawn")
      add({
        ...actionEntry(c, "withdrawn", c.withdrawn_at ?? c.raised_at),
        id: `action-${c.card_id}`,
        reason: c.withdraw_reason ?? null,
      });
    else if (c.status === "done" || c.status === "declined")
      add({
        ...actionEntry(c, c.status, c.decided_at ?? c.raised_at),
        id: `action-${c.card_id}`,
        by: person(c.decided_by, c.decided_by_name),
        reason: c.status === "declined" ? (c.decline_reason ?? null) : null,
        note: c.decision_note ?? null,
      });
  }

  // ---- exceptions: the one in force (an ended one leaves no record) -----
  for (const x of exceptions) {
    const setAt = x.set_at ?? null;
    add({
      id: `exception-${x.kind}-${setAt}`,
      kind: "exception",
      groups: ["actions"],
      at: setAt,
      exception: x.kind ?? "leader",
      until: x.until ?? null,
      note: x.note ?? null,
      by: person(x.by, x.by_name),
    });
    const ends = ms(x.until);
    if (ends !== null && ends <= now)
      add({
        id: `exception-${x.kind}-${setAt}-ended`,
        kind: "exception_ended",
        groups: ["actions"],
        at: new Date(ends).toISOString(),
        exception: x.kind ?? "leader",
      });
  }

  // ---- River Race weeks -------------------------------------------------
  if (row) {
    (part?.war_weeks ?? []).forEach((w, i) => {
      const decks = row.war_decks?.[i];
      if (!Number.isInteger(decks)) return;
      const finished = w.finished_observed_at ?? null;
      // A week still being fought is told as it stands now.
      const at = finished ?? part?.meta?.as_of ?? new Date(now).toISOString();
      const required =
        !w.is_colosseum && Number.isInteger(w.finish_war_day)
          ? Math.min(4, Math.max(1, w.finish_war_day))
          : 4;
      add({
        id: `war-${w.season_id}-${w.section_index}`,
        kind: "war_week",
        groups: ["war"],
        at,
        season_id: w.season_id,
        week: w.section_index + 1,
        colosseum: Boolean(w.is_colosseum),
        decks,
        decks_asked: 4 * required,
        in_progress: !finished,
      });
    });
  }

  // ---- awards -----------------------------------------------------------
  for (const g of grants.filter((g) => g.player_tag === playerTag))
    add({
      id: `award-${g.season_id}-${g.award_id}`,
      kind: "award",
      groups: ["awards"],
      at: g.granted_at,
      season_id: g.season_id,
      award_id: g.award_id,
      name: g.name ?? g.award_id,
      rank: g.rank ?? 1,
      manual: g.manual === true,
      note: g.note ?? null,
      by: g.manual ? person(g.granted_by, g.granted_by_name) : null,
    });

  // ---- notes ------------------------------------------------------------
  for (const n of notes.filter((n) => n.player_tag === playerTag))
    add({
      id: `note-${n.note_id}`,
      kind: "note",
      groups: ["notes"],
      at: n.created_at,
      note_id: n.note_id,
      tier: n.tier,
      text: n.text,
      by: person(n.author_tag, n.author_name),
    });

  return entries.sort((a, b) => ms(b.at) - ms(a.at) || (a.id < b.id ? -1 : 1));
}

function person(tag, name) {
  return tag || name ? { player_tag: tag ?? null, name: name ?? null } : null;
}

function actionRef(card) {
  return {
    card_id: card.card_id,
    number: Number.isInteger(card.number) ? card.number : null,
    type: card.type,
    by: person(card.decided_by, card.decided_by_name),
    headline: card.evidence?.rationale?.headline ?? null,
  };
}

function actionEntry(card, status, at) {
  return {
    kind: "action",
    groups: ["actions"],
    at,
    status,
    card_id: card.card_id,
    number: Number.isInteger(card.number) ? card.number : null,
    type: card.type,
    label: actionLabel(card),
    headline: card.evidence?.rationale?.headline ?? null,
    by: null,
    reason: null,
    note: null,
  };
}

/** What this history cannot hold, as stable keys the page words. */
export function historyGaps({ part, roster }) {
  const gaps = ["ended_exceptions"];
  if (!part) gaps.push("participation_unavailable");
  else gaps.push("war_window");
  if (!roster) gaps.push("roster_unavailable");
  return gaps;
}
