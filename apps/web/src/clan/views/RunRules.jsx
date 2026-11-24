import {
  Disclosure,
  SplitBar,
  Stepper,
  Switch,
  noun,
  useClock,
} from "@elixir-mcp/ui";
import { useState } from "react";
import {
  CATEGORY_WORDS,
  MINIMUM_FIELD,
  POSTURE_WORDS,
  PRESETS,
  QUESTIONS,
  applies,
  countedCategories,
  directoryPolicy,
  elderSeats,
  questionOf,
  rulesCheck,
  setWeightShare,
  weightShares,
} from "@elixir-mcp/clan-engine";
import { useExceptions, useRoster } from "../lib/queries.js";
import { PageHead } from "../components/PageHead.jsx";
import { ClanTile } from "./Directory.jsx";
import { CanDo, Preview, VersionRows, presetNote } from "./Policy.jsx";

/**
 * Rules, under Run (2026-11-23): the clan's policy asked as six plain
 * questions (the engine's `QUESTIONS`), phone first. Beside them on a wide
 * screen, above them on a phone: the clan's card as the clan list will show
 * it, drawn from the draft, and the Rules check. A sticky bar says what
 * changed and saves. The draft is Run's (`usePolicyDraft`), so it outlives
 * moving to Waiting and back.
 */

const CATEGORIES = ["war", "ranked", "donations", "trophies"];

/** How a category's weekly goal is counted, in the editor's words. */
const GOAL = {
  war: { unit: "decks", step: 1, hint: "16 a week is every deck." },
  ranked: { unit: "battles", step: 1, hint: "Ranked battles in the game." },
  donations: { unit: "a week", step: 10, hint: "A weekly average." },
  trophies: { unit: "trophies", step: 100, hint: "On the Trophy Road now." },
};

const WAR_PICKS = [
  { value: "participating", title: "We war every week" },
  { value: "not_participating", title: "We don't war" },
  { value: "unknown", title: "Not saying" },
];
const POSTURE_HINTS = {
  relaxed: "Real life first",
  standard: "Play most weeks",
  strict: "Every week counts",
};
const ELDER_PICKS = [
  { value: "manual", title: "We pick by hand", hint: "Leaders choose" },
  {
    value: "categories",
    title: "Our best players",
    hint: "Elixir suggests them",
  },
];
const RULE_PICKS = [
  { value: "any", title: "Any one" },
  { value: "all", title: "All of them" },
];

/** A share of the roster or a score, shown as a whole percent. */
const isShare = (f) => f.type === "number" && f.max <= 1;
const shown = (f, v) => (isShare(f) ? Math.round(Number(v) * 100) : v);

/** What a saved value was, in the field's own words. */
function wasText(f, was) {
  if (f.type === "boolean") return was ? "On" : "Off";
  if (f.type === "enum")
    return f.options.find((o) => o.value === was)?.label ?? String(was);
  return isShare(f) ? `${shown(f, was)}%` : `${was}`;
}

/** The saved value of a field the draft changed, or undefined. */
const wasOf = (e, k) =>
  e.view.set && e.draft[k] !== e.view.current.values[k]
    ? e.view.current.values[k]
    : undefined;

function Was({ e, k }) {
  const was = wasOf(e, k);
  if (was === undefined) return null;
  return (
    <span className="rules-was">Was {wasText(e.view.fields[k], was)}</span>
  );
}

function Question({ n, q, sub, wrong, children }) {
  const id = `rules-${q.key}`;
  return (
    <section
      id={id}
      className="rules-q"
      aria-labelledby={`${id}-title`}
      data-wrong={wrong.length ? "true" : undefined}
    >
      <h3 id={`${id}-title`} className="rules-q__head">
        <span className="rules-q__n" aria-hidden="true">
          {n}
        </span>
        {q.title}
      </h3>
      {sub ? <p className="rules-q__sub">{sub}</p> : null}
      {wrong.map(([k, text]) => (
        <p key={k} className="rules-error" role="alert">
          {text}
        </p>
      ))}
      {children}
    </section>
  );
}

/** A choice of a few, each a big button. */
function Pick({ label, value, options, onChange, disabled }) {
  return (
    <div className="grid gap-2">
      <span className="rules-row__label">{label}</span>
      <div className="rules-pick" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="rules-pick__opt"
            aria-pressed={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            <b>{o.title}</b>
            {o.hint ? <span>{o.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One number, its words on the left and its stepper on the right. */
function Row({ label, hint, children, was }) {
  return (
    <div className="rules-row">
      <span className="rules-row__label">
        {label}
        {hint ? <span>{hint}</span> : null}
      </span>
      {children}
      {was}
    </div>
  );
}

/** A field asked with its engine label: the fine tuning under "More". */
function FieldRow({ e, k }) {
  const f = e.view.fields[k];
  if (f.type === "boolean")
    return (
      <div className="grid gap-1">
        <Switch
          on={Boolean(e.draft[k])}
          onChange={(on) => e.set(k, on)}
          disabled={e.disabled}
          hint={f.why}
        >
          {f.label}
        </Switch>
        <Was e={e} k={k} />
      </div>
    );
  const share = isShare(f);
  return (
    <Row label={f.label} hint={f.why} was={<Was e={e} k={k} />}>
      <Stepper
        label={f.label}
        value={shown(f, e.draft[k])}
        min={share ? Math.round(f.min * 100) : f.min}
        max={share ? Math.round(f.max * 100) : f.max}
        unit={share ? "%" : f.unit}
        disabled={e.disabled}
        onChange={(v) => e.set(k, share ? v / 100 : v)}
      />
    </Row>
  );
}

/** The folded fields of a question that apply under the draft. */
function More({ e, q, title, problems }) {
  const keys = q.more.filter((k) => applies(e.view.fields[k].when, e.draft));
  if (!keys.length) return null;
  return (
    <details
      className="rules-q__more"
      open={keys.some((k) => problems[k]) || undefined}
    >
      <summary>{title}</summary>
      <div>
        {keys.map((k) => (
          <FieldRow key={k} e={e} k={k} />
        ))}
      </div>
    </details>
  );
}

function About({ e }) {
  const { draft, disabled } = e;
  return (
    <>
      <Pick
        label="Clan Wars"
        value={draft.war_intent}
        options={WAR_PICKS}
        disabled={disabled}
        onChange={(v) => e.set("war_intent", v)}
      />
      <Was e={e} k="war_intent" />
      <Pick
        label="How serious?"
        value={draft.posture}
        options={Object.entries(POSTURE_WORDS).map(([value, title]) => ({
          value,
          title,
          hint: POSTURE_HINTS[value],
        }))}
        disabled={disabled}
        onChange={(v) => e.set("posture", v)}
      />
      <Was e={e} k="posture" />
      <Switch
        on={Boolean(draft.goal_together)}
        onChange={(on) => e.set("goal_together", on)}
        disabled={disabled}
        hint="Friendly battles and 2v2"
      >
        We like to play together
      </Switch>
      <Was e={e} k="goal_together" />
    </>
  );
}

function Weekly({ e, problems }) {
  const { draft, view, disabled } = e;
  const counted = countedCategories(draft);
  const weeks = draft.minimums_window_weeks;
  return (
    <>
      {CATEGORIES.map((c) => {
        const on = Boolean(draft[`${c}_enabled`]);
        const k = MINIMUM_FIELD[c];
        const f = view.fields[k];
        return (
          <div key={c} className="rules-measure">
            <Switch
              on={on}
              onChange={(v) => e.flip(c, v)}
              disabled={disabled}
              hint={on ? GOAL[c].hint : null}
            >
              {CATEGORY_WORDS[c]}
            </Switch>
            {on ? (
              <Stepper
                label={`${CATEGORY_WORDS[c]} goal`}
                value={draft[k]}
                min={f.min}
                max={f.max}
                step={GOAL[c].step}
                unit={GOAL[c].unit}
                disabled={disabled}
                onChange={(v) => e.set(k, v)}
              />
            ) : null}
            <Was e={e} k={`${c}_enabled`} />
            {on ? <Was e={e} k={k} /> : null}
          </div>
        );
      })}
      {counted.length > 1 ? (
        <>
          <Pick
            label="A member did their part if they do"
            value={draft.minimums_rule}
            options={RULE_PICKS}
            disabled={disabled}
            onChange={(v) => e.set("minimums_rule", v)}
          />
          <Was e={e} k="minimums_rule" />
        </>
      ) : null}
      {counted.length ? (
        <details
          className="rules-q__more"
          open={problems.minimums_window_weeks ? true : undefined}
        >
          <summary>
            Elixir checks the last {weeks} {noun(weeks, "week")}.
          </summary>
          <div>
            <Row
              label="Weeks Elixir checks"
              hint="Goals are counted over these weeks. Donations are a weekly average."
              was={<Was e={e} k="minimums_window_weeks" />}
            >
              <Stepper
                label="Weeks Elixir checks"
                value={weeks}
                min={view.fields.minimums_window_weeks.min}
                max={view.fields.minimums_window_weeks.max}
                unit={noun(weeks, "week")}
                disabled={disabled}
                onChange={(v) => e.set("minimums_window_weeks", v)}
              />
            </Row>
          </div>
        </details>
      ) : null}
    </>
  );
}

/** Elders by best players with every weight at zero: share them evenly. */
function evenWeights(values) {
  const cats = countedCategories(values);
  if (!cats.length) return {};
  if (cats.some((c) => Number(values[`elder_weight_${c}`]) > 0)) return {};
  const each = Math.floor(100 / cats.length);
  return Object.fromEntries(
    cats.map((c, i) => [
      `elder_weight_${c}`,
      i === 0 ? 100 - each * (cats.length - 1) : each,
    ]),
  );
}

function Elder({ e, roster, problems }) {
  const { draft, view, disabled } = e;
  const ranked = draft.elder_mode === "categories";
  const counted = countedCategories(draft);
  const shares = weightShares(draft);
  const seats = elderSeats(draft, roster);
  const tenure = view.fields.tenure_min_days;
  return (
    <>
      <Pick
        label="Who gets Elder?"
        value={draft.elder_mode}
        options={ELDER_PICKS}
        disabled={disabled}
        onChange={(v) =>
          v === "categories"
            ? e.patch({ elder_mode: v, ...evenWeights(draft) })
            : e.set("elder_mode", v)
        }
      />
      <Was e={e} k="elder_mode" />
      {!ranked ? (
        <p className="rules-q__sub">
          Leaders promote in the game. Elixir suggests nobody for Elder.
        </p>
      ) : null}
      {ranked && !counted.length ? (
        <p className="rules-q__sub">
          Turn on something in question 2 first. Best players are ranked by it.
        </p>
      ) : null}
      {ranked && counted.length ? (
        <>
          <SplitBar
            label="What makes a best player?"
            parts={counted.map((c) => ({
              key: c,
              label: CATEGORY_WORDS[c],
              share: shares[c] ?? 0,
            }))}
          />
          {counted.map((c) => (
            <Row
              key={c}
              label={CATEGORY_WORDS[c]}
              was={<Was e={e} k={`elder_weight_${c}`} />}
            >
              <Stepper
                label={`${CATEGORY_WORDS[c]} share`}
                value={shares[c] ?? 0}
                min={0}
                max={100}
                step={5}
                unit="%"
                disabled={disabled || counted.length === 1}
                onChange={(v) => e.patch(setWeightShare(draft, c, v))}
              />
            </Row>
          ))}
        </>
      ) : null}
      {ranked ? (
        <>
          <Row
            label="Elder seats"
            hint="The most of the clan who can be Elder"
            was={<Was e={e} k="band_ceiling_share" />}
          >
            <Stepper
              label="Elder seats"
              value={Math.round(Number(draft.band_ceiling_share) * 100)}
              min={0}
              max={100}
              unit="%"
              disabled={disabled}
              onChange={(v) => e.set("band_ceiling_share", v / 100)}
            />
          </Row>
          {seats ? (
            <p
              className="rules-seats"
              data-full={seats.full ? "true" : undefined}
            >
              Room for {seats.seats} {noun(seats.seats, "Elder")}. You have{" "}
              {seats.elders},{" "}
              {seats.full
                ? "so the seats are full."
                : `so ${seats.open} ${noun(seats.open, "seat")} ${seats.open === 1 ? "is" : "are"} open.`}
              {seats.kept
                ? ` ${seats.kept} more ${seats.kept === 1 ? "is" : "are"} kept as Elder and ${seats.kept === 1 ? "takes" : "take"} no seat.`
                : null}
            </p>
          ) : null}
          <Row
            label="New members wait"
            hint="Days in the clan before Elder"
            was={<Was e={e} k="tenure_min_days" />}
          >
            <Stepper
              label="New members wait"
              value={draft.tenure_min_days}
              min={tenure.min}
              max={tenure.max}
              unit={noun(draft.tenure_min_days, "day")}
              disabled={disabled}
              onChange={(v) => e.set("tenure_min_days", v)}
            />
          </Row>
        </>
      ) : null}
      <More
        e={e}
        q={QUESTIONS[2]}
        title="More Elder settings"
        problems={problems}
      />
    </>
  );
}

const DAYS = [
  { key: "watch_days", step: "quiet", name: "Quiet", label: "Quiet after" },
  {
    key: "at_risk_days",
    step: "warning",
    name: "Warning",
    label: "Warning after",
  },
  { key: "confirm_days", step: "kick", name: "Kick", label: "Kick after" },
];

function Quiet({ e, problems }) {
  const { draft, view, disabled } = e;
  const on = Boolean(draft.removal_enabled);
  const away = view.fields.away_max_days;
  return (
    <>
      <Switch
        on={on}
        onChange={(v) => e.flip("removal", v)}
        disabled={disabled}
        hint="Elixir never kicks anyone. The Leaders get an Action and decide."
      >
        Suggest kicking quiet members
      </Switch>
      <Was e={e} k="removal_enabled" />
      {on ? (
        <>
          <p className="rules-q__sub">Days with no battle:</p>
          <ol className="rules-days">
            {DAYS.map((d) => (
              <li key={d.key} className="rules-days__step" data-step={d.step}>
                <span className="rules-days__name">{d.name}</span>
                <Stepper
                  label={d.label}
                  value={draft[d.key]}
                  min={view.fields[d.key].min}
                  max={view.fields[d.key].max}
                  unit="days"
                  disabled={disabled}
                  onChange={(v) => e.set(d.key, v)}
                />
                <Was e={e} k={d.key} />
              </li>
            ))}
          </ol>
          <Switch
            on={Boolean(draft.removal_includes_elders)}
            onChange={(v) => e.set("removal_includes_elders", v)}
            disabled={disabled}
          >
            Elders can be kicked too
          </Switch>
          <Was e={e} k="removal_includes_elders" />
          <Row
            label="Members can say they're away for up to"
            hint={
              draft.away_max_days > 0
                ? "Away days don't count as quiet."
                : "At 0, nobody can say they're away."
            }
            was={<Was e={e} k="away_max_days" />}
          >
            <Stepper
              label="Away for up to"
              value={draft.away_max_days}
              min={away.min}
              max={away.max}
              unit="days"
              disabled={disabled}
              onChange={(v) => e.set("away_max_days", v)}
            />
          </Row>
        </>
      ) : null}
      <More
        e={e}
        q={QUESTIONS[3]}
        title="More kick settings"
        problems={problems}
      />
    </>
  );
}

/** Switches asked with words of their own. */
function Switches({ e, rows }) {
  return rows
    .filter(([k]) => applies(e.view.fields[k].when, e.draft))
    .map(([k, words, hint]) => (
      <div key={k} className="grid gap-1">
        <Switch
          on={Boolean(e.draft[k])}
          onChange={(v) => e.set(k, v)}
          disabled={e.disabled}
          hint={hint}
        >
          {words}
        </Switch>
        <Was e={e} k={k} />
      </div>
    ));
}

/** The clan's card in the clan list, drawn from the draft. Only the
 *  public part (`directoryPolicy`) and the game's own record. */
function CardPreview({ clan, roster, draft }) {
  const tile = {
    clan_tag: clan.clan_tag,
    name: roster?.name ?? clan.name ?? null,
    type: roster?.type ?? null,
    description: roster?.description ?? null,
    required_trophies: roster?.required_trophies ?? null,
    members: roster?.member_count ?? null,
    yours: false,
    policy: directoryPolicy(draft),
  };
  return (
    <section className="rules-preview" aria-labelledby="rules-preview-title">
      <h3 id="rules-preview-title" className="label m-0">
        What players see in the clan list
      </h3>
      <ul>
        <ClanTile clan={tile} />
      </ul>
      <p className="rules-q__sub">
        The description is your clan&rsquo;s own, from the game.
      </p>
    </section>
  );
}

const QUESTION_NUMBER = Object.fromEntries(
  QUESTIONS.map((q, i) => [q.key, i + 1]),
);

function Check({ found, e, jump }) {
  const invalid = [
    ...new Set(
      found.filter((f) => f.kind === "invalid").map((f) => f.question),
    ),
  ];
  const notes = found.filter((f) => f.kind !== "invalid");
  return (
    <section className="panel" aria-labelledby="rules-check-title">
      <div className="panel__body grid gap-3">
        <h3 id="rules-check-title" className="kit-panel__title">
          Rules check
        </h3>
        {found.length ? (
          <ul className="rules-check">
            {invalid.map((q) => (
              <li key={q} className="rules-check__item" data-kind="invalid">
                <span>Question {QUESTION_NUMBER[q]} needs a fix.</span>
                <span>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => jump(q)}
                  >
                    Go to question {QUESTION_NUMBER[q]}
                  </button>
                </span>
              </li>
            ))}
            {notes.map((f) => (
              <li key={f.kind + f.key} className="rules-check__item">
                <span>{f.text}</span>
                {f.fix ? (
                  <span>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={e.disabled}
                      onClick={() => e.patch(f.fix.set)}
                    >
                      {f.fix.label}
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rules-check__ok">Nothing to fix. Everything works.</p>
        )}
      </div>
    </section>
  );
}

function Presets({ e }) {
  return (
    <div className="clan-presets">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className="clan-preset"
          aria-pressed={e.filled?.key === p.key}
          disabled={!e.view.can_edit || e.busy || e.conflict}
          onClick={() => e.fill(p)}
        >
          <b>{p.label}</b>
          <span>{presetNote(p)}</span>
        </button>
      ))}
    </div>
  );
}

/** The editor's own words for a field, where they differ from the
 *  field's label, so the save bar's list reads like the questions. */
const SAID = {
  war_intent: "Clan Wars",
  posture: "How serious?",
  goal_together: "We like to play together",
  minimums_rule: "A member did their part if they do",
  minimums_window_weeks: "Weeks Elixir checks",
  elder_mode: "Who gets Elder?",
  band_ceiling_share: "Elder seats",
  tenure_min_days: "New members wait",
  removal_enabled: "Suggest kicking quiet members",
  watch_days: "Quiet after",
  at_risk_days: "Warning after",
  confirm_days: "Kick after",
  removal_includes_elders: "Elders can be kicked too",
  away_max_days: "Away for up to",
  welcome_enabled: "Help us welcome new members",
  departures_enabled: "Ask if someone left or was kicked",
  members_see_standing: "Members see where everyone stands",
  announce_awards_enabled: "Post each season's awards",
  announce_rules_enabled: "Post when the rules change",
  ...Object.fromEntries(
    CATEGORIES.flatMap((c) => [
      [`${c}_enabled`, CATEGORY_WORDS[c]],
      [MINIMUM_FIELD[c], `${CATEGORY_WORDS[c]} goal`],
    ]),
  ),
};

const WEIGHT = /^elder_weight_(\w+)$/;

/** What the save bar lists: each changed field as "Label: before to
 *  after", and the Elder weights as one line of shares. */
export function changeLines(e) {
  const { view, draft, changed } = e;
  const lines = [];
  const pair = (label, before, now) =>
    view.set ? `${label}: ${before} to ${now}` : `${label}: ${now}`;
  for (const k of changed) {
    if (WEIGHT.test(k)) continue;
    const f = view.fields[k];
    lines.push(
      pair(
        SAID[k] ?? f.label,
        wasText(f, view.current.values[k]),
        wasText(f, draft[k]),
      ),
    );
  }
  if (changed.some((k) => WEIGHT.test(k))) {
    const said = (values) => {
      const shares = Object.entries(weightShares(values));
      return shares.length
        ? shares.map(([c, v]) => `${CATEGORY_WORDS[c]} ${v}%`).join(", ")
        : "nothing";
    };
    lines.push(
      pair("What makes a best player", said(view.current.values), said(draft)),
    );
  }
  return lines;
}

function SaveBar({ e, jump }) {
  const [open, setOpen] = useState(false);
  const { view } = e;
  const lines = changeLines(e);
  const n = lines.length;
  const count = n
    ? `You changed ${n} ${noun(n, "thing")}.`
    : view.set
      ? "No changes."
      : "Nothing changed yet.";
  const first = !view.set
    ? view.big_enough === false
      ? "Saving starts your clan's rules: version 1. Clan management waits for 10 members."
      : "Saving starts your clan's rules: version 1."
    : null;
  return (
    <div className="rules-save" aria-label="Save rules" role="region">
      <div className="rules-save__what">
        {n ? (
          <button
            type="button"
            className="btn--text rules-save__count"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {count}
          </button>
        ) : (
          <p className="rules-save__count">{count}</p>
        )}
        {open && n ? (
          <ul className="rules-save__list">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="page-head__note m-0" role="status">
          {e.message.text && !e.message.bad ? e.message.text : first}
        </p>
        {e.message.text && e.message.bad ? (
          <p className="rules-error" role="alert">
            {e.message.text}
          </p>
        ) : null}
      </div>
      <div className="rules-save__buttons">
        <button
          type="button"
          className="btn"
          disabled={e.busy || !e.dirty}
          onClick={e.discard}
        >
          Undo all
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={e.busy || !e.canSave}
          onClick={() => e.save(jump)}
        >
          Save rules
        </button>
      </div>
    </div>
  );
}

function BeforeSave({ e, jump }) {
  const { view } = e;
  return (
    <Disclosure title="Before you save">
      <div className="grid gap-3">
        {view.can_edit ? (
          <>
            <label className="field-label" htmlFor="policy-note">
              A note for this version
            </label>
            <input
              id="policy-note"
              className="input"
              placeholder="why this change (optional)"
              value={e.note}
              onChange={(ev) => e.setNote(ev.target.value)}
            />
            <div>
              <button
                type="button"
                className="btn"
                disabled={e.busy || !e.canSave || view.big_enough === false}
                onClick={() => e.doPreview(jump)}
              >
                Preview the last reviews
              </button>
            </div>
            {e.preview && !e.conflict ? <Preview preview={e.preview} /> : null}
          </>
        ) : null}
        <div className="grid gap-2 text-body-sm">
          <p className="m-0">
            Saving makes a new version. It applies the next time Elixir reads
            the clan, so the Actions waiting can change. Saving also lists the
            clan in Elixir&rsquo;s clan list, with the card above.
          </p>
          <p className="m-0">
            Nobody&rsquo;s clock restarts, and decisions and awards already made
            stay as they are. Elixir never kicks or promotes anyone: a Leader
            decides.
          </p>
          <p className="m-0">
            Preview reads the record with no model. It skips exceptions and
            waits, and saves nothing.
          </p>
        </div>
        {view.versions.length ? (
          <Disclosure title={`Versions (${view.versions.length})`}>
            <VersionRows
              versions={view.versions}
              current={view.current.version}
            />
          </Disclosure>
        ) : null}
        {view.set && view.can_do?.length ? (
          <Disclosure title="What these rules can do today">
            <CanDo lines={view.can_do} />
          </Disclosure>
        ) : null}
      </div>
    </Disclosure>
  );
}

export function RunRules({ e, clan }) {
  const { whenDay } = useClock();
  const roster = useRoster(clan.clan_tag).state.data ?? null;
  const running = useExceptions(clan.clan_tag).state.data?.exceptions ?? [];
  const { view, draft } = e;
  // A kept Elder takes no earned seat, so the seats count only the rest.
  const kept = new Set(
    running
      .filter((x) => x.kind === "keep_as_elder" && x.role === "elder")
      .map((x) => x.player_tag),
  ).size;
  const counts = roster
    ? {
        members: roster.member_count,
        elders: roster.role_counts?.elder ?? 0,
        kept,
      }
    : {};
  const found = rulesCheck(draft, counts);
  // Every problem once: the server's refusal, then the draft's own.
  const problems = { ...e.errors };
  for (const f of found)
    if (f.kind === "invalid" && !problems[f.key]) problems[f.key] = f.text;
  for (const k of Object.keys(e.errors))
    if (!found.some((f) => f.key === k))
      found.unshift({
        kind: "invalid",
        key: k,
        question: questionOf(k) ?? "about",
        text: e.errors[k],
        fix: null,
      });
  const wrong = (q) =>
    Object.entries(problems).filter(
      ([k]) => (questionOf(k) ?? "about") === q.key,
    );
  const jump = (q) =>
    document
      .getElementById(`rules-${q}`)
      ?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  const name = clan.name ?? clan.clan_tag;
  const [about, weekly, elder, quiet, welcome, sees] = QUESTIONS;
  return (
    <div className="grid gap-4">
      <PageHead
        title="Rules"
        lede={
          view.set
            ? "Six questions. Your answers decide what Elixir suggests and what your clan sees."
            : `${name} has no rules yet, so nothing in Clan runs. Pick a quick start or answer the six questions, then save.`
        }
      />
      {view.set ? (
        <p className="page-head__note m-0">
          {`Version ${view.current.version}, saved ${whenDay(view.current.saved_at)} by ${view.current.saved_by_name ?? view.current.saved_by}.`}{" "}
          Every save is a new version.
        </p>
      ) : null}
      {view.big_enough === false ? (
        <div className="callout" role="note">
          <span>
            This clan has {view.members} {noun(view.members, "member")}. You can
            set its rules now. Actions, standing and awards start at{" "}
            {view.min_members} members.
          </span>
        </div>
      ) : null}
      {e.conflict ? (
        <div className="callout callout--warn" role="alert">
          <span>
            Someone saved newer rules. Your draft is kept.{" "}
            <button type="button" className="btn" onClick={e.discard}>
              Load latest rules and discard my draft
            </button>
          </span>
        </div>
      ) : null}
      {!view.set ? (
        <section className="grid gap-3" aria-labelledby="rules-start-title">
          <h3 id="rules-start-title" className="label m-0">
            Quick start
          </h3>
          <p className="rules-q__sub">
            Pick the closest one. It fills every question for you to change.
            Nothing is saved until you save.
          </p>
          <Presets e={e} />
        </section>
      ) : null}
      {e.filled ? (
        <p className="notice m-0">
          {e.filled.label} filled every question. Nothing is saved yet.
        </p>
      ) : null}
      <div className="rules">
        <div className="rules__questions">
          <Question n={1} q={about} wrong={wrong(about)}>
            <About e={e} />
          </Question>
          <Question
            n={2}
            q={weekly}
            wrong={wrong(weekly)}
            sub={
              countedCategories(draft).length
                ? "Turn on what your clan does, and set a goal for each."
                : "Turn on what your clan does. Nothing is asked until one is on."
            }
          >
            <Weekly e={e} problems={problems} />
          </Question>
          <Question n={3} q={elder} wrong={wrong(elder)}>
            <Elder e={e} roster={counts} problems={problems} />
          </Question>
          <Question
            n={4}
            q={quiet}
            wrong={wrong(quiet)}
            sub="Elixir counts days with no battle. Away days don't count."
          >
            <Quiet e={e} problems={problems} />
          </Question>
          <Question n={5} q={welcome} wrong={wrong(welcome)}>
            <Switches
              e={e}
              rows={[
                [
                  "welcome_enabled",
                  "Help us welcome new members",
                  "Elders and Leaders get an Action to say hi",
                ],
                [
                  "departures_enabled",
                  "Ask if someone left or was kicked",
                  "So the clan's story stays true",
                ],
              ]}
            />
          </Question>
          <Question n={6} q={sees} wrong={wrong(sees)}>
            <Switches
              e={e}
              rows={[
                [
                  "members_see_standing",
                  "Members see where everyone stands",
                  "Who's rising and who's slipping, on Standing",
                ],
                ["announce_awards_enabled", "Post each season's awards", null],
                ["announce_rules_enabled", "Post when the rules change", null],
              ]}
            />
          </Question>
          {view.set ? (
            <Disclosure title="Start over from a quick start">
              <Presets e={e} />
            </Disclosure>
          ) : null}
          <BeforeSave e={e} jump={jump} />
        </div>
        <aside
          className="rules__side"
          aria-label="Your clan's card and the Rules check"
        >
          <CardPreview clan={clan} roster={roster} draft={draft} />
          <Check found={found} e={e} jump={jump} />
        </aside>
      </div>
      {view.can_edit ? <SaveBar e={e} jump={jump} /> : null}
    </div>
  );
}
