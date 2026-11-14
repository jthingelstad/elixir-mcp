import { timedStore, timedRead } from "@elixir-mcp/clan/trace.mjs";
import { ledgerOver } from "@elixir-mcp/clan-state";
import { createModelService } from "@elixir-mcp/clan/manage/model.mjs";
import { createDrafts } from "@elixir-mcp/clan/manage/drafts.mjs";
import { createModelBridge } from "@elixir-mcp/clan/model-bridge.mjs";
import { createDiscordBridge } from "@elixir-mcp/clan/discord-bridge.mjs";
import { createDiscordService } from "@elixir-mcp/clan/manage/discord.mjs";
import { clanDiscordWake } from "@elixir-mcp/clan/discord-wake.mjs";
import { discordQuality } from "@elixir-mcp/syndication/quality";
import { createActivityService } from "@elixir-mcp/clan/manage/activity.mjs";
import { ManageError } from "@elixir-mcp/clan/manage/service.mjs";
import {
  FeedbackError,
  discordRatings,
  rateDiscordPost,
} from "@elixir-mcp/feedback";
import { senderRef } from "@elixir-mcp/outbox/notify";
import { createBox } from "@elixir-mcp/clan/sealed.mjs";
import {
  awaitFirstWord,
  clanActivityRowView,
  clanEditorPreview,
  clanActivitySeal,
  readClanActivity,
  refuseClanActivity,
  refusalOf,
  removeClanActivity,
  saveClanActivity,
  wakeAfterFact,
  CLAN_ACTIVITY_PURPOSE,
  draftStory,
} from "@elixir-mcp/syndication";
/** Clan inside the web API: the authenticated Elixir person, the request's
 * connected Postgres client, and the same recorded facts the public doors
 * read. There is no internal OAuth grant or HTTP round trip. */
import { createHandler } from "@elixir-mcp/clan/handler.mjs";
import { createMemberActivity } from "@elixir-mcp/clan/member-activity.mjs";
import { readClanFeed } from "./clan-feed.mjs";
import { readClanRace } from "./clan-race.mjs";
import { createAccountContext } from "@elixir-mcp/clan/account.mjs";
import { createRecord } from "@elixir-mcp/clan/record.mjs";
import { sharedRead } from "./shared-read.mjs";
import {
  createManageService,
  fetchParticipation,
  fetchRoster,
} from "@elixir-mcp/clan/manage/service.mjs";
import { createAwardsService } from "@elixir-mcp/clan/manage/awards.mjs";
import { createRecruitService } from "@elixir-mcp/clan/manage/recruit.mjs";
import { createScout } from "@elixir-mcp/clan/manage/scout.mjs";
import { createSocialService } from "@elixir-mcp/clan/manage/social.mjs";
import { createVoiceService } from "@elixir-mcp/clan/manage/voice.mjs";
import { diskGeo } from "@elixir-mcp/clan/geo.mjs";
import { normalizeTag } from "@elixir-mcp/clan/gate.mjs";
import { createPostgresStore } from "@elixir-mcp/clan-state/postgres";
import { myPlayers } from "@elixir-mcp/record/players";
import { readClanDirectory } from "@elixir-mcp/auth/clan-context";
import { readMembershipCapture } from "@elixir-mcp/record/membership-capture";
import { membershipCapture } from "@elixir-mcp/record/capture-state";
import {
  clanWeekBattles,
  memberActivityWeeks,
  memberActivityWarBounds,
} from "@elixir-mcp/record/member-activity";
import { warMembershipEvidence } from "@elixir-mcp/record/war-membership";
import { clanActivityEvidence } from "@elixir-mcp/record/clan-activity-evidence";
import { seasonCalendar } from "@elixir-mcp/record/season";
import { seasonFromDate, monthForSeasonId } from "@elixir-mcp/record/war-clock";
import {
  writeClanFactInClan,
  removeClanFactInClan,
} from "@elixir-mcp/record/attested-facts";
import { makeRegistry } from "@elixir-mcp/tools";
import { makeRecordReader } from "@elixir-mcp/tools/invoker";
import { memberParticipation } from "@elixir-mcp/tools/tools/clans";
import { makeLive } from "@elixir-mcp/tools/live";
import { enqueueJob } from "@elixir-mcp/ledger";
import { principalBlock } from "@elixir-mcp/tools/identity";
import { toolDeadlineMs } from "./deadline.mjs";

const registry = makeRegistry();
const live = makeLive({ enqueue: (db, job) => enqueueJob(db, job) });
/** The live lane for Clan's reads: the same jobs and the same global rate
 *  budget, with no per-account daily quota spent. */
const unmeteredLive = (db, request) =>
  live(db, { ...request, beforeMint: undefined });

const answer = async (fn) => {
  try {
    return { ok: true, body: await fn() };
  } catch (e) {
    return {
      ok: false,
      status: e.status ?? 502,
      code: e.code ?? "internal",
      error: e.status ? e.message : "Clan could not record this action.",
    };
  }
};

/** The clan's lock: one key per clan, so O/0 aliases name the same lock.
 *  The morning run (services/jobs) and the Discord wake
 *  (services/timeline-sync) take the same key. */
export const clanLockKey = (tag) => `clan-state:${normalizeTag(tag) ?? tag}`;

/**
 * `fn` run holding the clan's session advisory lock on this request's
 * connection: the services' read-modify-writes of the clan's ledger. A
 * request that already holds the lock (a write route) takes it again;
 * session advisory locks stack on one connection and each unlock
 * releases one hold.
 */
export function clanExclusive(db) {
  return async (clanTag, fn) => {
    const key = clanLockKey(clanTag);
    await db.query("select pg_advisory_lock(hashtext($1))", [key]);
    try {
      return await fn();
    } finally {
      await db.query("select pg_advisory_unlock(hashtext($1))", [key]);
    }
  };
}

const CLAN_PATH = /^\/api\/clan\/clans\/([0-9A-Za-z]{3,12})(\/.*)?$/;
// Views that calculate without reconciling actions or grants. Their only
// shared metadata write is an atomic, monotonic observation.
const PURE_VIEWS =
  /^\/(?:week|season|me|home|needs|feed|race|run|members\/[0-9A-Za-z]{3,12}\/activity)$/;
// Views whose writes (evaluating, reconciling Actions, granting awards,
// numbering) run inside the services' `exclusive`, and the policy
// preview, which writes only the size observation. Their record reads,
// the slow part, hold no lock (2026-11-13).
const NARROWED = new Map([
  [
    "GET",
    /^\/(?:actions|actions\/[0-9]{1,7}|manage|history|policy|standing|awards|awards\/manage|trophies)$/,
  ],
  ["POST", /^\/policy\/preview$/],
]);

/**
 * How one Clan request holds the clan's lock: `request` names a lock held
 * for the whole request (every other write, and the reads that write
 * outside `exclusive`); `share` says whether the clan's Discord is
 * brought up to date after it, under the clan's lock.
 */
export function clanLockPlan(method, path, accountId) {
  const m = CLAN_PATH.exec(path);
  if (!m)
    return {
      clan: null,
      request: method !== "GET" ? `clan-state:${accountId}` : null,
      share: false,
    };
  const clan = normalizeTag(m[1]);
  const rest = m[2] ?? "";
  if (method === "GET" && PURE_VIEWS.test(rest))
    return { clan, request: null, share: false };
  if (NARROWED.get(method)?.test(rest))
    return { clan, request: null, share: true };
  return {
    clan,
    request: clan ? clanLockKey(clan) : `clan-state:${accountId}`,
    share: true,
  };
}

/** Time logical state operations without exposing keys, SQL or stored words. */
export function createTracedClanStore(db) {
  const raw = createPostgresStore(db);
  return Object.fromEntries(
    Object.entries(raw).map(([op, fn]) => [
      op,
      (...args) => timedStore(`clan_state.${op}`, () => fn.apply(raw, args)),
    ]),
  );
}

/** Keep the principal's tracked-clan ordering while reusing the players read.
 * No primary-clan/default-subject query is needed by this private gate. */
export async function recordedIdentity(db, account) {
  const players = await myPlayers(db, account.accountId);
  const membership = await readMembershipCapture(
    db,
    players.map((player) => player.player_tag),
  );
  const { rows: clans } = await db.query(
    `select ac.clan_tag, c.name,
            exists (select 1 from claim cl
                    join clan_membership m on m.player_tag = cl.player_tag
                                          and m.left_observed_at is null
                    where cl.account_id = ac.account_id and cl.is_primary
                      and m.clan_tag = ac.clan_tag) as primary_players_clan
     from account_clan ac
     left join clan c on c.clan_tag = ac.clan_tag
     where ac.account_id = $1
     order by primary_players_clan desc, ac.is_primary desc, ac.clan_tag`,
    [account.accountId],
  );
  return {
    ok: true,
    principal: principalBlock("person", {
      grouped: {
        primary: players.filter((player) => player.relationship === "primary"),
      },
      clans,
    }),
    body: {
      players: players.map((player) => ({
        ...player,
        membership_capture:
          membership.get(player.player_tag) ?? membershipCapture(null),
      })),
    },
  };
}

/** The reads a page's parallel panel requests repeat, shared while one
 *  is in flight (`shared-read.mjs`): the eight-week participation every
 *  Clan panel evaluates from. */
const SHARED_READS = new Set(["clans_participation"]);

export function createClanRequest({
  origin,
  modelSecret = null,
  modelStorage = null,
  /** the outbox (`makeOutbox`): a fact's wake and the clan's activity
   *  channel's hello line; null = neither */
  outbox = null,
  /** the relay's last word on a channel (`makeStatusReader`) */
  readStatus = async () => null,
  /** the relay's last deliveries to a channel (`makeHistoryReader`) */
  readHistory = async () => null,
  /** tells Jamie of a leader's thumbs down or note on a Discord post */
  notifyOwner = null,
}) {
  const appUrl = `${origin}/clan`;
  // The clan's activity channel: its webhook sealed as it is saved.
  const activitySeal = modelSecret
    ? clanActivitySeal(createBox(modelSecret, CLAN_ACTIVITY_PURPOSE)).seal
    : null;
  return async ({ db, account, event, modelFactory = null }) => {
    // Clan reads the record in process, as the signed-in person: the
    // same tools and budget as any door, but no tool call of anyone's (no
    // audit row, quota or client name). Its live reads (Scout, Recruit,
    // the role check) spend no one's daily live quota, as they never have.
    const read = makeRecordReader({
      db,
      account,
      registry,
      live: unmeteredLive,
      surface: "web",
      queryBudgetMs: 15_000,
      deadlineMs: toolDeadlineMs(event),
    });
    const record = createRecord({
      identity: () =>
        timedRead("identity", () => recordedIdentity(db, account)),
      read: (name, args) =>
        timedRead(name, () =>
          SHARED_READS.has(name)
            ? sharedRead(
                JSON.stringify([
                  account.accountId,
                  account.timezone ?? null,
                  name,
                  args,
                ]),
                () => read(name, args),
              )
            : read(name, args),
        ),
      // A leader's fact (a departure's answer, an award) wakes the
      // Discord syndication, as a collector's admission does.
      writeFact: (tag, body) =>
        answer(async () => {
          const fact = await writeClanFactInClan(db, account, tag, body);
          await wakeAfterFact(db, fact, { outbox });
          return fact;
        }),
      removeFact: (tag, ref) =>
        answer(() => removeClanFactInClan(db, account, tag, ref)),
    });
    const state = createTracedClanStore(db),
      ledger = ledgerOver(state);
    const context = createAccountContext({ account, state });
    const exclusive = clanExclusive(db);
    const manage = createManageService({
      ledger,
      record,
      exclusive,
      appUrl,
      activityFor: (tag, tags) => clanActivityEvidence(db, tag, tags),
      weekBattlesFor: (tag, windows) => clanWeekBattles(db, tag, windows),
      seasonCalendar: (t, ids) => {
        const current = seasonFromDate(t).seasonId;
        return {
          current_season_id: current,
          seasons: [...new Set([current, ...ids])]
            .sort((a, b) => b - a)
            .map((id) => {
              const c = seasonCalendar(monthForSeasonId(id));
              return {
                season_id: id,
                from: c.starts_at.toISOString(),
                to: c.ends_at.toISOString(),
                sections: c.sections,
              };
            }),
        };
      },
    });
    const awards = createAwardsService({
      ledger,
      exclusive,
      membershipFor: (tag, participation) =>
        warMembershipEvidence(db, tag, participation),
      participationFor: (tag) => fetchParticipation(record, tag),
      elixir: record,
    });
    const model = modelFactory
      ? modelFactory({ ledger, record })
      : modelSecret && modelStorage
        ? createModelService({
            ledger,
            secret: modelSecret,
            rosterFor: (tag) => fetchRoster(record, tag),
            anthropic: createModelBridge({
              secret: modelSecret,
              storage: modelStorage,
              timeoutMs: () =>
                Math.max(
                  1,
                  Math.min(
                    25_000,
                    (event.softDeadlineAt ?? Date.now() + 28_000) -
                      Date.now() -
                      3000,
                  ),
                ),
            }),
          })
        : null;
    // A leader's ratings of the clan's Discord posts (2026-10-11): filed
    // as the signed-in person, about a post of this clan's; the services
    // check the leader first.
    const ratings = {
      async rate({ feature, clanTag, postId, rating, note }) {
        try {
          return await rateDiscordPost(db, {
            account,
            feature,
            clanTag,
            postId,
            rating,
            note,
            via: { principal_kind: account.kind ?? "person" },
            from: senderRef(account),
            notifyOwner,
          });
        } catch (err) {
          if (err instanceof FeedbackError)
            throw new ManageError(err.status, err.code, err.message, {
              message: err.message,
            });
          throw err;
        }
      },
      mine: (ids) => discordRatings(db, account.accountId, ids),
    };
    // Actions in the clan's Discord ride the same sealed outbox bridge
    // and secret as the clan's model.
    const discord =
      modelSecret && modelStorage
        ? createDiscordService({
            ledger,
            secret: modelSecret,
            appUrl,
            bridge: createDiscordBridge({
              secret: modelSecret,
              storage: modelStorage,
            }),
            // A minute on, the timeline sync collects the relay's answers.
            wake: clanDiscordWake(outbox),
            quality: discordQuality(db),
            ratings,
            waitMs: () =>
              Math.max(
                1,
                Math.min(
                  20_000,
                  (event.softDeadlineAt ?? Date.now() + 28_000) -
                    Date.now() -
                    3000,
                ),
              ),
          })
        : null;
    // How the clan's messages sound: one setting, read by the drafts and
    // the Discord editor (2026-10-20).
    const voices = createVoiceService({ ledger });
    // The clan's activity in its own Discord channel (Social).
    const activity = activitySeal
      ? createActivityService({
          ledger,
          model,
          ratings,
          voice: voices,
          store: {
            async read(clanTag) {
              const row = await readClanActivity(db, clanTag);
              return row
                ? clanActivityRowView(
                    row,
                    await readStatus(row.channel_id),
                    await readHistory(row.channel_id).catch(() => null),
                  )
                : null;
            },
            async save(clanTag, change, { who, clanName }) {
              const r = await saveClanActivity(db, clanTag, change, {
                seal: activitySeal,
                outbox,
                who,
                clanName,
              });
              if (r.error) return r;
              // The hello's first word: a forum channel's webhook, or one
              // Discord says is gone, is switched off at once (2026-10-11).
              const status = r.hello
                ? await awaitFirstWord(
                    readStatus,
                    r.channel_id,
                    r.fp,
                    r.hello_at,
                    {
                      waitMs: Math.max(
                        0,
                        Math.min(
                          8000,
                          (event.softDeadlineAt ?? Date.now() + 28_000) -
                            Date.now() -
                            5000,
                        ),
                      ),
                    },
                  )
                : null;
              const refused = refusalOf(status);
              // A save that replaced this webhook during the wait keeps
              // its own.
              const row = refused
                ? await refuseClanActivity(db, clanTag, refused, r.fp)
                : null;
              if (row) {
                return {
                  error: refused,
                  view: clanActivityRowView(row, status),
                };
              }
              return { view: clanActivityRowView(r.row, status) };
            },
            remove: (clanTag) => removeClanActivity(db, clanTag),
            // The newest stories as the clan's editor would tell them,
            // for a leader's preview; nothing is posted or told.
            preview: (clanTag, { voice }) =>
              clanEditorPreview(db, clanTag, {
                voice,
                policyFor: (_db, tag) => ledger.currentPolicy(tag),
                pitchFor: (_db, tag) => ledger.currentPitch(tag),
                voiceFor: (_db, tag) => voices.current(tag),
              }),
          },
        })
      : null;
    const handler = createHandler({
      ...context,
      activity,
      voice: voices,
      discord,
      record,
      manage,
      awards,
      model,
      drafts: createDrafts({
        ledger,
        model,
        requireRemovalSafety: manage.requireRemovalSafety,
        // What the record says about the clan and the Action's member,
        // for the clan's model (2026-10-11).
        storyFor: (clanTag, playerTags) => draftStory(db, clanTag, playerTags),
      }),
      recruit: createRecruitService({ ledger, record, model }),
      scout: createScout({ record }),
      social: createSocialService({ ledger, geo: diskGeo() }),
      memberActivity: createMemberActivity({
        record,
        participationFor: (clanTag, playerTag, weeks) =>
          timedRead("clans_participation", () =>
            memberParticipation(db, account, clanTag, playerTag, weeks),
          ),
        weeklyCounts: (...args) => memberActivityWeeks(db, ...args),
        warBounds: (weeks) => memberActivityWarBounds(db, weeks),
      }),
      // The clan directory, through the approved seam (#768).
      directory: () => readClanDirectory(db, account),
      // Clan's Feed (#766): the clan's timeline as this reader reads it.
      feed: (clanTag) => readClanFeed(db, account, clanTag),
      // The clan card's race chip and the Feed's race bar (G5).
      race: (clanTag) => readClanRace(read, clanTag),
      appUrl,
      elixirUrl: origin,
    });
    // Writes hold the clan's session lock for the whole request; the
    // views in NARROWED take it only around their read-modify-writes
    // (`exclusive`), so a slow record read never holds it. The fact
    // writer owns its transaction; an outer transaction would
    // accidentally commit the rest of the request inside that writer.
    const method = event.method ?? "GET";
    const plan = clanLockPlan(method, event.path ?? "", account.accountId);
    const lock = plan.request;
    const lockStarted = Date.now();
    if (lock) await db.query("select pg_advisory_lock(hashtext($1))", [lock]);
    const lockMs = lock ? Date.now() - lockStarted : null;
    try {
      const response = await handler(event, { lockMs });
      // Anything that can raise or decide an Action brings the clan's
      // Discord up to date under the clan's lock (a write route already
      // holds it). Best effort: the morning run sweeps again.
      if (discord && plan.clan && plan.share)
        await exclusive(plan.clan, () => discord.share(plan.clan)).catch(() => {
          console.error("clan_discord_share_failed");
        });
      return response;
    } finally {
      if (lock)
        await db.query("select pg_advisory_unlock(hashtext($1))", [lock]);
    }
  };
}
