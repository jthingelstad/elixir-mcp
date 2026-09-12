import { randomInt } from "node:crypto";
import { json } from "../http.mjs";
import { checkRateLimit } from "@elixir-mcp/auth";
import { normalizeTag } from "@elixir-mcp/contracts";
import { makeLive } from "../../../mcp/src/live.mjs";
import { enqueueJob } from "../../../scheduler/src/ledger.mjs";

/**
 * Verify (0080, battles since 0081): prove that the signed-in account
 * controls a player by having them PLAY ONE BATTLE with a target deck.
 * The battle log records the deck each participant played and is fresh
 * within a minute of a match; the profile's currentDeck, the first
 * design, did not move for over an hour after an in-game slot change
 * (measured 2026-09-12). Three routes: the list, start (idempotent while
 * open), and the poll the wizard reads every ~15 s.
 *
 * Reads go through the live lane like `live: true` on battles_query, but
 * with NO quota hook: a person proving who they are may hold no tier.
 * The challenge row carries the job it asked for, and api_receipt.job_id
 * (0041) says a fetch was a verification read. The browser never causes
 * a fetch directly: the poll route mints at most one live read every
 * LIVE_READ_EVERY_S while the challenge is open and being watched.
 */
export const DECK_SIZE = 8;
const CHALLENGE_MINUTES = 60;
/** A restart after a challenge that never matched hands back the SAME
 *  eight cards for this long, so a slow player does not rebuild a deck. */
const REUSE_TARGET_HOURS = 24;
const LIVE_READ_EVERY_S = 45;
const POLL_EVERY_S = 15;
/** Challenge starts per hour, per account and per tag: the wizard must
 *  not become a way to make the fleet read a stranger every 15 s. */
export const STARTS_PER_HOUR = 5;

const TARGET_SQL = `select c.card_id, c.name, c.icon_urls->>'medium' as icon
                    from card c where c.card_id = any($1::int[])`;

function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function cardsById(db, ids) {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query(TARGET_SQL, [ids]);
  return new Map(
    rows.map((r) => [
      r.card_id,
      { id: r.card_id, name: r.name, icon: r.icon ?? null },
    ]),
  );
}

async function claimFor(db, accountId, tag) {
  const { rows } = await db.query(
    `select c.player_tag, c.status, c.verified_at, c.verified_method, c.is_primary,
            c.relationship, p.name
       from claim c join player p on p.player_tag = c.player_tag
      where c.account_id = $1 and c.player_tag = $2`,
    [accountId, tag],
  );
  return rows[0] ?? null;
}

async function expireStale(db, accountId, tag) {
  await db.query(
    `update claim_challenge set outcome = 'expired', completed_at = now()
      where account_id = $1 and player_tag = $2 and outcome = 'open'
        and expires_at <= now()`,
    [accountId, tag],
  );
}

/** The battles this player has played since the brief, newest first,
 *  each with the ids of the deck they used. Duels (rounds) carry no
 *  single deck and never match. */
async function battlesSince(db, tag, since, limit = 10) {
  const { rows } = await db.query(
    `select bp.battle_id, bp.battle_time, bp.deck, bp.outcome, bp.crowns, bp.side,
            b.type, b.game_mode_name,
            (select json_build_object('player_tag', o.player_tag, 'name', p.name, 'crowns', o.crowns)
               from battle_participant o join player p on p.player_tag = o.player_tag
              where o.battle_id = bp.battle_id and o.side <> bp.side
              order by o.player_tag limit 1) as opponent
       from battle_participant bp join battle b on b.battle_id = bp.battle_id
      where bp.player_tag = $1 and bp.battle_time >= $2::timestamptz
      order by bp.battle_time desc limit $3`,
    [tag, since, limit],
  );
  return rows.map((r) => ({
    ...r,
    ids: Array.isArray(r.deck?.cards)
      ? r.deck.cards.map((c) => Number(c.id)).filter(Number.isInteger)
      : [],
  }));
}

/** When the battle log was last read for this player. */
async function battlelogReadAt(db, tag) {
  const { rows } = await db.query(
    `select r.fetched_at from api_receipt r
      where r.entity_key = $1 and r.endpoint = 'player_battlelog' and r.admission = 'admitted'
      order by r.fetched_at desc limit 1`,
    [tag],
  );
  return rows[0]?.fetched_at ?? null;
}

/** What the wizard sees: the target with art, the latest battle since
 *  the brief with its deck marked card by card and its result, how many
 *  battles have been seen since, and the outcome. */
async function present(db, row, { livePending = false, battle = null } = {}) {
  const targetIds = row.target_card_ids.map(Number);
  const targetSet = new Set(targetIds);
  const since = await battlesSince(db, row.player_tag, row.created_at);
  // The proving battle when verified, else the newest since the brief.
  const shown =
    battle ??
    (row.proof_battle_id
      ? (since.find((b) => b.battle_id === row.proof_battle_id) ?? null)
      : (since[0] ?? null));
  const shownIds = shown ? shown.ids : [];
  const shownSet = new Set(shownIds);
  const art = await cardsById(db, [...new Set([...targetIds, ...shownIds])]);
  const card = (id, matched) => ({
    ...(art.get(id) ?? { id, name: null, icon: null }),
    matched,
  });
  const readAt = await battlelogReadAt(db, row.player_tag);
  return {
    state: row.outcome,
    challenge_id: row.challenge_id,
    player_tag: row.player_tag,
    name: row.name ?? null,
    created_at: row.created_at,
    expires_at: row.expires_at,
    verified_at: row.verified_at ?? null,
    target: targetIds.map((id) => card(id, shownSet.has(id))),
    battles_since: since.length,
    last_battle: shown
      ? {
          battle_id: shown.battle_id,
          battle_time: shown.battle_time,
          type: shown.type,
          mode: shown.game_mode_name ?? null,
          outcome: shown.outcome ?? null,
          crowns: shown.crowns ?? null,
          opponent: shown.opponent ?? null,
          cards: shownIds.map((id) => card(id, targetSet.has(id))),
          proof: row.proof_battle_id === shown.battle_id,
        }
      : null,
    read_at: readAt,
    // How close the record follows the player: seconds from the proving
    // battle's time to the log read that carried it (the unlock says so).
    seen_after_s:
      shown && readAt && row.proof_battle_id === shown.battle_id
        ? Math.max(
            0,
            Math.round(
              (new Date(readAt).getTime() -
                new Date(shown.battle_time).getTime()) /
                1000,
            ),
          )
        : null,
    matched: targetIds.filter((id) => shownSet.has(id)).length,
    of: DECK_SIZE,
    live_pending: livePending,
    retry_after_s: POLL_EVERY_S,
  };
}

/** Only a claim that says "this is me" can be proven: the primary or an
 *  alt (Jamie, 2026-09-12). A friend or a watched player is somebody
 *  else's to verify. */
function eligibleClaim(claim) {
  return claim.is_primary === true || claim.relationship === "alt";
}

/** The eight target ids are all in the deck the player has selected. */
export function deckMatches(targetIds, seenIds) {
  const target = new Set(targetIds.map(Number));
  const seen = new Set(seenIds.map(Number));
  if (target.size !== DECK_SIZE || seen.size !== DECK_SIZE) return false;
  for (const id of target) if (!seen.has(id)) return false;
  return true;
}

export function verifyRoutes({ resolveAccount, logEvent, live = null }) {
  const liveRead = live ?? makeLive({ enqueue: enqueueJob });

  /** Ask for a fresh profile through the live lane, charged to nobody.
   *  Returns whether a read is pending and, when one was minted or
   *  promoted, its job id. */
  async function requestRead(db, tag) {
    const r = await liveRead(db, {
      endpoint: "player_battlelog",
      entityKey: tag,
    });
    if (r.ok) return { pending: false, jobId: null, fresh: true };
    if (r.reason === "pending") return { pending: true, jobId: r.job_id };
    return { pending: false, jobId: null, fresh: false };
  }

  async function ownedPlainCards(db, tag) {
    const { rows } = await db.query(
      `select pc.card_id from player_card pc
         join card c on c.card_id = pc.card_id
        where pc.player_tag = $1 and c.kind = 'card'`,
      [tag],
    );
    return rows.map((r) => r.card_id);
  }

  return {
    "GET /api/me/verify": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      await db.query(
        `update claim_challenge set outcome = 'expired', completed_at = now()
          where account_id = $1 and outcome = 'open' and expires_at <= now()`,
        [account.accountId],
      );
      const { rows } = await db.query(
        `select c.player_tag, c.status, c.verified_at, c.is_primary, c.relationship,
                p.name,
                (select json_build_object('challenge_id', ch.challenge_id, 'expires_at', ch.expires_at)
                   from claim_challenge ch
                  where ch.account_id = c.account_id and ch.player_tag = c.player_tag
                    and ch.outcome = 'open' limit 1) as challenge
           from claim c join player p on p.player_tag = c.player_tag
          where c.account_id = $1
          order by c.is_primary desc, c.player_tag`,
        [account.accountId],
      );
      return json(200, {
        players: rows.map((r) => ({
          player_tag: r.player_tag,
          name: r.name ?? null,
          status: r.status,
          verified_at: r.verified_at ?? null,
          is_primary: r.is_primary === true,
          relationship: r.relationship,
          eligible: eligibleClaim(r),
          challenge: r.challenge ?? null,
        })),
        poll_every_s: POLL_EVERY_S,
        challenge_minutes: CHALLENGE_MINUTES,
      });
    },

    "POST /api/me/verify": async (db, event, body) => {
      const account = await resolveAccount(db, event, {
        requireContractHeader: true,
      });
      if (!account) return json(401, { error: "unauthenticated" });
      let tag;
      try {
        tag = normalizeTag(String(body?.player_tag ?? ""));
      } catch {
        return json(400, { error: "invalid_tag" });
      }
      const perAccount = await checkRateLimit(db, {
        bucket: `verify#${account.accountId}`,
        max: STARTS_PER_HOUR,
      });
      const perTag = await checkRateLimit(db, {
        bucket: `verify-tag#${tag}`,
        max: STARTS_PER_HOUR,
      });
      if (!perAccount || !perTag)
        return json(429, {
          error: "rate_limited",
          message: `At most ${STARTS_PER_HOUR} verification starts an hour.`,
        });

      // Somebody else already proved this tag: a tag has one owner.
      const { rows: elsewhere } = await db.query(
        `select 1 from claim where player_tag = $1 and status = 'verified' and account_id <> $2`,
        [tag, account.accountId],
      );
      if (elsewhere[0]) return json(409, { error: "verified_elsewhere" });

      // Adding a player is Tracking's job (Jamie, 2026-09-12): this page
      // proves claims that exist, as the primary or an alt.
      const claim = await claimFor(db, account.accountId, tag);
      if (!claim)
        return json(404, {
          error: "not_tracked",
          message: "Add the player under Tracking first, then verify it here.",
        });
      if (!eligibleClaim(claim))
        return json(403, {
          error: "not_yours",
          message: "Only your primary player or an alt can be verified.",
        });
      if (claim.status === "verified")
        return json(200, {
          state: "verified",
          player_tag: tag,
          name: claim.name ?? null,
          verified_at: claim.verified_at,
        });

      await expireStale(db, account.accountId, tag);
      const { rows: open } = await db.query(
        `select ch.*, p.name from claim_challenge ch join player p on p.player_tag = ch.player_tag
          where ch.account_id = $1 and ch.player_tag = $2 and ch.outcome = 'open'`,
        [account.accountId, tag],
      );
      if (open[0]) return json(200, await present(db, open[0]));

      // The target is drawn from the recorded collection, plain cards only
      // (tower troops are kind = 'support'). A player recorded a moment
      // ago has no collection yet: ask for a read and say so.
      const owned = await ownedPlainCards(db, tag);
      if (owned.length < DECK_SIZE) {
        // The collection lives on the profile: that one read is a profile.
        const p = await liveRead(db, { endpoint: "player", entityKey: tag });
        const read = { pending: !p.ok && p.reason === "pending" };
        return json(202, {
          state: "collecting",
          player_tag: tag,
          live_pending: read.pending,
          retry_after_s: POLL_EVERY_S,
        });
      }
      // A challenge that ran out without a match hands back the same
      // eight cards for a day: the player may already hold that deck.
      const { rows: prior } = await db.query(
        `select target_card_ids from claim_challenge
          where account_id = $1 and player_tag = $2 and outcome = 'expired'
            and created_at > now() - make_interval(hours => $3)
          order by created_at desc limit 1`,
        [account.accountId, tag, REUSE_TARGET_HOURS],
      );
      const ownedSet = new Set(owned);
      const reusable = prior[0]?.target_card_ids?.map(Number) ?? [];
      const target =
        reusable.length === DECK_SIZE &&
        reusable.every((id) => ownedSet.has(id))
          ? reusable
          : shuffle(owned).slice(0, DECK_SIZE);
      const { rows: created } = await db.query(
        `insert into claim_challenge (account_id, player_tag, target_card_ids, expires_at)
         values ($1, $2, $3::int[], now() + make_interval(mins => $4))
         returning *`,
        [account.accountId, tag, target, CHALLENGE_MINUTES],
      );
      const read = await requestRead(db, tag);
      if (read.pending)
        await db.query(
          `update claim_challenge set live_job_id = $2, live_requested_at = now(), live_reads = 1
            where challenge_id = $1`,
          [created[0].challenge_id, read.jobId],
        );
      await logEvent(db, account.accountId, "verify_started", {
        player_tag: tag,
      });
      return json(
        200,
        await present(
          db,
          { ...created[0], name: claim.name },
          { livePending: read.pending },
        ),
      );
    },

    "GET /api/me/verify/*": async (db, event) => {
      const account = await resolveAccount(db, event);
      if (!account) return json(401, { error: "unauthenticated" });
      const { rows } = await db.query(
        `select ch.*, p.name, c.verified_at
           from claim_challenge ch
           join player p on p.player_tag = ch.player_tag
           left join claim c on c.account_id = ch.account_id and c.player_tag = ch.player_tag
          where ch.account_id = $1 and ch.challenge_id::text = $2`,
        [account.accountId, String(event.pathParam ?? "")],
      );
      const row = rows[0];
      if (!row) return json(404, { error: "not_found" });
      if (row.outcome !== "open") return json(200, await present(db, row));
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await db.query(
          `update claim_challenge set outcome = 'expired', completed_at = now() where challenge_id = $1`,
          [row.challenge_id],
        );
        return json(200, await present(db, { ...row, outcome: "expired" }));
      }

      // The proof: a battle played AFTER the brief with exactly the target.
      const since = await battlesSince(db, row.player_tag, row.created_at);
      const proof = since.find((b) => deckMatches(row.target_card_ids, b.ids));
      if (proof) {
        await db.query("begin");
        try {
          await db.query(
            `update claim set status = 'verified', verified_method = 'deck_battle', verified_at = now()
              where account_id = $1 and player_tag = $2`,
            [account.accountId, row.player_tag],
          );
          await db.query(
            `update claim_challenge set outcome = 'verified', completed_at = now(), proof_battle_id = $2
              where challenge_id = $1`,
            [row.challenge_id, proof.battle_id],
          );
          await db.query("commit");
        } catch (err) {
          await db.query("rollback");
          // claim_one_verified_per_tag: somebody else proved it first.
          if (err?.code === "23505")
            return json(409, { error: "verified_elsewhere" });
          throw err;
        }
        await logEvent(db, account.accountId, "claim_verified", {
          player_tag: row.player_tag,
          method: "deck_battle",
          battle_id: proof.battle_id,
        });
        const done = await claimFor(db, account.accountId, row.player_tag);
        return json(
          200,
          await present(
            db,
            {
              ...row,
              outcome: "verified",
              proof_battle_id: proof.battle_id,
              verified_at: done?.verified_at ?? new Date().toISOString(),
            },
            { battle: proof },
          ),
        );
      }

      // Not yet: keep the record fresh, at the server's cadence, only
      // while someone is watching (this poll IS the watching).
      const lastAsk = row.live_requested_at
        ? new Date(row.live_requested_at).getTime()
        : 0;
      let livePending = false;
      if (Date.now() - lastAsk >= LIVE_READ_EVERY_S * 1000) {
        const read = await requestRead(db, row.player_tag);
        livePending = read.pending;
        await db.query(
          `update claim_challenge
              set live_requested_at = now(),
                  live_job_id = coalesce($2, live_job_id),
                  live_reads = live_reads + case when $2 is null then 0 else 1 end
            where challenge_id = $1`,
          [row.challenge_id, read.jobId],
        );
      } else {
        const { rows: openJob } = await db.query(
          `select 1 from job where endpoint = 'player_battlelog' and entity_key = $1
             and status in ('queued', 'leased') limit 1`,
          [row.player_tag],
        );
        livePending = Boolean(openJob[0]);
      }
      return json(200, await present(db, row, { livePending }));
    },
  };
}
