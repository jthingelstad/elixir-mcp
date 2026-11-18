import { useEffect, useId, useState } from "react";
import { useWrite } from "../client/index.ts";
import { ConfirmAction, WriteError } from "@elixir-mcp/ui";
import { PostReadState } from "../home/PostReadState.jsx";
import { ItemShare } from "../home/ItemShare.jsx";
import { api } from "../api.js";
import { useBattlePosts, usePostsChanged } from "../lib/queries.js";
import { useAskOnOpen } from "../lib/own-refresh.js";

/**
 * Post about this battle (social slice 4, #762; 2026-11-17, 0292: what
 * was a highlight is a post with a battle attached). A signed-in person
 * whose own verified player played this battle posts about it on that
 * player's timeline, with words or without, then may share it as
 * an opaque /share/<id> link and post it once in the clan's Discord. The server decides who
 * may post (`can_post_as`); this panel only shows what it answered, and
 * draws nothing for anyone else. The post itself is an ordinary post:
 * the Timeline, a player's page and Clan's Feed draw it with its battle.
 */

const WORDS_MAX = 500;
const count = (s) => [...s].length;

export function BattlePosts({ battle, sides }) {
  const query = useBattlePosts(battle.id);
  return (
    <PostReadState query={query}>
      {query.data ? (
        <BattlePostPanel battle={battle} sides={sides} data={query.data} />
      ) : null}
    </PostReadState>
  );
}

function BattlePostPanel({ battle, sides, data }) {
  const invalidate = usePostsChanged();
  // A session page's Post lands here (#post, 2026-11-16; #highlight from
  // a link made before): once the panel has drawn, it scrolls into view.
  useEffect(() => {
    if (!["#post", "#highlight"].includes(window.location.hash)) return;
    document.getElementById("post")?.scrollIntoView?.({ block: "start" });
  }, [data]);
  const { can_post_as: players = [], posts = [] } = data;
  const posted = new Set(posts.map((p) => p.subject_tag));
  const open = players.filter((tag) => !posted.has(tag));
  if (posts.length === 0 && open.length === 0) return null;
  const nameOf = (tag) =>
    sides.flatMap((s) => s.players).find((p) => p.player_tag === tag)?.name ??
    tag;
  return (
    <section id="post" className="panel" aria-label="Post about this battle">
      <div className="panel__head">Post about this battle</div>
      <div className="panel__body">
        {posts.map((it) => (
          <Posted
            key={it.id}
            it={it}
            p={it.post}
            name={nameOf(it.subject_tag)}
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
  // Opening the composer asks for your battles now (lib/own-refresh.js).
  useAskOnOpen(true);
  const [words, setWords] = useState("");
  const [as, setAs] = useState(players[0]);
  const post = useWrite(api.writeBattlePost, { invalidate });
  const player = players.includes(as) ? as : players[0];
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const r = await post.run({
          battle: battle.id,
          player_tag: player,
          text: words,
        });
        if (r.ok) setWords("");
      }}
    >
      <p className="footnote mb-3">
        It goes on {nameOf(player)}’s timeline as a post with this battle and
        your words. People in Elixir see it there; a member who can see it can
        share a link to it.
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
          className="btn btn--primary"
          type="submit"
          disabled={post.busy || count(words) > WORDS_MAX}
        >
          {post.busy ? "Checking" : "Post"}
        </button>
      </div>
    </form>
  );
}

function Posted({ it, p, name, invalidate }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(p.text);
  const edit = useWrite(api.editPost, { invalidate });
  const remove = useWrite(api.deletePost, { invalidate });
  return (
    <div className="highlight-posted">
      {editing ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const r = await edit.run(p.id, words);
            if (r.ok) setEditing(false);
          }}
        >
          <Words id={id} value={words} onChange={setWords} label="Your words" />
          <WriteError error={edit.error} />
          <div className="share-actions">
            <button className="btn" type="submit" disabled={edit.busy}>
              {edit.busy ? "Checking" : "Save words"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => {
                setWords(p.text);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p
          className={`highlight-posted__words${p.text ? "" : " highlight-posted__words--none"}`}
        >
          {p.text ? `“${p.text}”` : "No words, just the battle."}
        </p>
      )}
      {/* The words lead (G9, 2026-11-12); where they are posted is the
          line under them, and the actions are ordinary-sized beside it. */}
      <p className="highlight-posted__where">
        {p.status === "hidden"
          ? "Only you see this one for now: it's waiting for a look."
          : `On ${name}’s timeline`}
      </p>
      <WriteError error={remove.error} />
      {!editing && (
        <div className="highlight-posted__actions">
          {p.status !== "hidden" && <ItemShare it={it} onReady={invalidate} />}
          <button
            className="btn btn--sm"
            type="button"
            onClick={() => {
              setWords(p.text);
              setEditing(true);
            }}
          >
            Edit words
          </button>
          <ConfirmAction
            label="Delete"
            className="link highlight-posted__delete"
            title="Delete this post?"
            body={
              p.share_url
                ? "It leaves the timeline with its cheers and comments, its words are deleted, and its link stops opening."
                : "It leaves the timeline with its cheers and comments, and its words are deleted."
            }
            confirm="Delete"
            run={() => remove.run(p.id)}
          />
        </div>
      )}
      {p.share_url && (
        <p className="footnote">
          Anyone with the link can open the post, no account needed: your words,{" "}
          {name}’s game name and the battle.
        </p>
      )}
      {p.share_url && <ClanDiscord p={p} name={name} invalidate={invalidate} />}
    </div>
  );
}

/** A shared post about a battle in its player's clan's Discord (#767):
 *  offered only when the server says the clan's leaders allow it, and
 *  only once. */
function ClanDiscord({ p, name, invalidate }) {
  const post = useWrite(api.postToClanDiscord, { invalidate });
  const state = p.clan_discord;
  if (state?.posted_at)
    return <p className="footnote">Posted in your clan’s Discord.</p>;
  if (!state?.available) return null;
  return (
    <div className="highlight-posted__actions">
      <ConfirmAction
        label="Post in your clan’s Discord"
        danger={false}
        title="Post in your clan’s Discord?"
        body={`Everyone in the channel sees your words, ${name}’s game name, the result and the link. It is posted once, and editing or deleting the post later does not change it there.`}
        confirm="Post"
        run={() => post.run(p.id)}
      />
    </div>
  );
}
