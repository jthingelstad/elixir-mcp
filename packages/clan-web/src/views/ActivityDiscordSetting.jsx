import { useState } from "react";
import { DISCORD_CLAN_HISTORY_MAX } from "@elixir-mcp/contracts";
import { DiscordDeliveries, Disclosure, Setting } from "@elixir-mcp/ui";
import { manageApi } from "../api.js";
import { keys, useActivityDiscord, useInvalidate } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { clanPath } from "../lib/base.js";
import { untilWritten } from "../lib/pending.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");
const dead = (c) =>
  ["gone", "forum"].includes(c?.delivery?.state) ||
  ["webhook_gone", "webhook_forum"].includes(c?.disabled_reason);

/** Current state stays visible; each scoped editor owns its unsaved draft.
 * The parent observes pending operations across closing and reopening. */
export function ActivityDiscordSetting({ clan, navigate }) {
  const settings = `${clanPath(clan.clan_tag)}/manage/settings`;
  const toSettings = (e) => {
    if (!navigate) return;
    e.preventDefault();
    navigate(settings, { hash: "settings-model" });
  };
  const { state } = useActivityDiscord(clan.clan_tag);
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const perform = async (operation, event, label, refresh = true) => {
    setBusy(true);
    try {
      const r = await operation();
      if (r.ok && event) trackEvent(event, label);
      if (refresh) invalidate(keys.activityDiscord(clan.clan_tag));
      return r;
    } finally {
      setBusy(false);
    }
  };
  if (state.signedOut) return null;
  if (state.forbidden)
    return (
      <p className="page-head__note m-0">
        Only the leader and co-leaders can connect the clan’s activity channel.
      </p>
    );
  if (state.error)
    return (
      <p className="field-error m-0" role="alert">
        Elixir Clan did not answer. Try again in a minute.
      </p>
    );
  const d = state.data;
  if (!d) return <p className="page__lede">Reading…</p>;
  const c = d.connection;
  const hasCategories = d.categories.some((cat) => d.in_effect[cat.key]);
  const posting = c?.enabled && d.policy.ready && hasCategories && !dead(c);
  const editor = (kind) => (
    <ActivityEditor
      key={clan.clan_tag + kind}
      kind={kind}
      d={d}
      busy={busy}
      settings={settings}
      toSettings={toSettings}
      save={(body, event, label) =>
        perform(
          () => manageApi.saveActivityDiscord(clan.clan_tag, body),
          event,
          label,
        )
      }
      remove={() =>
        perform(
          () => manageApi.removeActivityDiscord(clan.clan_tag),
          "clan.activity_discord_removed",
        )
      }
      preview={(voice) =>
        perform(
          () =>
            untilWritten((pending) =>
              manageApi.previewActivityDiscord(clan.clan_tag, voice, pending),
            ),
          "clan.activity_discord_preview",
          undefined,
          false,
        )
      }
    />
  );
  return (
    <div className="grid gap-3">
      {!d.policy.ready ? (
        <div className="callout callout--warn" role="status">
          <span>
            Nothing is posted until the clan has a policy. Set it on the Policy
            page.
          </span>
        </div>
      ) : null}
      <ActivityWarning connection={c} />
      {c ? (
        <>
          <Setting
            title="Activity channel"
            description={
              posting
                ? "Posting · Connected"
                : !d.policy.ready
                  ? "Not posting · Policy needed"
                  : !hasCategories
                    ? "Not posting · No categories on"
                    : "Not posting · Connected"
            }
          >
            {editor("channel")}
          </Setting>
          <Setting
            title="What is posted"
            description={
              d.categories
                .filter((cat) => d.in_effect[cat.key])
                .map((cat) => cat.label)
                .join(" · ") || "No categories on"
            }
          >
            {editor("categories")}
          </Setting>
          <Setting
            title="Channel voice"
            description={
              d.model.refused
                ? "Model key refused · Elixir’s own stories are posted"
                : c.rewrite && d.model.set && !d.model.name
                  ? "Model unavailable · Elixir’s own stories are posted"
                  : c.rewrite && d.model.set
                    ? `${d.model.name ?? "The clan’s model"} · Posted without prior review`
                    : "Elixir’s own stories"
            }
          >
            {editor("voice")}
          </Setting>
          {c.deliveries?.length || c.not_delivered ? (
            <DiscordDeliveries
              entries={c.deliveries}
              notDelivered={c.not_delivered ?? 0}
              show={DISCORD_CLAN_HISTORY_MAX}
              whole
              ratings={d.ratings}
              onRate={(body) =>
                manageApi.rateActivityDiscord(clan.clan_tag, body)
              }
            />
          ) : null}
        </>
      ) : (
        editor("channel")
      )}
      <Disclosure title="How activity posting works">
        <p className="page-head__note m-0">
          Joins, departures, milestones and the Clan Wars week become short
          stories a few minutes after they land. This channel has its own
          webhook, separate from Actions and your personal timeline. Members can
          read these posts; use a channel the clan reads.
        </p>
      </Disclosure>
    </div>
  );
}

function ActivityWarning({ connection: c }) {
  if (!c) return null;
  const forum =
    c.disabled_reason === "webhook_forum" || c.delivery?.state === "forum";
  if (forum)
    return (
      <div className="callout callout--warn" role="alert">
        <span>
          This webhook belongs to a forum channel, which takes threads, not
          messages, so nothing is posted. Manage the activity channel to connect
          a text channel’s webhook, or add <code>?thread_id=</code> and a
          thread’s id to post into that thread.
        </span>
      </div>
    );
  if (c.disabled_reason === "webhook_gone" || c.delivery?.state === "gone")
    return (
      <div className="callout callout--warn" role="alert">
        <span>
          Discord stopped accepting this webhook
          {c.delivery?.at ? ` on ${day(c.delivery.at)}` : ""}. It may have been
          deleted in Discord. Manage the activity channel to connect a new one.
        </span>
      </div>
    );
  if (c.delivery?.state === "failing")
    return (
      <div className="callout callout--warn" role="status">
        <span>
          Discord refused a post ({day(c.delivery.at)}
          {c.delivery.reason ? `: ${c.delivery.reason}` : ""}). That post was
          skipped; the others are still posted.
        </span>
      </div>
    );
  return null;
}

function ActivityEditor({
  kind,
  d,
  busy,
  save,
  remove: disconnect,
  preview,
  settings,
  toSettings,
}) {
  const c = d.connection;
  const saved = c?.categories ?? {};
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState(null);
  const [message, setMessage] = useState("");
  const voiceNow = voice ?? c?.voice ?? "";
  const send = async (...args) => {
    setMessage("");
    const r = await save(...args);
    if (!r.ok)
      setMessage(
        r.data?.message ?? "Elixir Clan did not answer. Try again in a minute.",
      );
    return r.ok;
  };
  const connect = async (e) => {
    e.preventDefault();
    if (!url.trim() || busy) return;
    const body = { url: url.trim() };
    setUrl("");
    await send(body, "clan.activity_discord_set");
  };
  const remove = async () => {
    if (
      !window.confirm(
        "Disconnect the activity channel? Messages already there stay.",
      )
    )
      return;
    setMessage("");
    const r = await disconnect();
    if (!r.ok)
      setMessage(
        r.data?.message ?? "The channel could not be disconnected. Try again.",
      );
  };
  return (
    <div className="grid gap-4">
      {kind === "channel" ? (
        <>
          {c ? (
            <>
              <dl className="fields m-0">
                <dt className="label">Webhook</dt>
                <dd className="m-0 break-all">
                  <code>{c.webhook}</code>
                </dd>
                <dt className="label">Set by</dt>
                <dd className="m-0">
                  {c.set_by_name ?? c.set_by} · {day(c.updated_at)}
                </dd>
                {c.enabled ? (
                  <>
                    <dt className="label">Posting since</dt>
                    <dd className="m-0">{day(c.enabled_at)}</dd>
                  </>
                ) : null}
              </dl>
              <div className="flex flex-wrap gap-2">
                {!dead(c) ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      send(
                        { enabled: !c.enabled },
                        "clan.activity_discord_switch",
                        c.enabled ? "off" : "on",
                      )
                    }
                  >
                    {c.enabled ? "Pause posting" : "Resume posting"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={remove}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : null}
          <form className="grid gap-2" onSubmit={connect}>
            <label
              className="field-label font-semibold"
              htmlFor="activity-webhook"
            >
              {c ? "Replace it with another webhook" : "Connect a webhook"}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="activity-webhook"
                className="input flex-[1_1_280px]"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://discord.com/api/webhooks/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || !url.trim()}
              >
                Connect
              </button>
            </div>
            <p className="page-head__note m-0">
              In Discord: the channel&rsquo;s settings, Integrations, Webhooks,
              New Webhook, Copy Webhook URL. Connecting posts a short hello
              there. Posting starts from that moment: nothing earlier is posted
              {c ? ", and a new webhook starts over in its channel" : ""}.
            </p>
          </form>
        </>
      ) : null}
      {kind === "categories" ? (
        <>
          <fieldset
            className="grid gap-2 border-0 m-0 p-0 min-w-0"
            disabled={busy}
          >
            <legend className="field-label font-semibold">
              What is posted
            </legend>
            {d.categories.map((cat) => {
              const ruledOut = d.policy.ruled_out[cat.key];
              const chosen = typeof saved[cat.key] === "boolean";
              const id = `activity-${cat.key}`;
              return (
                <div key={cat.key} className="grid gap-1">
                  <label className="flex items-center gap-2" htmlFor={id}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(d.in_effect[cat.key])}
                      disabled={Boolean(ruledOut) || !d.policy.ready}
                      onChange={(e) =>
                        send(
                          { categories: { [cat.key]: e.target.checked } },
                          "clan.activity_discord_category",
                          cat.key,
                        )
                      }
                    />
                    <span>{cat.label}</span>
                  </label>
                  <p className="page-head__note m-0">
                    {ruledOut ?? cat.why}
                    {!ruledOut && d.policy.ready ? (
                      chosen ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className="link"
                            onClick={() =>
                              send({ categories: { [cat.key]: null } })
                            }
                          >
                            Use the policy&rsquo;s default (
                            {d.policy.defaults[cat.key] ? "on" : "off"})
                          </button>
                        </>
                      ) : (
                        " The policy's default."
                      )
                    ) : null}
                  </p>
                </div>
              );
            })}
          </fieldset>
        </>
      ) : null}
      {kind === "voice" ? (
        <>
          <fieldset
            className="grid gap-2 border-0 m-0 p-0 min-w-0"
            disabled={busy}
          >
            <legend className="field-label font-semibold">
              Edited by the clan&rsquo;s own model
            </legend>
            {!d.model.set ? (
              <div className="callout" role="status">
                <span>
                  To have the clan&rsquo;s own model edit the channel in the
                  clan&rsquo;s voice rather than post Elixir&rsquo;s own
                  stories, add the clan&rsquo;s Anthropic API key in{" "}
                  <a href={`${settings}#settings-model`} onClick={toSettings}>
                    Settings ›
                  </a>
                </span>
              </div>
            ) : (
              <>
                {d.model.refused ? (
                  <div className="callout callout--warn" role="alert">
                    <span>
                      Anthropic stopped accepting the clan&rsquo;s key. Add it
                      again in Settings; until then Elixir&rsquo;s own stories
                      are posted.
                    </span>
                  </div>
                ) : null}
                <label
                  className="flex items-center gap-2"
                  htmlFor="activity-rewrite"
                >
                  <input
                    id="activity-rewrite"
                    type="checkbox"
                    checked={Boolean(c.rewrite)}
                    disabled={d.model.refused && !c.rewrite}
                    onChange={(e) =>
                      send(
                        { rewrite: e.target.checked },
                        "clan.activity_discord_rewrite",
                        e.target.checked ? "on" : "off",
                      )
                    }
                  />
                  <span>Have the clan&rsquo;s model edit the channel</span>
                </label>
                <p className="page-head__note m-0">
                  Posted without anyone reading them first. Uses the clan’s key
                  and monthly cap.
                </p>
                <Disclosure title="How the model edits posts">
                  <p className="page-head__note m-0">
                    {d.model.name
                      ? `Edited by ${d.model.name}, the model Elixir Clan uses for this channel. `
                      : ""}
                    Posted without anyone reading them first. The model reads
                    Elixir&rsquo;s stories with what the record says about the
                    clan and each member, and may look up a member&rsquo;s
                    record, their battles this week and what the channel posted
                    lately. Then it tells each story, tells a few together, or
                    skips one with a reason the deliveries above show. A
                    departure is always told, alone, in the record&rsquo;s
                    words. A post that drops or changes a name, carries a number
                    or a name it was not given, says a time of day, carries a
                    link or a mention, or runs long keeps Elixir&rsquo;s own
                    words. Uses the clan&rsquo;s key, at most{" "}
                    {d.editor_runs_per_day} runs a day (a run edits up to 12
                    stories ready then; any more are Elixir&rsquo;s own), and
                    never past the clan&rsquo;s monthly cap.
                  </p>
                </Disclosure>
                <form
                  className="grid gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await send({ voice: voiceNow })) setVoice(null);
                  }}
                >
                  <label className="field-label" htmlFor="activity-voice">
                    How the posts should sound
                  </label>
                  <textarea
                    id="activity-voice"
                    className="input min-h-[96px]"
                    maxLength={d.voice_max}
                    placeholder="Warm and a little cheeky; cheer the wins, keep departures short."
                    value={voiceNow}
                    onChange={(e) => setVoice(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      className="btn btn--sm"
                      disabled={busy || voice === null}
                    >
                      Save the voice
                    </button>
                    <span className="page-head__note">
                      {voiceNow.length}/{d.voice_max}. No links or mentions.
                    </span>
                  </div>
                </form>
                <EditorPreview
                  preview={preview}
                  voice={voiceNow}
                  disabled={busy || d.model.refused}
                />
              </>
            )}
          </fieldset>
        </>
      ) : null}
      {message ? (
        <p className="field-error m-0" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Why a previewed story would keep Elixir's own words. */
const REFUSED = {
  empty: "the model's post was empty",
  link: "the model's post carried a link",
  mention: "the model's post carried a mention",
  too_long: "the model's post was too long",
  clock_time: "the model's post said a time of day",
  name_changed: "the model's post dropped or changed a member's name",
  number_invented:
    "the model's post carried a number the record did not give it",
  name_invented: "the model's post carried a name the record did not give it",
  departure_words:
    "the model's post changed Elixir's sentence for a departure or gave a reason",
  merge_refused:
    "the model told it with another story, and this one is told alone",
  skip_refused: "the model skipped it, and a departure is always told",
  key_reused: "the model told it in a post with a story already told",
};

const PREVIEW_ERROR = {
  still_pending:
    "The model is taking longer than usual. The use is counted in Settings; try again in a minute.",
  model_daily_limit:
    "The clan's model has drafted as many times as it may today. Try again tomorrow.",
  model_spend_cap:
    "The clan's model has reached this month's spend cap. A leader can raise it in Settings.",
};

/**
 * The last few stories the channel could post, as the clan's editor
 * would tell them in the voice in the box (saved or not): each post with
 * the stories it tells, each skip with its reason, and each story kept
 * in Elixir's words with why. A leader's own use, counted with the
 * drafts in Settings, in one request with no lookups; nothing is posted
 * (2026-10-11).
 */
function EditorPreview({ preview, voice, disabled }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    const r = await preview(voice);
    setBusy(false);
    if (!r.ok) {
      setResult(null);
      setError(
        PREVIEW_ERROR[r.data?.error] ??
          r.data?.message ??
          "The model did not answer. Check Settings before trying again.",
      );
      return;
    }
    setResult(r.data);
  };
  const elixirOf = new Map((result?.posts ?? []).map((p) => [p.key, p.elixir]));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn btn--sm"
          disabled={disabled || busy}
          onClick={run}
        >
          {busy ? "Editing…" : "Preview the last 5 in this voice"}
        </button>
        <span className="page-head__note">
          Counts as one of the leaders&rsquo; drafts today. Nothing is posted,
          and the preview looks nothing up.
        </span>
      </div>
      {error ? (
        <p className="field-error m-0" role="alert">
          {error}
        </p>
      ) : null}
      {result?.empty ? (
        <p className="page-head__note m-0" role="status">
          Nothing from the last week would be posted to preview.
        </p>
      ) : null}
      {result && !result.empty ? (
        <ol className="grid gap-2 m-0 p-0 list-none" aria-label="Preview">
          {result.posts
            .filter((p) => !p.told_in)
            .map((p) => (
              <li key={p.key} className="panel">
                <div className="panel__body grid gap-1">
                  {p.post ? (
                    <>
                      <span>{p.post}</span>
                      <span className="page-head__note">
                        {p.with?.length
                          ? `Tells ${p.with.length + 1} stories. Elixir's versions: ${[
                              p.elixir,
                              ...p.with.map((k) => elixirOf.get(k)),
                            ]
                              .filter(Boolean)
                              .join(" · ")}`
                          : `Elixir's version: ${p.elixir}`}
                      </span>
                    </>
                  ) : p.skipped ? (
                    <>
                      <span className="page-head__note">
                        Skipped: {p.skipped}
                      </span>
                      <span className="page-head__note">
                        Elixir&rsquo;s version: {p.elixir}
                      </span>
                    </>
                  ) : (
                    <>
                      <span>{p.elixir}</span>
                      <span className="page-head__note">
                        {p.refused
                          ? `Elixir's version would be posted: ${REFUSED[p.refused] ?? "the model's post was refused"}.`
                          : "Elixir's version would be posted, as the model left it."}
                      </span>
                    </>
                  )}
                </div>
              </li>
            ))}
        </ol>
      ) : null}
    </div>
  );
}
