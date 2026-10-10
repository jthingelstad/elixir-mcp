import { useState } from "react";
import { useWrite } from "@elixir-mcp/client";
import { Fresh, WriteError, useClock } from "@elixir-mcp/ui";
import { api } from "../../api.js";
import { scopedKey, useTimelineDiscord } from "../../lib/queries.js";
import { useScope } from "../../lib/scope.js";

/**
 * The timeline cross-posted to a Discord channel (Jamie, 2026-10-10):
 * every new item as one line, posted as it is recorded and edited in
 * place as a session grows. A person's own timeline, or on an agent's
 * console the agent's. Off, it asks for the channel's webhook; on, it
 * shows the webhook shortened (the address is a credential to post in
 * that channel, so the whole of it is never shown again) and lets you
 * change it or turn it off.
 */
export function TimelineDiscord() {
  const scope = useScope();
  const { stamp } = useClock();
  const query = useTimelineDiscord();
  const save = useWrite((body) => api.saveTimelineDiscord(body, scope), {
    invalidate: [scopedKey(scope, "feed-discord")],
  });
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [said, setSaid] = useState("");
  const s = query.data ?? null;

  if (query.isPending) return null;
  if (query.isError)
    return (
      <p className="mb-6 text-ink-faint" role="status">
        Discord cross-posting could not be read just now.
      </p>
    );

  const gone = !s.enabled && s.disabled_reason === "webhook_gone";
  const failing = s.enabled && s.delivery?.state === "failing";
  const asking = !s.enabled ? !s.webhook || gone || editing : editing;
  const run = async (body, done) => {
    setSaid("");
    const r = await save.run(body);
    if (!r.ok) return;
    setEditing(false);
    setUrl("");
    setSaid(done(r.data));
  };
  const hello = (d) =>
    d.hello_sent
      ? "Saved. A first line was sent to the channel: look for it there."
      : "Saved.";

  return (
    <section className="panel mb-6" aria-labelledby="timeline-discord-title">
      <div className="panel__head">
        <span className="panel-title" id="timeline-discord-title">
          Cross-post to Discord
        </span>
        <span className="hint">{s.enabled ? "on" : "off"}</span>
      </div>
      <div className="panel__body space-y-3">
        <p>
          {scope
            ? "Every new item on this agent's timeline, posted to a Discord channel as Elixir records it:"
            : "Every new item on your timeline, posted to a Discord channel as Elixir records it:"}{" "}
          one line each, edited in place as a session grows, with links back
          here. Nothing from before it is turned on is posted, and leaders-only
          items never are.
        </p>
        {gone ? (
          <div className="callout callout--warn" role="alert">
            <span>
              Discord says the webhook no longer exists, so cross-posting turned
              off {s.disabled_at ? stamp(s.disabled_at) : ""}. Add a new webhook
              to turn it back on.
            </span>
          </div>
        ) : null}
        {failing ? (
          <div className="callout callout--warn" role="alert">
            <span>
              Discord refused the last post
              {s.delivery.http_status
                ? ` (HTTP ${s.delivery.http_status})`
                : ""}
              , <Fresh ts={s.delivery.at} />. Check the webhook still posts to
              the channel, or change it.
            </span>
          </div>
        ) : null}
        {s.enabled ? (
          <p>
            On since {stamp(s.enabled_at)}, posting to{" "}
            <span className="mono break-all">{s.webhook}</span>.
            {s.delivery?.state === "ok" ? (
              <>
                {" "}
                Last delivered <Fresh ts={s.delivery.at} />.
              </>
            ) : null}
          </p>
        ) : s.webhook && !gone ? (
          <p>
            Off. The saved webhook is{" "}
            <span className="mono break-all">{s.webhook}</span>.
          </p>
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
                  save.reset();
                }}
              >
                cancel
              </button>
            ) : null}
            <p className="hint w-full" id="timeline-discord-hint">
              In Discord: the channel&rsquo;s settings › Integrations › Webhooks
              › New Webhook › Copy Webhook URL. Anyone holding it can post in
              that channel, so keep it to yourself; Elixir shows it shortened
              from here on.
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
        {save.error ? <WriteError error={save.error} /> : null}
        {said ? <p role="status">{said}</p> : null}
      </div>
    </section>
  );
}

/** One line for a Settings page: whether the timeline is cross-posted,
 *  and where (shortened). */
export function TimelineDiscordState({ agent = null }) {
  const query = useTimelineDiscord(agent);
  const s = query.data ?? null;
  if (!s) return <span className="hint">…</span>;
  if (s.enabled)
    return (
      <>
        on, to <span className="mono break-all">{s.webhook}</span>
      </>
    );
  return s.disabled_reason === "webhook_gone"
    ? "off: Discord said the webhook no longer exists"
    : "off";
}
