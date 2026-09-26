/**
 * Attested facts (JSON API 2.2.0; Jamie, 2026-09-25): the family's apps
 * tell Elixir what a person did in a clan, and what a family app's own
 * game produced for a player. Kept apart from the game record and
 * labelled; see @elixir-mcp/contracts `facts.ts` for the types and who
 * may see each.
 *
 *   POST   /api/v1/clans/{tag}/facts        a person, through a family app,
 *                                           holding clans:attest
 *   DELETE /api/v1/clans/{tag}/facts/{ref}  the same, to take one back
 *   POST   /api/v1/players/{tag}/facts      an integration with facts:write
 *
 * A clan fact is attested by the person's VERIFIED player in that clan,
 * with the role the record holds for it now; the type names the roles
 * that may attest it. The app's own id (`ref`) makes a retry the same
 * fact and a correction replace it.
 */

import {
  ATTESTED_FACT_TYPES,
  FAMILY_APP_NAMES,
  LEADER_MESSAGE_ROLES,
  OAUTH_SCOPE,
  normalizeTag,
} from "@elixir-mcp/contracts";

class FactError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
  }
}

const ROLE_RANK = { member: 0, elder: 1, coLeader: 2, leader: 3 };
/** How far an app may date a fact: an hour ahead of the clock (skew),
 *  a year behind it. */
const FUTURE_MS = 3_600_000;
const PAST_MS = 366 * 86_400_000;

function tagOf(value, field) {
  try {
    return normalizeTag(String(value ?? ""));
  } catch {
    throw new FactError(400, "invalid_tag", `${field} is not a tag.`);
  }
}

function instantOf(value, field) {
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms))
    throw new FactError(400, "invalid_fact", `${field} is not an instant.`);
  if (ms > Date.now() + FUTURE_MS || ms < Date.now() - PAST_MS)
    throw new FactError(
      400,
      "invalid_fact",
      `${field} is more than an hour ahead of now or a year behind it.`,
    );
  return new Date(ms).toISOString();
}

/** The detail a type allows, cleaned; anything else is refused. */
function checkDetail(type, input) {
  const spec = ATTESTED_FACT_TYPES[type].detail;
  const detail = input && typeof input === "object" ? input : {};
  const extra = Object.keys(detail).find((k) => !spec[k]);
  if (extra)
    throw new FactError(
      400,
      "invalid_fact",
      `${type} has no detail field '${extra}'.`,
    );
  const out = {};
  for (const [key, f] of Object.entries(spec)) {
    const v = detail[key];
    if (v === undefined) {
      if (f.optional) continue;
      throw new FactError(400, "invalid_fact", `${type} needs ${key}.`);
    }
    if (v === null) {
      if (f.nullable) {
        out[key] = null;
        continue;
      }
      throw new FactError(400, "invalid_fact", `${key} cannot be null.`);
    }
    if (f.type === "enum") {
      if (!f.values.includes(v))
        throw new FactError(
          400,
          "invalid_fact",
          `${key} is one of: ${f.values.join(", ")}.`,
        );
      out[key] = v;
    } else if (f.type === "string") {
      const s = String(v).trim();
      if (!s || s.length > f.max)
        throw new FactError(
          400,
          "invalid_fact",
          `${key} is text of 1 to ${f.max} characters.`,
        );
      out[key] = s;
    } else if (f.type === "integer") {
      if (!Number.isInteger(v) || v < f.min || v > f.max)
        throw new FactError(
          400,
          "invalid_fact",
          `${key} is a whole number from ${f.min} to ${f.max}.`,
        );
      out[key] = v;
    } else out[key] = instantOf(v, key);
  }
  return out;
}

function refOf(value) {
  const ref = String(value ?? "");
  if (!ref || ref.length > 128)
    throw new FactError(
      400,
      "invalid_fact",
      "ref is the app's own id for the fact, 1 to 128 characters.",
    );
  return ref;
}

/** The person's verified player in the clan today, with the role the
 *  record holds for it (the higher, if two of theirs are there). */
async function seatIn(db, accountId, clanTag) {
  const { rows } = await db.query(
    `select c.player_tag, cm.role
       from claim c
       join clan_membership cm
         on cm.player_tag = c.player_tag and cm.left_observed_at is null
      where c.account_id = $1 and c.status = 'verified' and cm.clan_tag = $2`,
    [accountId, clanTag],
  );
  return (
    rows.sort(
      (a, b) => (ROLE_RANK[b.role] ?? 0) - (ROLE_RANK[a.role] ?? 0),
    )[0] ?? null
  );
}

/** The family app a person's grant came through, by its redirect origin. */
async function appOf(db, account) {
  const { rows } = await db.query(
    `select redirect_uris from oauth_client where client_id = $1`,
    [account.clientId],
  );
  try {
    return new URL(rows[0]?.redirect_uris?.[0]).host;
  } catch {
    return null;
  }
}

function mayAttest(t, type, detail, seat, playerTag) {
  if (
    type === "clan_message" &&
    detail.channel === "leader_message" &&
    !LEADER_MESSAGE_ROLES.includes(seat.role)
  )
    return false;
  if (t.attesters.includes(seat.role)) return true;
  return t.attesters.includes("self") && seat.player_tag === playerTag;
}

/** The fact as the API answers it. */
function shapeFact(row) {
  return {
    id: String(row.fact_id),
    type: row.fact_type,
    ref: row.source_ref,
    subject:
      row.subject_kind === "clan"
        ? { kind: "clan", clan_tag: row.clan_tag, player_tag: row.player_tag }
        : { kind: "player", player_tag: row.player_tag },
    detail: row.detail,
    // Who sees it is the type's rule now, as the timeline reads it (9.3.0).
    visibility:
      ATTESTED_FACT_TYPES[row.fact_type]?.visibility ?? row.visibility,
    occurred_at: new Date(row.occurred_at).toISOString(),
    recorded_at: new Date(row.recorded_at).toISOString(),
    attested_by: {
      app: FAMILY_APP_NAMES[row.source] ?? row.source,
      player_tag: row.attester_tag,
      role: row.attester_role,
    },
  };
}

async function upsert(db, fact) {
  const { rows } = await db.query(
    `insert into attested_fact
       (subject_kind, clan_tag, player_tag, fact_type, detail, visibility,
        source, source_ref, attester_account_id, attester_tag, attester_role,
        occurred_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (source, source_ref) do update set
       player_tag = excluded.player_tag,
       detail = excluded.detail,
       visibility = excluded.visibility,
       attester_account_id = excluded.attester_account_id,
       attester_tag = excluded.attester_tag,
       attester_role = excluded.attester_role,
       occurred_at = excluded.occurred_at,
       recorded_at = now()
     where attested_fact.fact_type = excluded.fact_type
       and attested_fact.subject_kind = excluded.subject_kind
       and attested_fact.clan_tag is not distinct from excluded.clan_tag
       and (attested_fact.subject_kind = 'clan'
            or attested_fact.player_tag = excluded.player_tag)
     returning *, (xmax = 0) as created`,
    [
      fact.subject_kind,
      fact.clan_tag,
      fact.player_tag,
      fact.fact_type,
      JSON.stringify(fact.detail),
      fact.visibility,
      fact.source,
      fact.source_ref,
      fact.attester_account_id,
      fact.attester_tag,
      fact.attester_role,
      fact.occurred_at,
    ],
  );
  if (!rows[0])
    throw new FactError(
      409,
      "ref_conflict",
      "This ref already names a different fact (another type or subject).",
    );
  return { ...shapeFact(rows[0]), created: rows[0].created };
}

/** Who may write a clan's facts, and as whom: shared by write and remove. */
async function clanAttester(db, account, clanTag) {
  if (!account.firstParty)
    throw new FactError(
      403,
      "family_apps_only",
      "Attested facts are written only by the Elixir family's own apps.",
    );
  if (!(account.scopes ?? []).includes(OAUTH_SCOPE.CLANS_ATTEST))
    throw new FactError(
      403,
      "insufficient_scope",
      `This grant lacks the capability ${OAUTH_SCOPE.CLANS_ATTEST}.`,
    );
  const { rows } = await db.query(`select 1 from clan where clan_tag = $1`, [
    clanTag,
  ]);
  if (!rows[0]) throw new FactError(404, "not_recorded");
  const seat = await seatIn(db, account.accountId, clanTag);
  if (!seat)
    throw new FactError(
      403,
      "not_in_clan",
      "No verified player of yours is in this clan.",
    );
  const source = await appOf(db, account);
  if (!source) throw new FactError(403, "family_apps_only");
  return { seat, source };
}

export async function writeClanFact(db, account, clanInput, body) {
  const clanTag = tagOf(clanInput, "clan_tag");
  const type = String(body.type ?? "");
  const t = ATTESTED_FACT_TYPES[type];
  if (!t || t.subject !== "clan")
    throw new FactError(
      400,
      "unknown_fact_type",
      `A clan fact is one of: ${Object.keys(ATTESTED_FACT_TYPES)
        .filter((k) => ATTESTED_FACT_TYPES[k].subject === "clan")
        .join(", ")}.`,
    );
  const ref = refOf(body.ref);
  const detail = checkDetail(type, body.detail);
  const playerTag = t.member ? tagOf(body.player_tag, "player_tag") : null;
  const occurredAt =
    body.occurred_at === undefined
      ? new Date().toISOString()
      : instantOf(body.occurred_at, "occurred_at");
  const { seat, source } = await clanAttester(db, account, clanTag);
  if (!mayAttest(t, type, detail, seat, playerTag))
    throw new FactError(
      403,
      "not_permitted",
      `Your role in this clan (${seat.role}) may not attest ${type}${type === "clan_message" && detail.channel === "leader_message" ? " as a Clan Leader Message" : ""}.`,
    );
  return upsert(db, {
    subject_kind: "clan",
    clan_tag: clanTag,
    player_tag: playerTag,
    fact_type: type,
    detail,
    visibility: t.visibility,
    source,
    source_ref: ref,
    attester_account_id: account.accountId,
    attester_tag: seat.player_tag,
    attester_role: seat.role,
    occurred_at: occurredAt,
  });
}

/** Take a clan fact back (a grant revoked, a message withdrawn): the
 *  app that wrote it, by its ref, by someone who may attest that type. */
export async function removeClanFact(db, account, clanInput, refInput) {
  const clanTag = tagOf(clanInput, "clan_tag");
  const ref = refOf(refInput);
  const { seat, source } = await clanAttester(db, account, clanTag);
  const { rows } = await db.query(
    `select * from attested_fact
      where source = $1 and source_ref = $2 and clan_tag = $3`,
    [source, ref, clanTag],
  );
  const row = rows[0];
  if (!row) throw new FactError(404, "not_found");
  const t = ATTESTED_FACT_TYPES[row.fact_type];
  if (!mayAttest(t, row.fact_type, row.detail, seat, row.player_tag))
    throw new FactError(403, "not_permitted");
  await db.query(`delete from attested_fact where fact_id = $1`, [row.fact_id]);
  return { removed: true, id: String(row.fact_id), ref };
}

/** A family app's own game fact for a player, on its integration key. */
export async function writePlayerFact(db, integration, playerInput, body) {
  const playerTag = tagOf(playerInput, "player_tag");
  const type = String(body.type ?? "");
  const t = ATTESTED_FACT_TYPES[type];
  if (!t || t.subject !== "player")
    throw new FactError(
      400,
      "unknown_fact_type",
      `A player fact is one of: ${Object.keys(ATTESTED_FACT_TYPES)
        .filter((k) => ATTESTED_FACT_TYPES[k].subject === "player")
        .join(", ")}.`,
    );
  const ref = refOf(body.ref);
  const detail = checkDetail(type, body.detail);
  const occurredAt =
    body.occurred_at === undefined
      ? new Date().toISOString()
      : instantOf(body.occurred_at, "occurred_at");
  return upsert(db, {
    subject_kind: "player",
    clan_tag: null,
    player_tag: playerTag,
    fact_type: type,
    detail,
    visibility: t.visibility,
    source: integration.name,
    source_ref: ref,
    attester_account_id: integration.accountId,
    attester_tag: null,
    attester_role: null,
    occurred_at: occurredAt,
  });
}
