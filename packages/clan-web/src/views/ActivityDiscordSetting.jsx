import { useState } from "react";
import { manageApi } from "../api.js";
import { keys, useActivityDiscord, useInvalidate } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";
import { clanPath } from "../lib/base.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");

/**
 * The clan's activity in its own Discord channel (Jamie, 2026-10-10):
 * the body of Social ▸ Discord. A webhook of its own (not the one Actions go
 * to), the categories of the clan's timeline posted there (the policy
 * sets the defaults and can rule one out), and the clan's own model
 * rewriting the posts in a voice the leaders describe. Without the
 * clan's key the rewrite asks for one in Settings. The
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

  const posting = c?.enabled && c?.delivery?.state !== "gone";
  return (
    <div className="grid gap-3">
      <p className="page__lede m-0">
        Post the clan&rsquo;s activity to a Discord channel as it happens: who
        joins and departs, members&rsquo; milestones and the Clan Wars week,
        each a short line with a link back here. This is its own webhook, apart
        from the one Actions go to; members can read these lines, so any channel
        the clan reads will do.
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
          {c.disabled_reason === "webhook_gone" ||
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
                Discord did not take the last post ({day(c.delivery.at)}).
                Elixir Clan tries again with the next one.
              </span>
            </div>
          ) : null}
          <div className="panel__body flex flex-wrap gap-2 pt-0">
            {c.disabled_reason !== "webhook_gone" ? (
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
              Written by the clan&rsquo;s own model
            </legend>
            {!d.model.set ? (
              <div className="callout" role="status">
                <span>
                  To have the posts written in the clan&rsquo;s own voice rather
                  than Elixir&rsquo;s plain lines, add the clan&rsquo;s
                  Anthropic API key in{" "}
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
                      again in Settings; until then Elixir&rsquo;s own lines are
                      posted.
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
                  <span>Rewrite each post with the clan&rsquo;s model</span>
                </label>
                <p className="page-head__note m-0">
                  Posted without anyone reading them first. The model sees only
                  what the line already says; a line that drops a member&rsquo;s
                  name, adds a number or carries a link keeps Elixir&rsquo;s own
                  words. Uses the clan&rsquo;s key, at most {d.rewrites_per_day}{" "}
                  times a day, and never past the clan&rsquo;s monthly cap.
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
              </>
            )}
          </fieldset>
        </>
      ) : null}
    </div>
  );
}
