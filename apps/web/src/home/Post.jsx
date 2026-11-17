import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CardArt,
  Chips,
  ConfirmAction,
  DeckRow,
  Icon,
  avatarCardOf,
} from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useMe } from "../App.jsx";
import { useCardCatalog, usePostsChanged } from "../lib/queries.js";
import { useScope } from "../lib/scope.js";
import { ReportForm } from "./Comments.jsx";
import {
  POST_CARDS_MAX,
  POST_MAX,
  averageElixir,
  canPost,
  postsOn,
  readDraft,
  refusalWords,
} from "./post-set.js";

/**
 * Posts (2026-11-17): a person's own few words on the Timeline, perhaps a
 * question, perhaps with a deck from the game's "Copy deck" link or a few
 * cards from the catalog. The server half is services/web-api/src
 * posts.mjs; the rules are docs/notes/2026-11-17-posts.md.
 *
 * The words are the writer's: drawn as plain text, never as links,
 * Markdown or tags. No images, and no links: a deck link from the game is
 * read into the deck and leaves the words.
 */
export function usePostsOn() {
  const { me } = useMe();
  const scope = useScope();
  return postsOn(me, scope);
}

/** Whether this reader may write one now. */
export function useMayPost() {
  const { me } = useMe();
  return usePostsOn() && canPost(me);
}

/**
 * The composer at the feed's top: a quiet line until it is tapped (or the
 * page head's Post opens it), then the box, Post or Ask a question, the
 * deck a pasted link carries, and Add cards.
 */
export function PostComposer({ open, setOpen }) {
  const may = useMayPost();
  if (!may) return null;
  if (!open)
    return (
      <div className="kit-post-compose kit-post-compose--quiet">
        <button
          type="button"
          className="kit-post-compose__start"
          onClick={() => setOpen(true)}
        >
          <Icon name="plus" size={16} />
          Write a post or ask a question
        </button>
      </div>
    );
  return <PostForm onClose={() => setOpen(false)} />;
}

function PostForm({ onClose }) {
  const [text, setText] = useState("");
  const [question, setQuestion] = useState(false);
  const [cards, setCards] = useState([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const fieldId = useId();
  const changed = usePostsChanged();
  const catalog = useCardCatalog();
  useEffect(() => {
    box.current?.focus();
  }, []);
  const draft = readDraft(text);
  const left = POST_MAX - draft.length;
  const byId = useMemo(
    () =>
      new Map(
        (Array.isArray(catalog.data?.cards) ? catalog.data.cards : []).map(
          (c) => [c.id, c],
        ),
      ),
    [catalog.data],
  );
  const deckCards = draft.deck
    ? draft.deck.cards.map((id) => ({
        id,
        name: byId.get(id)?.name ?? "A card",
        elixir_cost: byId.get(id)?.elixir_cost ?? null,
      }))
    : null;
  const empty = !draft.words;
  const send = async (e) => {
    e.preventDefault();
    if (busy || empty || left < 0) return;
    setBusy(true);
    setError(null);
    const res = await api.writePost({
      text,
      question,
      cards: draft.deck ? [] : cards,
    });
    setBusy(false);
    if (res.ok) {
      setText("");
      setCards([]);
      setQuestion(false);
      changed();
      onClose();
      return;
    }
    setError(refusalWords(res));
    box.current?.focus();
  };
  return (
    <form className="kit-post-compose" onSubmit={send}>
      <Chips
        label="Kind of post"
        options={[
          { key: "post", label: "Say something" },
          { key: "question", label: "Ask a question" },
        ]}
        value={question ? "question" : "post"}
        onChange={(v) => setQuestion(v === "question")}
      />
      <textarea
        id={fieldId}
        ref={box}
        aria-label={question ? "Your question" : "Your post"}
        className="kit-comments__field kit-post-compose__field"
        rows={3}
        maxLength={POST_MAX * 3}
        placeholder={
          question
            ? "Ask your followers and clanmates. Paste a deck link from the game to show the deck."
            : "Say something to your followers and clanmates"
        }
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${fieldId}-help`}
        onChange={(e) => setText(e.target.value)}
      />
      {deckCards ? (
        <div className="kit-written__deck">
          <p className="kit-tiny m-0">The deck from your link</p>
          <DeckRow cards={deckCards} showCost label="The deck from your link" />
        </div>
      ) : cards.length ? (
        <PostCards
          cards={cards.map((id) => ({
            id,
            name: byId.get(id)?.name ?? "A card",
          }))}
          onRemove={(id) => setCards(cards.filter((c) => c !== id))}
        />
      ) : null}
      {picking && !draft.deck ? (
        <CardPicker
          picked={cards}
          onPick={(id) =>
            setCards(
              cards.includes(id)
                ? cards.filter((c) => c !== id)
                : cards.length < POST_CARDS_MAX
                  ? [...cards, id]
                  : cards,
            )
          }
          onDone={() => setPicking(false)}
        />
      ) : null}
      <div className="kit-comments__send">
        <span
          id={`${fieldId}-help`}
          className={left < 0 ? "field-error" : "kit-tiny"}
        >
          {left < 0 ? `${-left} too many` : `${left} left`}
        </span>
        <span className="kit-post-compose__acts">
          {!draft.deck ? (
            <button
              type="button"
              className="btn btn--sm"
              aria-expanded={picking}
              onClick={() => setPicking(!picking)}
            >
              {cards.length ? `Cards (${cards.length})` : "Add cards"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--sm btn--primary"
            disabled={busy || empty || left < 0}
          >
            {busy ? "Checking" : question ? "Ask" : "Post"}
          </button>
        </span>
      </div>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Up to eight cards, searched by name in the catalog: a card's own art
 *  and its name, never a tower troop. */
function CardPicker({ picked, onPick, onDone }) {
  const [query, setQuery] = useState("");
  const catalog = useCardCatalog();
  const cards = useMemo(
    () =>
      (Array.isArray(catalog.data?.cards) ? catalog.data.cards : [])
        .filter((c) => avatarCardOf(c?.id) !== null && c.name)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog.data],
  );
  const q = query.trim().toLowerCase();
  const shown = q
    ? cards.filter((c) => c.name.toLowerCase().includes(q))
    : cards;
  const full = picked.length >= POST_CARDS_MAX;
  return (
    <div className="kit-post-picker">
      <input
        type="search"
        className="input"
        aria-label="Search cards"
        placeholder="Search cards"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="kit-tiny m-0" role="status">
        {full
          ? `That's ${POST_CARDS_MAX}, the most a post carries.`
          : `${picked.length} of ${POST_CARDS_MAX} picked`}
      </p>
      {catalog.isPending ? (
        <p className="kit-tiny m-0">Loading cards…</p>
      ) : catalog.isError || cards.length === 0 ? (
        <p className="kit-tiny m-0">
          The cards couldn't be loaded. Try again later.
        </p>
      ) : shown.length === 0 ? (
        <p className="kit-tiny m-0">No card matches that.</p>
      ) : (
        <div className="avpick__grid" role="group" aria-label="Cards">
          {shown.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className="avpick__tile"
                aria-label={c.name}
                aria-pressed={on}
                disabled={!on && full}
                onClick={() => onPick(c.id)}
              >
                <CardArt
                  card={{ id: c.id, name: c.name }}
                  size={48}
                  showLevel={false}
                />
                <span className="avpick__name">{c.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <button type="button" className="btn btn--sm" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/** Loose cards as art with their names; with `onRemove`, each one taps
 *  out. */
function PostCards({ cards, onRemove = null }) {
  return (
    <ul className="kit-written__cards" aria-label="Cards">
      {cards.map((c) => (
        <li key={c.id}>
          {onRemove ? (
            <button
              type="button"
              className="kit-written__card"
              aria-label={`Take out ${c.name}`}
              onClick={() => onRemove(c.id)}
            >
              <CardArt card={c} size={48} showLevel={false} />
              <span className="kit-written__name">{c.name}</span>
            </button>
          ) : (
            <span className="kit-written__card">
              <span aria-hidden="true">
                <CardArt card={c} size={48} showLevel={false} />
              </span>
              <span className="kit-written__name">{c.name}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A post's body in the feed: Question when it is one, the words as
 *  plain text, and its deck (the label, the average elixir, Copy deck) or
 *  its cards. */
export function PostBody({ it }) {
  const p = it.post ?? {};
  return (
    <div className="kit-written">
      {p.question ? <p className="kit-written__label">Question</p> : null}
      <p className="kit-written__text">{String(p.text ?? "")}</p>
      {p.status === "hidden" ? (
        <p className="kit-tiny m-0">
          Only you see this one for now: it's waiting for a look.
        </p>
      ) : null}
      {p.deck ? <PostDeck deck={p.deck} /> : null}
      {p.cards?.length ? <PostCards cards={p.cards} /> : null}
    </div>
  );
}

function PostDeck({ deck }) {
  const [copied, setCopied] = useState(null);
  const avg = deck.average_elixir ?? averageElixir(deck.cards);
  return (
    <div className="kit-written__deck">
      <DeckRow
        cards={deck.cards}
        showCost
        label={
          deck.label
            ? `${deck.label}, the deck in this post`
            : "The deck in this post"
        }
      />
      <p className="kit-decklabel kit-written__decklabel">
        {deck.label ? <b>{deck.label}</b> : null}
        {deck.label && avg != null ? " · " : null}
        {avg != null ? `${avg.toFixed(1)} average elixir` : null}
        {deck.tower_troop ? ` · ${deck.tower_troop.name}` : null}
      </p>
      {deck.copy_link ? (
        <span className="kit-written__copy">
          <button
            type="button"
            className="btn btn--sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(deck.copy_link);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Icon name="copy" size={16} />
            Copy deck
          </button>
          <span className="kit-tiny" role="status">
            {copied === true
              ? "Copied. Open it in Clash Royale to use the deck."
              : copied === false
                ? "Couldn't copy here."
                : ""}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** What the reader may do about a post: delete their own, report or
 *  block someone else's. */
export function PostActions({ it }) {
  const p = it.post ?? {};
  const changed = usePostsChanged();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const name = p.author?.name ?? p.author?.player_tag ?? "this player";
  if (reported)
    return (
      <p className="kit-tiny kit-written__acts" role="status">
        Thanks. You won't see that post now.
      </p>
    );
  return (
    <div className="kit-written__acts">
      {p.can_delete ? (
        <ConfirmAction
          label="Delete"
          className="btn btn--quiet btn--sm"
          title="Delete your post?"
          body="It goes for good, with its cheers and comments."
          confirm="Delete"
          run={() => api.deletePost(p.id)}
          onDone={(out) => {
            if (out?.ok) changed();
          }}
        />
      ) : null}
      {p.can_report ? (
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          aria-expanded={reporting}
          onClick={() => setReporting(!reporting)}
        >
          Report
        </button>
      ) : null}
      {p.can_block ? (
        <ConfirmAction
          label="Block"
          className="btn btn--quiet btn--sm"
          title={`Block ${name}?`}
          body="You won't see each other's posts or comments, and they can't comment on your play or cheer it. Any follows between you end. They won't be told. Battles and player pages stay as they are."
          confirm="Block"
          run={() => api.block({ post_id: p.id })}
          onDone={(out) => {
            if (out?.ok) changed();
          }}
        />
      ) : null}
      {reporting ? (
        <ReportForm
          id={p.id}
          run={(reason) => api.reportPost(p.id, reason)}
          onDone={() => {
            setReported(true);
            changed();
          }}
        />
      ) : null}
    </div>
  );
}
