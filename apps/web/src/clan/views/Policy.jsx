import { useClock, Panel, Table } from "@elixir-mcp/ui";
import { useEffect, useRef, useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, usePolicy } from "../lib/queries.js";
import { trackEvent } from "../../analytics.js";
import {
  CATEGORY_LABELS,
  POSTURE_WORDS,
  countedCategories,
  policyFromGoals,
  questionOf,
  removalDay,
  tabStart,
} from "@elixir-mcp/clan-engine";

/**
 * The clan's Rules, as Run drafts them: the draft and everything done with
 * it, and the parts the Rules page shows beside its questions (the preview
 * of the last reviews, the versions, what the rules can do today). The page
 * itself is `RunRules.jsx`. Code and the API keep the word "policy".
 */

const LEAVE = "Leave without saving? Your changes to the rules aren't saved.";
export { LEAVE as LEAVE_POLICY };

/**
 * The draft of a clan's rules and everything done with it. It lives in Run,
 * above the page, so an edit survives moving to Waiting and back; a save
 * writes one new version of the whole policy. `go` takes the leader to a
 * question (`questionOf`) when a save or preview is refused.
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
  /** Several fields at once: a Rules check fix, a rebalanced weight. */
  const patch = (values) => {
    invalidatePreview();
    setDraft((d) => ({ ...d, ...values }));
  };
  /** A tab's switch (a category, inactivity): turning it on fills that
   *  tab from the posture, as the engine starts it. */
  const flip = (tab, on) => {
    const sw = view.tabs.find((t) => t.key === tab)?.switch;
    if (!sw) return;
    setDraft((d) => (on ? { ...d, ...tabStart(d, tab) } : { ...d, [sw]: on }));
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
    // Take the leader to the first question with a problem.
    const first = Object.keys(errs).map(questionOf).find(Boolean);
    if (first) go?.(first);
    setMessage({
      text: Object.keys(errs).length ? "Fix the answers marked in red." : what,
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
          "Someone saved newer rules. Your draft is kept; load the latest rules before saving.",
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
    patch,
    flip,
    fill,
    doPreview,
    save,
    discard,
    // The first save is a policy even with nothing changed.
    canSave: !conflict && (!view.set || changed.length > 0),
    disabled: !view.can_edit || busy || conflict,
  };
}

/** A preset's own numbers, in the words the questions use. */
export function presetNote(p) {
  const v = policyFromGoals(p.goals, p.posture);
  const counted = countedCategories(v).map((c) => CATEGORY_LABELS[c]);
  const min = [
    v.war_enabled && v.war_min_decks ? `${v.war_min_decks} war decks` : null,
    v.ranked_enabled && v.ranked_min_battles
      ? `${v.ranked_min_battles} ranked battles`
      : null,
    v.donations_enabled && v.donations_min_weekly
      ? `${v.donations_min_weekly} cards donated a week`
      : null,
  ].filter(Boolean);
  return [
    counted.length
      ? `Counts ${counted.join(", ")}.`
      : "Counts nothing the game measures.",
    v.goal_together ? "Playing together on." : null,
    `${POSTURE_WORDS[p.posture] ?? p.posture}.`,
    min.length ? `Asks for ${min.join(", ")}.` : null,
    v.elder_mode === "categories" ? "Elder is earned." : "Leaders pick Elders.",
    v.removal_enabled ? `Kick after ${removalDay(v)} quiet days.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Every saved version, newest first, the one in use marked. */
export function VersionRows({ versions, current }) {
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

export function Preview({ preview }) {
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
          : `No rules yet. Under the draft, the Elder band is ${bandText(preview.draft.band)}.`}
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
              head: preview.current ? "Rules now" : "Today",
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
export function CanDo({ lines }) {
  return (
    <Panel as="div">
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
