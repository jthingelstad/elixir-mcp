import { useState } from "react";
import { useWrite } from "@elixir-mcp/client";
import {
  ConfirmAction,
  DetailSheet,
  DiscordDeliveries,
  Fresh,
  PageHead,
  Panel,
  WriteError,
  useClock,
} from "@elixir-mcp/ui";
import { discordOutcome, discordStartHref } from "../../discord.js";
import { SETTINGS } from "../../lib/settings.js";
import { Crumb, Facts, Note } from "./parts.jsx";
import { api } from "../../api.js";
import { scopedKey, useTimelineDiscord } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";

/**
 * The timeline cross-posted to a Discord channel (Jamie, 2026-10-10):
 * every new item as one line, posted as it is recorded and edited in
 * place as a session grows. A person's own timeline, or an agent's. Off, it asks for the channel's webhook; on, it
 * shows the webhook shortened (the address is a credential to post in
 * that channel, so the whole of it is never shown again) and lets you
 * change it or turn it off.
 */
function sharingStatus(s) {
  // The relay's word can come after the save's wait, before the next
  // sync turns the setting off: read it from the delivery too.
  const gone =
    (!s.enabled && s.disabled_reason === "webhook_gone") ||
    (s.enabled && s.delivery?.state === "gone");
  const forum =
    (!s.enabled && s.disabled_reason === "webhook_forum") ||
    (s.enabled && s.delivery?.state === "forum");
  const failing = s.enabled && s.delivery?.state === "failing";
  return { gone, forum, failing };
}

/** The timeline line on an agent's own timeline page: the sheet holds the
 *  editor, so it is there when wanted and out of the way when not. */
export function TimelineDiscord() {
  const scope = useScope();
  const query = useTimelineDiscord();
  const save = useWrite((body) => api.saveTimelineDiscord(body, scope), {
    invalidate: [scopedKey(scope, "feed-discord")],
  });
  const [managing, setManaging] = useState(false);
  const s = query.data ?? null;

  if (query.isPending) return null;
  if (query.isError)
    return (
      <p className="mb-6 text-ink-faint" role="status">
        Discord cross-posting could not be read just now.
      </p>
    );
  const { gone, forum, failing } = sharingStatus(s);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-body-sm">
        <span
          className={gone || forum || failing ? "text-warn" : "text-ink-dim"}
        >
          Discord sharing{" "}
          {gone || forum || failing
            ? "needs attention"
            : s.enabled
              ? "on"
              : "off"}
        </span>
        {s.enabled && s.delivery?.state === "ok" ? (
          <Fresh label="last delivered" ts={s.delivery.at} />
        ) : null}
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => setManaging(true)}
        >
          Manage sharing
        </button>
      </div>
      {managing ? (
        <DetailSheet
          title="Timeline to Discord"
          onClose={() => setManaging(false)}
        >
          <TimelineSharing
            key={scope ?? "person"}
            scope={scope}
            query={query}
            save={save}
          />
        </DetailSheet>
      ) : null}
    </>
  );
}

/** The person's Discord home: `/settings/connections/discord`. The account
 *  link and the timeline in a channel are separate things, side by side. */
export function DiscordPage({ me, refresh, search = "" }) {
  const query = useTimelineDiscord();
  const save = useWrite((body) => api.saveTimelineDiscord(body, null), {
    invalidate: [scopedKey(null, "feed-discord")],
  });
  const [came] = useState(() => discordOutcome(search, "link"));
  const s = query.data ?? null;
  const status = s ? sharingStatus(s) : null;
  return (
    <div className="st-page">
      <Crumb to={`${SETTINGS}/connections`}>Connections &amp; agents</Crumb>
      <PageHead
        title="Discord"
        sub="Your Discord account, and your timeline in a channel."
      />
      {came?.text ? (
        <p className={came.ok ? "" : "field-error"} role="status">
          {came.text}
        </p>
      ) : null}
      {!me?.features?.discord_login && !me?.discord ? null : (
        <Panel title="Your Discord" titleAs="h2">
          <Facts
            rows={[
              [
                "Account",
                me?.discord ? (
                  <>
                    Connected as {me.discord.username}
                    <Note>
                      Sign in with it, and a clan&rsquo;s Discord agent knows it
                      is you.
                    </Note>
                    <div className="st-actions">
                      <ConfirmAction
                        label="Disconnect"
                        title="Disconnect Discord?"
                        body="You can't sign in with it, and a clan's Discord agent no longer knows it is you. Your email still signs you in."
                        confirm="Disconnect"
                        run={() => api.unlinkDiscord()}
                        onDone={(r) => {
                          if (r?.ok) refresh?.();
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <a
                      className="btn btn--sm"
                      href={discordStartHref({ intent: "link" })}
                    >
                      Connect Discord
                    </a>
                    <Note>
                      Sign in with it, and a clan&rsquo;s Discord agent knows it
                      is you.
                    </Note>
                  </>
                ),
              ],
            ]}
          />
        </Panel>
      )}
      {query.isError ? (
        <p className="text-ink-faint" role="status">
          Discord cross-posting could not be read just now.
        </p>
      ) : s ? (
        <Panel
          title="Timeline to Discord"
          titleAs="h2"
          action={
            <span
              className={
                status.gone || status.forum || status.failing
                  ? "chip chip--warn"
                  : s.enabled
                    ? "chip chip--ok"
                    : "chip"
              }
            >
              {status.gone || status.forum || status.failing
                ? "Needs attention"
                : s.enabled
                  ? "On"
                  : "Off"}
            </span>
          }
        >
          <TimelineSharing scope={null} query={query} save={save} />
        </Panel>
      ) : null}
    </div>
  );
}

/** Draft and feedback belong to this mount. The parent keeps the mutation
 * observer, so reopening cannot repeat an update that is still in flight. */
function TimelineSharing({ scope, query, save }) {
  const { when } = useClock();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState(null);
  const s = query.data;
  const { gone, forum, failing } = sharingStatus(s);
  const asking = !s.enabled
    ? !s.webhook || gone || forum || editing
    : editing || gone || forum;
  const run = async (body, done) => {
    setSaid("");
    setError(null);
    const r = await save.run(body);
    // A refused save may still have changed the setting (a forum
    // channel's webhook is kept, off): read it again.
    if (!r.ok) {
      setError(r.error);
      query.refetch?.();
      return;
    }
    setEditing(false);
    setUrl("");
    setSaid(done(r.data));
  };
  const hello = (d) =>
    d.hello_sent
      ? "Saved. A first line was sent to the channel: look for it there."
      : "Saved.";

  return (
    <div className="panel__body space-y-3">
      <p>
        {scope
          ? "Every new item on this agent's timeline, posted to a Discord channel as Elixir records it:"
          : "Every new item on your timeline, posted to a Discord channel as Elixir records it:"}{" "}
        one line each, edited in place as a session grows, with links back here.
        Nothing from before it is turned on is posted, and leaders-only items
        never are.
      </p>
      {gone ? (
        <div className="callout callout--warn" role="alert">
          <span>
            Discord says the webhook no longer exists, so cross-posting turned
            off {s.disabled_at ? when(s.disabled_at) : ""}. Add a new webhook to
            turn it back on.
          </span>
        </div>
      ) : null}
      {forum ? (
        <div className="callout callout--warn" role="alert">
          <span>
            That webhook belongs to a forum channel, which takes posts, not
            lines, so cross-posting is off. Use a text channel&rsquo;s webhook,
            or post into one thread: add{" "}
            <span className="mono">?thread_id=</span> and the thread&rsquo;s id
            to the end of the webhook.
          </span>
        </div>
      ) : null}
      {failing ? (
        <div className="callout callout--warn" role="alert">
          <span>
            Discord refused a line
            {s.delivery.http_status
              ? ` (HTTP ${s.delivery.http_status}${s.delivery.reason ? `: ${s.delivery.reason}` : ""})`
              : s.delivery.reason
                ? ` (${s.delivery.reason})`
                : ""}
            , <Fresh ts={s.delivery.at} />. That line was skipped. The others
            are still posted.
          </span>
        </div>
      ) : null}
      {s.enabled && !gone && !forum ? (
        <p>
          On since {when(s.enabled_at)}, posting to{" "}
          <span className="mono break-all">{s.webhook}</span>.
          {s.delivery?.state === "ok" ? (
            <>
              {" "}
              Last delivered <Fresh ts={s.delivery.at} />.
            </>
          ) : null}
        </p>
      ) : s.webhook && !gone && !forum ? (
        <p>
          Off. The saved webhook is{" "}
          <span className="mono break-all">{s.webhook}</span>.
        </p>
      ) : null}
      {s.enabled && s.clan_channels?.length ? (
        <div className="callout" role="note">
          <span>
            {s.clan_channels.map((c) => c.name ?? c.clan_tag).join(", ")}{" "}
            {s.clan_channels.length > 1 ? "post" : "posts"} the clan&rsquo;s
            activity to a Discord channel of its own. Those lines are in your
            timeline too, so they are posted here as well: a server that carries
            both channels shows them twice. Nothing here is filtered.
          </span>
        </div>
      ) : null}

      {asking ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (ev) => {
            ev.preventDefault();
            await run({ url: url.trim(), enabled: true }, hello);
          }}
        >
          <input
            id="timeline-discord-url"
            className="mono min-w-0 flex-[1_1_18rem]"
            aria-label="Discord webhook URL"
            aria-describedby="timeline-discord-hint"
            placeholder="https://discord.com/api/webhooks/…"
            autoComplete="off"
            spellCheck={false}
            value={url}
            disabled={save.busy}
            onChange={(ev) => setUrl(ev.target.value)}
            required
          />
          <button className="btn" disabled={save.busy}>
            {s.enabled ? "Save webhook" : "Turn on"}
          </button>
          {editing ? (
            <button
              type="button"
              className="btn--text"
              onClick={() => {
                setEditing(false);
                setUrl("");
                setError(null);
              }}
            >
              cancel
            </button>
          ) : null}
          <p className="hint w-full" id="timeline-discord-hint">
            In Discord: the channel&rsquo;s settings › Integrations › Webhooks ›
            New Webhook › Copy Webhook URL. Anyone holding it can post in that
            channel, so keep it to yourself. Elixir shows it shortened from here
            on.
          </p>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {s.enabled ? (
            <>
              <button
                className="btn btn--quiet"
                disabled={save.busy}
                onClick={() => {
                  setSaid("");
                  setEditing(true);
                }}
              >
                Change webhook
              </button>
              <button
                className="btn btn--quiet"
                disabled={save.busy}
                onClick={() =>
                  run(
                    { enabled: false },
                    () => "Turned off. Nothing more is posted.",
                  )
                }
              >
                Turn off
              </button>
            </>
          ) : (
            <>
              <button
                className="btn"
                disabled={save.busy}
                onClick={() => run({ enabled: true }, hello)}
              >
                Turn on
              </button>
              <button
                className="btn btn--quiet"
                disabled={save.busy}
                onClick={() => {
                  setSaid("");
                  setEditing(true);
                }}
              >
                Use another webhook
              </button>
            </>
          )}
        </div>
      )}
      {error ? <WriteError error={error} /> : null}
      {said ? <p role="status">{said}</p> : null}
      <DiscordDeliveries
        entries={s.deliveries}
        notDelivered={s.not_delivered ?? 0}
        ratings={s.ratings}
        onRate={(body) => api.rateTimelineDiscord(body, scope)}
      />
    </div>
  );
}

/** One line for a Settings page: whether the timeline is cross-posted,
 *  and where (shortened). */
export function TimelineDiscordState({ agent = null }) {
  const query = useTimelineDiscord(agent);
  const s = query.data ?? null;
  if (!s) return <span className="hint">Reading.</span>;
  if (s.enabled)
    return (
      <>
        On, to <span className="mono break-all">{s.webhook}</span>
        {s.delivery?.state === "ok" ? (
          <Note>
            Last delivered <Fresh ts={s.delivery.at} />
          </Note>
        ) : null}
      </>
    );
  return s.disabled_reason === "webhook_gone"
    ? "Off. Discord said the webhook no longer exists."
    : s.disabled_reason === "webhook_forum"
      ? "Off. The webhook belongs to a forum channel."
      : "Off.";
}
