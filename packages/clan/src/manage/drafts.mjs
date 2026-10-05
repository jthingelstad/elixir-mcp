/**
 * Words for an existing action, through the clan's own model. Leader
 * Messages retain their existing context; welcome and removal chat copy
 * receives clan voice/goals and a fixed tone. Welcomes additionally use
 * their frozen return or career detail; all other member evidence stays
 * local. Confirmed departures use classification and recorded tenure,
 * never private decision reasons. Names are substituted after the answer.
 * A person reviews,
 * edits and sends; drafting only adds a log entry, never a decision.
 */

import {
  actionDelivery,
  CHAT_TONES,
  chatMessageFromDraft,
  chatMessageRequest,
  chatSafe,
  chatLines,
  declaredGoals,
  leaderMessageFromDraft,
  leaderMessageRequest,
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

export function createDrafts({
  ledger,
  model,
  requireRemovalSafety = null,
  now = () => Date.now(),
}) {
  const { logAction, person } = createActionStore({ ledger, now });
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
      // The action's subject stays local, including in a leader's optional note.
      const anonymous = (text) => {
        let value =
          kind === "awards" ? chatSafe(String(text ?? "")) : String(text ?? "");
        for (const privateValue of [
          card.player_name,
          card.player_tag,
          ...(kind === "awards"
            ? (ev.awards ?? []).flatMap((a) => a.winners ?? [])
            : []),
          ...(kind === "awards"
            ? (ev.grant_refs ?? []).flatMap((ref) => {
                const tag = ref.split(":").at(-1);
                return [tag, tag.replace(/^#/, "")];
              })
            : []),
        ])
          if (privateValue)
            value = value.replaceAll(
              kind === "awards" ? chatSafe(privateValue) : privateValue,
              "{name}",
            );
        return value;
      };
      const context = {
        kind,
        clanName,
        voice: pitch?.values ?? null,
        goals: policy ? declaredGoals(policy.values) : [],
        note: chat ? note : anonymous(note),
        welcome: kind === "welcome" ? ev.welcome : null,
        departure:
          kind === "departure"
            ? {
                classification: card.outcome.classification,
                confirmed_at: card.decided_at,
                observed_left_at: ev.left_at,
                tenure_days: ev.tenure_days,
              }
            : null,
      };
      const request = chat
        ? chatMessageRequest(context)
        : leaderMessageRequest({
            ...context,
            changes: ev.changes ?? [],
            first: kind === "rules" && ev.version === 1,
            seasonId: ev.season_id ?? null,
            awardCount: (ev.awards ?? []).length,
            // The template the action carries, with the name taken out again.
            current:
              kind === "awards"
                ? { title: `Season ${ev.season_id} awards`, body: "{winners}" }
                : ev.message
                  ? {
                      title: anonymous(ev.message.title),
                      body: anonymous(ev.message.body),
                    }
                  : null,
          });
      const unchanged = async () => {
        const current = await ledger.card(clanTag, cardId);
        if (!current || draftContextVersion(current) !== version)
          throw new ManageError(409, "draft_changed");
        await removalProof();
      };
      await unchanged();
      const answer = await model.write(clanTag, who, token, request);
      await unchanged();
      const draft = (chat ? chatMessageFromDraft : leaderMessageFromDraft)(
        answer.input,
        {
          kind,
          name: card.player_name ?? null,
          awards: ev.awards ?? [],
          welcome: kind === "welcome" ? ev.welcome : null,
          departure: context.departure,
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
