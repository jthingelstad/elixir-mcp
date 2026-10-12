import { useState } from "react";
import { DISCORD_CLAN_HISTORY_MAX } from "@elixir-mcp/contracts";
import { DiscordDeliveries } from "@elixir-mcp/ui";
import { manageApi } from "../api.js";
import { keys, useActivityDiscord, useInvalidate } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { clanPath } from "../lib/base.js";
import { untilWritten } from "../lib/pending.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");

/**
 * The clan's activity in its own Discord channel (Jamie, 2026-10-10):
 * the body of Social ▸ Discord. A webhook of its own (not the one Actions go
 * to), the categories of the clan's timeline posted there (the policy
 * sets the defaults and can rule one out), and the clan's own model
 * editing the channel in a voice the leaders describe (2026-10-11).
 * Without the clan's key the editor asks for one in Settings. The
 * webhook is kept sealed and shown only in its short form.
 */
export function ActivityDiscordSetting({ clan, navigate }) {
  const settings = `${clanPath(clan.clan_tag)}/manage/settings`;
  const toSettings = (e) => {
    if (!navigate) return;
    e.preventDefault();
    navigate(settings, { hash: "settings-model" });
  };
  const { state } = useActivityDiscord(clan.clan_tag);
  const invalidate = useInvalidate();
  const [url, setUrl] = useState("");
  const [voice, setVoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (state.signedOut) return null;
  if (state.forbidden)
    return (
      <p className="page-head__note m-0">
        Only the leader and co-leaders can connect the clan&rsquo;s activity
        channel.
      </p>
    );
  if (state.error)
    return (
      <p className="page-head__note m-0">
        Elixir Clan did not answer. Try again in a minute.
      </p>
    );
  const d = state.data;
  if (!d) return <p className="page__lede">Reading…</p>;
  const c = d.connection;
  const saved = c?.categories ?? {};
  const voiceNow = voice ?? c?.voice ?? "";

  const send = async (body, event, label) => {
    setBusy(true);
    setMessage("");
    const r = await manageApi.saveActivityDiscord(clan.clan_tag, body);
    setBusy(false);
    if (!r.ok) {
      setMessage(
        r.data?.message ?? "Elixir Clan did not answer. Try again in a minute.",
      );
      // A forum channel's webhook is kept, switched off: show it.
      invalidate(keys.activityDiscord(clan.clan_tag));
      return false;
    }
    if (event) trackEvent(event, label);
    invalidate(keys.activityDiscord(clan.clan_tag));
    return true;
  };
  const connect = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    const body = { url: url.trim() };
    // The address leaves the page either way: it is never kept here.
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
    setBusy(true);
    await manageApi.removeActivityDiscord(clan.clan_tag);
    setBusy(false);
    trackEvent("clan.activity_discord_removed");
    invalidate(keys.activityDiscord(clan.clan_tag));
  };

  const dead = (st) => st === "gone" || st === "forum";
  const posting = c?.enabled && !dead(c?.delivery?.state);
  const forum =
    c?.disabled_reason === "webhook_forum" || c?.delivery?.state === "forum";
  return (
    <div className="grid gap-3">
      <p className="page__lede m-0">
        Post the clan&rsquo;s activity to a Discord channel as it happens: who
        joins and departs, members&rsquo; milestones and the Clan Wars week,
        each moment told as a short story a few minutes after it lands. This is
        its own webhook, apart from the one Actions go to; members can read
        these posts, so any channel the clan reads will do.
      </p>

      {!d.policy.ready ? (
        <div className="callout callout--warn" role="status">
          <span>
            Nothing is posted until the clan has a policy. Set it on the Policy
            page.
          </span>
        </div>
      ) : null}

      {c ? (
        <section className="panel">
          <div className="panel__head flex-wrap gap-2">
            <span>The activity channel</span>
            <span
              className={`chip ${posting ? "chip--ok" : "chip--warn"}`}
              role="status"
            >
              {posting ? "posting" : "not posting"}
            </span>
          </div>
          <div className="panel__body fields">
            <span className="label">Webhook</span>
            <span>
              <code>{c.webhook}</code>
            </span>
            <span className="label">Set by</span>
            <span>
              {c.set_by_name ?? c.set_by} · {day(c.updated_at)}
            </span>
            {c.enabled ? (
              <>
                <span className="label">Posting since</span>
                <span>{day(c.enabled_at)}</span>
              </>
            ) : null}
          </div>
          {forum ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                This webhook belongs to a forum channel, which takes threads,
                not messages, so nothing is posted. Connect a text
                channel&rsquo;s webhook below, or post into one thread: add{" "}
                <code>?thread_id=</code> and the thread&rsquo;s id
                (Discord&rsquo;s Developer Mode, Copy Thread ID) to the end of
                the webhook.
              </span>
            </div>
          ) : c.disabled_reason === "webhook_gone" ||
            c.delivery?.state === "gone" ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                Discord stopped accepting this webhook
                {c.delivery?.at ? ` on ${day(c.delivery.at)}` : ""}. It may have
                been deleted in Discord. Connect a new one below.
              </span>
            </div>
          ) : c.delivery?.state === "failing" ? (
            <div className="callout callout--warn m-3" role="status">
              <span>
                Discord refused a post ({day(c.delivery.at)}
                {c.delivery.reason ? `: ${c.delivery.reason}` : ""}). That post
                was skipped; the others are still posted.
              </span>
            </div>
          ) : null}
          <div className="panel__body flex flex-wrap gap-2 pt-0">
            {!["webhook_gone", "webhook_forum"].includes(c.disabled_reason) ? (
              <button
                type="button"
                className="btn btn--sm"
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
              className="btn btn--sm"
              disabled={busy}
              onClick={remove}
            >
              Disconnect
            </button>
          </div>
          {c.deliveries?.length || c.not_delivered ? (
            <div className="panel__body pt-0">
              <DiscordDeliveries
                entries={c.deliveries}
                notDelivered={c.not_delivered ?? 0}
                // The channel keeps its skips beside its posts.
                show={DISCORD_CLAN_HISTORY_MAX}
                whole
                ratings={d.ratings}
                onRate={(body) =>
                  manageApi.rateActivityDiscord(clan.clan_tag, body)
                }
              />
            </div>
          ) : null}
        </section>
      ) : null}

      <form className="grid gap-2" onSubmit={connect}>
        <label className="field-label font-semibold" htmlFor="activity-webhook">
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
          In Discord: the channel&rsquo;s settings, Integrations, Webhooks, New
          Webhook, Copy Webhook URL. Connecting posts a short hello there.
          Posting starts from that moment: nothing earlier is posted
          {c ? ", and a new webhook starts over in its channel" : ""}.
        </p>
      </form>

      {message ? (
        <p className="field-error m-0" role="alert">
          {message}
        </p>
      ) : null}

      {c ? (
        <>
          <fieldset className="grid gap-2" disabled={busy}>
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

          <fieldset className="grid gap-2" disabled={busy}>
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
                  {d.model.name
                    ? `Edited by ${d.model.name}, the model Elixir Clan uses for this channel. `
                    : ""}
                  Posted without anyone reading them first. The model reads
                  Elixir&rsquo;s stories with what the record says about the
                  clan and each member, and may look up a member&rsquo;s record,
                  their battles this week and what the channel posted lately.
                  Then it tells each story, tells a few together, or skips one
                  with a reason the deliveries above show. A departure is always
                  told, alone, in the record&rsquo;s words. A post that drops or
                  changes a name, carries a number or a name it was not given,
                  says a time of day, carries a link or a mention, or runs long
                  keeps Elixir&rsquo;s own words. Uses the clan&rsquo;s key, at
                  most {d.editor_runs_per_day} runs a day (a run edits up to 12
                  stories ready then; any more are Elixir&rsquo;s own), and
                  never past the clan&rsquo;s monthly cap.
                </p>
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
                  tag={clan.clan_tag}
                  voice={voiceNow}
                  disabled={busy || d.model.refused}
                />
              </>
            )}
          </fieldset>
        </>
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
function EditorPreview({ tag, voice, disabled }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const run = async () => {
    setBusy(true);
    setError("");
    const r = await untilWritten((pending) =>
      manageApi.previewActivityDiscord(tag, voice, pending),
    );
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
    trackEvent("clan.activity_discord_preview");
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
