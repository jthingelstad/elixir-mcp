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

const VALIDATORS = {
  player: admitPlayer,
  player_battlelog: admitBattlelog,
  clan: admitClan,
  currentriverrace: admitRiverrace,
  riverracelog: admitRiverraceLog,
  cards: admitCards,
};

/**
 * @returns {{ok: true} | {ok: false, errors: string[]}}
 */
export function admit(endpoint, payload) {
  const validator = VALIDATORS[endpoint];
  if (!validator)
    return { ok: false, errors: [`endpoint:unknown:${endpoint}`] };
  const errors = [];
  validator(payload, errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export const ADMITTED_ENDPOINTS = Object.keys(VALIDATORS);
