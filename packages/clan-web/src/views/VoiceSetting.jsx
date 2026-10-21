import { useState } from "react";
import { manageApi } from "../api.js";
import { keys, useInvalidate, useVoice } from "../lib/queries.js";
import { trackEvent } from "../analytics.js";

const day = (ts) => (ts ? ts.slice(0, 10) : "");

/**
 * How our messages sound (2026-10-20): the clan's one voice, in its
 * leaders' words, for both of the clan's model's writing uses: "Draft in
 * our voice" on an Action and the editor of the clan's Discord activity
 * channel. Social ▸ Discord shows it and links here; this is the one
 * place it is edited. The model gets it as written, and it never lifts a
 * rule: it sets the tone and the wording, never the facts.
 */
export function VoiceSetting({ clan }) {
  const { state } = useVoice(clan.clan_tag);
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (state.signedOut) return null;
  if (state.forbidden)
    return (
      <p className="page-head__note m-0">
        Only the leader and co-leaders can set how the clan&rsquo;s messages
        sound.
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
  const now = draft ?? d.voice;
  const save = async (e) => {
    e.preventDefault();
    if (busy || draft === null) return;
    setBusy(true);
    setMessage("");
    const r = await manageApi.setVoice(clan.clan_tag, now);
    setBusy(false);
    if (!r.ok) {
      setMessage(
        r.data?.message ?? "Elixir Clan did not answer. Try again in a minute.",
      );
      return;
    }
    trackEvent("clan.voice_set", r.data.voice ? "set" : "cleared");
    setDraft(null);
    invalidate(keys.voice(clan.clan_tag));
    invalidate(keys.activityDiscord(clan.clan_tag));
  };
  return (
    <form className="grid gap-2" onSubmit={save}>
      <p className="page__lede m-0">
        In your own words, how the clan&rsquo;s model should sound when it
        drafts a message for an Action and when it edits the clan&rsquo;s
        Discord activity channel. The model gets these words as written. They
        set the tone and the wording, never the facts: a message still says only
        what the record says, and every check still applies.
      </p>
      <label className="field-label font-semibold" htmlFor="clan-voice">
        How our messages sound
      </label>
      <textarea
        id="clan-voice"
        className="input min-h-[96px]"
        maxLength={d.max}
        aria-describedby="clan-voice-bound"
        placeholder="Warm and a little cheeky; cheer the wins, keep departures short."
        value={now}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="btn btn--sm"
          disabled={busy || draft === null}
        >
          Save the voice
        </button>
        <span id="clan-voice-bound" className="page-head__note">
          {now.length}/{d.max}. At most {d.max} characters, one paragraph, no
          links or mentions. Empty means none.
        </span>
      </div>
      {d.set_by_name ? (
        <p className="page-head__note m-0">
          Last set by {d.set_by_name} · {day(d.set_at)}
        </p>
      ) : null}
      {message ? (
        <p className="field-error m-0" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  );
}
