/**
 * Words for an existing action, through the clan's own model. The model
 * is told what Elixir knows (Jamie, 2026-10-11: "The intent is to become
 * even more contextual and pull in the variety of data elixir has"): the
 * clan (`clanContext`), the Action's own evidence in a person's terms
 * (`actionLines`), the member it is about by name with their record
 * (`memberLines`, from `storyFor`), and the leader's note (the draft's
 * "What should it say?") as written. A departure or a removal gives only
 * the member's time in the clan and what they gave; nothing gives a note
 * saved on an Action (anyone's), a hold, a
 * removal's rationale, inactivity numbers or fame per member.
 *
 * A person reviews, edits and sends; drafting only adds a log entry,
 * never a decision. A draft that outlasts the request (`pending`) is
 * collected by asking again with its id.
 */

import {
  actionDelivery,
  actionLines,
  CHAT_TONES,
  chatMessageFromDraft,
  chatMessageRequest,
  chatLines,
  clanContext,
  declaredGoals,
  describePolicy,
  dossierBlock,
  leaderMessageFromDraft,
  leaderMessageRequest,
  memberLines,
  recentWeeksFor,
} from "@elixir-mcp/clan-engine";
import { ManageError } from "./service.mjs";
import {
  confirmedDeparture,
  createActionStore,
  draftContextVersion,
} from "./actions.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
const KIND = {
  promotion: "promotion",
  demotion: "demotion",
  awards_announcement: "awards",
  rules_announcement: "rules",
  welcome: "welcome",
  removal: "removal",
  departure: "departure",
};
/** Kinds whose member block is their time in the clan and what they
 *  gave, never their trophies, moments or a week they missed. */
const CONTRIBUTION = new Set(["removal", "departure"]);

/** A grant's reference on an awards Action: `season:award:tag`. */
const grantRef = (g) => `${g.season_id}:${g.award_id}:${g.player_tag}`;

/**
 * @param {{
 *   ledger: any, model: any,
 *   requireRemovalSafety?: Function | null,
 *   storyFor?: ((clanTag: string, playerTags: string[]) =>
 *     Promise<{ clan: object|null, members: Record<string, object> }>) | null,
 *   now?: () => number,
 * }} deps
 */
export function createDrafts({
  ledger,
  model,
  requireRemovalSafety = null,
  storyFor = null,
  now = () => Date.now(),
}) {
  const { logAction, person } = createActionStore({ ledger, now });

  /** What the model is told for this Action: the clan block (the cached
   *  prefix) and the packet (the moment and its people). */
  async function told(clanTag, card, kind, { policy, pitch, clanName }) {
    const ev = card.evidence ?? {};
    const all = kind === "awards" ? await ledger.grants(clanTag) : [];
    const refs = new Set(ev.grant_refs ?? []);
    const grants = all.filter((g) => refs.has(grantRef(g)));
    const subject =
      kind === "awards" || kind === "rules" ? null : card.player_tag;
    const story = storyFor
      ? await storyFor(clanTag, subject ? [subject] : []).catch(() => null)
      : null;
    const context = clanContext({
      name: clanName ?? story?.clan?.name ?? null,
      pitch: pitch?.values ?? null,
      goals: policy ? declaredGoals(policy.values) : [],
      facts: story?.clan ?? null,
    });
    const lines = actionLines(kind, {
      card,
      grants,
      policyLines:
        kind === "rules" && policy
          ? describePolicy(policy.values).flatMap((s) => s.lines ?? [])
          : [],
    });
    if (subject) {
      const recorded = story?.members?.[subject] ?? {};
      const held = (
        subject && !CONTRIBUTION.has(kind) ? await ledger.grants(clanTag) : []
      )
        .filter((g) => g.player_tag === subject)
        .map((g) => ({
          name: g.name ?? g.award_id,
          season_id: g.season_id,
          value: g.metric_value ?? null,
          unit: g.metric_unit ?? null,
        }));
      const member = {
        ...recorded,
        name: card.player_name ?? recorded.name ?? null,
        // A departure's tenure is the one the Action recorded.
        ...(kind === "departure" && Number.isSafeInteger(ev.tenure_days)
          ? { tenure_days: ev.tenure_days, joined_at: recorded.joined_at }
          : {}),
        ...(CONTRIBUTION.has(kind)
          ? {
              // What they gave: weeks they played, never one they missed.
              war: (recorded.war ?? []).filter((w) => w.decks_used > 0),
              awards: [],
            }
          : { awards: held }),
      };
      lines.push(
        "",
        ...memberLines(member, {
          scope: CONTRIBUTION.has(kind) ? "contribution" : "full",
        }),
        // Their dossier and Elixir's story angles, what `kind` may tell.
        ...dossierBlock(story?.dossier, kind, {
          recentWeeks: recentWeeksFor(policy?.values),
          member,
        }),
      );
    }
    return { context, packet: lines.join("\n"), grants };
  }

  return {
    async leaderMessage(
      clanTag,
      who,
      token,
      cardId,
      {
        note = null,
        clanName = null,
        expectedDraftVersion = null,
        channel = null,
        pending = null,
      } = {},
    ) {
      if (!LEADERS.has(who.role) || who.verified === false)
        throw new ManageError(403, "leaders_only");
      if (!model) throw new ManageError(404, "not_found");
      const card = await ledger.card(clanTag, cardId);
      if (!card) throw new ManageError(404, "no_action");
      const version = draftContextVersion(card);
      if (expectedDraftVersion && expectedDraftVersion !== version)
        throw new ManageError(409, "draft_changed");
      if (card.type === "departure" && !confirmedDeparture(card))
        throw new ManageError(409, "departure_unconfirmed");
      if (card.status !== "proposed" && !confirmedDeparture(card))
        throw new ManageError(409, "action_closed");
      let removalVersion = null;
      const removalProof = async () => {
        if (card.type !== "removal") return;
        if (!requireRemovalSafety)
          throw new ManageError(409, "removal_evidence_held");
        const proof = await requireRemovalSafety(clanTag, card, token);
        if (removalVersion && proof.evidence_version !== removalVersion)
          throw new ManageError(409, "draft_changed");
        removalVersion = proof.evidence_version;
      };
      await removalProof();
      const kind = KIND[card.type];
      const chat = ["welcome", "removal", "departure"].includes(kind);
      const delivery = actionDelivery(card);
      if (
        channel &&
        !Object.hasOwn(
          delivery?.parts[0]?.options ?? { clan_chat: true },
          channel,
        )
      )
        throw new ManageError(400, "bad_message");
      if (chat && note != null && !Object.hasOwn(CHAT_TONES, note))
        throw new ManageError(400, "bad_draft_tone");
      if (!kind || (!chat && !actionDelivery(card)))
        throw new ManageError(400, "no_leader_message");
      if (pending != null && typeof pending !== "string")
        throw new ManageError(400, "bad_message");
      const [policy, pitch] = await Promise.all([
        ledger.currentPolicy(clanTag),
        ledger.currentPitch(clanTag),
      ]);
      const ev = card.evidence ?? {};
      if (kind === "awards") {
        try {
          leaderMessageFromDraft({}, { kind, awards: ev.awards ?? [] });
        } catch (error) {
          if (error instanceof RangeError)
            throw new ManageError(409, "awards_need_segments");
          throw error;
        }
      }
      const departure =
        kind === "departure"
          ? {
              classification: card.outcome.classification,
              confirmed_at: card.decided_at,
              observed_left_at: ev.left_at,
              tenure_days: ev.tenure_days,
            }
          : null;
      const { context, packet } = await told(clanTag, card, kind, {
        policy,
        pitch,
        clanName,
      });
      const request = chat
        ? chatMessageRequest({
            kind,
            context,
            packet,
            tone: note,
            welcome: kind === "welcome" ? ev.welcome : null,
            departure,
          })
        : leaderMessageRequest({
            kind,
            context,
            packet,
            note,
            current:
              kind === "awards"
                ? { title: `Season ${ev.season_id} awards`, body: "{winners}" }
                : (ev.message ?? null),
          });
      const unchanged = async () => {
        const current = await ledger.card(clanTag, cardId);
        if (!current || draftContextVersion(current) !== version)
          throw new ManageError(409, "draft_changed");
        await removalProof();
      };
      await unchanged();
      const answer = pending
        ? await model.collect(clanTag, who, pending)
        : await model.write(clanTag, who, token, request, { defer: true });
      if (answer.pending)
        return { pending: answer.pending, draft_context_version: version };
      await unchanged();
      const draft = (chat ? chatMessageFromDraft : leaderMessageFromDraft)(
        answer.input,
        {
          kind,
          name: card.player_name ?? null,
          awards: ev.awards ?? [],
          welcome: kind === "welcome" ? ev.welcome : null,
          departure,
          told: `${request.context}\n${request.prompt}`,
        },
      );
      await logAction(clanTag, card.card_id, "drafted", {
        by: person(who),
        text: `Drafted ${chat || channel === "clan_chat" ? "clan-chat words" : "a Leader Message"} in the clan's voice (${answer.model}).`,
      });
      return {
        ...draft,
        ...(!chat && channel === "clan_chat"
          ? { lines: chatLines(draft) }
          : {}),
        model: answer.model,
        draft_context_version: version,
      };
    },
  };
}
