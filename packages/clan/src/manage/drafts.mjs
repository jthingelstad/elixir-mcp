/**
 * Words for an existing action, through the clan's own model. The model
 * is told what Elixir knows (Jamie, 2026-10-11: "The intent is to become
 * even more contextual and pull in the variety of data elixir has"): the
 * clan (`clanContext`), the Action's own evidence in a person's terms
 * (`actionLines`), the member it is about by name with their record
 * (`memberLines`, from `storyFor`), the words the Action would send with
 * no draft as the floor (Jamie, 2026-10-20: a draft should be
 * "meaningfully more in-depth and personalized"), and the leader's note
 * (the draft's "What should it say?") as written. A departure or a
 * removal gives only the member's time in the clan and what they gave; a
 * demotion only their time in the clan and the awards they hold, never
 * what its review counted. Nothing gives a note saved on an Action
 * (anyone's), a hold, a removal's rationale, inactivity numbers or fame
 * per member.
 *
 * The destination decides the draft's shape: clan chat is lines, each
 * its own send (`clanChatRequest`); the Inbox, and an announcement's
 * heading and message, a title and a message (`leaderMessageRequest`).
 *
 * A person reviews, edits and sends; drafting only adds a log entry,
 * never a decision. A draft that outlasts the request (`pending`) is
 * collected by asking again with its id. `request` builds the exact
 * request for one Action without a model, a key or a write, for the
 * read-only `draft_packet` maintenance lane.
 */

import {
  actionDelivery,
  actionLines,
  CHAT_TONES,
  chatLines,
  clanChatFromDraft,
  clanChatRequest,
  clanContext,
  declaredGoals,
  describePolicy,
  dossierBlock,
  inGameCopy,
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
/** Kinds whose only words are clan chat. */
const CHAT_ONLY = new Set(["welcome", "removal", "departure"]);
/** The member block each kind gets: a departure's or a removal's is
 *  their time in the clan and what they gave, never their trophies,
 *  moments or a week they missed; a demotion's is their history (their
 *  time in the clan and the awards they hold), never a number of the
 *  review's window. */
const SCOPE = {
  removal: "contribution",
  departure: "contribution",
  demotion: "history",
};

/** A grant's reference on an awards Action: `season:award:tag`. */
const grantRef = (g) => `${g.season_id}:${g.award_id}:${g.player_tag}`;

/**
 * The words the Action would send with no draft, which the draft must say
 * at least: the frozen delivery's words in the chosen channel, or the
 * game copy a welcome, a removal or a farewell shows. An awards draft is
 * its heading around `{winners}`, which Elixir fills.
 */
function plainWords(card, kind, { shape, delivery }) {
  const ev = card.evidence ?? {};
  const name = card.player_name ?? null;
  if (kind === "awards")
    return { title: `Season ${ev.season_id} awards`, body: "{winners}" };
  if (kind === "welcome")
    return { lines: [inGameCopy("welcome", { name, welcome: ev.welcome })] };
  if (kind === "removal" || kind === "departure")
    return {
      lines: [inGameCopy(kind === "departure" ? "farewell" : kind, { name })],
    };
  const options = delivery?.parts[0]?.options ?? {};
  if (shape === "chat")
    return {
      lines: options.clan_chat?.lines ?? chatLines(options.leader_message),
    };
  return options.leader_message ?? null;
}

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
      const scope = SCOPE[kind] ?? "full";
      const recorded = story?.members?.[subject] ?? {};
      const held = (
        scope === "contribution" ? [] : await ledger.grants(clanTag)
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
        ...(scope === "contribution"
          ? {
              // What they gave: weeks they played, never one they missed.
              war: (recorded.war ?? []).filter((w) => w.decks_used > 0),
              awards: [],
            }
          : { awards: held }),
      };
      lines.push(
        "",
        ...memberLines(member, { scope }),
        // Their dossier and Elixir's story angles, what `kind` may tell.
        ...dossierBlock(story?.dossier, kind, {
          recentWeeks: recentWeeksFor(policy?.values),
          member,
        }),
      );
    }
    return { context, packet: lines.join("\n"), grants };
  }

  /**
   * Everything a draft for this Action is before any model: its kind and
   * shape, the plain words, and the exact request. Refuses what a draft
   * would refuse for the Action itself (its channel, tone and note).
   */
  async function prepare(clanTag, card, { note, tone, channel, clanName }) {
    const kind = KIND[card.type];
    const delivery = actionDelivery(card);
    if (
      channel &&
      !Object.hasOwn(
        delivery?.parts[0]?.options ?? { clan_chat: true },
        channel,
      )
    )
      throw new ManageError(400, "bad_message");
    if (!kind || (!CHAT_ONLY.has(kind) && !delivery))
      throw new ManageError(400, "no_leader_message");
    const chosen = channel ?? delivery?.channel ?? "clan_chat";
    // Clan chat is lines; an announcement keeps its heading and message
    // (Elixir splits them into lines), and the Inbox is a title and a
    // message.
    const shape =
      CHAT_ONLY.has(kind) ||
      ((kind === "promotion" || kind === "demotion") && chosen === "clan_chat")
        ? "chat"
        : "message";
    // The tone is its own field; an older page sent it as the note.
    let said = note;
    let mood = tone;
    if (
      shape === "chat" &&
      mood == null &&
      typeof said === "string" &&
      Object.hasOwn(CHAT_TONES, said)
    ) {
      mood = said;
      said = null;
    }
    if (mood != null && (shape !== "chat" || !Object.hasOwn(CHAT_TONES, mood)))
      throw new ManageError(400, "bad_draft_tone");
    if (said != null && typeof said !== "string")
      throw new ManageError(400, "bad_message");
    // The words after a removal take a tone, never a note.
    if (kind === "removal" && said?.trim())
      throw new ManageError(400, "bad_draft_tone");
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
      kind === "departure" && card.outcome
        ? {
            classification: card.outcome.classification,
            confirmed_at: card.decided_at,
            observed_left_at: ev.left_at,
            tenure_days: ev.tenure_days,
          }
        : null;
    if (kind === "departure" && !confirmedDeparture(card))
      throw new ManageError(409, "departure_unconfirmed");
    const [policy, pitch] = await Promise.all([
      ledger.currentPolicy(clanTag),
      ledger.currentPitch(clanTag),
    ]);
    const { context, packet } = await told(clanTag, card, kind, {
      policy,
      pitch,
      clanName,
    });
    const plain = plainWords(card, kind, { shape, delivery });
    const request =
      shape === "chat"
        ? clanChatRequest({
            kind,
            context,
            packet,
            plain,
            note: said,
            tone: mood,
            welcome: kind === "welcome" ? ev.welcome : null,
            departure,
          })
        : leaderMessageRequest({
            kind,
            context,
            packet,
            plain,
            note: said,
            destination: chosen,
          });
    return { kind, shape, chosen, plain, departure, request };
  }

  return {
    /**
     * The exact request a draft for this Action would send, with nothing
     * sent, read from a key or written: for the read-only `draft_packet`
     * maintenance lane. A closed Action is built as it would have been
     * drafted; a removal's safety proof needs a person's sign-in, so it
     * is not checked here.
     */
    async request(
      clanTag,
      cardId,
      { note = null, tone = null, channel = null, clanName = null } = {},
    ) {
      const card = await ledger.card(clanTag, cardId);
      if (!card) throw new ManageError(404, "no_action");
      const { kind, shape, chosen, plain, request } = await prepare(
        clanTag,
        card,
        { note, tone, channel, clanName },
      );
      return {
        kind,
        shape,
        channel: chosen,
        status: card.status,
        plain,
        request,
      };
    },

    async leaderMessage(
      clanTag,
      who,
      token,
      cardId,
      {
        note = null,
        tone = null,
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
      if (pending != null && typeof pending !== "string")
        throw new ManageError(400, "bad_message");
      const { kind, shape, chosen, plain, departure, request } = await prepare(
        clanTag,
        card,
        { note, tone, channel, clanName },
      );
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
      const ev = card.evidence ?? {};
      const checks = {
        kind,
        name: card.player_name ?? null,
        plain,
        told: `${request.context}\n${request.prompt}`,
      };
      const draft =
        shape === "chat"
          ? clanChatFromDraft(answer.input, {
              ...checks,
              welcome: kind === "welcome" ? ev.welcome : null,
              departure,
            })
          : leaderMessageFromDraft(answer.input, {
              ...checks,
              awards: ev.awards ?? [],
            });
      const chat = shape === "chat" || chosen === "clan_chat";
      await logAction(clanTag, card.card_id, "drafted", {
        by: person(who),
        text: `Drafted ${chat ? "clan-chat words" : "a Leader Message"} in the clan's voice (${answer.model}).`,
      });
      return {
        ...draft,
        ...(shape === "message" && chosen === "clan_chat"
          ? { lines: chatLines(draft) }
          : {}),
        model: answer.model,
        draft_context_version: version,
      };
    },
  };
}
