import {
  Fresh,
  Icon,
  Link,
  ago,
  stamp,
  useClock,
  noun,
  Tag,
  TagText,
} from "@elixir-mcp/ui";
import {
  CHAT_MAX,
  CHAT_TONES,
  WELCOME_MAX,
  LEADER_MESSAGE,
  chatWarnings,
  actionDelivery,
  chatLines,
  deliveryWords,
} from "@elixir-mcp/clan-engine";
import { useEffect, useRef, useState } from "react";
import { manageApi } from "../api.js";
import { trackEvent } from "../analytics.js";
import { CLAN, clanPath, memberPath } from "../lib/base.js";
import { MemberSheet } from "./MemberSheet.jsx";
import { ReportThis } from "./ReportThis.jsx";
import { RoleChip } from "./RoleChip.jsx";

/**
 * One action (Jamie, 2026-09-25): what Elixir Clan suggests someone in the
 * clan do, assigned to them or open to their role, completed or declined.
 * It is drawn on the action's own page (`/clan/<TAG>/actions/<number>`),
 * with its log open: what raised it, who took it and how, what the record
 * confirmed, and anyone's comments, open or closed. The log is where the
 * people it is for work it out.
 */

const LEADER_TYPES = new Set(["promotion", "demotion", "removal"]);
const ROLE = {
  leader: "Leader",
  coLeader: "Co-leader",
  elder: "Elder",
  member: "Member",
};
export const STATUS = {
  done: ["Completed", "chip--ok"],
  declined: ["Declined", "chip--warn"],
  withdrawn: ["Withdrawn", ""],
};
const KIND = {
  raised: "Suggested",
  completed: "Completed",
  declined: "Declined",
  reopened: "Reopened",
  withdrawn: "Withdrawn",
  outcome_verified: "Confirmed by the record",
  outcome_flagged: "Flagged: no change seen",
  comment: "Comment",
  emailed: "Emailed",
  drafted: "Drafted by the clan's model",
  shared: "Shared with Elixir",
  not_shared: "Not shared with Elixir",
};
/** Each kind of action's mark, as the canvas draws it: what it is in one
 *  glyph, toned by what it asks (a removal is the clan's hardest call). */
const TYPE_ICON = {
  promotion: ["award", "text-accent-bright"],
  demotion: ["award", "text-warn"],
  removal: ["user-round", "text-bad"],
  departure: ["log-out", "text-ink-dim"],
  welcome: ["users", "text-ok"],
  away: ["plane", "text-accent-bright"],
  awards_standings: ["megaphone", "text-accent-bright"],
  awards_announcement: ["megaphone", "text-accent-bright"],
  rules_announcement: ["file-text", "text-accent-bright"],
};

/** An action's mark in its tile; `big` on the action's own page. */
export function TypeIcon({ type, big = false }) {
  const [name, tone] = TYPE_ICON[type] ?? ["inbox", "text-accent-bright"];
  return (
    <span
      className={`grid shrink-0 place-items-center ${big ? "h-9 w-9 rounded-control bg-info-fill" : "h-[30px] w-[30px] rounded-[9px] bg-panel-raised"} ${tone}`}
    >
      <Icon name={name} size={big ? 18 : 15} />
    </span>
  );
}

const KIND_ICON = {
  raised: "bell",
  completed: "circle-check",
  declined: "x",
  reopened: "inbox",
  withdrawn: "circle-dashed",
  outcome_verified: "shield-check",
  outcome_flagged: "shield-question-mark",
  comment: "message-square",
  emailed: "mail",
  drafted: "file-text",
  shared: "external-link",
  not_shared: "shield-x",
};
const CLASSIFIED = {
  member_kicked: "said: kicked",
  member_left: "said: left",
  ignored: "said: ignore",
};

/** A person's word on a decision, kept in the action's log. */
function NoteInput({ value, onChange, placeholder = "note (optional)" }) {
  return (
    <input
      className="input basis-full"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={280}
    />
  );
}

/** Paste-ready in-game copy for clan chat; `event` and `value` name the
 *  copy for the analytics taxonomy. */
export function CopyLine({
  text,
  event = "clan.copy_in_game",
  value,
  label = "Copy for clan chat",
}) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-control border border-line-soft bg-ground-sunken px-2.5 py-2 text-[13px]">
      <span className="flex-auto">
        <TagText>{text}</TagText>
      </span>
      <button
        type="button"
        className="btn btn--sm"
        title={label}
        aria-label={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            trackEvent(event, value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // The line is on screen to select by hand.
          }
        }}
      >
        <Icon name={done ? "check" : "copy"} size={14} />
      </button>
    </div>
  );
}

/** One field of a Clan Leader Message: editable, counted, copyable, and
 *  warned when an edit holds what the game's filter blanks. */
function MessageField({
  label,
  value,
  onChange,
  max,
  rows = 1,
  disabled = false,
  copyKind = "leader_message",
}) {
  const [done, setDone] = useState(false);
  const over = value.length > max;
  const warnings = chatWarnings(value, max).filter(
    (w) => !w.startsWith("longer"),
  );
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <span className="label">{label}</span>
        <span className={`page-head__note ${over ? "text-bad" : ""}`}>
          {value.length}/{max}
        </span>
        <button
          type="button"
          className="btn btn--sm ml-auto"
          aria-label={`Copy the ${label.toLowerCase()}`}
          disabled={disabled || over}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              trackEvent("clan.copy_in_game", copyKind);
              setDone(true);
              setTimeout(() => setDone(false), 1500);
            } catch {
              // The text is on screen to select by hand.
            }
          }}
        >
          <Icon name={done ? "check" : "copy"} size={14} />
        </button>
      </div>
      {rows > 1 ? (
        <textarea
          className="input"
          aria-label={label}
          rows={rows}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input"
          aria-label={label}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {over ? (
        <div className="page-head__note text-warn" role="status">
          Shorten to {max} characters before copying.
        </div>
      ) : null}
      {warnings.length ? (
        <div className="page-head__note text-warn" role="status">
          The game may blank or garble this: {warnings.join("; ")}.
        </div>
      ) : null}
    </div>
  );
}

/** A draft always requires a person's click, with one-click restoration. */
function DraftControls({
  value,
  onChange,
  onDraft,
  onBusy,
  chat = false,
  disabled = false,
}) {
  const [ask, setAsk] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [said, setSaid] = useState("");
  const [previous, setPrevious] = useState(null);
  const draft = async () => {
    setDrafting(true);
    onBusy(true);
    setSaid("");
    try {
      const r = await onDraft(ask.trim() || null);
      if (r.error) return setSaid(r.error);
      setPrevious(value);
      onChange(
        r.lines
          ? { lines: r.lines }
          : r.line !== undefined
            ? r.line
            : { title: r.title, body: r.body },
      );
      setSaid(
        `Drafted by ${r.model}.${r.warnings?.length ? ` Check: ${r.warnings.join("; ")}.` : ""} Edit it, then copy and send.`,
      );
    } catch {
      setSaid(
        "The draft's outcome is unknown. Your words are unchanged. Check the use log in Settings before requesting another draft.",
      );
    } finally {
      setDrafting(false);
      onBusy(false);
    }
  };
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap gap-2">
        {chat ? (
          <select
            className="input flex-[1_1_200px]"
            aria-label="Draft tone"
            value={ask}
            disabled={drafting || disabled}
            onChange={(e) => setAsk(e.target.value)}
          >
            <option value="">The clan's own voice</option>
            {Object.entries(CHAT_TONES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="input flex-[1_1_200px]"
            aria-label="What should it say?"
            placeholder="What should it say? (optional)"
            value={ask}
            maxLength={300}
            disabled={drafting || disabled}
            onChange={(e) => setAsk(e.target.value)}
          />
        )}
        <button
          type="button"
          className="btn btn--sm"
          disabled={drafting || disabled}
          onClick={draft}
        >
          {drafting ? "Drafting…" : "Draft in our voice"}
        </button>
      </div>
      {said ? (
        <span className="page-head__note" role="status">
          {said}
        </span>
      ) : null}
      {previous !== null ? (
        <button
          type="button"
          className="btn--text justify-self-start"
          disabled={drafting || disabled}
          onClick={() => {
            onChange(previous);
            setPrevious(null);
            setSaid("");
          }}
        >
          Put back what I had
        </button>
      ) : null}
    </div>
  );
}

/** Editable chat copy; completion remains a separate human decision. */
function ChatMessage({
  kind,
  value,
  onChange,
  onDraft,
  onBusy,
  disabled = false,
}) {
  const [drafting, setDrafting] = useState(false);
  return (
    <div className="grid gap-2.5 rounded-block border border-line-soft bg-ground-sunken p-4">
      <span className="text-[13.5px] font-semibold">Clan chat</span>
      <div className="page-head__note">
        {kind === "removal"
          ? "Use this only after you decide and make the change in the game. Drafting does not remove anyone."
          : kind === "departure"
            ? "The leader's confirmed classification guides this draft. Review it, then copy and send it in the game."
            : "Make the welcome your own, then copy and send it in the game."}
      </div>
      <MessageField
        label="Chat message"
        value={value}
        onChange={onChange}
        max={kind === "welcome" ? WELCOME_MAX : CHAT_MAX}
        rows={3}
        disabled={drafting || disabled}
        copyKind="clan_chat"
      />
      {onDraft ? (
        <DraftControls
          value={value}
          onChange={onChange}
          onDraft={onDraft}
          onBusy={(pending) => {
            setDrafting(pending);
            onBusy?.(pending);
          }}
          disabled={disabled}
          chat
        />
      ) : null}
    </div>
  );
}

/** A Clan Leader Message ready to send in the game: a title and a message,
 *  each within the game's limit, edited before copying. The card holds
 *  the words (`value`/`onChange`) so completing the action can say what
 *  was sent; on its own it keeps them itself. */
export function LeaderMessageNotice({ count = 1, children }) {
  return (
    <div className="rounded-control border border-line-soft bg-panel-raised p-3 text-[13px] leading-[1.5]">
      <strong>Leader Message availability: check in the game</strong>
      <p className="my-1">
        Reported limit: one Leader Message per day. Elixir cannot see sends
        outside these Actions or determine when the game resets the limit.
        {count > 1
          ? ` ${count} Actions need Leader Messages. Choose which to send first; leave the others open for later.`
          : " If the game will not let you send this one yet, leave the Action open for later."}{" "}
        Ordinary clan chat uses a different channel.
      </p>
      <p className="my-1">
        After sending, check the Inbox text. A delivered message can be masked
        with asterisks and may have used the daily slot. Do not automatically
        resend it. Elixir cannot verify delivery or readability.
      </p>
      {children}
    </div>
  );
}

/** Separate edit buffers survive channel changes and reloads in this tab.
 * They are bound to the acting player and frozen context, never a receipt. */
function useDeliveryDraft(action, clan, who, part = 1) {
  const delivery = actionDelivery(action);
  const options = delivery?.parts.find((m) => m.part === part)?.options;
  const prefix = `clan-delivery:${clan.clan_tag}:${action.card_id}:${who?.player_tag ?? ""}:`;
  const key = `${prefix}${action.draft_context_version ?? action.raised_at}:${part}`;
  const [draft, setDraft] = useState(() => {
    const initial = options
      ? { channel: delivery.channel, options: structuredClone(options) }
      : null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      if (
        saved &&
        options &&
        Object.hasOwn(options, saved.channel) &&
        Object.keys(options).every((channel) =>
          Object.hasOwn(saved.options ?? {}, channel),
        ) &&
        Array.isArray(saved.options.clan_chat?.lines) &&
        saved.options.clan_chat.lines.every(
          (line) => typeof line === "string",
        ) &&
        (!options.leader_message ||
          (typeof saved.options.leader_message?.title === "string" &&
            typeof saved.options.leader_message?.body === "string"))
      )
        return saved;
    } catch {
      /* Storage is optional; the on-screen editor still works. */
    }
    return initial;
  });
  useEffect(() => {
    if (
      action.status !== "proposed" ||
      action.messages_sent?.some((r) => r.part === part)
    ) {
      try {
        for (const savedKey of Object.keys(sessionStorage))
          if (savedKey.startsWith(prefix) && savedKey.endsWith(`:${part}`))
            sessionStorage.removeItem(savedKey);
      } catch {
        /* Storage is optional. */
      }
    }
  }, [prefix, action.status, action.messages_sent, part]);
  const change = (value) => {
    setDraft(value);
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Storage is optional. */
    }
  };
  const words = draft
    ? { channel: draft.channel, ...draft.options[draft.channel] }
    : null;
  let valid = true;
  if (words) {
    try {
      deliveryWords(action, words, part);
    } catch {
      valid = false;
    }
  }
  return { draft, change, words, valid };
}

function DeliveryComposer({
  draft,
  onChange,
  onDraft = null,
  onBusy = null,
  disabled = false,
  part = null,
}) {
  const channel = draft.channel;
  const words = draft.options[channel];
  const edit = (value) =>
    onChange({ ...draft, options: { ...draft.options, [channel]: value } });
  return (
    <div className="grid gap-3">
      {Object.keys(draft.options).length > 1 ? (
        <label className="grid gap-1">
          <span className="field-label">Delivery channel</span>
          <select
            className="input w-full"
            aria-label={
              part ? `Delivery channel for message ${part}` : "Delivery channel"
            }
            disabled={disabled}
            value={channel}
            onChange={(e) => onChange({ ...draft, channel: e.target.value })}
          >
            <option value="clan_chat">Clan chat</option>
            {draft.options.leader_message ? (
              <option value="leader_message">
                Durable Leader Message · Inbox
              </option>
            ) : null}
          </select>
          <span className="page-head__note">
            Chat reaches the clan conversation. Inbox is separate and useful for
            important messages members may want to keep.
          </span>
        </label>
      ) : null}
      {channel === "leader_message" ? (
        <>
          <LeaderMessageNotice />
          <LeaderMessage
            message={words}
            value={words}
            onChange={edit}
            onDraft={onDraft}
            onBusy={onBusy}
            disabled={disabled}
          />
        </>
      ) : (
        <div className="grid gap-2.5 rounded-block border border-line-soft bg-ground-sunken p-4">
          <strong className="text-[13.5px]">Clan chat</strong>
          <p className="page-head__note m-0">
            Send in the clan&rsquo;s chat, where members normally talk. Each
            field below is a separate send. Check the text after sending; the
            game may mask it. Copying does not send or complete this Action.
          </p>
          {words.lines.map((line, i) => (
            <MessageField
              key={i}
              label={
                words.lines.length > 1
                  ? `Chat message ${i + 1}`
                  : "Chat message"
              }
              value={line}
              max={CHAT_MAX}
              rows={3}
              copyKind="clan_chat"
              disabled={disabled}
              onChange={(value) =>
                edit({
                  lines: words.lines.map((old, n) => (n === i ? value : old)),
                })
              }
            />
          ))}
          {onDraft ? (
            <DraftControls
              value={words}
              onDraft={onDraft}
              onBusy={onBusy}
              disabled={disabled}
              onChange={(value) =>
                edit(
                  value?.lines
                    ? value
                    : {
                        lines:
                          typeof value === "string"
                            ? [value]
                            : chatLines(value),
                      },
                )
              }
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function SentWords({ receipt }) {
  return (
    <div className="grid gap-1 text-[13.5px]">
      <strong>
        {receipt.channel === "clan_chat"
          ? "Sent in clan chat"
          : "Sent as a Leader Message"}
      </strong>
      {receipt.word_source === "suggested" ? (
        <span className="page-head__note">
          Suggested words; the original decision did not supply edited text.
        </span>
      ) : null}
      {receipt.channel === "clan_chat" ? (
        receipt.lines.map((line, i) => (
          <p className="m-0 whitespace-pre-wrap break-words" key={i}>
            {line}
          </p>
        ))
      ) : (
        <>
          <strong>{receipt.title}</strong>
          <p className="m-0 whitespace-pre-wrap break-words">{receipt.body}</p>
        </>
      )}
    </div>
  );
}

function LeaderMessage({
  message,
  value = null,
  onChange = null,
  onDraft = null,
  onBusy = null,
  disabled = false,
}) {
  const [own, setOwn] = useState({
    title: message?.title ?? "",
    body: message?.body ?? "",
  });
  const words = value ?? own;
  const change = onChange ?? setOwn;
  const [drafting, setDrafting] = useState(false);
  const title = words.title;
  const body = words.body;
  const setTitle = (t) => change({ ...words, title: t });
  const setBody = (b) => change({ ...words, body: b });
  const filtered = (v, max) =>
    chatWarnings(v, max).filter((w) => !w.startsWith("longer")).length > 0;
  const clean =
    !filtered(title, LEADER_MESSAGE.title) &&
    !filtered(body, LEADER_MESSAGE.body);
  return (
    <div className="grid gap-2.5 rounded-block border border-line-soft bg-ground-sunken p-4">
      <div className="flex items-center gap-2.5">
        <span className="text-accent-bright">
          <Icon name="megaphone" size={15} />
        </span>
        <span className="grow text-[13.5px] font-semibold">
          Clan Leader Message
        </span>
      </div>
      <div className="page-head__note">
        In the game, Clan → the leader message button; only leaders and
        co-leaders can send one. It appears in members&rsquo; Inbox, separate
        from clan chat.
      </div>
      <MessageField
        label="Title"
        value={title}
        onChange={setTitle}
        max={LEADER_MESSAGE.title}
        disabled={drafting || disabled}
      />
      <MessageField
        label="Message"
        value={body}
        onChange={setBody}
        max={LEADER_MESSAGE.body}
        rows={3}
        disabled={drafting || disabled}
      />
      {clean ? (
        <span className="page-head__note">
          No known text warnings. This does not guarantee the game will display
          it unchanged.
        </span>
      ) : null}
      {onDraft ? (
        <DraftControls
          value={words}
          onChange={change}
          onDraft={onDraft}
          onBusy={(pending) => {
            setDrafting(pending);
            onBusy?.(pending);
          }}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}

/** What a draft refusal means, in a leader's words. */
const DRAFT_ERROR = {
  removal_evidence_held:
    "Current evidence does not establish inactivity. Removal words are withheld; reload the action.",
  draft_changed:
    "The action's context changed. Reload it before drafting or sending these words.",
  departure_unconfirmed:
    "Confirm Kicked or Left before drafting a departure message.",
  no_model_key: "The clan has no model key yet (Manage ▸ Settings).",
  model_key_refused:
    "Anthropic stopped accepting the clan's key. Add it again in Settings.",
  model_key_unreadable: "The clan's key needs to be added again in Settings.",
  model_unavailable:
    "The chosen model is no longer available to this key. Pick another in Settings.",
  model_daily_limit:
    "The clan's model has drafted as many times as it may today. Try again tomorrow.",
  model_spend_cap:
    "The clan's model has reached this month's spend cap. A leader can raise it in Settings.",
  model_key_owner_left:
    "The clan's key was added by someone who no longer leads the clan. Add a key of yours in Settings.",
};

/** Who wrote a log entry. */
function By({ by }) {
  if (!by || by.system) return <span>Elixir Clan</span>;
  return (
    <span>
      {by.name ?? <Tag tag={by.tag} />}
      {by.role ? ` (${by.role})` : ""}
    </span>
  );
}

/** An action's log, oldest first, and a place to add to it. */
export function ActionLog({ action, clan, onChanged }) {
  const { zone: accountZone } = useClock();
  const zone = accountZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    const r = await manageApi.commentAction(
      clan.clan_tag,
      action.card_id,
      text.trim(),
    );
    setBusy(false);
    if (!r.ok) return setError("That did not save.");
    trackEvent("clan.action_commented", action.type);
    setText("");
    onChanged?.();
  };
  return (
    <div className="grid gap-2">
      <ol className="m-0 grid list-none p-0">
        {(action.log ?? []).map((e, i) => (
          <li
            key={e.entry_id ?? `${e.kind}-${i}`}
            className="grid gap-1 border-b border-line-row py-2 text-[13.5px] last:border-b-0"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-accent-bright">
                <Icon name={KIND_ICON[e.kind] ?? "circle-dashed"} size={14} />
              </span>
              <span className="text-[13px] font-semibold text-ink">
                {KIND[e.kind] ?? e.kind}
              </span>
              <span className="grow text-[13px] text-ink-dim">
                by <By by={e.by} />
                {e.detail?.reconstructed
                  ? " (from the action's own record)"
                  : ""}
              </span>
              <span className="mono text-[12px] text-ink-faint">
                <time dateTime={e.at}>{stamp(e.at, zone, { year: true })}</time>
              </span>
            </div>
            {e.text ? <div className="text-ink-body">{e.text}</div> : null}
            {e.detail?.reason ? (
              <div className="page-head__note">
                reason: {e.detail.reason.replaceAll("_", " ")}
              </div>
            ) : null}
            {e.detail?.classification ? (
              <div className="page-head__note">
                {CLASSIFIED[e.detail.classification] ?? e.detail.classification}
              </div>
            ) : null}
            {e.kind === "raised" && e.detail?.facts?.length ? (
              <ul className="m-0 pl-[18px] text-ink-body">
                {e.detail.facts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            ) : null}
            {e.kind === "raised" && e.detail?.clauses?.length ? (
              <div className="page-head__note">
                policy v{e.detail.policy_version ?? "?"}:{" "}
                {e.detail.clauses.join(", ")}
              </div>
            ) : null}
            {e.kind === "raised" && e.detail?.prior?.length ? (
              <div className="page-head__note">
                Earlier:{" "}
                {e.detail.prior
                  .map(
                    (p) =>
                      `${STATUS[p.status]?.[0]?.toLowerCase() ?? p.status} ${(p.closed_at ?? p.raised_at).slice(0, 10)}${p.reason ? ` (${p.reason.replaceAll("_", " ")})` : ""}`,
                  )
                  .join("; ")}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {clan.verified === false ? (
        <div className="page-head__note">
          Verify your player in Elixir to comment.
        </div>
      ) : (
        <form className="flex flex-wrap gap-2" onSubmit={add}>
          <input
            className="input flex-[1_1_240px]"
            placeholder="Add a comment to this action's log"
            aria-label="Comment"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" className="btn btn--sm" disabled={busy}>
            Add
          </button>
        </form>
      )}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

/** One action, open or closed, with its buttons and its log. */
export function ActionCard(props) {
  const a = props.action;
  const version =
    a.draft_context_version ??
    `${a.card_id}:${a.status}:${a.outcome?.classification}:${a.decided_at}`;
  return (
    <BoundActionCard
      key={`${props.clan.clan_tag}:${props.who?.player_tag}:${version}:${a.removal_safety?.status}:${a.removal_safety?.evidence_version}`}
      {...props}
    />
  );
}

function BoundActionCard({
  action,
  clan,
  who,
  reasons,
  onChanged,
  navigate,
  model = null,
}) {
  const { zone: accountZone } = useClock();
  const zone = accountZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [reason, setReason] = useState("not_now");
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [deciding, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [contextInvalid, setContextInvalid] = useState(false);
  const busy = deciding || drafting || contextInvalid;
  const reopenRequest = useRef(null);
  const reopenPending = useRef(false);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState(false);
  const open = action.status === "proposed";
  const removalHeld =
    action.type === "removal" && action.removal_safety?.status === "held";
  const departureCopy =
    action.type === "departure" && action.status === "done" && !!action.copy;
  const mine = action.audience?.kind === "member";
  const ev = action.evidence ?? {};
  const delivery = useDeliveryDraft(action, clan, who);
  // The words as the person edits them, sent with a completion so what
  // the clan shares with Elixir is what was said in the game.
  const [line, setLine] = useState(action.copy ?? "");
  const grouped = ev.messages?.length > 0;
  const allSent =
    grouped &&
    ev.messages.every((m) =>
      action.messages_sent?.some((r) => r.part === m.part),
    );
  const onDraft =
    !contextInvalid &&
    !removalHeld &&
    action.type !== "awards_standings" &&
    model?.set &&
    !model.refused &&
    (action.can_act !== false || (departureCopy && action.can_draft)) &&
    ["leader", "coLeader"].includes(who?.role)
      ? async (note) => {
          const r = await manageApi.draftLeaderMessage(
            clan.clan_tag,
            action.card_id,
            note,
            action.draft_context_version ?? null,
            ...(delivery.words ? [delivery.words.channel] : []),
          );
          if (!r.ok) {
            if (
              ["draft_changed", "removal_evidence_held"].includes(r.data?.error)
            ) {
              setContextInvalid(true);
              onChanged?.();
            }
            return {
              error:
                DRAFT_ERROR[r.data?.error] ??
                r.data?.message ??
                "The model did not answer. Your words are unchanged; check Settings before requesting another draft.",
            };
          }
          trackEvent(
            "clan.model_drafted",
            action.copy ? "clan_chat" : "leader_message",
          );
          return r.data;
        }
      : null;
  const decide = async (status, extra = {}) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await manageApi.decideAction(clan.clan_tag, action.card_id, {
        status,
        reason:
          status === "declined" && LEADER_TYPES.has(action.type)
            ? reason
            : null,
        note: note || null,
        ...(status === "done" && delivery.words && !grouped
          ? { sent: delivery.words }
          : status === "done" && action.copy && action.type === "welcome"
            ? { sent: { line } }
            : {}),
        ...extra,
      });
      if (!r.ok) {
        onChanged?.();
        if (r.data?.error === "removal_evidence_held") {
          setContextInvalid(true);
          onChanged?.();
          return setError(
            "Current evidence does not establish inactivity. Removal words and completion are withheld; reload the action.",
          );
        }
        return setError(
          r.data?.error === "action_closed"
            ? "This action was already taken or withdrawn."
            : "That did not work.",
        );
      }
      trackEvent(
        "clan.action_decided",
        `${action.type}:${extra.classification ?? status}`,
      );
      onChanged?.();
    } catch {
      onChanged?.();
      setError(
        "The action's outcome is unknown. Your words are unchanged. Reload the action to check its log before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    if (reopenPending.current) return;
    reopenPending.current = true;
    reopenRequest.current ??= crypto.randomUUID();
    setBusy(true);
    setError("");
    try {
      const r = await manageApi.reopenAction(clan.clan_tag, action.card_id, {
        request_id: reopenRequest.current,
        expected_decided_at: action.decided_at ?? null,
      });
      if (!r.ok) {
        if (
          [
            "action_changed",
            "action_not_declined",
            "action_already_delivered",
            "removal_evidence_held",
          ].includes(r.data?.error)
        )
          onChanged?.();
        if (r.data?.error === "removal_evidence_held") setContextInvalid(true);
        return setError(
          r.data?.error === "leaders_only" || r.data?.error === "unverified"
            ? "Only verified clan leadership can reopen a declined action."
            : r.status === 409
              ? "This action changed. Reload it before trying again."
              : "Reopening was not confirmed. Try again to check the same request.",
        );
      }
      reopenRequest.current = null;
      onChanged?.();
    } catch {
      setError(
        "Reopening was not confirmed. Try again to check the same request.",
      );
    } finally {
      reopenPending.current = false;
      setBusy(false);
    }
  };
  const id = `action-${action.card_id}`;
  return (
    <article
      className="panel max-w-[880px] overflow-hidden"
      data-action={action.card_id}
      aria-labelledby={id}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-5 py-4">
        <TypeIcon type={action.type} big />
        <div className="grid min-w-0 grow gap-0.5">
          <h2 id={id} className="m-0 text-[17px] font-semibold">
            {action.label}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-dim">
            {mine ? (
              <span>
                <span className="yours">★</span> You
              </span>
            ) : !action.player_tag ? (
              <span>The clan</span>
            ) : (
              <>
                <b className="text-ink">
                  {action.player_name ?? <Tag tag={action.player_tag} />}
                </b>
                <span className="tag">{action.player_tag}</span>
                {action.role_at_raise ? (
                  <RoleChip
                    role={action.role_at_raise}
                    label={ROLE[action.role_at_raise] ?? action.role_at_raise}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
        {open ? (
          ev.as_of ? (
            <Fresh label="evidence as of" ts={ev.as_of} />
          ) : (
            <span className="chip chip--warn">
              suggested {ago(action.raised_at)}
            </span>
          )
        ) : (
          <span className={`chip ${STATUS[action.status]?.[1] ?? ""}`.trim()}>
            {STATUS[action.status]?.[0] ?? action.status}
          </span>
        )}
      </div>
      <div className="grid gap-4 px-5 py-[18px]">
        <div className="flex flex-wrap items-center gap-3">
          {action.player_tag ? (
            <Link to={memberPath(clan.clan_tag, action.player_tag)}>
              View member activity
            </Link>
          ) : null}
          {/* The action on screen rides along, so the maintainer reads
              the evidence the person saw (2026-10-08). */}
          <span className="ml-auto">
            <ReportThis
              about={`This action: ${action.label}${action.player_tag ? `, ${action.player_name ?? action.player_tag}` : ""}. Its evidence and the policy behind it ride along.`}
              refs={[
                { kind: "clan_action", ref: String(action.card_id) },
                { kind: "clan", ref: clan.clan_tag },
                ...(action.player_tag
                  ? [{ kind: "player", ref: action.player_tag }]
                  : []),
              ]}
              context={{ action_type: action.type, status: action.status }}
            />
          </span>
        </div>
        {removalHeld ? (
          <div className="callout callout--warn flex-col gap-2" role="alert">
            <strong>Removal held: inactivity is not established.</strong>
            <p className="m-0">{action.removal_safety.reason}</p>
            {action.removal_safety.latest_activity_interval ? (
              <p className="m-0">
                The profile counter increased by{" "}
                {
                  action.removal_safety.latest_activity_interval
                    .counter_increase
                }{" "}
                between{" "}
                <time
                  dateTime={
                    action.removal_safety.latest_activity_interval.observed_from
                  }
                >
                  {stamp(
                    action.removal_safety.latest_activity_interval
                      .observed_from,
                    zone,
                    { year: true },
                  )}
                </time>{" "}
                and{" "}
                <time
                  dateTime={
                    action.removal_safety.latest_activity_interval.observed_to
                  }
                >
                  {stamp(
                    action.removal_safety.latest_activity_interval.observed_to,
                    zone,
                    { year: true },
                  )}
                </time>
                .
                {action.removal_safety.latest_activity_interval
                  .no_battles_captured
                  ? " No battles from that interval were captured."
                  : ""}{" "}
                The exact battle time and mode are unknown.
              </p>
            ) : null}
            <p className="m-0">
              Checked{" "}
              <time dateTime={action.removal_safety.checked_at}>
                {stamp(action.removal_safety.checked_at, zone, { year: true })}
              </time>
              . Removal copy, drafting and completion are withheld. The saved
              evidence and log below are historical.
              {open && action.can_act
                ? " Leadership may still explicitly decline this open Action."
                : " This Action is closed; its decisions and audit remain recorded."}
            </p>
          </div>
        ) : null}
        <div className="text-[14.5px] leading-[1.6] text-ink-body">
          {action.type === "departure" ? (
            <div>
              Departure observed {ago(ev.left_at)} ({ev.left_at?.slice(0, 10)})
              {ev.removal_state && ev.removal_state !== "none"
                ? ` · was ${ev.removal_state.replaceAll("_", " ")} on the clock`
                : ""}
              {ev.days_idle != null
                ? ` · ${Math.round(ev.days_idle)} ${noun(Math.round(ev.days_idle), "day")} since their last battle`
                : ""}
              {ev.tenure_days != null
                ? ` · recorded tenure ${ev.tenure_days} ${noun(ev.tenure_days, "day")}`
                : ""}
              {departureCopy
                ? `. A leader confirmed ${action.outcome?.classification === "member_kicked" ? "Kicked" : "Left"}.`
                : action.outcome?.classification === "ignored"
                  ? ". A leader marked this departure Ignore."
                  : ". A leave and a kick look the same in the roster observation; confirm which so the clan's history knows."}
            </div>
          ) : action.type === "welcome" ? (
            <div>
              Joined {ago(ev.joined_at)}. Welcome them in clan chat, then mark
              it done.
            </div>
          ) : action.type === "away" ? (
            <div>
              The recorded activity clock is {Math.floor(ev.days_idle ?? 0)}{" "}
              days. This does not establish no play across every battle mode.
              Going to be away? Mark it to shield removal eligibility while
              active
              {ev.away_max_days
                ? ` (up to ${ev.away_max_days} ${noun(ev.away_max_days, "day")})`
                : ""}
              .
            </div>
          ) : action.type === "awards_announcement" ? (
            <div>
              Season {ev.season_id} is closed and its awards are granted. Tell
              the clan in chat or choose a durable Inbox message, then mark it
              sent. This message covers the recipients listed below. An award
              granted later can have its own announcement.
              {ev.parts > 1
                ? ` Message ${ev.part} of ${ev.parts}; send every part to name all recipients.`
                : ""}
            </div>
          ) : action.type === "awards_standings" ? (
            <div>
              {ev.scope === "current"
                ? `Current provisional season ${ev.season_id} standings.`
                : `War week ${ev.section_index + 1} of season ${ev.season_id} is recorded as closed. Share provisional standings through that week.`}
              {ev.as_of ? ` As of ${ev.as_of}.` : ""} These are not final
              grants; incomplete evidence withholds places.
              {grouped
                ? " Send each message in order and mark each one sent. Copying alone does not record delivery."
                : ev.parts > 1
                  ? ` Message ${ev.part} of ${ev.parts}; send every part.`
                  : ""}
            </div>
          ) : action.type === "rules_announcement" ? (
            <div>
              {ev.changes?.length
                ? `Policy version ${ev.version} changed: ${ev.changes.join(", ")}.`
                : `Policy version ${ev.version}: the clan's first.`}{" "}
              Tell the clan in chat or choose a durable Inbox message, then mark
              it sent.
            </div>
          ) : (
            <div>
              {action.type === "removal"
                ? "Saved rationale at the time this Action was raised: "
                : ""}
              {ev.rationale?.headline}
            </div>
          )}
        </div>
        {open && (action.type === "promotion" || action.type === "demotion") ? (
          <div className="rounded-control bg-panel-raised px-3.5 py-2.5 text-[13.5px] leading-[1.5] text-ink-body">
            <b className="text-ink">In the game:</b>{" "}
            {action.type === "promotion" ? "promote" : "demote"}{" "}
            {action.player_name ?? <Tag tag={action.player_tag} />}, send the
            reviewed message, then mark it complete. They go together.
          </div>
        ) : null}
        {LEADER_TYPES.has(action.type) && ev.facts?.length ? (
          <div className="grid">
            {ev.facts.map((f) => (
              <div
                key={f.key}
                className="flex flex-wrap gap-x-4 gap-y-0.5 border-b border-line-row py-2 last:border-b-0"
              >
                <span className="w-[110px] shrink-0 text-[12.5px] text-ink-faint">
                  {f.label}
                </span>
                <span className="grow text-[13.5px] text-ink-body">
                  {f.value}{" "}
                  <span className="page-head__note">
                    ({f.window}
                    {f.fidelity !== "daily" ? `, ${f.fidelity}` : ""})
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {contextInvalid ? (
          <div className="callout callout--warn" role="alert">
            The action&rsquo;s context changed. Older words are withheld. Reload
            the action before drafting or sending.
            <button type="button" className="btn btn--sm" onClick={onChanged}>
              Reload action
            </button>
          </div>
        ) : null}
        {!contextInvalid &&
        !removalHeld &&
        action.copy &&
        !delivery.draft &&
        (open || departureCopy) ? (
          (["welcome", "removal"].includes(action.type) &&
            action.can_act !== false) ||
          (departureCopy && action.can_draft) ? (
            <ChatMessage
              kind={action.type}
              value={line}
              onChange={setLine}
              onDraft={onDraft}
              onBusy={setDrafting}
              disabled={deciding}
            />
          ) : (
            <CopyLine text={action.copy} />
          )
        ) : null}
        {open && delivery.draft ? (
          <>
            <a
              className="btn w-fit"
              href={`${clanPath(clan.clan_tag)}/actions`}
              onClick={(e) => {
                if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                navigate(`${clanPath(clan.clan_tag)}/actions`);
              }}
            >
              Review later · leave open
            </a>
            {grouped && ev.messages.length > 1 ? (
              <p className="page-head__note m-0">
                Each part has its own delivery choice. If using the Inbox, wait
                until the game allows another Leader Message. Sent receipts stay
                saved while you wait.
              </p>
            ) : null}
          </>
        ) : null}
        {grouped ? (
          <div className="grid gap-4">
            {ev.messages.map((m) => (
              <UpdateMessage
                key={`${action.card_id}-${m.part}`}
                message={m}
                who={who}
                action={action}
                clan={clan}
                onChanged={onChanged}
              />
            ))}
          </div>
        ) : !contextInvalid && delivery.draft && open ? (
          <DeliveryComposer
            draft={delivery.draft}
            onChange={delivery.change}
            onDraft={onDraft}
            onBusy={setDrafting}
            disabled={busy || action.can_act === false}
          />
        ) : null}
        {!open && action.sent ? <SentWords receipt={action.sent} /> : null}
        {!open ? (
          <div className="page-head__note">
            {action.status === "withdrawn"
              ? `${action.withdraw_reason ?? "Withdrawn"} · ${action.withdrawn_at?.slice(0, 10) ?? ""}`
              : `${action.decided_by_name ?? action.decided_by ?? ""} · ${action.decided_at?.slice(0, 10) ?? ""}`}
            {action.outcome?.verified_at
              ? action.type === "departure"
                ? " · confirmed by a leader"
                : " · confirmed by the record"
              : ""}
            {action.outcome?.flagged_at ? " · no change seen" : ""}
          </div>
        ) : null}

        <div className="grid gap-1">
          <div className="label">
            Log · {(action.log ?? []).length}{" "}
            {(action.log ?? []).length === 1 ? "entry" : "entries"}
          </div>
          <ActionLog action={action} clan={clan} onChanged={onChanged} />
        </div>
      </div>
      {(open && action.can_act) || action.can_reopen || sheet || error ? (
        <div className="grid gap-3 border-t border-line-soft bg-ground-chrome px-5 py-3.5">
          {action.can_reopen && !removalHeld ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={reopen}
              >
                {busy ? "Reopening…" : "Reopen action"}
              </button>
              <span className="page-head__note">
                Return it to Open. The decline and any sent parts stay in its
                log.
              </span>
            </div>
          ) : null}
          {open && action.can_act ? (
            action.type === "departure" ? (
              <div className="flex flex-wrap gap-2">
                <NoteInput
                  value={note}
                  onChange={setNote}
                  placeholder="why, for the log (optional)"
                />
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={busy}
                  onClick={() => decide("done", { classification: "kick" })}
                >
                  Kicked
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => decide("done", { classification: "leave" })}
                >
                  Left
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={busy}
                  onClick={() => decide("done", { classification: "ignore" })}
                >
                  Ignore
                </button>
              </div>
            ) : action.type === "away" ? (
              <div className="flex flex-wrap gap-2">
                <a
                  className="btn btn--primary"
                  href={`${CLAN}/you/away`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate?.(`${CLAN}/you/away`);
                  }}
                >
                  Mark me away
                </a>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => decide("declined")}
                >
                  I&rsquo;m not away
                </button>
              </div>
            ) : action.type === "awards_standings" ||
              action.type === "awards_announcement" ||
              action.type === "rules_announcement" ? (
              <div className="flex flex-wrap gap-2">
                <NoteInput value={note} onChange={setNote} />
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || (grouped ? !allSent : !delivery.valid)}
                  onClick={() => decide("done")}
                >
                  {grouped ? "Complete update" : "Sent"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => decide("declined")}
                >
                  {grouped ? "Skip remaining messages" : "Skip"}
                </button>
              </div>
            ) : action.type === "welcome" ? (
              <div className="flex flex-wrap gap-2">
                <NoteInput value={note} onChange={setNote} />
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => decide("done")}
                >
                  Welcomed
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => decide("declined")}
                >
                  Skip
                </button>
              </div>
            ) : !declining ? (
              <div className="flex flex-wrap gap-2">
                <NoteInput value={note} onChange={setNote} />
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={
                    busy ||
                    action.can_complete === false ||
                    removalHeld ||
                    !delivery.valid
                  }
                  onClick={() => decide("done")}
                >
                  Complete
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setDeclining(true)}
                >
                  Decline
                  <Icon name="chevron-down" size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => setSheet((v) => !v)}
                >
                  Notes & hold
                </button>
              </div>
            ) : (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  decide("declined");
                }}
              >
                <select
                  className="select"
                  aria-label="Why decline"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                >
                  {(reasons ?? []).map((r) => (
                    <option key={r} value={r}>
                      {r.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <NoteInput value={note} onChange={setNote} />
                <button
                  type="submit"
                  className="btn btn--danger"
                  disabled={busy}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={() => setDeclining(false)}
                >
                  Back
                </button>
              </form>
            )
          ) : null}
          {sheet ? (
            <MemberSheet
              clanTag={clan.clan_tag}
              member={{
                player_tag: action.player_tag,
                name: action.player_name,
                role: action.role_at_raise,
                hold: null,
              }}
              role={who.role}
              onChange={onChanged}
            />
          ) : null}
          {error ? (
            <div className="callout callout--warn" role="alert">
              <span>{error}</span>
            </div>
          ) : null}
          {open && action.can_act && LEADER_TYPES.has(action.type) ? (
            <span className="text-[12.5px] text-ink-faint">
              One action, one decision.
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Each delivery is a person's explicit receipt; copying remains independent. */
function UpdateMessage({ message, action, clan, who, onChanged }) {
  const receipt = action.messages_sent?.find((r) => r.part === message.part);
  const delivery = useDeliveryDraft(action, clan, who, message.part);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (receipt) setError("");
  }, [receipt]);
  const record = async (words) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await manageApi.messageSent(
        clan.clan_tag,
        action.card_id,
        message.part,
        words,
      );
      if (!r.ok)
        setError(
          "The receipt is unconfirmed here. Reload to check the saved receipt before trying again. Do not resend the game message.",
        );
      onChanged?.();
    } catch {
      setError(
        "The receipt is unconfirmed here. Reload to check the saved receipt before trying again. Do not resend the game message.",
      );
      onChanged?.();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-2 border-t border-line-row pt-3">
      <div className="label">
        Message {message.part} of {action.evidence.messages.length}
      </div>
      {receipt ? (
        <>
          <p className="page-head__note m-0">
            Sent by {receipt.sent_by_name ?? receipt.sent_by} ·{" "}
            {receipt.sent_at}
          </p>
          <SentWords receipt={receipt} />
          {receipt.shared === false && receipt.sent_by === who?.player_tag ? (
            <>
              <p className="page-head__note m-0">
                The sent receipt is saved. Retry only records it in Elixir; it
                does not resend in the game.
              </p>
              <button
                className="btn btn--sm w-fit"
                type="button"
                disabled={busy}
                onClick={() => record(receipt)}
              >
                Retry recording in Elixir
              </button>
            </>
          ) : null}
        </>
      ) : action.status === "proposed" ? (
        <>
          <DeliveryComposer
            draft={delivery.draft}
            onChange={delivery.change}
            part={message.part}
            disabled={busy || !action.can_act}
          />
          {action.can_act ? (
            <button
              className="btn w-fit"
              type="button"
              disabled={busy || !delivery.valid}
              onClick={() => record(delivery.words)}
            >
              {busy ? "Recording…" : `Mark message ${message.part} sent`}
            </button>
          ) : null}
        </>
      ) : (
        <>
          <strong>{message.message.title}</strong>
          <p className="m-0">{message.message.body}</p>
          <span className="page-head__note">
            Saved suggestion · not marked sent.
          </span>
        </>
      )}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
