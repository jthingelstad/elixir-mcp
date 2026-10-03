/**
 * The action store: raising, withdrawing and shaping actions, and each
 * action's append-only log, shared by the manage and awards services so
 * every action anywhere is raised, logged and read the same way. Ledger
 * and clock are the caller's.
 */

import {
  ACTION_TYPES,
  SYSTEM,
  audienceOf,
  canAct,
  inGameCopy,
  leaderMessage,
  logEntry,
  priorActions,
  reconstructedLog,
} from "@elixir-mcp/clan-engine";

export function createActionStore({ ledger, now = () => Date.now() }) {
  const person = (who) => ({
    tag: who.player_tag,
    name: who.name ?? null,
    role: who.role,
  });

  /** Append one entry to an action's log. */
  const logAction = (
    clanTag,
    card_id,
    kind,
    {
      by = SYSTEM,
      text = null,
      detail = null,
      at = null,
      entry_id = null,
    } = {},
  ) =>
    ledger.appendActionLog(clanTag, {
      card_id,
      ...(entry_id ? { entry_id } : {}),
      ...logEntry(kind, {
        at: at ?? new Date(now()).toISOString(),
        by,
        text,
        detail,
      }),
    });

  /** Raise an action, logging what raised it and the member's earlier
   *  actions of the same kind. */
  async function raiseAction(clanTag, card, cards, { text, detail = {} }) {
    // Older actions get their numbers first, so the count reads in order.
    await numberActions(clanTag, cards);
    const action = {
      ...card,
      number: await ledger.nextActionNumber(clanTag),
      audience: audienceOf(card),
    };
    await ledger.putCard(clanTag, action);
    await logAction(clanTag, action.card_id, "raised", {
      text,
      detail: {
        policy_version: action.policy_version ?? null,
        ...detail,
        prior: priorActions(cards, {
          player_tag: action.player_tag,
          type: action.type,
          before: action.raised_at,
        }),
      },
    });
    return action;
  }

  /** Give every action without a number one, oldest first (the actions
   *  raised before numbers existed, once). */
  async function numberActions(clanTag, cards = null) {
    const list = (cards ?? (await ledger.cards(clanTag)))
      .filter((c) => !Number.isInteger(c.number))
      .sort((a, b) => (a.raised_at < b.raised_at ? -1 : 1));
    for (const c of list) {
      const n = await ledger.nextActionNumber(clanTag);
      if (await ledger.numberCard(clanTag, c.card_id, n)) c.number = n;
      // Another request numbered it first: its number is the one.
      else c.number = (await ledger.card(clanTag, c.card_id))?.number;
    }
  }

  /** Withdraw an open action, saying why. */
  async function withdrawAction(clanTag, card, reason) {
    await ledger.putCard(clanTag, {
      ...card,
      status: "withdrawn",
      withdrawn_at: new Date(now()).toISOString(),
      withdraw_reason: reason,
    });
    await logAction(clanTag, card.card_id, "withdrawn", { text: reason });
  }

  /** An action's log: the stored entries, with what an action raised
   *  before logs were kept reconstructed from its own fields. */
  function logOf(card, stored) {
    const order = (a, b) =>
      a.at < b.at
        ? -1
        : a.at > b.at
          ? 1
          : String(a.seq ?? "").localeCompare(String(b.seq ?? ""));
    const entries = [...(stored ?? [])].sort(order);
    const have = new Set(entries.map((e) => e.kind));
    const base = entries.some((e) => e.kind === "raised")
      ? []
      : reconstructedLog(card).filter((e) => !have.has(e.kind));
    for (const reopening of card.reopenings ?? []) {
      const decline = reopening.decline;
      if (
        decline?.decided_at &&
        !entries.some(
          (e) =>
            e.kind === "declined" &&
            e.at === decline.decided_at &&
            e.by?.tag === decline.decided_by,
        )
      )
        base.push(
          logEntry("declined", {
            at: decline.decided_at,
            by: {
              tag: decline.decided_by,
              name: decline.decided_by_name ?? null,
              role: null,
            },
            text: decline.decision_note ?? null,
            detail: {
              reason: decline.decline_reason ?? null,
              reconstructed: true,
            },
          }),
        );
      if (
        !entries.some(
          (e) =>
            e.kind === "reopened" &&
            e.detail?.request_id === reopening.request_id,
        )
      )
        base.push(
          logEntry("reopened", {
            at: reopening.at,
            by: reopening.by,
            text: "Returned to Open by leadership.",
            detail: {
              request_id: reopening.request_id,
              decline,
              reconstructed: true,
            },
          }),
        );
    }
    return [...base, ...entries].sort(order);
  }

  /** The words an action carries into the game: a clan chat line, or a
   *  Clan Leader Message (title and message) for leaders to send. */
  function wordsFor(c) {
    const channel = ACTION_TYPES[c.type]?.channel ?? null;
    if (channel === "clan_chat")
      return {
        channel,
        copy:
          c.type === "welcome"
            ? inGameCopy("welcome", {
                name: c.player_name,
                welcome: c.evidence?.welcome,
              })
            : inGameCopy(c.type, {
                name: c.player_name,
                days_idle: c.evidence?.days_idle ?? null,
                phrase: c.evidence?.phrase ?? "",
              }),
        message: null,
      };
    if (channel === "leader_message")
      return {
        channel,
        copy: null,
        message:
          c.evidence?.message ??
          leaderMessage(c.type, {
            name: c.player_name,
            phrase: c.evidence?.phrase ?? "",
          }),
        messages: c.evidence?.messages ?? null,
      };
    return { channel: null, copy: null, message: null };
  }

  /** An action as a person reads it, with its words and its log. */
  const shapeAction = (c, stored, who) => ({
    ...c,
    audience: audienceOf(c),
    label: ACTION_TYPES[c.type]?.label ?? c.type,
    ...wordsFor(c),
    // An unverified player sees its own actions and takes none of them.
    can_act:
      c.status === "proposed" &&
      (!who || (canAct(c, who) && who.verified !== false)),
    can_reopen:
      c.status === "declined" &&
      !!who &&
      who.verified !== false &&
      ["leader", "coLeader"].includes(who.role) &&
      canAct(c, who) &&
      !(
        c.evidence?.messages?.length &&
        c.evidence.messages.every((message) =>
          c.messages_sent?.some((receipt) => receipt.part === message.part),
        )
      ),
    log: logOf(c, stored),
  });

  const logsByCard = async (clanTag, cards = null) => {
    const byCard = new Map();
    const entries = cards
      ? await ledger.actionLogsFor(
          clanTag,
          cards.map((c) => c.card_id),
        )
      : await ledger.actionLogs(clanTag);
    for (const e of entries) {
      const list = byCard.get(e.card_id) ?? [];
      list.push(e);
      byCard.set(e.card_id, list);
    }
    return byCard;
  };

  return {
    person,
    logAction,
    raiseAction,
    withdrawAction,
    numberActions,
    logOf,
    shapeAction,
    logsByCard,
  };
}
