/**
 * Words for an existing open action, through the clan's own model. Leader
 * Messages retain their existing context; welcome and removal chat copy
 * receives clan voice/goals and a fixed tone only. Member evidence stays
 * local and names are substituted after the answer. A person reviews,
 * edits and sends; drafting only adds a log entry, never a decision.
 */

import {
  ACTION_TYPES,
  CHAT_TONES,
  chatMessageFromDraft,
  chatMessageRequest,
  declaredGoals,
  leaderMessageFromDraft,
  leaderMessageRequest,
} from "@elixir-mcp/clan-engine";
import { ManageError } from "./service.mjs";
import { createActionStore } from "./actions.mjs";

const LEADERS = new Set(["leader", "coLeader"]);
const KIND = {
  promotion: "promotion",
  demotion: "demotion",
  awards_announcement: "awards",
  rules_announcement: "rules",
  welcome: "welcome",
  removal: "removal",
};

export function createDrafts({ ledger, model, now = () => Date.now() }) {
  const { logAction, person } = createActionStore({ ledger, now });
  return {
    async leaderMessage(
      clanTag,
      who,
      token,
      cardId,
      { note = null, clanName = null } = {},
    ) {
      if (!LEADERS.has(who.role)) throw new ManageError(403, "leaders_only");
      if (!model) throw new ManageError(404, "not_found");
      const card = await ledger.card(clanTag, cardId);
      if (!card) throw new ManageError(404, "no_action");
      if (card.status !== "proposed")
        throw new ManageError(409, "action_closed");
      const kind = KIND[card.type];
      const chat = ["welcome", "removal"].includes(kind);
      if (chat && note != null && !Object.hasOwn(CHAT_TONES, note))
        throw new ManageError(400, "bad_draft_tone");
      if (
        !kind ||
        (!chat && ACTION_TYPES[card.type]?.channel !== "leader_message")
      )
        throw new ManageError(400, "no_leader_message");
      const [policy, pitch] = await Promise.all([
        ledger.currentPolicy(clanTag),
        ledger.currentPitch(clanTag),
      ]);
      const ev = card.evidence ?? {};
      // The action's subject stays local, including in a leader's optional note.
      const anonymous = (text) => {
        let value = String(text ?? "");
        for (const privateValue of [card.player_name, card.player_tag])
          if (privateValue) value = value.replaceAll(privateValue, "{name}");
        return value;
      };
      const context = {
        kind,
        clanName,
        voice: pitch?.values ?? null,
        goals: policy ? declaredGoals(policy.values) : [],
        note: chat ? note : anonymous(note),
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
            current: ev.message
              ? {
                  title: anonymous(ev.message.title),
                  body: anonymous(ev.message.body),
                }
              : null,
          });
      const answer = await model.write(clanTag, who, token, request);
      const draft = (chat ? chatMessageFromDraft : leaderMessageFromDraft)(
        answer.input,
        {
          kind,
          name: card.player_name ?? null,
          awards: ev.awards ?? [],
        },
      );
      await logAction(clanTag, card.card_id, "drafted", {
        by: person(who),
        text: `Drafted ${chat ? "a clan-chat line" : "a Leader Message"} in the clan's voice (${answer.model}).`,
      });
      return { ...draft, model: answer.model };
    },
  };
}
