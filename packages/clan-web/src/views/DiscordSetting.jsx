import { useState } from "react";
import { DiscordDeliveries } from "@elixir-mcp/ui";
import { manageApi } from "../api.js";
import { keys, useDiscord, useInvalidate } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");

/**
 * Actions in the clan's Discord (Jamie, 2026-10-10). A leader or
 * co-leader pastes a webhook from a Discord channel; each Action leaders
 * or elders can take is then posted there, and its message is updated
 * when the Action is completed, declined or withdrawn. The webhook is
 * checked by posting through it, kept sealed and never shown again.
 *
 * Since 2026-10-11: a forum channel's webhook works (each Action is a
 * post of its own), the last deliveries are listed with Discord's words
 * for a refusal, and a leader may name one role to mention on each new
 * Action (opt in; an edit never mentions anyone).
 */
export function DiscordSetting({ clan }) {
  const { state, load } = useDiscord(clan.clan_tag);
  const invalidate = useInvalidate();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [role, setRole] = useState(null);
  const [roleMessage, setRoleMessage] = useState("");
  if (state.signedOut) return null;
  if (state.forbidden)
    return (
      <p className="page-head__note m-0">
        Only the leader and co-leaders can connect the clan&rsquo;s Discord.
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

  const refresh = () => {
    load();
    invalidate(keys.actions(clan.clan_tag));
  };
  const save = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMessage("");
    const r = await manageApi.setDiscord(clan.clan_tag, url.trim());
    setBusy(false);
    // The address leaves the page either way: it is never kept here.
    setUrl("");
    if (!r.ok) {
      setMessage(
        r.data?.message ?? "Discord did not answer. Try again in a minute.",
      );
      return;
    }
    trackEvent("clan.discord_set");
    refresh();
  };
  const saveRole = async (e, value) => {
    e?.preventDefault();
    setBusy(true);
    setRoleMessage("");
    const r = await manageApi.setDiscordMention(clan.clan_tag, value);
    setBusy(false);
    if (!r.ok) {
      setRoleMessage(r.data?.message ?? "That did not save. Try again.");
      return;
    }
    setRole(null);
    trackEvent(value ? "clan.discord_mention_set" : "clan.discord_mention_off");
    load();
  };
  const remove = async () => {
    if (
      !window.confirm(
        "Stop posting Actions to Discord? Messages already there stay.",
      )
    )
      return;
    setBusy(true);
    await manageApi.removeDiscord(clan.clan_tag);
    setBusy(false);
    trackEvent("clan.discord_removed");
    refresh();
  };

  return (
    <div className="grid gap-3">
      <p className="page__lede m-0">
        Post the clan&rsquo;s Actions to a Discord channel: each one leaders or
        elders can take, as a short line and a link to it here, updated when
        someone completes or declines it. Lines name the member, so use a
        channel only your leaders can read. Members&rsquo; own away prompts are
        never posted.
      </p>

      {d.set ? (
        <section className="panel">
          <div className="panel__head flex-wrap gap-2">
            <span>The clan&rsquo;s Discord</span>
            <span
              className={`chip ${d.refused_at || !d.readable ? "chip--warn" : "chip--ok"}`}
              role="status"
            >
              {d.refused_at || !d.readable ? "not posting" : "posting"}
            </span>
          </div>
          <div className="panel__body fields">
            <span className="label">Webhook</span>
            <span>
              {d.name ? `${d.name} · ` : ""}
              <code>{d.hint}</code>
            </span>
            <span className="label">Connected by</span>
            <span>
              {d.set_by_name ?? d.set_by} · {day(d.set_at)}
            </span>
            <span className="label">Actions posted</span>
            <span>
              {d.posted}
              {d.waiting ? ` · ${d.waiting} on the way` : ""}
              {d.forum ? " · each as a forum post of its own" : ""}
            </span>
            <span className="label">Mention</span>
            <span>
              {d.mention_role ? (
                <>
                  <code>{`<@&${d.mention_role}>`}</code> on each new Action{" "}
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={(e) => saveRole(e, null)}
                  >
                    stop mentioning
                  </button>
                </>
              ) : (
                "no one"
              )}
            </span>
          </div>
          <form
            className="panel__body grid gap-2 pt-0"
            onSubmit={(e) => saveRole(e, (role ?? "").trim() || null)}
          >
            <label className="field-label" htmlFor="discord-mention-role">
              Mention a role on each new Action (optional): its id
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="discord-mention-role"
                className="input mono flex-[1_1_220px]"
                inputMode="numeric"
                autoComplete="off"
                spellCheck={false}
                placeholder="Role id, a long number"
                value={role ?? d.mention_role ?? ""}
                onChange={(e) => setRole(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn--sm"
                disabled={busy || role === null}
              >
                Save
              </button>
            </div>
            {roleMessage ? (
              <p className="field-error m-0" role="alert">
                {roleMessage}
              </p>
            ) : null}
            <p className="page-head__note m-0">
              In Discord, with Developer Mode on: Server Settings, Roles,
              right-click the role, Copy Role ID. Only that role is ever
              mentioned, only when an Action is first posted, and never when it
              is updated. Connecting a different webhook clears it.
            </p>
          </form>
          <div className="panel__body pt-0">
            <DiscordDeliveries
              entries={d.deliveries}
              notDelivered={d.not_delivered ?? 0}
            />
          </div>
          {d.refused_at ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>
                Discord stopped accepting this webhook on {day(d.refused_at)}.
                It may have been deleted in Discord. Connect it again, or a new
                one, below.
              </span>
            </div>
          ) : !d.readable ? (
            <div className="callout callout--warn m-3" role="alert">
              <span>This webhook needs to be connected again.</span>
            </div>
          ) : null}
          <div className="panel__body pt-0">
            <button
              type="button"
              className="btn btn--sm"
              disabled={busy}
              onClick={remove}
            >
              Stop posting
            </button>
          </div>
        </section>
      ) : null}

      <form className="grid gap-2" onSubmit={save}>
        <label className="field-label font-semibold" htmlFor="discord-webhook">
          {d.set ? "Replace it with another webhook" : "Connect a webhook"}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="discord-webhook"
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
            {busy ? "Checking…" : "Check and connect"}
          </button>
        </div>
        {message ? (
          <p className="field-error m-0" role="alert">
            {message}
          </p>
        ) : null}
        <p className="page-head__note m-0">
          In Discord: the channel&rsquo;s settings, Integrations, Webhooks, New
          Webhook, Copy Webhook URL. A forum channel works too: each Action
          becomes a post of its own. Connecting posts a short message there to
          check it. The address is kept encrypted and never shown again. Open
          Actions are posted once it is connected
          {d.set ? "; a new webhook starts over in its channel" : ""}.
        </p>
      </form>
    </div>
  );
}
