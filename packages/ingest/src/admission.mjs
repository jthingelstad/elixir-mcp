/**
 * Admission boundary — DESIGN §5.1 (elixir-bot's observations.py pattern).
 *
 * Raw stays byte-true; admission decides whether a decoded response may
 * mutate durable state. Identity fields and must-have keys are validated;
 * optional CR fields stay optional so additive API evolution doesn't stop
 * the recorder. Unknown endpoints are REJECTED, never silently admitted.
 * Errors are structured path strings ("memberList[3].tag:missing").
 */

import { normalizeTag } from "@elixir-mcp/contracts";

function tagOk(value) {
  if (typeof value !== "string") return false;
  try {
    normalizeTag(value);
    return true;
  } catch {
    return false;
  }
}

function admitPlayer(payload, errors) {
  if (!tagOk(payload?.tag)) errors.push("tag:invalid");
  if (typeof payload?.name !== "string") errors.push("name:missing");
  if (typeof payload?.battleCount !== "number")
    errors.push("battleCount:missing");
}

function admitBattlelog(payload, errors) {
  if (!Array.isArray(payload)) {
    errors.push(":not-an-array");
    return;
  }
  payload.forEach((battle, i) => {
    if (typeof battle?.battleTime !== "string")
      errors.push(`[${i}].battleTime:missing`);
    if (typeof battle?.type !== "string") errors.push(`[${i}].type:missing`);
    if (!Array.isArray(battle?.team) || battle.team.length === 0)
      errors.push(`[${i}].team:missing`);
    for (const [sideName, side] of [
      ["team", battle?.team],
      ["opponent", battle?.opponent],
    ]) {
      if (!Array.isArray(side)) continue;
      side.forEach((p, j) => {
        if (p?.tag !== undefined && !tagOk(p.tag))
          errors.push(`[${i}].${sideName}[${j}].tag:invalid`);
      });
    }
  });
}

function admitClan(payload, errors) {
  if (!tagOk(payload?.tag)) errors.push("tag:invalid");
  if (typeof payload?.name !== "string") errors.push("name:missing");
  if (!Array.isArray(payload?.memberList)) {
    errors.push("memberList:missing");
    return;
  }
  if (payload.members !== payload.memberList.length)
    errors.push("members:count-mismatch");
  const seen = new Set();
  payload.memberList.forEach((m, i) => {
    if (!tagOk(m?.tag)) errors.push(`memberList[${i}].tag:invalid`);
    else if (seen.has(m.tag)) errors.push(`memberList[${i}].tag:duplicate`);
    else seen.add(m.tag);
  });
}

/** A race in matchmaking is the API's state, not a bad payload. A race
 *  exists for a minute or two before its bracket is drawn: the whole body
 *  is periodIndex, sectionIndex and state "matchmaking", with no clan
 *  (recorded at the S137 season roll, 2026-10-05, cr-agent-api-docs
 *  models/river-race.md). It is neither admitted nor rejected: the
 *  receipt's admission is RACE_MATCHMAKING (0211), nothing is projected,
 *  freshness holds so the clan is read again on its cadence, and it is
 *  never charged to the collector that fetched it. Readers that want a
 *  usable race keep reading `admission = 'admitted'`; the live lane
 *  answers it as "no race yet" (tools/live.mjs). */
export const RACE_MATCHMAKING = "matchmaking";

/** SQL: an api_receipt rejection charged to its collector. A matchmaking
 *  race is not a rejection, so it is never charged. `alias` is the
 *  receipt's table alias, if the query has one. */
export function chargedRejectionSql(alias = "") {
  const c = alias ? `${alias}.` : "";
  return `(${c}admission = 'rejected')`;
}

/** The receipt's admission value for an admit() result. */
export function admissionValue(admission) {
  if (admission.ok) return "admitted";
  return admission.state === RACE_MATCHMAKING ? RACE_MATCHMAKING : "rejected";
}

function admitRiverrace(payload, errors) {
  if (!tagOk(payload?.clan?.tag)) errors.push("clan.tag:invalid");
  if (!Array.isArray(payload?.clans) || payload.clans.length === 0)
    errors.push("clans:missing");
  if (typeof payload?.periodIndex !== "number")
    errors.push("periodIndex:missing");
  if (typeof payload?.sectionIndex !== "number")
    errors.push("sectionIndex:missing");
  if (
    typeof payload?.periodIndex === "number" &&
    typeof payload?.sectionIndex === "number" &&
    Math.floor(payload.periodIndex / 7) !== payload.sectionIndex
  )
    errors.push("periodIndex:section-cross-check-failed");
}

function admitCards(payload, errors) {
  if (!Array.isArray(payload?.items) || payload.items.length === 0) {
    errors.push("items:missing");
    return;
  }
  payload.items.forEach((c, i) => {
    if (typeof c?.id !== "number") errors.push(`items[${i}].id:missing`);
    if (typeof c?.name !== "string") errors.push(`items[${i}].name:missing`);
  });
}

function admitRiverraceLog(payload, errors) {
  if (!Array.isArray(payload?.items)) {
    errors.push("items:missing");
    return;
  }
  payload.items.forEach((item, i) => {
    if (typeof item?.seasonId !== "number")
      errors.push(`items[${i}].seasonId:missing`);
    if (typeof item?.sectionIndex !== "number")
      errors.push(`items[${i}].sectionIndex:missing`);
    if (typeof item?.createdDate !== "string")
      errors.push(`items[${i}].createdDate:missing`);
    if (!Array.isArray(item?.standings) || item.standings.length === 0)
      errors.push(`items[${i}].standings:missing`);
    for (const [j, s] of (item?.standings ?? []).entries()) {
      if (!tagOk(s?.clan?.tag))
        errors.push(`items[${i}].standings[${j}].clan.tag:invalid`);
    }
  });
}

function admitListItems(payload, errors) {
  // Global tournament listings use { items: [...] }; an empty list is valid.
  if (!Array.isArray(payload?.items)) errors.push("items:missing");
}

/** /events is a BARE ARRAY of { eventTag, title, description } - the one
 *  list endpoint the API does not wrap in items (cr-agent-api-docs). */
function admitEvents(payload, errors) {
  if (!Array.isArray(payload)) errors.push("array:missing");
  else
    payload.forEach((e, i) => {
      if (typeof e?.eventTag !== "string")
        errors.push(`[${i}].eventTag:missing`);
    });
}

const VALIDATORS = {
  player: admitPlayer,
  player_battlelog: admitBattlelog,
  clan: admitClan,
  currentriverrace: admitRiverrace,
  riverracelog: admitRiverraceLog,
  cards: admitCards,
  events: admitEvents,
  globaltournaments: admitListItems,
};

/** Payload identity per endpoint - who this payload is ABOUT. Used to
 *  bind the body to the requested entity: a mis-routed collector result
 *  must never be projected under another subject's key (sol-6 F4). */
const IDENTITY = {
  player: (p) => p?.tag,
  clan: (p) => p?.tag,
  currentriverrace: (p) => p?.clan?.tag,
};

function sameTag(a, b) {
  try {
    return normalizeTag(a) === normalizeTag(b);
  } catch {
    return false;
  }
}

/** A race with state "matchmaking" and no clan: the whole body the API
 *  serves between the season roll's 404 and the drawn bracket. A body
 *  that names a clan is judged like any other race. */
function isMatchmakingRace(endpoint, payload) {
  return (
    endpoint === "currentriverrace" &&
    payload?.state === "matchmaking" &&
    payload?.clan === undefined &&
    typeof payload?.periodIndex === "number" &&
    typeof payload?.sectionIndex === "number"
  );
}

/**
 * @returns {{ok: true} | {ok: false, errors: string[]}
 *   | {ok: false, state: "matchmaking", errors: []}}
 */
export function admit(endpoint, payload, entityKey = null) {
  if (isMatchmakingRace(endpoint, payload))
    return { ok: false, state: RACE_MATCHMAKING, errors: [] };
  const validator = VALIDATORS[endpoint];
  if (!validator)
    return { ok: false, errors: [`endpoint:unknown:${endpoint}`] };
  const errors = [];
  validator(payload, errors);
  if (entityKey && errors.length === 0) {
    const found = IDENTITY[endpoint]?.(payload);
    if (found && !sameTag(found, entityKey)) {
      errors.push(`identity:mismatch:${found}`);
    }
    // A battlelog is the OBSERVER's log: every battle includes them.
    if (endpoint === "player_battlelog" && Array.isArray(payload)) {
      payload.forEach((battle, i) => {
        const team = Array.isArray(battle?.team) ? battle.team : [];
        if (team.length > 0 && !team.some((t) => sameTag(t?.tag, entityKey)))
          errors.push(`[${i}].team:observer-missing`);
      });
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
