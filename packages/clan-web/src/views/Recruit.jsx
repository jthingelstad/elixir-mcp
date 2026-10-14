import { Disclosure, Fresh, Icon, noun } from "@elixir-mcp/ui";
import { useEffect, useState } from "react";
import { manageApi } from "../api.js";
import { useRecruit } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { CLAN, clanPath } from "../lib/base.js";
import { untilWritten } from "../lib/pending.js";

/**
 * Recruit: a page every member can use. The clan's pitch (a leader's
 * words), the facts the game states today (one live read, cached), and
 * copy in two formats: a personal note for one person by email or
 * message, and a public post for a recruiting forum. The post carries the
 * forums' requirements itself: the required trophies in brackets, and no
 * invite link in the body. Every piece is editable before it is copied and
 * comes back to the clan's words with one click. Until a leader writes the
 * pitch there is no copy: nothing is said for a clan it has not said.
 */
const FORMATS = [
  [
    "personal",
    "Personal note",
    "For one person, by email or message. Plain text; the subject is for email.",
  ],
  [
    "post",
    "Public post",
    "For a recruiting forum, such as a Discord recruiting channel or r/RoyaleRecruit. The title carries the required trophies in brackets and the body says Required Trophies: [N], as the forums ask; invite links are left out of the body.",
  ],
];

export function Recruit({ clan, navigate }) {
  const [editing, setEditing] = useState(false);
  // A pending live read asks again after Elixir's retry_after_s: the
  // query's own refetchInterval, read off the answer (lib/queries.js).
  const { state, load, updatedAt: now } = useRecruit(clan.clan_tag);

  if (state.signedOut) {
    window.location.assign(`${CLAN}?error=session_expired`);
    return null;
  }
  if (state.error)
    return (
      <div className="callout callout--warn" role="alert">
        <span>Elixir did not answer. Try again in a minute.</span>
      </div>
    );
  if (!state.data) return <p className="page__lede">Reading the clan…</p>;
  const d = state.data;
  const f = d.facts;

  if (editing)
    return (
      <PitchEditor
        clan={clan}
        view={d}
        navigate={navigate}
        onDone={() => {
          setEditing(false);
          load();
        }}
      />
    );

  return (
    <div className="grid gap-5">
      <h1 className="page__title">Recruit</h1>
      <div className="recruit-facts" role="group" aria-label="Recruiting facts">
        <span>
          {f?.members ?? "?"} {noun(f?.members, "member")}
          {f ? ` · ${f.open_slots} open` : ""}
        </span>
        <span>
          {f?.required_trophies != null
            ? `${f.required_trophies.toLocaleString()} trophies`
            : "Entry requirement not in the record yet"}
          {f?.type
            ? ` · ${f.type === "inviteOnly" ? "invite only" : f.type}`
            : ""}
        </span>
        {d.facts_read_at ? (
          <Fresh
            label="read"
            seconds={Math.max(0, (now - Date.parse(d.facts_read_at)) / 1000)}
            ts={d.facts_read_at}
          />
        ) : null}
        {f?.source === "recorded" ? (
          <span className="page-head__note">From the record</span>
        ) : null}
      </div>
      {d.pending ? (
        <p className="notice" role="status">
          fresh read queued · asking again in{" "}
          {Math.min(60, d.pending.retry_after_s)} s
        </p>
      ) : null}
      {d.copy && d.problems?.length ? (
        <div className="callout callout--warn" role="alert">
          <span>Check before posting: {d.problems.join("; ")}.</span>
        </div>
      ) : null}
      {d.copy ? <CopyFormats copy={d.copy} /> : null}
      <div className="recruit-context">
        <Disclosure
          title={`The pitch · ${d.pitch_version ? `v${d.pitch_version}` : "not written yet"}`}
          open={d.pitch_version === 0}
        >
          <section className="panel">
            <div
              className="panel__head"
              style={{ gap: "8px", flexWrap: "wrap" }}
            >
              <span>The pitch</span>
              <span className="page-head__note">
                {d.pitch_version === 0
                  ? "not written yet"
                  : `v${d.pitch_version}`}
              </span>
            </div>
            {d.pitch_version === 0 ? (
              <div className="panel__body page-head__note">
                {d.can_edit
                  ? "Write what your clan is, in your words: a tagline, a few sentences, what makes it different and who you want. The copy below follows from it and today's numbers."
                  : "A leader has not written the clan's pitch yet, so there is no copy to share."}
              </div>
            ) : (
              <div
                className="panel__body"
                style={{ display: "grid", gap: "6px" }}
              >
                <div style={{ fontWeight: 600 }}>{d.pitch.tagline}</div>
                <div>{d.pitch.about}</div>
                <ul style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
                  {d.pitch.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <div className="page-head__note">{d.pitch.looking_for}</div>
              </div>
            )}
          </section>
        </Disclosure>
        {d.can_edit ? (
          <button
            type="button"
            className="btn self-start"
            onClick={() => setEditing(true)}
          >
            {d.pitch_version === 0 ? "write the pitch" : "edit the pitch"}
          </button>
        ) : null}
      </div>
      <Disclosure title="Clan facts">
        <section className="panel">
          <div className="panel__head" style={{ gap: "8px", flexWrap: "wrap" }}>
            <span>Today, from the game</span>
            {d.can_edit ? (
              <button
                type="button"
                className="btn--text"
                style={{ marginLeft: "auto" }}
                onClick={() => load(true)}
              >
                read again
              </button>
            ) : null}
          </div>
          <div className="panel__body fields" style={{ rowGap: "6px" }}>
            <span className="label">Members</span>
            <span>
              {f?.members ?? "?"} {noun(f?.members, "member")}
              {f ? ` · ${f.open_slots} open` : ""}
            </span>
            <span className="label">To join</span>
            <span>
              {f?.required_trophies !== null &&
              f?.required_trophies !== undefined
                ? `${f.required_trophies.toLocaleString()} trophies`
                : "not in the record yet"}
              {f?.type
                ? ` · ${f.type === "inviteOnly" ? "invite only" : f.type}`
                : ""}
            </span>
            <span className="label">Clan numbers</span>
            <span>
              {f?.war_trophies
                ? `${f.war_trophies.toLocaleString()} war trophies`
                : "—"}
              {f?.clan_score
                ? ` · clan score ${f.clan_score.toLocaleString()}`
                : ""}
              {f?.donations_per_week
                ? ` · ${f.donations_per_week.toLocaleString()} cards a week`
                : ""}
            </span>
            {f?.top_trophies?.length ? (
              <>
                <span className="label">Top trophies</span>
                <span>
                  {f.top_trophies
                    .map((m) => `${m.name} ${m.value.toLocaleString()}`)
                    .join(" · ")}
                </span>
              </>
            ) : null}
            {f?.top_donors?.length ? (
              <>
                <span className="label">Top donors</span>
                <span>
                  {f.top_donors
                    .map((m) => `${m.name} ${m.value.toLocaleString()}`)
                    .join(" · ")}
                </span>
              </>
            ) : null}
          </div>
        </section>
      </Disclosure>
    </div>
  );
}

const asText = (value) =>
  typeof value === "string"
    ? value
    : value?.subject !== undefined
      ? `Subject: ${value.subject}\n\n${value.body}`
      : value?.title !== undefined
        ? `Title: ${value.title}\n\n${value.body}`
        : "";

/** Both local drafts survive a format switch; only the chosen one is shown. */
function CopyFormats({ copy }) {
  const personal = asText(copy.personal);
  const post = asText(copy.post);
  const [format, setFormat] = useState("personal");
  const [texts, setTexts] = useState({ personal, post });
  const [done, setDone] = useState(null);
  useEffect(() => {
    setTexts((previous) => ({ ...previous, personal }));
    setDone((previous) => (previous === "personal" ? null : previous));
  }, [personal]);
  useEffect(() => {
    setTexts((previous) => ({ ...previous, post }));
    setDone((previous) => (previous === "post" ? null : previous));
  }, [post]);
  const [, title, note] = FORMATS.find(([key]) => key === format);
  const original = format === "personal" ? personal : post;
  const text = texts[format];
  return (
    <section className="grid gap-3" aria-label="Recruiting copy">
      <div className="recruit-copy__tools">
        <div className="grid gap-1">
          <label className="field-label" htmlFor="recruit-format">
            Format
          </label>
          <select
            id="recruit-format"
            className="input"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setDone(null);
            }}
          >
            {FORMATS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 self-end">
          {text !== original ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setTexts((prev) => ({ ...prev, [format]: original }));
                setDone(null);
              }}
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--primary"
            aria-label={`Copy the ${title.toLowerCase()}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                trackEvent("clan.recruit_copied", format);
                setDone(format);
              } catch {
                setDone(null);
              }
            }}
          >
            <Icon name={done === format ? "check" : "copy"} size={14} />
            {done === format ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <textarea
        className="input recruit-copy__text"
        aria-label={title}
        rows={Math.min(16, Math.max(8, text.split("\n").length + 1))}
        value={text}
        onChange={(e) => {
          setTexts((prev) => ({ ...prev, [format]: e.target.value }));
          setDone(null);
        }}
      />
      <Disclosure title="Format details">
        <p className="page-head__note m-0">{note}</p>
      </Disclosure>
    </section>
  );
}

/** What a draft refusal means, in a leader's words. */
const DRAFT_ERROR = {
  no_model_key: "The clan has no model key yet.",
  model_key_refused:
    "Anthropic stopped accepting the clan's key. Add it again in Settings.",
  model_key_unreadable: "The clan's key needs to be added again in Settings.",
  model_unavailable:
    "The clan's key could not reach the model Elixir Clan uses for this. Try again; if it fails again, opening Settings checks the key with Anthropic.",
  model_daily_limit:
    "The clan's model has drafted as many times as it may today. Try again tomorrow.",
  model_spend_cap:
    "The clan's model has reached this month's spend cap. A leader can raise it in Settings.",
  still_pending:
    "The model is taking longer than usual. Its draft is counted in Settings; try again in a minute.",
  no_pending_draft: "That draft is no longer waiting. Ask for another.",
};

/**
 * The clan's own model drafting the pitch: the words fill the editor, the
 * leader edits them, and nothing is saved until they save. The clan's
 * key lives in Manage ▸ Settings.
 */
function DraftWithModel({ clan, model, navigate, current, onDraft }) {
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [previous, setPrevious] = useState(null);
  const modelPath = `${clanPath(clan.clan_tag)}/manage/settings`;
  const toModel = (e) => {
    e.preventDefault();
    navigate?.(modelPath);
  };
  if (!model.set || model.refused)
    return (
      <div className="notice">
        {model.refused
          ? "Anthropic stopped accepting the clan's key, so the clan's model cannot draft this. "
          : "The clan's own model can draft these words from what the clan is: the game's numbers, what it is for and how it runs. It runs on the clan's own Anthropic key. "}
        <a href={modelPath} onClick={toModel}>
          {model.refused ? "Add the key again" : "Add the clan's key"}
        </a>
        .
      </div>
    );
  const draft = async () => {
    setBusy(true);
    setResult(null);
    const r = await untilWritten((pending) =>
      manageApi.draftPitch(clan.clan_tag, ask.trim() || null, pending),
    );
    setBusy(false);
    if (!r.ok) {
      const e = r.data ?? {};
      setResult({
        error:
          e.error === "model_key_owner_left"
            ? `The clan's key was added by ${e.set_by_name}, who no longer leads the clan. Add a key of yours in Settings.`
            : (DRAFT_ERROR[e.error] ??
              e.message ??
              "The clan's model did not answer. Try again in a minute."),
      });
      return;
    }
    trackEvent("clan.model_drafted", "recruit_pitch");
    setPrevious(current);
    onDraft(r.data.draft);
    setResult(r.data);
  };
  return (
    <div className="panel">
      <div className="panel__head">
        <span>Draft with the clan&rsquo;s model</span>
      </div>
      <div className="panel__body grid gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-[1_1_280px]"
            aria-label="What should it stress?"
            placeholder="What should it stress? (optional)"
            value={ask}
            maxLength={300}
            onChange={(e) => setAsk(e.target.value)}
          />
          <button type="button" className="btn" disabled={busy} onClick={draft}>
            {busy ? "Drafting…" : "Draft it"}
          </button>
        </div>
        <span className="page-head__note">
          Uses the clan&rsquo;s Anthropic key
          {model.model_for?.recruit_pitch
            ? ` (${model.model_for.recruit_pitch.name}, Elixir Clan's choice)`
            : ""}
          . It replaces the tagline, the about, the points and who you are
          looking for below; nothing is saved until you save.
        </span>
        {result?.error ? (
          <p className="field-error m-0" role="alert">
            {result.error}
          </p>
        ) : null}
        {result?.draft ? (
          <div className="grid gap-1" role="status">
            <span className="page-head__note">
              Drafted by {result.model}. Read it as the clan would, then edit
              and save.
            </span>
            {result.checks.map((c) => (
              <span key={c} className="page-head__note text-[var(--warn)]">
                {c}
              </span>
            ))}
            {previous ? (
              <button
                type="button"
                className="btn--text justify-self-start"
                onClick={() => {
                  onDraft(previous, { raw: true });
                  setPrevious(null);
                  setResult(null);
                }}
              >
                Put back what I had
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PitchEditor({ clan, view, navigate, onDone }) {
  // A first pitch starts from a draft of the clan's goals, when it has any.
  const start =
    view.pitch_version === 0 && view.suggested ? view.suggested : view.pitch;
  const [draft, setDraft] = useState(() => ({
    ...start,
    points: (start.points ?? []).join("\n"),
    website_url: start.website_url ?? "",
    contact: start.contact ?? "",
  }));
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.savePitch(clan.clan_tag, draft, note || null);
    setBusy(false);
    if (!r.ok) {
      setErrors(r.data?.errors ?? {});
      setMessage(
        r.data?.errors ? "Fix the fields marked below." : "Save failed.",
      );
      return;
    }
    trackEvent("clan.recruit_saved", `v${r.data.version}`);
    onDone();
  };
  return (
    <div style={{ display: "grid", gap: "14px", maxWidth: "720px" }}>
      <div className="page-head">
        <h1 className="page__title">The pitch</h1>
        <span className="page-head__note">
          Your words; the numbers come from the game. Every save is a new
          version.
          {view.pitch_version === 0 && view.suggested
            ? " This first draft comes from what the clan is for: make it yours."
            : ""}
        </span>
      </div>
      {view.model ? (
        <DraftWithModel
          clan={clan}
          model={view.model}
          navigate={navigate}
          current={draft}
          onDraft={(values, { raw = false } = {}) =>
            setDraft((d) =>
              raw
                ? values
                : {
                    ...d,
                    tagline: values.tagline ?? "",
                    about: values.about ?? "",
                    points: (values.points ?? []).join("\n"),
                    looking_for: values.looking_for ?? "",
                  },
            )
          }
        />
      ) : null}
      {Object.entries(view.fields).map(([key, f]) => (
        <div key={key} style={{ display: "grid", gap: "4px" }}>
          <label
            className="field-label"
            htmlFor={`p-${key}`}
            style={{ fontWeight: 600 }}
          >
            {f.label}{" "}
            <span className="page-head__note">
              ({f.optional ? "optional, " : ""}
              {f.lines
                ? `up to ${f.max} characters a line`
                : `up to ${f.max} characters`}
              )
            </span>
          </label>
          {f.lines || f.max > 200 ? (
            <textarea
              id={`p-${key}`}
              className="input"
              rows={f.lines ? 7 : 4}
              value={draft[key] ?? ""}
              onChange={(e) => set(key, e.target.value)}
            />
          ) : (
            <input
              id={`p-${key}`}
              className="input"
              value={draft[key] ?? ""}
              maxLength={f.max}
              onChange={(e) => set(key, e.target.value)}
            />
          )}
          <span className="page-head__note">{f.why}</span>
          {errors[key] ? <p className="field-error">{errors[key]}</p> : null}
        </div>
      ))}
      <input
        className="input"
        placeholder="A note for this version (optional)"
        value={note}
        maxLength={200}
        onChange={(e) => setNote(e.target.value)}
      />
      {message ? <p className="field-error">{message}</p> : null}
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={save}
        >
          {busy ? "Saving…" : "Save as a new version"}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
      {view.versions.length ? (
        <p className="page-head__note" style={{ margin: 0 }}>
          Versions:{" "}
          {view.versions
            .map(
              (v) =>
                `v${v.version} (${v.saved_at.slice(0, 10)}${v.note ? `, ${v.note}` : ""})`,
            )
            .join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
