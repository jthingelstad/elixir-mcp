import { useId, useState } from "react";
import { useWrite } from "../client/index.ts";
import { ConfirmAction, Icon, WriteError, useFlash } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { HOME_FEED_KEY, keys, useMyHighlights } from "../lib/queries.js";

/**
 * Highlight it (social slice 4, #762): a signed-in person whose own
 * verified player played this battle posts it to that player's timeline
 * with their words, then may share it as /h/<id>. The server decides who
 * may post (`can_highlight_as`); this panel only shows what it answered,
 * and draws nothing for anyone else.
 */

const WORDS_MAX = 500;
const FEED = [...keys.me, "feed"];
const count = (s) => [...s].length;

export function BattleHighlight({ battle, sides }) {
  const query = useMyHighlights(battle.id);
  const data = query.data;
  if (!data) return null;
  const { can_highlight_as: players = [], highlights = [] } = data;
  const posted = new Set(highlights.map((h) => h.player_tag));
  const open = players.filter((tag) => !posted.has(tag));
  if (highlights.length === 0 && open.length === 0) return null;
  const nameOf = (tag) =>
    sides.flatMap((s) => s.players).find((p) => p.player_tag === tag)?.name ??
    tag;
  const invalidate = [keys.highlights(battle.id), FEED, HOME_FEED_KEY];
  return (
    <section className="panel" aria-label="Highlight this battle">
      <div className="panel__head">Highlight this battle</div>
      <div className="panel__body">
        {highlights.map((h) => (
          <Posted
            key={h.highlight_id}
            h={h}
            name={nameOf(h.player_tag)}
            invalidate={invalidate}
          />
        ))}
        {open.length > 0 && (
          <Compose
            battle={battle}
            players={open}
            nameOf={nameOf}
            invalidate={invalidate}
          />
        )}
      </div>
    </section>
  );
}

function Words({ id, value, onChange, label }) {
  return (
    <>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={WORDS_MAX}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${id}-limit`}
      />
      <p id={`${id}-limit`} className="footnote mt-1">
        {count(value)}/{WORDS_MAX}
      </p>
    </>
  );
}

function Compose({ battle, players, nameOf, invalidate }) {
  const id = useId();
  const [words, setWords] = useState("");
  const [as, setAs] = useState(players[0]);
  const post = useWrite(api.postHighlight, { invalidate });
  const player = players.includes(as) ? as : players[0];
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const r = await post.run({
          battle: battle.id,
          player_tag: player,
          words,
        });
        if (r.ok) setWords("");
      }}
    >
      <p className="footnote mb-3">
        It goes on {nameOf(player)}’s timeline as this battle, with your words.
        People who follow them see it; nobody else does until you share it.
      </p>
      {players.length > 1 && (
        <>
          <label htmlFor={`${id}-as`} className="field-label">
            Post as
          </label>
          <select
            id={`${id}-as`}
            value={player}
            onChange={(event) => setAs(event.target.value)}
          >
            {players.map((tag) => (
              <option key={tag} value={tag}>
                {nameOf(tag)}
              </option>
            ))}
          </select>
        </>
      )}
      <Words
        id={id}
        value={words}
        onChange={setWords}
        label="Your words (optional)"
      />
      <WriteError error={post.error} />
      <div className="share-actions">
        <button
          className="btn btn--gold"
          type="submit"
          disabled={post.busy || count(words) > WORDS_MAX}
        >
          Post to your timeline
        </button>
      </div>
    </form>
  );
}

function Posted({ h, name, invalidate }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(h.words);
  const [copied, flash] = useFlash();
  const edit = useWrite(api.editHighlight, { invalidate });
  const share = useWrite(api.shareHighlight, { invalidate });
  const remove = useWrite(api.deleteHighlight, { invalidate });
  return (
    <div className="highlight-posted">
      {editing ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const r = await edit.run(h.highlight_id, words);
            if (r.ok) setEditing(false);
          }}
        >
          <Words id={id} value={words} onChange={setWords} label="Your words" />
          <WriteError error={edit.error} />
          <div className="share-actions">
            <button className="btn" type="submit" disabled={edit.busy}>
              Save words
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setWords(h.words);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p
          className={`highlight-posted__words${h.words ? "" : " highlight-posted__words--none"}`}
        >
          {h.words ? `“${h.words}”` : "No words, just the battle."}
        </p>
      )}
      {/* The words lead (G9, 2026-11-12); where they are posted is the
          line under them, and the actions are ordinary-sized beside it. */}
      <p className="highlight-posted__where">On {name}’s timeline</p>
      {h.share_url && (
        <div className="share-link">
          <Icon name="link-2" size={15} />
          <span className="share-link__url">{h.share_url}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              navigator.clipboard?.writeText(h.share_url);
              flash();
            }}
          >
            <Icon name={copied ? "check" : "copy"} size={14} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <WriteError error={share.error} />
      <WriteError error={remove.error} />
      {!editing && (
        <div className="highlight-posted__actions">
          {!h.share_url && (
            <button
              className="btn btn--sm"
              type="button"
              disabled={share.busy}
              onClick={() => share.run(h.highlight_id)}
            >
              Share
            </button>
          )}
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => {
              setWords(h.words);
              setEditing(true);
            }}
          >
            Edit words
          </button>
          <ConfirmAction
            label="Delete"
            className="link highlight-posted__delete"
            title="Delete this highlight?"
            body={
              h.share_url
                ? "It leaves the timeline, its words are deleted, and its link stops opening within about a minute."
                : "It leaves the timeline and its words are deleted."
            }
            confirm="Delete"
            run={() => remove.run(h.highlight_id)}
          />
        </div>
      )}
      {h.share_url && (
        <p className="footnote">
          Anyone with the link can open the post, no account needed: your words,{" "}
          {name}’s game name and the battle.
        </p>
      )}
      {h.share_url && <ClanDiscord h={h} name={name} invalidate={invalidate} />}
    </div>
  );
}

/** A shared highlight in its player's clan's Discord (#767): offered only
 *  when the server says the clan's leaders allow it, and only once. */
function ClanDiscord({ h, name, invalidate }) {
  const post = useWrite(api.postHighlightToClan, { invalidate });
  const state = h.clan_discord;
  if (state?.posted_at)
    return <p className="footnote">Posted in your clan’s Discord.</p>;
  if (!state?.available) return null;
  return (
    <div className="highlight-posted__actions">
      <ConfirmAction
        label="Post in your clan’s Discord"
        danger={false}
        title="Post in your clan’s Discord?"
        body={`Everyone in the channel sees your words, ${name}’s game name, the result and the link. It is posted once, and editing or deleting the highlight later does not change it there.`}
        confirm="Post"
        run={() => post.run(h.highlight_id)}
      />
    </div>
  );
}
