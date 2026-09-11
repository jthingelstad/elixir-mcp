/**
 * The push lane's write side.
 *
 * WHAT THIS FEED IS (Jamie, 2026-09-08): a nod, not a report. "A thing
 * happened over here and you may want to look." A payload answers "is this
 * worth a look?" and nothing more — the reader drills with the data tools,
 * which are cheap and always current. Putting the analysis in the event is
 * how a notification lane turns into a second, staler copy of the API.
 *
 * That principle decides two things that used to be ad hoc:
 *
 *   1. COALESCING IS THE DEFAULT for anything that can arrive in bulk. Three
 *      badges on one tag are one nod carrying count=3, not three rows. Only
 *      roster changes stay discrete: a clan sees a handful a day and WHO
 *      joined is the entire signal, so folding them to "3 roster changes"
 *      forces exactly the lookup the nod exists to save.
 *
 *   2. THE TOPIC NAME CARRIES *WHAT*, the count carries *HOW MUCH*, and the
 *      reader drills for *WHICH*. This is why badge tiers are split at the
 *      emitter into two topics rather than one topic with a tier field —
 *      elixir-bot's lesson (engine/event_contracts.py): a reader that
 *      hardcodes one name silently drops the other half forever.
 *
 * Subscriptions are implicit — an account's claims, its clans, and its
 * feedback ARE its subscriptions — so emitters fan out at write time.
 * Failures never break the action being recorded (same stance as the
 * activity log).
 */

/**
 * Who a topic is for, and how it travels.
 *
 * `stream` picks the subscriber query. `audience` is BY PRINCIPAL KIND, which
 * is the whole point of this table: an agent's "me" is the clan it runs, a
 * person's is the players they added, and an integration has no "me" at all.
 * Nothing read account.kind before this.
 *
 * `coalesce: true` folds unread rows per (account, topic, subject_tag) and
 * sums `count`. `payload` is the floor — the keys a reader may rely on.
 */
export const TOPIC_CONTRACTS = {
  // --- player stream: reaches claimants, and agents via clan membership ---
  battles_recorded: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  badge_earned: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  // Split at the emitter, never behind a tier field on badge_earned.
  legendary_badge_earned: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  arena_changed: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  best_trophies_peak: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  career_wins_milestone: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  collection_level_milestone: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  // The collection (0076): a card the player did not have, and a level
  // that went up. Counts ticking toward the next level are recorded, not
  // announced. Split at the emitter like the badge tiers.
  card_unlocked: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  card_leveled: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },
  pol_promotion: {
    stream: "player",
    audience: { person: true, agent: true },
    coalesce: true,
    payload: ["count"],
  },

  // --- clan stream: reaches accounts that added the clan ---
  // Discrete on purpose. WHO is the signal.
  member_joined: {
    stream: "clan",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: ["player_tag", "name"],
  },
  /**
   * Raw departure, and deliberately not split into a "verified" variant.
   *
   * elixir-bot holds a public farewell until a leader confirms the leave was
   * organic, because narrating a goodbye to somebody who was kicked is the
   * worst thing that feed can do. It can do that because it HAS a leader
   * action surface. We do not, and the CR API does not distinguish a leave
   * from a kick, so a verified variant here would be a guess wearing a
   * confident name. Jamie's call: emit the fact, let the receiving agent make
   * the call. `role` is the departing role because it is free here and is the
   * one thing a reader cannot reconstruct after the membership closes.
   */
  member_left: {
    stream: "clan",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: ["player_tag", "name", "role"],
  },
  member_role_changed: {
    stream: "clan",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: ["player_tag", "name", "prev_role", "new_role", "direction"],
  },
  war_day_open: {
    stream: "clan",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },
  clan_war_week_finished: {
    stream: "clan",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },
  clan_pulse: {
    stream: "clan",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },

  // --- account stream: addressed directly, never fanned out ---
  feedback_responded: {
    stream: "account",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },
  recording_started: {
    stream: "account",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },
  recording_stopped: {
    stream: "account",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },
  /**
   * Your ACCOUNT TIER changed (member -> leader -> ...), not a clan
   * promotion. It was called `role_changed`, one word from
   * `member_role_changed`, which means the opposite thing — and elixir-bot
   * uses `role_changed` for the CLAN one, so logic ported between the two
   * projects landed backwards. `role_changed` is still emitted alongside
   * this during the deprecation window.
   */
  account_tier_changed: {
    stream: "account",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
  },
  role_changed: {
    stream: "account",
    audience: { person: true, agent: true },
    coalesce: false,
    payload: [],
    deprecated: "account_tier_changed",
  },
};

export const FEED_TOPICS = Object.keys(TOPIC_CONTRACTS);

/**
 * Subscriber sets, per stream. $1 is the subject tag.
 *
 * The player set is the part that is new. A claim is one route; the other is
 * clan membership, which is how an agent hears about the players in the clan
 * it runs WITHOUT holding 50 claims of its own. Restricted to agents on
 * purpose: a person who adds a clan is watching the clan, and does not want
 * every member's badge shelf in their feed — they add players for that.
 */
const SUBSCRIBERS = {
  player: `
    select c.account_id from claim c
      join account a on a.account_id = c.account_id
     where c.player_tag = $1 and c.notify and a.kind = any($2)
    union
    select ac.account_id from account_clan ac
      join account a on a.account_id = ac.account_id
      join clan_membership m on m.clan_tag = ac.clan_tag
     where m.player_tag = $1 and m.left_observed_at is null
       and ac.notify and a.kind = 'agent' and a.kind = any($2)`,
  clan: `
    select ac.account_id from account_clan ac
      join account a on a.account_id = ac.account_id
     where ac.clan_tag = $1 and ac.notify and a.kind = any($2)`,
};

const kindsFor = (topic) =>
  Object.entries(TOPIC_CONTRACTS[topic].audience)
    .filter(([, on]) => on === true)
    .map(([kind]) => kind);

/** Emit one event to one account. The account stream: no fanout to do. */
export async function emitFeedEvent(db, accountId, topic, subjectTag, payload) {
  await db
    .query(
      `insert into event_feed (account_id, topic, subject_tag, payload)
       values ($1, $2, $3, $4)`,
      [accountId, topic, subjectTag, payload ? JSON.stringify(payload) : null],
    )
    .catch(() => {});
}

/**
 * Fan one subject event out to every account the contract says should hear it.
 *
 * Coalescing folds any UNREAD row for the same (account, topic, subject_tag)
 * into the new one, summing `count` and taking a fresh event_id at the cursor
 * tail. Rows already read are never touched, so an account sees at most one
 * unread row per topic per tag with a running total. Call this AFTER the
 * ingest transaction commits: an error inside a txn aborts the whole txn, so
 * the swallow-catch is only safe outside one.
 */
export async function emitToSubjectWatchers(
  db,
  topic,
  subjectTag,
  { count = 1, payload = null } = {},
) {
  const contract = TOPIC_CONTRACTS[topic];
  if (!contract) throw new Error(`unknown feed topic: ${topic}`);
  const subs = SUBSCRIBERS[contract.stream];
  if (!subs) throw new Error(`topic ${topic} is not a fan-out stream`);
  const kinds = kindsFor(topic);

  if (!contract.coalesce) {
    await db
      .query(
        `insert into event_feed (account_id, topic, subject_tag, payload)
         select s.account_id, $3, $1, $4 from (${subs}) s`,
        [subjectTag, kinds, topic, payload ? JSON.stringify(payload) : null],
      )
      .catch(() => {});
    return;
  }

  await db
    .query(
      `with subs as (${subs}),
       folded as (
         delete from event_feed ef
         using account a
         where a.account_id = ef.account_id
           and ef.account_id in (select account_id from subs)
           and ef.topic = $3
           and ef.subject_tag = $1
           and ef.event_id > a.events_seen_through
         returning ef.account_id,
                   coalesce((ef.payload->>'count')::int, 0) as prior
       ),
       folded_sum as (
         select account_id, sum(prior)::int as prior
         from folded group by account_id
       )
       insert into event_feed (account_id, topic, subject_tag, payload)
       select s.account_id, $3, $1,
              jsonb_build_object('count', $4::int + coalesce(f.prior, 0))
       from subs s
       left join folded_sum f on f.account_id = s.account_id`,
      [subjectTag, kinds, topic, count],
    )
    .catch(() => {});
}

/**
 * Account tier changed. Emits BOTH names for the deprecation window: readers
 * pinned to the old `role_changed` keep working, new readers get the name that
 * does not collide with `member_role_changed`. Drop the old emit — and the
 * contract entry — once no connected agent is polling for it.
 */
export async function emitAccountTierChanged(db, accountId, payload) {
  await emitFeedEvent(db, accountId, "account_tier_changed", null, payload);
  await emitFeedEvent(db, accountId, "role_changed", null, payload);
}
