/**
 * The awards service: the clan's awards document (versioned like policy),
 * the live races and closed seasons from the record, grants written on
 * the first evaluation after a season closes, grants by hand for a
 * leaders' pick, and the trophy case every member sees.
 *
 * Pure engine in (evaluateAwards), ledger and Elixir out. Evaluation is on
 * demand with the signed-in person's token and cached five minutes per
 * clan, like the management evaluation; any member opening the trophy
 * case runs it, so grants do not wait on a leader visiting Manage. Like
 * every management function, nothing here runs until the clan has a
 * policy, nor while it is below MIN_MEMBERS (10), and a clan starts with
 * no awards.
 */

import {
  AWARD_KINDS,
  actionDelivery,
  defaultAwards,
  describeAward,
  evaluateAwards,
  awardAnnouncementParts,
  validateAwards,
} from "@elixir-mcp/clan-engine";
import {
  ManageError,
  EVALUATION_TTL_MS,
  noteClanSize,
  tooFewMembers,
} from "./service.mjs";
import { MIN_MEMBERS } from "@elixir-mcp/clan-engine";
import { createActionStore } from "./actions.mjs";
import { createHash } from "node:crypto";
import { newId } from "@elixir-mcp/clan-state";
import { planStandings, standingsFrom } from "./standings.mjs";
import {
  weeklyAwardUpdates,
  timelyAwardWeek,
  currentAwardUpdate,
} from "./award-week.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
const ELDER_PLUS = new Set(["leader", "coLeader", "elder"]);

export function createAwardsService({
  ledger,
  participationFor,
  membershipFor = null,
  // Elixir's client, for the morning run's award standings (JSON API
  // 2.6.0, on the integration key with facts:write); none, none shared.
  elixir = null,
  now = () => Date.now(),
}) {
  const isLeader = (who) => LEADERS.has(who.role);
  const { raiseAction, withdrawAction } = createActionStore({ ledger, now });

  const grantRef = (g) => `${g.season_id}:${g.award_id}:${g.player_tag}`;
  const receiptRef = (g) => `${grantRef(g)}:${g.granted_at}`;

  /** Complete bounded copy from receipts, including later manual picks.
   * Completed messages remain immutable; changed pending segments are withdrawn
   * and replaced, with their evidence/log retained. No message is sent here. */
  async function announceSeason(clanTag, seasonIds) {
    const policy = await ledger.currentPolicy(clanTag);
    if (!policy?.values?.announce_awards_enabled) return;
    const all = await ledger.grants(clanTag);
    const cards = await ledger.cards(clanTag);
    for (const season_id of new Set(seasonIds)) {
      const prior = cards.filter(
        (c) =>
          c.type === "awards_announcement" &&
          c.evidence?.season_id === season_id,
      );
      const sent = prior.filter((c) => c.status === "done");
      const unsent = all.filter(
        (g) =>
          g.season_id === season_id &&
          !sent.some((c) =>
            c.evidence?.grant_receipts
              ? c.evidence.grant_receipts.includes(receiptRef(g))
              : g.granted_at <= (c.decided_at ?? c.raised_at),
          ),
      );
      const parts = awardAnnouncementParts(unsent);
      const wanted = parts.map((part) => ({
        ...part,
        key: createHash("sha256")
          .update(JSON.stringify(part.grants.map(receiptRef)))
          .digest("hex"),
      }));
      const samePendingPart = (c, p) =>
        p.key === c.evidence?.announcement_key &&
        p.part === c.evidence?.part &&
        parts.length === c.evidence?.parts;
      for (const c of prior.filter((c) => c.status === "proposed"))
        if (!wanted.some((p) => samePendingPart(c, p)))
          await withdrawAction(
            clanTag,
            c,
            "Award receipts changed; use the replacement announcement segments.",
          );
      for (const part of wanted) {
        if (
          prior.some(
            (c) =>
              (["done", "declined"].includes(c.status) &&
                c.evidence?.announcement_key === part.key) ||
              (c.status === "proposed" && samePendingPart(c, part)),
          )
        )
          continue;
        const message = {
          title:
            parts.length === 1
              ? `Season ${season_id} awards`
              : `S${season_id} awards ${part.part}/${parts.length}`,
          body: part.body,
        };
        await raiseAction(
          clanTag,
          {
            card_id: newId(),
            clan_tag: clanTag,
            player_tag: null,
            player_name: null,
            role_at_raise: null,
            type: "awards_announcement",
            status: "proposed",
            raised_at: new Date(now()).toISOString(),
            policy_version: policy.version,
            evidence: {
              season_id,
              awards: part.awards,
              message,
              part: part.part,
              parts: parts.length,
              announcement_key: part.key,
              grant_refs: part.grants.map(grantRef),
              grant_receipts: part.grants.map(receiptRef),
            },
          },
          cards,
          {
            text: `Season ${season_id}: review award announcement ${part.part} of ${parts.length}.`,
            detail: { clauses: ["announce_awards_enabled"] },
          },
        );
      }
    }
  }

  /** New updates have one durable Action; old plans retain their original
   * card IDs and decisions. Only the latest timely week can recover a raise. */
  async function raiseUpdate(clanTag, plan, policy, cards) {
    const evidence = {
      scope: plan.scope ?? "weekly",
      season_id: plan.season_id,
      section_index: plan.section_index ?? null,
      finished_observed_at: plan.finished_observed_at ?? null,
      as_of: plan.as_of,
      complete: plan.complete,
      config_version: plan.config_version,
    };
    const text =
      plan.scope === "current"
        ? `Review current provisional season ${plan.season_id} standings as of ${plan.as_of}.`
        : `War week ${plan.section_index + 1} closed: share provisional season ${plan.season_id} standings.`;
    const existing = cards.find((c) => c.card_id === plan.card_id);
    if (existing) return existing;
    return raiseAction(
      clanTag,
      {
        card_id: plan.card_id,
        clan_tag: clanTag,
        player_tag: null,
        player_name: null,
        role_at_raise: null,
        type: "awards_standings",
        status: "proposed",
        raised_at: plan.raised_at,
        policy_version: policy.version,
        evidence: { ...evidence, messages: plan.parts },
      },
      cards,
      { text },
    );
  }

  async function announceWeeks(clanTag, participation, config, t) {
    const eligible = timelyAwardWeek(participation, new Date(t));
    if (!eligible) return;
    const saved = await ledger.weeklyAwardPlans(clanTag);
    let plan = saved.find(
      (p) =>
        p.season_id === eligible.season_id &&
        p.section_index === eligible.section_index,
    );
    if (!plan && config.values.awards.some((a) => a.enabled)) {
      const update = weeklyAwardUpdates({
        participation,
        config: config.values,
        now: new Date(t),
      })[0];
      if (update)
        plan = await ledger.saveWeeklyAwardPlan(clanTag, {
          ...update,
          card_id: newId(),
          config_version: config.version,
          raised_at: new Date(t).toISOString(),
        });
    }
    if (
      !plan ||
      !Number.isFinite(Date.parse(plan.finished_observed_at)) ||
      t - Date.parse(plan.finished_observed_at) > 7 * 86400000
    )
      return;
    const policy = await ledger.currentPolicy(clanTag);
    if (!policy) return;
    const cards = await ledger.cards(clanTag);
    if (plan.card_id) {
      await raiseUpdate(clanTag, plan, policy, cards);
      return;
    }
    // Previously frozen segmented plans are never replaced or regrouped.
    for (const part of plan.parts) {
      if (cards.some((c) => c.card_id === part.card_id)) continue;
      const card = await raiseAction(
        clanTag,
        {
          card_id: part.card_id,
          clan_tag: clanTag,
          player_tag: null,
          player_name: null,
          role_at_raise: null,
          type: "awards_standings",
          status: "proposed",
          raised_at: plan.raised_at,
          policy_version: policy.version,
          evidence: {
            season_id: plan.season_id,
            section_index: plan.section_index,
            finished_observed_at: plan.finished_observed_at,
            as_of: plan.as_of,
            complete: plan.complete,
            config_version: plan.config_version,
            part: part.part,
            parts: plan.parts.length,
            message: part.message,
          },
          delivery: actionDelivery({
            type: "awards_standings",
            evidence: { message: part.message },
          }),
        },
        cards,
        {
          text: `War week ${plan.section_index + 1} closed: share provisional season ${plan.season_id} standings.`,
        },
      );
      cards.push(card);
    }
  }

  async function readParticipation(clanTag, token) {
    const participation = await participationFor(token, clanTag);
    if (membershipFor) {
      const evidence = await membershipFor(clanTag, participation);
      participation.members = participation.members.map((m) => ({
        ...m,
        absent_at_war_week: evidence.war?.[m.player_tag] ?? [],
        absent_at_donation_week: evidence.donations?.[m.player_tag] ?? [],
      }));
    }
    return participation;
  }

  /** Nothing in clan management runs before a policy is saved, nor while
   *  the clan is below MIN_MEMBERS. An evaluation passes `size: false`
   *  and decides from its own participation read. */
  async function requirePolicy(clanTag, { size = true } = {}) {
    if (!(await ledger.currentPolicy(clanTag)))
      throw new ManageError(409, "no_policy");
    if (size) {
      const known = await ledger.clanSize(clanTag);
      if (known && known.members < MIN_MEMBERS)
        throw tooFewMembers(known.members);
    }
  }

  async function configFor(clanTag) {
    const current = await ledger.currentAwards(clanTag);
    if (current)
      return {
        values: current.values,
        version: current.version,
        saved_at: current.saved_at,
        saved_by: current.saved_by,
        saved_by_name: current.saved_by_name ?? null,
      };
    return {
      values: defaultAwards(),
      version: 0,
      saved_at: null,
      saved_by: null,
      saved_by_name: null,
    };
  }

  /** Evaluate the record (or reuse a fresh snapshot) and write grants due. */
  async function evaluateClan({ clanTag, token, force = false }) {
    const t = now();
    const config = await configFor(clanTag);
    const cached = await ledger.latestAwardsSnapshot(clanTag);
    // A clan last seen below the minimum is re-read, never served a cache.
    const known = await ledger.clanSize(clanTag);
    const small = known !== null && known.members < MIN_MEMBERS;
    if (
      !force &&
      !small &&
      cached &&
      cached.config_version === config.version &&
      t - Date.parse(cached.evaluated_at) < EVALUATION_TTL_MS
    )
      return { result: cached, config, cached: true };
    const participation = await readParticipation(clanTag, token);
    // Too small for awards: remember the size and grant nothing.
    await noteClanSize(ledger, clanTag, participation.members.length, t);
    if (participation.members.length < MIN_MEMBERS)
      throw tooFewMembers(participation.members.length);
    const grants = await ledger.grants(clanTag);
    const result = evaluateAwards({
      participation,
      config: config.values,
      now: new Date(t),
      grants,
      decisions: await ledger.awardPlans(clanTag),
      config_version: config.version,
    });
    const granted_at = new Date(t).toISOString();
    // Save the complete frozen plan before the first recipient. A timeout
    // between writes resumes that same plan rather than re-ranking survivors.
    const due = new Map();
    for (const g of result.grants_due) {
      const key = `${g.season_id}|${g.award_id}`;
      due.set(key, [...(due.get(key) ?? []), { ...g, granted_at }]);
    }
    for (const season of result.seasons.filter((s) => s.closed && s.complete))
      for (const award of season.awards.filter(
        (a) => a.computed && a.state === "closed",
      )) {
        // Legacy grants remain authoritative; never infer a missing historical
        // recipient. New decisions, including no-winner decisions, get a plan.
        if (
          grants.some(
            (g) =>
              g.season_id === season.season_id && g.award_id === award.award_id,
          )
        )
          continue;
        await ledger.saveAwardPlan(clanTag, {
          season_id: season.season_id,
          award_id: award.award_id,
          kind: award.kind,
          name: award.name,
          description: award.description,
          rule: award.rule,
          grants: due.get(`${season.season_id}|${award.award_id}`) ?? [],
          planned_at: granted_at,
        });
      }
    const plans = (await ledger.awardPlans(clanTag)).filter(
      (p) => !p.completed_at,
    );
    for (const plan of plans)
      for (const g of plan.grants) await ledger.putGrant(clanTag, g);
    await announceSeason(
      clanTag,
      result.seasons.filter((s) => s.closed).map((s) => s.season_id),
    );
    for (const plan of plans)
      await ledger.completeAwardPlan(clanTag, plan, granted_at);
    const snapshot = {
      ...evaluateAwards({
        participation,
        config: config.values,
        now: new Date(t),
        grants: await ledger.grants(clanTag),
        decisions: await ledger.awardPlans(clanTag),
        config_version: config.version,
      }),
      grants_due: [],
    };
    await announceWeeks(clanTag, participation, config, t);
    await ledger.saveAwardsSnapshot(clanTag, snapshot);
    return {
      result: snapshot,
      config,
      cached: false,
      granted: result.grants_due.length,
    };
  }

  /**
   * The running season's award standings to Elixir, as the app's own
   * facts: only what moved since the last morning is written, and a
   * standing no longer held is taken back (manage/standings.mjs). A write
   * that fails is left out of what was shared, so the next run retries it.
   */
  async function shareStandings(clanTag, key, result) {
    const prev = await ledger.sharedStandings(clanTag);
    const current = standingsFrom(result);
    const { writes, removes, next } = planStandings(prev, current);
    let failed = 0;
    for (const fact of writes) {
      const r = await elixir.writeFact(key, clanTag, fact);
      if (!r.ok) {
        failed += 1;
        // What Elixir may hold under this ref stays in the record, so it is
        // retried next morning and can always be taken back: a standing
        // written before keeps its old place; one never confirmed (a
        // timeout may still have landed) is kept with no place, which
        // differs from any place, so it is written again.
        next.refs[fact.ref] = prev?.refs?.[fact.ref] ?? {
          ...next.refs[fact.ref],
          place: null,
        };
      }
    }
    for (const ref of removes) {
      const r = await elixir.removeFact(key, clanTag, ref);
      if (!r.ok) {
        failed += 1;
        next.refs[ref] = prev.refs[ref];
      }
    }
    await ledger.saveSharedStandings(clanTag, {
      ...next,
      shared_at: new Date(now()).toISOString(),
    });
    return {
      standings_written: writes.length,
      standings_removed: removes.length,
      standings_failed: failed,
    };
  }

  const shape = (g) => ({
    season_id: g.season_id,
    award_id: g.award_id,
    kind: g.kind,
    name: g.name,
    rank: g.rank ?? 1,
    player_tag: g.player_tag,
    player_name: g.player_name ?? null,
    metric_value: g.metric_value ?? null,
    metric_unit: g.metric_unit ?? null,
    note: g.note ?? null,
    manual: g.manual === true,
    granted_at: g.granted_at,
    granted_by: g.granted_by ?? null,
    granted_by_name: g.granted_by_name ?? null,
    donations: g.metadata?.donations ?? null,
  });

  return {
    configFor,
    evaluateClan,

    /** The morning evaluation (door 1): a closed season's grants are
     *  written, and its announcement raised, without anyone visiting; the
     *  standings go to Elixir as the app's own facts. */
    async evaluateOnSchedule(clanTag, key) {
      await requirePolicy(clanTag, { size: false });
      const { result } = await evaluateClan({
        clanTag,
        token: key,
        force: true,
      });
      const shared = elixir ? await shareStandings(clanTag, key, result) : null;
      return { awards_evaluated: true, ...(shared ?? {}) };
    },

    async currentUpdate(clanTag, who, token, requestId) {
      if (!isLeader(who) || who.verified === false)
        throw new ManageError(403, "leaders_only");
      if (
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId ?? "")
      )
        throw new ManageError(400, "bad_request_id");
      await requirePolicy(clanTag);
      let plan = await ledger.currentAwardUpdate(clanTag, requestId);
      if (!plan) {
        const config = await configFor(clanTag);
        const participation = await readParticipation(clanTag, token);
        if (participation.members.length < MIN_MEMBERS)
          throw tooFewMembers(participation.members.length);
        const update = currentAwardUpdate({
          participation,
          config: config.values,
          now: new Date(now()),
        });
        if (!update) throw new ManageError(409, "season_not_open");
        if (!update.parts.length) throw new ManageError(409, "no_awards");
        plan = await ledger.saveCurrentAwardUpdate(clanTag, {
          ...update,
          request_id: requestId,
          card_id: newId(),
          config_version: config.version,
          raised_at: new Date(now()).toISOString(),
          requested_by: who.player_tag,
        });
      }
      const action = await raiseUpdate(
        clanTag,
        plan,
        await ledger.currentPolicy(clanTag),
        await ledger.cards(clanTag),
      );
      return { action };
    },

    /** Manage ▸ Awards: races, seasons, grants, and the document. */
    async manageView(clanTag, who, token, { refresh = false } = {}) {
      await requirePolicy(clanTag, { size: false });
      const { result, config, cached } = await evaluateClan({
        clanTag,
        token,
        force: refresh,
      });
      // Who granted, by name: rows since 2026-09-20 carry it; older ones
      // are named from the evaluation's members and the grants themselves.
      const names = new Map();
      for (const m of result.members ?? [])
        if (m.name) names.set(m.player_tag, m.name);
      for (const g of await ledger.grants(clanTag))
        if (g.player_name && !names.has(g.player_tag))
          names.set(g.player_tag, g.player_name);
      const grants = (await ledger.grants(clanTag)).map((g) => {
        const row = shape(g);
        return {
          ...row,
          granted_by_name:
            row.granted_by_name ?? names.get(row.granted_by) ?? null,
        };
      });
      const versions = ELDER_PLUS.has(who.role)
        ? await ledger.awardsVersions(clanTag)
        : [];
      // Manual rows come from the ledger as it is now, not from the
      // snapshot: a pick granted a moment ago shows without a re-read.
      const seasons = result.seasons.map((s) => ({
        ...s,
        awards: s.awards.map((a) =>
          a.state !== "manual"
            ? a
            : {
                ...a,
                rows: grants
                  .filter(
                    (g) =>
                      g.season_id === s.season_id && g.award_id === a.award_id,
                  )
                  .map((g) => ({
                    player_tag: g.player_tag,
                    name: g.player_name,
                    note: g.note,
                    granted_at: g.granted_at,
                    granted_by: g.granted_by,
                    granted_by_name: g.granted_by_name,
                  })),
              },
        ),
      }));
      return {
        clan_tag: clanTag,
        can_edit: isLeader(who),
        can_send: isLeader(who) && who.verified !== false,
        can_grant: config.values.awards
          .filter(
            (a) =>
              a.enabled &&
              a.kind === "leaders_pick" &&
              (isLeader(who) ||
                (ELDER_PLUS.has(who.role) && a.params.granted_by === "elders")),
          )
          .map((a) => a.id),
        evaluated_at: result.evaluated_at,
        cached,
        as_of: result.as_of,
        freshness_seconds: result.freshness_seconds,
        members: result.members ?? [],
        seasons,
        grants,
        config: config.values,
        config_version: config.version,
        kinds: AWARD_KINDS,
        versions: versions
          .map((v) => ({
            version: v.version,
            saved_at: v.saved_at,
            saved_by: v.saved_by,
            saved_by_name: v.saved_by_name ?? names.get(v.saved_by) ?? null,
            note: v.note,
          }))
          .reverse(),
      };
    },

    async saveConfig(clanTag, who, input, note) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      await requirePolicy(clanTag);
      const checked = validateAwards(input);
      if (!checked.ok)
        throw Object.assign(new ManageError(400, "invalid_awards"), {
          errors: checked.errors,
        });
      const existing = [
        ...(await ledger.grants(clanTag)),
        ...(await ledger.awardPlans(clanTag)),
      ];
      const errors = {};
      checked.values.awards.forEach((a, i) => {
        if (
          existing.some(
            (g) => g.award_id === a.id && g.kind && g.kind !== a.kind,
          )
        )
          errors[`awards.${i}.kind`] =
            "This award id keeps its original kind. Add a new award for a different kind.";
      });
      if (Object.keys(errors).length)
        throw Object.assign(new ManageError(400, "invalid_awards"), { errors });
      return ledger.saveAwards(clanTag, {
        values: checked.values,
        by: who.player_tag,
        by_name: who.name ?? null,
        note,
      });
    },

    /** A leaders' pick, by hand. */
    async grant(clanTag, who, { award_id, player_tag, season_id, note }) {
      await requirePolicy(clanTag);
      const config = await configFor(clanTag);
      const award = config.values.awards.find((a) => a.id === award_id);
      if (!award || !award.enabled) throw new ManageError(404, "no_award");
      if (award.kind !== "leaders_pick")
        throw new ManageError(400, "not_manual");
      const allowed =
        isLeader(who) ||
        (award.params.granted_by === "elders" && ELDER_PLUS.has(who.role));
      if (!allowed) throw new ManageError(403, "leaders_only");
      const season = Number(season_id);
      if (!Number.isInteger(season) || season < 1 || season > 9999)
        throw new ManageError(400, "bad_season");
      const text = String(note ?? "").trim();
      if (!text || text.length > 500) throw new ManageError(400, "bad_note");
      const snapshot = await ledger.latestAwardsSnapshot(clanTag);
      if (
        !snapshot?.seasons.some(
          (s) => s.season_id === season && s.closed && s.complete,
        )
      )
        throw new ManageError(409, "season_not_closed");
      const member = snapshot.members?.find((m) => m.player_tag === player_tag);
      if (!member) throw new ManageError(400, "not_in_roster");
      const previous = (await ledger.grants(clanTag)).find(
        (g) =>
          g.season_id === season &&
          g.award_id === award.id &&
          g.player_tag === player_tag,
      );
      if (previous) {
        if (previous.note !== text) throw new ManageError(409, "grant_exists");
        // Preserve the original author/time when a response is retried.
        await announceSeason(clanTag, [season]);
        return shape(previous);
      }
      const granted = await ledger.putGrant(clanTag, {
        season_id: season,
        award_id: award.id,
        kind: award.kind,
        name: award.name,
        rank: 1,
        player_tag,
        player_name: member.name ?? player_tag,
        note: text,
        manual: true,
        config_version: config.version,
        granted_at: new Date(now()).toISOString(),
        granted_by: who.player_tag,
        granted_by_name: who.name ?? null,
      });
      await announceSeason(clanTag, [season]);
      return shape(granted);
    },

    /** Only a manual grant can be taken back; a computed one is the record's. */
    async revoke(clanTag, who, { season_id, award_id, player_tag }) {
      if (!isLeader(who)) throw new ManageError(403, "leaders_only");
      await requirePolicy(clanTag);
      const all = await ledger.grants(clanTag);
      const g = all.find(
        (x) =>
          x.season_id === Number(season_id) &&
          x.award_id === award_id &&
          x.player_tag === player_tag,
      );
      if (!g) {
        const config = await configFor(clanTag);
        if (
          config.values.awards.find((a) => a.id === award_id)?.kind !==
          "leaders_pick"
        )
          throw new ManageError(404, "no_grant");
        await announceSeason(clanTag, [Number(season_id)]);
        return;
      }
      if (g.manual !== true) throw new ManageError(400, "not_manual");
      await ledger.removeGrant(clanTag, g);
      await announceSeason(clanTag, [g.season_id]);
    },

    /** One member's trophy case, for the member sheet and the roster. */
    async forMember(clanTag, playerTag) {
      await requirePolicy(clanTag);
      return (await ledger.grants(clanTag))
        .filter((g) => g.player_tag === playerTag)
        .map(shape)
        .sort((a, b) => b.season_id - a.season_id || a.rank - b.rank);
    },

    /**
     * The clan's trophy case, for every member: the awards it runs (name,
     * description, rule), every grant season by season, newest first, and
     * the viewer's own. Opening it evaluates, so a closed season's grants
     * are written by whoever looks first.
     */
    async trophyCase(clanTag, who, token) {
      await requirePolicy(clanTag, { size: false });
      const { config } = await evaluateClan({ clanTag, token });
      const grants = (await ledger.grants(clanTag)).map(shape);
      const seasons = new Map();
      for (const g of grants) {
        const s = seasons.get(g.season_id) ?? {
          season_id: g.season_id,
          grants: [],
        };
        s.grants.push(g);
        seasons.set(g.season_id, s);
      }
      return {
        clan_tag: clanTag,
        awards: config.values.awards
          .filter((a) => a.enabled)
          .map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            rule: describeAward(a),
            manual: a.kind === "leaders_pick",
          })),
        seasons: [...seasons.values()]
          .sort((a, b) => b.season_id - a.season_id)
          .map((s) => ({
            season_id: s.season_id,
            grants: s.grants.sort(
              (a, b) => a.award_id.localeCompare(b.award_id) || a.rank - b.rank,
            ),
          })),
        yours: grants
          .filter((g) => g.player_tag === who.player_tag)
          .sort((a, b) => b.season_id - a.season_id || a.rank - b.rank),
      };
    },
  };
}
