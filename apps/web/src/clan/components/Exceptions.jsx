import {
  Chips,
  Panel,
  Row,
  Rows,
  Tag,
  useClock,
  useInitialTime,
} from "@elixir-mcp/ui";
import { useId, useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, useMemberExceptions } from "../lib/queries.js";
import { trackEvent } from "../../analytics.js";

/**
 * Member exceptions (2026-11-23): what a leader sets on one member so the
 * rules leave them alone in one way, until a date. They replace holds.
 * Every one ends; a leader picks who can see it. The server checks each
 * one again (packages/clan-engine/src/exceptions.mjs); these are the
 * page's words for them.
 */
export const KINDS = {
  keep_in_clan: {
    label: "Keep in clan",
    short: "No kick",
    help: "For someone who's away for a while, like a trip or exams.",
    does: (name) => `The rules won't suggest kicking ${name}.`,
  },
  keep_as_elder: {
    label: "Keep as Elder",
    short: "No demotion",
    help: "For an Elder who helps the clan in ways the numbers miss. Doesn't take an earned seat.",
    does: (name) => `The rules won't suggest demoting ${name}.`,
  },
  not_for_elder: {
    label: "Not for Elder",
    short: "No promotion",
    help: "For a second account, or someone who said no thanks.",
    does: (name) => `The rules won't suggest ${name} for Elder.`,
  },
  away: {
    label: "Away",
    short: "No kick",
    help: "Away for a set time, like a member marks themselves. The clan can see it.",
    does: (name) => `The rules won't suggest kicking ${name} while away.`,
  },
};
export const KIND_ORDER = Object.keys(KINDS);

/** The kinds a leader sets from a form, by the member's role now. */
const FITS = {
  keep_in_clan: ["member", "elder"],
  keep_as_elder: ["elder"],
  not_for_elder: ["member"],
  away: ["member", "elder"],
};

const LENGTHS = [
  { key: "1w", days: 7, label: "1 week" },
  { key: "2w", days: 14, label: "2 weeks" },
  { key: "1m", days: 30, label: "1 month" },
  { key: "3m", days: 90, label: "3 months" },
];
const MAX_DAYS = 365;
const DAY = 86400_000;

const ERRORS = {
  bad_until: "Pick a date after today.",
  too_long: "At most a year from today.",
  elders_only: "Keep as Elder is for Elders only.",
  members_only: "Not for Elder is for Members only.",
  leaders_are_automatic: "Leaders are never judged by the rules.",
  bad_note: "Keep the why short.",
  bad_kind: "Pick what the rules should skip.",
  not_on_roster: "They're not in the clan now.",
  no_exception: "That one has already ended.",
  leaders_only: "Only the Leader and Co-Leaders can do this.",
  no_policy: "Save the clan's rules first.",
};

/** "Ends Dec 7 · leaders only" for one exception. */
export function endsLine(e, calendar) {
  return `ends ${calendar(e.until)} · ${e.visibility === "clan" ? "clan can see" : "leaders only"}`;
}

/**
 * One exception event as a line: "Keep as Elder added by Ada", "Away
 * ended by Bea", "Keep in clan ran out". `by` is null for Elixir's own
 * (an end date running out, or 0318 giving a hold with none an end date),
 * and for a member who may not see who set it.
 */
export function eventLine(e) {
  const kind = KINDS[e.kind]?.label ?? e.kind;
  const who = e.by_name ?? e.by ?? null;
  if (e.event === "expired") return `${kind} ran out`;
  if (e.migration)
    return `${kind} given an end date when holds became exceptions`;
  const verb = { added: "added", changed: "changed", ended: "ended" }[e.event];
  return who ? `${kind} ${verb} by ${who}` : `${kind} ${verb}`;
}

/** Small chips for a member's running exceptions, in the kit's order. */
export function ExceptionChips({ exceptions }) {
  const { calendar } = useClock();
  if (!exceptions?.length) return null;
  return [...exceptions]
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .map((e) => (
      <span
        key={e.exception_id ?? e.kind}
        className="chip chip--info ml-1.5"
        title={`${KINDS[e.kind]?.short ?? ""} until ${calendar(e.until)}`}
      >
        {KINDS[e.kind]?.label ?? e.kind}
      </span>
    ));
}

/** What your own exceptions mean for you, one line each. Only ones the
 *  clan can see reach you; leaders-only ones stay theirs. */
export function YourExceptions({ exceptions }) {
  const { calendar } = useClock();
  if (!exceptions?.length) return null;
  const words = {
    away: (d) =>
      `You're marked away until ${d}. The clan can see this. No kick while it lasts. The days keep counting.`,
    keep_in_clan: (d) =>
      `Your leaders keep you in the clan until ${d}. No kick while it lasts. The days keep counting.`,
    keep_as_elder: (d) =>
      `Your leaders keep you as Elder until ${d}. The rules won't suggest moving you down.`,
    not_for_elder: (d) =>
      `Your leaders set Not for Elder until ${d}. The rules won't suggest you for Elder.`,
  };
  return exceptions.map((e) =>
    words[e.kind] ? (
      <div key={e.kind} className="notice">
        {words[e.kind](calendar(e.until))}
      </div>
    ) : null,
  );
}

/**
 * Add or change one exception. `member` is who it is on ({ player_tag,
 * name, role }), or null to pick from `members`. `existing` is the
 * running one being changed: its kind is fixed, and End it ends it.
 * `taken` is the kinds already running on the member, which Add skips;
 * with no fixed member, `running` is every running exception, and Add
 * skips the kinds the picked member already has.
 */
export function ExceptionForm({
  clanTag,
  member = null,
  members = [],
  existing = null,
  taken = [],
  running = [],
  onDone,
  onCancel,
}) {
  const { calendar } = useClock();
  const [today] = useInitialTime();
  const uid = useId();
  const [who, setWho] = useState(member?.player_tag ?? "");
  const target = member ?? members.find((m) => m.player_tag === who) ?? null;
  const busyKinds = [
    ...taken,
    ...running.filter((e) => e.player_tag === who).map((e) => e.kind),
  ];
  const role = target?.role ?? null;
  const open = existing ? [existing.kind] : KIND_ORDER;
  const fits = (k) => !role || FITS[k].includes(role);
  const [kind, setKind] = useState(existing?.kind ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [length, setLength] = useState(existing ? "" : "1m");
  const [date, setDate] = useState(
    existing ? String(existing.until).slice(0, 10) : "",
  );
  const [visibility, setVisibility] = useState(
    existing?.visibility ?? "leaders",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const invalidate = useInvalidate();
  const isAway = kind === "away";
  const preset = LENGTHS.find((l) => l.key === length);
  const ends = preset
    ? new Date(today + preset.days * DAY).toISOString()
    : date
      ? `${date}T23:59:59Z`
      : null;
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const canSave =
    target &&
    kind &&
    fits(kind) &&
    !(busyKinds.includes(kind) && !existing) &&
    ends &&
    !busy;
  const name = target?.name ?? target?.player_tag ?? "them";

  const refresh = (tag) => {
    invalidate(keys.exceptions(clanTag));
    invalidate(keys.memberExceptions(clanTag, tag));
    invalidate(keys.manage(clanTag));
  };
  const save = async () => {
    setBusy(true);
    setError("");
    const r = await manageApi.setException(clanTag, target.player_tag, kind, {
      ...(preset ? { length: preset.key } : { until: ends }),
      visibility: isAway ? "clan" : visibility,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!r.ok) return setError(ERRORS[r.data?.error] ?? "That did not work.");
    trackEvent(
      existing ? "clan.exception_changed" : "clan.exception_set",
      kind,
    );
    refresh(target.player_tag);
    onDone?.();
  };
  const end = async () => {
    setBusy(true);
    setError("");
    const r = await manageApi.endException(clanTag, target.player_tag, kind);
    setBusy(false);
    if (!r.ok) return setError(ERRORS[r.data?.error] ?? "That did not work.");
    trackEvent("clan.exception_ended", kind);
    refresh(target.player_tag);
    onDone?.();
  };

  return (
    <form
      className="grid gap-3"
      aria-label={existing ? "Change exception" : "Add an exception"}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save();
      }}
    >
      {member ? null : (
        <div className="grid gap-1.5">
          <label className="field-label" htmlFor={`${uid}-who`}>
            Who?
          </label>
          <select
            id={`${uid}-who`}
            className="input"
            value={who}
            onChange={(e) => {
              setWho(e.target.value);
              setKind("");
            }}
          >
            <option value="">Pick a member</option>
            {members.map((m) => (
              <option key={m.player_tag} value={m.player_tag}>
                {m.name ?? m.player_tag} (
                {m.role === "elder" ? "Elder" : "Member"})
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid gap-1.5">
        <span className="field-label">
          {existing ? KINDS[kind]?.label : "What should the rules skip?"}
        </span>
        {existing ? (
          <p className="m-0 text-ink-dim">{KINDS[kind]?.does(name)}</p>
        ) : (
          <>
            <Chips
              label="What should the rules skip?"
              value={kind}
              onChange={setKind}
              options={open
                .filter((k) => fits(k) && !busyKinds.includes(k))
                .map((k) => ({
                  key: k,
                  label: `${KINDS[k].label} · ${KINDS[k].short}`,
                }))}
            />
            {role === "member" ? (
              <p className="m-0 page-head__note">
                Keep as Elder is for Elders only.
              </p>
            ) : role === "elder" ? (
              <p className="m-0 page-head__note">
                Not for Elder is for Members only.
              </p>
            ) : null}
          </>
        )}
      </div>
      <div className="grid gap-1.5">
        <label className="field-label" htmlFor={`${uid}-why`}>
          Why? <span className="page-head__note">(optional)</span>
        </label>
        <input
          id={`${uid}-why`}
          className="input"
          maxLength={200}
          placeholder="Exams until Dec 12"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <span className="field-label">How long?</span>
        <Chips
          label="How long?"
          value={length || "date"}
          onChange={(k) => setLength(k === "date" ? "" : k)}
          options={[
            ...LENGTHS.map((l) => ({ key: l.key, label: l.label })),
            { key: "date", label: "Pick a date" },
          ]}
        />
        {!preset ? (
          <input
            className="input w-auto justify-self-start"
            type="date"
            aria-label="Ends on"
            min={ymd(today + DAY)}
            max={ymd(today + (MAX_DAYS - 1) * DAY)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        ) : null}
        <p className="m-0 page-head__note">
          {ends ? `Ends ${calendar(ends)}. ` : ""}Every exception ends. You can
          renew it.
        </p>
      </div>
      <div className="grid gap-1.5">
        <span className="field-label">Who can see it?</span>
        {isAway ? (
          <p className="m-0 page-head__note">
            Away is always one the clan can see.
          </p>
        ) : (
          <Chips
            label="Who can see it?"
            value={visibility}
            onChange={setVisibility}
            options={[
              { key: "leaders", label: "Leaders only" },
              { key: "clan", label: "The whole clan" },
            ]}
          />
        )}
      </div>
      {error ? (
        <p className="field-error m-0" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn--primary" disabled={!canSave}>
          {existing ? "Save change" : "Add exception"}
        </button>
        {existing ? (
          <button type="button" className="btn" disabled={busy} onClick={end}>
            End it
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className="btn btn--quiet" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * One member's exceptions, for a leader: each running one with Change,
 * and Add. Opened from the member's sheet, wherever it is drawn.
 */
export function MemberExceptions({ clanTag, member, onChange }) {
  const { calendar, whenDay } = useClock();
  const { data } = useMemberExceptions(clanTag, member.player_tag);
  const [editing, setEditing] = useState(null); // kind, or "new"
  const running = [...(data?.exceptions ?? [])].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const done = () => {
    setEditing(null);
    onChange?.();
  };
  const name = member.name ?? member.player_tag;
  const automatic = member.role === "leader" || member.role === "coLeader";
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label grow">Exceptions</span>
        {!automatic && editing === null ? (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setEditing("new")}
          >
            Add
          </button>
        ) : null}
      </div>
      {automatic ? (
        <p className="m-0 page__lede">
          Leaders are never judged by the rules. No exception is needed.
        </p>
      ) : data == null ? (
        <p className="m-0 page__lede">Loading…</p>
      ) : running.length === 0 && editing === null ? (
        <p className="m-0 page__lede">
          None. The rules treat {name} like everyone else.
        </p>
      ) : null}
      {running.length ? (
        <Rows>
          {running.map((e) =>
            editing === e.kind ? (
              <div key={e.kind} className="kit-row">
                <ExceptionForm
                  clanTag={clanTag}
                  member={member}
                  existing={e}
                  onDone={done}
                  onCancel={() => setEditing(null)}
                />
              </div>
            ) : (
              <Row
                key={e.kind}
                title={`${KINDS[e.kind]?.label ?? e.kind} · to ${calendar(e.until)}`}
                detail={
                  <>
                    {KINDS[e.kind]?.does(name)}{" "}
                    {e.set_by_name || e.set_by ? (
                      <>
                        Set by {e.set_by_name ?? <Tag tag={e.set_by} />}
                        {e.set_at ? ` on ${whenDay(e.set_at)}` : ""}
                        {e.note ? `: “${e.note.replace(/[.!?]+$/, "")}.”` : "."}
                      </>
                    ) : null}{" "}
                    {e.visibility === "clan"
                      ? "The clan can see this."
                      : "Leaders only can see this."}
                    {e.kind === "keep_as_elder"
                      ? " A kept Elder doesn't take one of the earned seats."
                      : ""}
                  </>
                }
                right={
                  editing === null ? (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setEditing(e.kind)}
                    >
                      Change
                    </button>
                  ) : null
                }
              />
            ),
          )}
        </Rows>
      ) : null}
      {editing === "new" ? (
        <Panel as="div" pad>
          <ExceptionForm
            clanTag={clanTag}
            member={member}
            taken={running.map((e) => e.kind)}
            onDone={done}
            onCancel={() => setEditing(null)}
          />
        </Panel>
      ) : null}
    </div>
  );
}
