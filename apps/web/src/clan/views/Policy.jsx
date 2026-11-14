import { Disclosure, noun, useClock, Panel, Table } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, usePolicy } from "../lib/queries.js";
import { trackEvent } from "../../analytics.js";
import {
  PRESETS,
  countedCategories,
  CATEGORY_LABELS,
  policyFromGoals,
  tabStart,
} from "@elixir-mcp/clan-engine";

/** Whether a group or field applies under the draft (engine `applies`). */
const applies = (when, values) =>
  !when ||
  when.some((clause) =>
    Object.entries(clause).every(([k, v]) => values?.[k] === v),
  );

/**
 * The policy's sections, by address under Run. Separated, each with its own
 * switch where it has one (the 09-25 ruling): the engine's tabs say which
 * groups they hold, and Arrivals and Departures, one engine tab, are two
 * sections of one switch each here.
 */
export const POLICY_SECTIONS = {
  about: { title: "About", tab: "about" },
  minimums: { title: "Minimums", tab: "minimums" },
  "clan-wars": { title: "Clan Wars", tab: "war", switch: "war_enabled" },
  ranked: { title: "Ranked", tab: "ranked", switch: "ranked_enabled" },
  donations: {
    title: "Donations",
    tab: "donations",
    switch: "donations_enabled",
  },
  "trophy-road": {
    title: "Trophy Road",
    tab: "trophies",
    switch: "trophies_enabled",
  },
  elder: { title: "Elder", tab: "elder" },
  inactivity: {
    title: "Inactivity",
    tab: "removal",
    switch: "removal_enabled",
  },
  arrivals: {
    title: "Arrivals",
    tab: "arrivals",
    switch: "welcome_enabled",
    only: ["welcome_enabled"],
  },
  departures: {
    title: "Departures",
    tab: "arrivals",
    switch: "departures_enabled",
    only: ["departures_enabled"],
  },
  announcements: {
    title: "Announcements",
    tab: "messages",
    switches: ["announce_awards_enabled", "announce_rules_enabled"],
  },
};

const LEAVE = "Leave without saving? Your edits to the policy aren't saved.";
export { LEAVE as LEAVE_POLICY };

/**
 * The draft of a clan's policy and everything done with it. It lives in Run,
 * above the sections, so an edit survives moving between them; a save writes
 * one new version of the whole policy.
 */
export function usePolicyDraft(clan) {
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: "", bad: false });
  const [note, setNote] = useState("");
  const [baseVersion, setBaseVersion] = useState(null);
  const [filled, setFilled] = useState(null);
  const revision = useRef(0);
  const policy = usePolicy(clan.clan_tag);
  const view = policy.data ?? null;
  // A saved policy changes the judged board too: the whole clan refetches.
  const invalidate = useInvalidate();
  const reload = () => invalidate(keys.clan(clan.clan_tag));
  useEffect(() => {
    if (view && baseVersion === null) {
      setDraft(view.current.values);
      setBaseVersion(view.current.version);
    }
  }, [view, baseVersion]);
  if (!view || !draft) return { policy, view: null };

  const conflict = baseVersion !== view.current.version;
  const groupsOf = (s) => view.tabs.find((t) => t.key === s.tab)?.groups ?? [];
  const fieldsOf = (s) =>
    Object.keys(view.fields).filter(
      (k) =>
        groupsOf(s).includes(view.fields[k].group) &&
        (!s.only || s.only.includes(k)),
    );
  const changed = Object.keys(view.fields).filter(
    (k) => draft[k] !== view.current.values[k],
  );
  const invalidatePreview = () => {
    revision.current += 1;
    setPreview(null);
  };
  const set = (key, value) => {
    invalidatePreview();
    setDraft((d) => ({ ...d, [key]: value }));
  };
  /** A section's switch: turning a category on fills it from the posture. */
  const flip = (s, on) => {
    const whole = view.tabs.find((t) => t.key === s.tab)?.switch === s.switch;
    setDraft((d) =>
      on && whole ? { ...d, ...tabStart(d, s.tab) } : { ...d, [s.switch]: on },
    );
    invalidatePreview();
  };
  const fill = (preset) => {
    setDraft((d) => ({
      ...policyFromGoals(preset.goals, preset.posture),
      war_intent: d.war_intent,
    }));
    invalidatePreview();
    setErrors({});
    setFilled(preset);
    trackEvent("clan.policy_preset", preset.key);
  };
  const failed = (r, what, go) => {
    const errs = r.data?.errors ?? {};
    setErrors(errs);
    // Open the first section that holds a field with a problem.
    const first = Object.entries(POLICY_SECTIONS).find(([, s]) =>
      fieldsOf(s).some((k) => errs[k]),
    );
    if (first) go?.(first[0]);
    setMessage({
      text: Object.keys(errs).length
        ? "Fix the fields marked in the list."
        : what,
      bad: true,
    });
  };
  const doPreview = async (go) => {
    setBusy(true);
    setMessage({ text: "", bad: false });
    const atRevision = revision.current;
    const r = await manageApi.previewPolicy(clan.clan_tag, draft);
    setBusy(false);
    if (!r.ok) return failed(r, "Preview failed.", go);
    if (revision.current !== atRevision) return;
    setErrors({});
    trackEvent("clan.policy_previewed");
    setPreview(r.data);
  };
  const save = async (go) => {
    setBusy(true);
    setMessage({ text: "", bad: false });
    const r = await manageApi.savePolicy(
      clan.clan_tag,
      draft,
      note || null,
      baseVersion,
    );
    setBusy(false);
    if (!r.ok) {
      if (r.data?.error === "policy_changed") {
        reload();
        return failed(
          r,
          "A newer policy was saved. Your draft is kept; load the latest version before saving.",
          go,
        );
      }
      return failed(r, "Save failed.", go);
    }
    setBaseVersion(r.data.version);
    setDraft(r.data.values ?? draft);
    setErrors({});
    setPreview(null);
    setNote("");
    setFilled(null);
    trackEvent("clan.policy_saved", `v${r.data.version}`);
    setMessage({ text: `Saved as version ${r.data.version}.`, bad: false });
    reload();
  };
  const discard = () => {
    invalidatePreview();
    setDraft(view.current.values);
    setBaseVersion(view.current.version);
    setErrors({});
    setFilled(null);
    setMessage({ text: "", bad: false });
  };
  /** How a section reads in the list: its state, its edits, its problems. */
  const stateOf = (s) => {
    if (s.tab === "elder")
      return draft.elder_mode === "categories" ? "ranked" : "by hand";
    const sw = s.switch ? [s.switch] : (s.switches ?? []);
    if (!sw.length) return null;
    return sw.some((k) => draft[k] === true) ? "on" : "off";
  };
  const dirty = !view.set
    ? filled !== null || changed.length > 0
    : changed.length > 0;
  return {
    policy,
    view,
    draft,
    errors,
    preview,
    busy,
    message,
    note,
    setNote,
    filled,
    conflict,
    changed,
    dirty,
    set,
    flip,
    fill,
    doPreview,
    save,
    discard,
    stateOf,
    fieldsOf,
    groupsOf,
    // The first save is a policy even with nothing changed.
    canSave: !conflict && (!view.set || changed.length > 0),
    disabled: !view.can_edit || busy || conflict,
  };
}

/** A preset's own numbers, in the words the sections use. */
function presetNote(p) {
  const v = policyFromGoals(p.goals, p.posture);
  const counted = countedCategories(v).map((c) => CATEGORY_LABELS[c]);
  const min = [
    v.war_enabled && v.war_min_decks ? `${v.war_min_decks} war decks` : null,
    v.ranked_enabled && v.ranked_min_battles
      ? `${v.ranked_min_battles} ranked battles`
      : null,
    v.donations_enabled && v.donations_min_weekly
      ? `${v.donations_min_weekly} donations a week`
      : null,
  ].filter(Boolean);
  const strict = { relaxed: "Relaxed", standard: "Standard", strict: "Strict" };
  return [
    counted.length
      ? `Counts ${counted.join(", ")}.`
      : "Counts nothing the game measures.",
    v.goal_together ? "Playing together on." : null,
    `How strict: ${strict[p.posture] ?? p.posture}.`,
    min.length ? `Minimums: ${min.join(", ")}.` : null,
    v.elder_mode === "categories"
      ? "Elders by participation."
      : "Elders chosen by hand.",
    v.removal_enabled
      ? `Removal action at ${Math.max(v.confirm_days, v.at_risk_days)} days.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** What a preset filled, one line a section, each opening that section. */
function whatItSet(v) {
  const onOff = (on, rest) => (on ? `On${rest ? `, ${rest}` : ""}` : "Off");
  const weeks = (w) => `${w} ${noun(w, "week")}`;
  return [
    [
      "Clan Wars",
      "clan-wars",
      onOff(
        v.war_enabled,
        `minimum ${v.war_min_decks} war decks, ${weeks(v.war_window_weeks)} window`,
      ),
    ],
    [
      "Ranked",
      "ranked",
      onOff(
        v.ranked_enabled,
        `minimum ${v.ranked_min_battles} battles, ${weeks(v.ranked_window_weeks)} window`,
      ),
    ],
    [
      "Donations",
      "donations",
      onOff(
        v.donations_enabled,
        `minimum ${v.donations_min_weekly} a week, ${weeks(v.donations_window_weeks)} window`,
      ),
    ],
    [
      "Trophy Road",
      "trophy-road",
      onOff(
        v.trophies_enabled,
        v.trophies_min ? `minimum ${v.trophies_min}` : "no minimum",
      ),
    ],
    [
      "Minimums",
      "minimums",
      `${weeks(v.minimums_window_weeks)}, ${v.minimums_rule === "any" ? "any one of them" : "all of them"}`,
    ],
    [
      "Elder",
      "elder",
      v.elder_mode === "categories"
        ? `By participation, ${v.tenure_min_days} days before promotion`
        : "By the leaders, by hand",
    ],
    [
      "Inactivity",
      "inactivity",
      onOff(
        v.removal_enabled,
        `at risk ${v.at_risk_days}, removal action at ${Math.max(v.confirm_days, v.at_risk_days)}`,
      ),
    ],
    ["Arrivals", "arrivals", onOff(v.welcome_enabled)],
    ["Departures", "departures", onOff(v.departures_enabled)],
    [
      "Announcements",
      "announcements",
      onOff(v.announce_awards_enabled || v.announce_rules_enabled),
    ],
  ];
}

const Group = ({ title, why, children }) => (
  <div className="grid gap-3">
    {title ? <h3 className="label m-0">{title}</h3> : null}
    {why ? <p className="page__lede m-0">{why}</p> : null}
    {children}
  </div>
);

function Presets({ e, go }) {
  const { view, filled, draft } = e;
  return (
    <>
      <Group
        title="Start from what the clan is for"
        why={`Pick a starting point and every section is filled from it, yours to change before you save. Every preset turns on removal suggestions, welcomes, departure questions and announcements. Review those sections before saving.${view.set ? " How strict seeds starting values; changing it alone does not retune existing fields. It replaces the whole draft, except Clan War participation; the changed settings and the preview show what would move." : " Nothing here is saved until you save."}`}
      >
        <div className="clan-presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className="clan-preset"
              aria-pressed={filled?.key === p.key}
              disabled={!view.can_edit || e.busy || e.conflict}
              onClick={() => e.fill(p)}
            >
              <b>{p.label}</b>
              <span>{presetNote(p)}</span>
            </button>
          ))}
        </div>
      </Group>
      {filled ? (
        <Group
          title="What it set"
          why="Each line opens its section, to change it."
        >
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {whatItSet(draft).map(([label, slug, value]) => (
              <li key={slug} className="clan-row__line">
                <button
                  type="button"
                  className="btn--text"
                  onClick={() => go(slug)}
                >
                  {label}
                </button>
                <span className="page-head__note"> {value}</span>
              </li>
            ))}
          </ul>
        </Group>
      ) : !view.set ? (
        <Group title="Saving turns on">
          <ul className="m-0 grid gap-1 pl-[18px]">
            <li>
              Actions for leaders, elders and members, each with its own log
            </li>
            <li>How it works here, and where everyone stands</li>
            <li>Awards and a trophy case for every member</li>
            <li>
              Welcomes, away notices and Clan Leader Messages ready to send
            </li>
          </ul>
        </Group>
      ) : null}
    </>
  );
}

const Fields = ({ e, keys: fieldKeys }) => {
  const { view, draft, errors, disabled } = e;
  return fieldKeys
    .filter((k) => applies(view.fields[k].when, draft))
    .map((k, i, shown) => (
      <Field
        key={k}
        name={k}
        f={view.fields[k]}
        help={view.fields[shown[i + 1]]?.why !== view.fields[k].why}
        value={draft[k]}
        was={wasOf(e, k)}
        error={errors[k]}
        disabled={disabled}
        onChange={(v) => e.set(k, v)}
      />
    ));
};

/** The saved value of a setting the draft changed, for its "Was" mark. */
const wasOf = (e, k) =>
  e.view.set && e.draft[k] !== e.view.current.values[k]
    ? e.view.current.values[k]
    : undefined;

const SwitchField = ({ e, s }) => (
  <Field
    name={s.switch}
    f={e.view.fields[s.switch]}
    value={e.draft[s.switch]}
    was={wasOf(e, s.switch)}
    error={e.errors[s.switch]}
    disabled={e.disabled}
    onChange={(v) => e.flip(s, v)}
  />
);

const LinkLine = ({ children, label, onClick }) => (
  <p className="page-head__note m-0">
    {children}{" "}
    <button type="button" className="btn--text" onClick={onClick}>
      {label}
    </button>
  </p>
);

/** Groups of one section: its help once, then its fields, with the fine
 *  tuning folded until a field there has a problem. */
function SectionGroups({ e, s, skip = [] }) {
  const { view, draft, errors } = e;
  const groupOf = (gk) => view.groups.find((x) => x.key === gk);
  const blocks = e
    .groupsOf(s)
    .filter((gk) => applies(groupOf(gk)?.when, draft));
  const multiple = blocks.length > 1;
  const block = (gk) => {
    const g = groupOf(gk);
    if (!g) return null;
    const here = e
      .fieldsOf({ tab: s.tab, only: s.only })
      .filter((k) => view.fields[k].group === gk && !skip.includes(k));
    return (
      <Group key={gk} title={multiple ? g.title : null} why={g.why}>
        <Fields e={e} keys={here} />
      </Group>
    );
  };
  const main = blocks.filter((gk) => groupOf(gk)?.advanced !== true);
  const fine = blocks.filter((gk) => groupOf(gk)?.advanced === true);
  return (
    <>
      {main.map(block)}
      {fine.length ? (
        <details
          open={fine.some((gk) =>
            e
              .fieldsOf({ tab: s.tab })
              .some((k) => view.fields[k].group === gk && errors[k]),
          )}
        >
          <summary className="label cursor-pointer">
            Fine tuning:{" "}
            {fine
              .map((gk) => groupOf(gk)?.title ?? gk)
              .join(", ")
              .toLowerCase()}
          </summary>
          <div className="mt-4 grid gap-5">{fine.map(block)}</div>
        </details>
      ) : null}
    </>
  );
}

/** One section of the clan's policy. */
export function PolicySection({ e, slug, go }) {
  const { view, draft } = e;
  const s = POLICY_SECTIONS[slug];
  const minimumsLine = (
    <LinkLine label="Open Minimums" onClick={() => go("minimums")}>
      The minimums window is {draft.minimums_window_weeks}{" "}
      {noun(draft.minimums_window_weeks, "week")}. Change it in Minimums.
    </LinkLine>
  );
  if (slug === "about") {
    const rest = e.fieldsOf(s).filter((k) => k !== "war_intent");
    if (!view.set)
      return (
        <div className="panel__body grid gap-5">
          <Fields e={e} keys={["war_intent"]} />
          <Presets e={e} go={go} />
          <details>
            <summary className="label cursor-pointer">
              How strict, and what the game cannot count
            </summary>
            <div className="mt-4 grid gap-5">
              <Fields e={e} keys={rest} />
            </div>
          </details>
        </div>
      );
    return (
      <div className="panel__body grid gap-5">
        <Fields e={e} keys={["war_intent"]} />
        {view.can_edit ? <Presets e={e} go={go} /> : null}
        <Group title="How strict, and what the game cannot count">
          <Fields e={e} keys={rest} />
        </Group>
      </div>
    );
  }
  if (slug === "minimums") {
    const on = [
      draft.war_enabled && [
        "Clan Wars",
        "clan-wars",
        "Minimum war decks",
        draft.war_min_decks,
        "",
      ],
      draft.ranked_enabled && [
        "Ranked",
        "ranked",
        "Minimum ranked battles",
        draft.ranked_min_battles,
        "",
      ],
      draft.donations_enabled && [
        "Donations",
        "donations",
        "Minimum donations",
        draft.donations_min_weekly,
        " cards a week",
      ],
      draft.trophies_enabled && [
        "Trophy Road",
        "trophy-road",
        "Minimum trophies",
        draft.trophies_min,
        "",
      ],
    ].filter(Boolean);
    if (!on.length)
      return (
        <div className="panel__body grid gap-3">
          <p className="m-0 font-semibold">Nothing counts yet</p>
          <p className="page-head__note m-0">
            Minimums start when the clan counts something. Turn one of these on
            first.
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              ["Clan Wars", "clan-wars"],
              ["Ranked", "ranked"],
              ["Donations", "donations"],
              ["Trophy Road", "trophy-road"],
            ].map(([label, to]) => (
              <button
                key={to}
                type="button"
                className="btn btn--sm"
                onClick={() => go(to)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      );
    return (
      <div className="panel__body grid gap-5">
        <SectionGroups
          e={e}
          s={s}
          skip={[
            "war_min_decks",
            "ranked_min_battles",
            "donations_min_weekly",
            "trophies_min",
          ]}
        />
        <Group title="Set in each section">
          <ul className="m-0 grid list-none gap-1.5 p-0">
            {on.map(([, to, label, value, unit]) => (
              <li key={to} className="clan-row__line">
                <button
                  type="button"
                  className="btn--text"
                  onClick={() => go(to)}
                >
                  {label}
                </button>
                <span className="page-head__note">
                  {" "}
                  {value ? `${value}${unit}` : "None set"}
                </span>
              </li>
            ))}
          </ul>
        </Group>
      </div>
    );
  }
  if (slug === "arrivals" || slug === "departures")
    return (
      <div className="panel__body">
        <SwitchField e={e} s={s} />
      </div>
    );
  if (s.switch) {
    const on = draft[s.switch] === true;
    const minimumField = {
      "clan-wars": "war_min_decks",
      ranked: "ranked_min_battles",
      donations: "donations_min_weekly",
      "trophy-road": "trophies_min",
    }[slug];
    return (
      <div className="panel__body grid gap-5">
        <SwitchField e={e} s={s} />
        {on ? (
          <>
            <SectionGroups e={e} s={s} skip={[s.switch]} />
            {minimumField ? <Fields e={e} keys={[minimumField]} /> : null}
            {minimumField && slug !== "trophy-road" ? minimumsLine : null}
          </>
        ) : null}
        {slug === "clan-wars" ? (
          <LinkLine
            label="Set Clan War participation in About"
            onClick={() => go("about")}
          >
            Counting war decks for scoring is separate from whether this clan
            plans to play Clan Wars.
          </LinkLine>
        ) : null}
      </div>
    );
  }
  return (
    <div className="panel__body grid gap-5">
      <SectionGroups e={e} s={s} />
    </div>
  );
}

/** The page's title and what stands above any section. */
export function PolicyHead({ e, slug, clan }) {
  const { whenDay } = useClock();
  const { view } = e;
  return (
    <>
      {view.big_enough === false ? (
        <div className="callout" role="note">
          <span>
            This clan has {view.members} {noun(view.members, "member")}. Leaders
            can prepare and save its policy now. Reviews, Actions, standing and
            awards stay paused until {view.min_members} members; saving below
            that size raises no announcement Action.
          </span>
        </div>
      ) : null}
      {e.conflict ? (
        <div className="callout callout--warn" role="alert">
          <span>
            A newer policy version is available. Your unsaved draft is kept.{" "}
            <button type="button" className="btn" onClick={e.discard}>
              Load latest policy and discard my draft
            </button>
          </span>
        </div>
      ) : null}
      {e.filled && !view.set ? (
        <p className="notice m-0">
          {e.filled.label} filled every section. Nothing is saved yet. Picking
          another replaces the draft.
        </p>
      ) : null}
      {slug === "about" && !view.set ? (
        <p className="page__lede m-0">
          {clan.name ?? "This clan"} has no policy yet, so nothing in clan
          management runs: no actions, no standing, no inactivity clock, no
          awards. Start from what the clan is for, or turn on the sections for
          what it does, and save. Clan management starts at ten members.
        </p>
      ) : null}
      {slug === "about" && view.set ? (
        <p className="page-head__note m-0">
          {`Version ${view.current.version}, saved ${whenDay(view.current.saved_at)} by ${view.current.saved_by_name ?? view.current.saved_by}.`}{" "}
          Every save is a new version; nothing is edited in place. Each action
          says which version raised it.
        </p>
      ) : null}
      {slug === "about" && view.set && view.can_do?.length ? (
        <Disclosure title="What this policy can do today">
          <CanDo lines={view.can_do} />
        </Disclosure>
      ) : null}
    </>
  );
}

/** One policy status line: what the save would do, or what just happened. */
export function policyStatus(e) {
  const { view, changed } = e;
  if (!view.set)
    return view.big_enough === false
      ? "Saving prepares version 1; clan management stays paused until 10 members."
      : "Saving creates version 1: clan management starts from it.";
  return changed.length
    ? `${changed.length} setting${changed.length === 1 ? "" : "s"} changed: ${changed.map((k) => view.fields[k].label).join(", ")}.`
    : "No changes.";
}

/** Under whichever section is open: save, preview, agreement and versions. */
export function PolicyFoot({ e, go }) {
  const { view, draft } = e;
  return (
    <>
      {view.can_edit ? (
        <>
          <Panel as="div" className="clan-save-more">
            <div className="panel__body grid gap-2.5">
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
              <p className="m-0 text-body-sm">
                Saving lists this clan in Elixir&rsquo;s clan directory, with
                its policy&rsquo;s public part.
              </p>
              <details>
                <summary className="label cursor-pointer">
                  What saving does
                </summary>
                <div className="mt-2 grid gap-2 text-body-sm">
                  <p className="m-0">
                    Edits stay on this page until you save. The new version
                    applies the next time Elixir reads the clan, which can be as
                    soon as someone opens Today or Standing, so Actions waiting
                    can change. With &ldquo;Tell the clan when the rules
                    change&rdquo; on, saving also raises an Action for leaders,
                    and a connected Discord can show its line straight away.
                  </p>
                  <p className="m-0">
                    Review streaks are replayed under the new version; saving
                    does not restart them or anyone&rsquo;s inactivity clock.
                    Decisions already made and award grants already saved stay
                    as they are. Awards have their own setup.
                  </p>
                  <p className="m-0">
                    Preview uses what is on the record, with no model, and does
                    not apply holds or decision cooldowns. It saves nothing.
                  </p>
                </div>
              </details>
              {e.preview && !e.conflict ? (
                <Preview preview={e.preview} />
              ) : null}
            </div>
          </Panel>
          {/* The save bar: what saving would do and the two buttons. It
              stays in view while a draft has changes, and is small enough
              not to hide the fields being changed. */}
          <div className="clan-save" data-live={e.canSave ? "true" : undefined}>
            <p className="clan-save__status" role="status">
              {e.message.text && !e.message.bad
                ? e.message.text
                : policyStatus(e)}
            </p>
            {e.message.text && e.message.bad ? (
              <div className="notice clan-save__error" role="alert">
                {e.message.text}
              </div>
            ) : null}
            <div className="clan-save__buttons">
              <button
                type="button"
                className="btn"
                disabled={e.busy || !e.canSave || view.big_enough === false}
                onClick={() => e.doPreview(go)}
              >
                Preview the last reviews
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={e.busy || !e.canSave}
                onClick={() => e.save(go)}
              >
                {view.set ? "Save as new version" : "Save this clan's policy"}
              </button>
            </div>
          </div>
        </>
      ) : null}
      <Disclosure title="Draft agreement">
        <div className="grid gap-2">
          <p className="m-0">
            Clan War participation:{" "}
            {view.fields.war_intent.options.find(
              (option) => option.value === draft.war_intent,
            )?.label ?? "Not specified"}
            . This intent is separate from scoring.
          </p>
          <p className="m-0">
            Counted categories:{" "}
            {countedCategories(draft)
              .map((c) => CATEGORY_LABELS[c])
              .join(", ") || "none"}
            . Elders are{" "}
            {draft.elder_mode === "categories"
              ? "ranked by counted participation"
              : "chosen by leaders by hand"}
            .
          </p>
          <p className="m-0">
            Minimums use {draft.minimums_window_weeks}{" "}
            {noun(draft.minimums_window_weeks, "week")} and require{" "}
            {draft.minimums_rule === "any" ? "any one" : "all"} of the enabled
            thresholds above zero. They affect Elder eligibility and inactivity
            grace; with no thresholds set, everyone meets them. Each
            category&rsquo;s window for the Elder order is separate.
          </p>
          <p className="m-0">
            Removal suggestions are{" "}
            {draft.removal_enabled
              ? `on: a member is at risk after ${draft.at_risk_days} battle-free ${noun(draft.at_risk_days, "day")}, and the leaders get a removal Action at ${Math.max(draft.confirm_days, draft.at_risk_days)} before contribution grace or holds`
              : "off"}
            .
          </p>
          <p className="page-head__note m-0">
            A leader reviews the evidence and makes the decision; Elixir never
            kicks or promotes a member.
          </p>
        </div>
      </Disclosure>
      {view.versions.length ? (
        <Disclosure title={`Versions (${view.versions.length})`}>
          <VersionRows
            versions={view.versions}
            current={view.current.version}
          />
        </Disclosure>
      ) : null}
    </>
  );
}

/** Every saved version, newest first, the one in use marked. */
function VersionRows({ versions, current }) {
  const { when } = useClock();
  const newest = [...versions].sort((a, b) => b.version - a.version);
  return (
    <ol className="clan-versions">
      {newest.map((v) => (
        <li key={v.version} className="clan-versions__row">
          <span className="clan-versions__v">v{v.version}</span>
          <span className="clan-versions__what">
            <span>
              {when(v.saved_at)}
              {v.saved_by_name ? ` · ${v.saved_by_name}` : ""}
              {v.version === current ? (
                <span className="clan-versions__now"> In use</span>
              ) : null}
            </span>
            {v.note ? (
              <span className="clan-versions__note">{v.note}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What a saved value was, in the field's own words. */
function wasText(f, was) {
  if (f.type === "boolean") return was ? "On" : "Off";
  if (f.type === "enum")
    return f.options.find((o) => o.value === was)?.label ?? String(was);
  return `${was}`;
}

/** One setting with its help and its problem, if any. A changed setting
 *  says what the saved policy had, so a leader sees every edit before
 *  saving. */
function Field({
  name,
  f,
  help = true,
  value,
  was,
  error,
  disabled,
  onChange,
}) {
  const id = `f-${name}`;
  const numeric = f.type === "integer" || f.type === "number";
  const changed = was !== undefined;
  const wasMark = changed ? (
    <span className="clan-field__was" id={`${id}-was`}>
      Was {wasText(f, was)}
      {numeric && f.unit ? ` ${f.unit}` : ""}
    </span>
  ) : null;
  return (
    <div
      id={name}
      className="clan-field"
      data-changed={changed ? "true" : undefined}
    >
      {f.type === "boolean" ? (
        <label className="clan-field__check">
          <input
            id={id}
            type="checkbox"
            className="size-4 shrink-0"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby={changed ? `${id}-was` : undefined}
          />
          <span>{f.label}</span>
          {wasMark}
        </label>
      ) : (
        <label className="clan-field__label" htmlFor={id}>
          {f.label}
        </label>
      )}
      {f.type === "enum" ? (
        <div className="clan-field__control">
          <select
            id={id}
            className="input"
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={changed ? `${id}-was` : undefined}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {wasMark}
        </div>
      ) : f.type === "boolean" ? null : (
        <div className="clan-field__control">
          <input
            id={id}
            className="input clan-field__num"
            type="number"
            inputMode={f.type === "integer" ? "numeric" : "decimal"}
            step={f.type === "integer" ? 1 : 0.01}
            min={f.min}
            max={f.max}
            value={value}
            disabled={disabled}
            onChange={(e) =>
              onChange(e.target.value === "" ? "" : Number(e.target.value))
            }
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-unit${changed ? ` ${id}-was` : ""}`}
          />
          <span className="clan-field__unit" id={`${id}-unit`}>
            {f.unit}, {f.min} to {f.max}
          </span>
          {wasMark}
        </div>
      )}
      {help ? <div className="clan-field__help">{f.why}</div> : null}
      {error ? (
        <div className="field-error text-bad" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function Preview({ preview }) {
  const label = (m) => {
    const bits = [];
    if (m.actionable.promotion) bits.push("promote");
    if (m.actionable.demotion) bits.push("demote");
    if (m.actionable.removal) bits.push("remove");
    if (bits.length) return bits.join(", ");
    if (m.promotion !== "none") return `promotion ${m.promotion}`;
    if (m.demotion !== "none") return `demotion ${m.demotion}`;
    if (m.removal !== "none") {
      if (m.removal_triage?.status === "protected") return "removal protected";
      if (m.removal_judgment === "held") return "removal waiting on the record";
      return `removal ${m.removal.replace("_", " ")}`;
    }
    return "—";
  };
  const none = {
    actionable: {},
    promotion: "none",
    demotion: "none",
    removal: "none",
  };
  const byTag = new Map(
    (preview.current?.members ?? []).map((m) => [m.player_tag, m]),
  );
  const rows = preview.draft.members.map((m) => ({
    tag: m.player_tag,
    name: m.name,
    current: label(byTag.get(m.player_tag) ?? none),
    draft: label(m),
  }));
  const moved = rows.filter((r) => r.current !== r.draft);
  const bandText = (b) =>
    b
      ? `${b.floor} to ${b.ceil} (target ${b.target})`
      : "none (Elders by hand)";
  return (
    <div>
      <div className="label my-2">
        Preview · {preview.draft.boundaries.length} reviews · {moved.length}{" "}
        member{moved.length === 1 ? "" : "s"} would read differently
      </div>
      <div className="page-head__note mb-2">
        {preview.current
          ? `Elder band now ${bandText(preview.current.band)}; under the draft ${bandText(preview.draft.band)}.`
          : `No policy yet. Under the draft, the Elder band is ${bandText(preview.draft.band)}.`}
      </div>
      {moved.length ? (
        <Table
          columns={[
            {
              head: "Member",
              cell: (r) => (
                <>
                  {r.name} <span className="tag">{r.tag}</span>
                </>
              ),
            },
            {
              head: preview.current ? "Current policy" : "Today",
              cell: (r) => r.current,
            },
            { head: "Draft", cell: (r) => r.draft },
          ]}
          rows={moved}
          rowKey={(r) => r.tag}
        />
      ) : (
        <p className="page__lede">
          Nobody would read differently over the last reviews.
        </p>
      )}
    </div>
  );
}

/** What the saved policy can do today: each judgment as live, needing
 *  more evidence (and what), or off. */
function CanDo({ lines }) {
  return (
    <Panel aria-labelledby="policy-can-do">
      <h3 id="policy-can-do" className="panel__head m-0">
        What this policy can do today
      </h3>
      <div className="panel__body">
        <ul className="m-0 grid list-none gap-2 p-0">
          {lines.map((l) => (
            <li key={l.key} className="grid gap-0.5">
              <span>
                <strong>{l.label}</strong>
                {": "}
                <span data-status={l.status}>{l.status_label}</span>
              </span>
              <span className="page-head__note">{l.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
