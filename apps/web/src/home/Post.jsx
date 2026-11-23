import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CardArt,
  Chips,
  ConfirmAction,
  DeckRow,
  DeckVersus,
  Icon,
  Link,
  TagText,
  useClock,
  avatarCardOf,
} from "@elixir-mcp/ui";
import { postableMoment } from "@elixir-mcp/posts/moment";
import { memberItemPath, timelineItemRef } from "@elixir-mcp/ui/item-link";
import { api } from "../api.js";
import { useMe } from "../App.jsx";
import {
  useCardCatalog,
  useDeckTrial,
  useInvalidate,
  usePostsChanged,
} from "../lib/queries.js";
import { modeWord } from "./logic.js";
import { ReportForm } from "./Comments.jsx";
import { CheckingLine, notPostedWords } from "./check-words.jsx";
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
 *
 * A post may carry a battle instead of a deck or cards (0292: what was a
 * highlight). It is written from the battle's own page (views/
 * BattlePosts.jsx), its words optional, and drawn here with the battle:
 * what happened, both decks with the score between, and Open battle.
 */
export function usePostsOn() {
  const { me } = useMe();
  return postsOn(me);
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
  const start = useRef(null);
  const opener = useRef(null);
  useEffect(() => {
    if (open || !opener.current) return;
    // Run after the closed composer has mounted its wide entry point.
    // The phone's Post button stays in the page head throughout.
    const target = opener.current.isConnected ? opener.current : start.current;
    opener.current = null;
    target?.focus();
  }, [open]);
  if (!may) return null;
  if (!open)
    return (
      <div className="kit-post-compose kit-post-compose--quiet">
        <button
          ref={start}
          type="button"
          className="kit-post-compose__start"
          onClick={(event) => {
            opener.current = event.currentTarget;
            setOpen(true);
          }}
        >
          <Icon name="plus" size={16} />
          Write a post or ask a question
        </button>
      </div>
    );
  return <PostForm onClose={() => setOpen(false)} opener={opener} />;
}

function PostForm({ onClose, opener, moment = null }) {
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
    opener.current ??= document.activeElement;
    box.current?.focus();
  }, [opener]);
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
  const conflictingLink = Boolean(moment && draft.deck);
  const send = async (e) => {
    e.preventDefault();
    if (busy || empty || left < 0 || conflictingLink) return;
    setBusy(true);
    setError(null);
    const res = await api.writePost({
      text,
      question,
      ...(moment
        ? { moment: timelineItemRef(moment) }
        : { cards: draft.deck ? [] : cards }),
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
    setError(notPostedWords(res, question ? "question" : "post"));
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
        readOnly={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${fieldId}-help`}
        onChange={(e) => setText(e.target.value)}
      />
      <CheckingLine busy={busy} kind={question ? "question" : "post"} />
      {moment ? (
        <PostMoment
          moment={{
            id: moment.id,
            kind: moment.kind,
            at: moment.at,
            text: moment.text,
          }}
        />
      ) : null}
      {conflictingLink ? (
        <p className="field-error" role="alert">
          This post carries the milestone. Remove the deck link to post it.
        </p>
      ) : null}
      {!moment && deckCards ? (
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
      {!moment && picking && !draft.deck ? (
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
          {!moment && !draft.deck ? (
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
            disabled={busy || empty || left < 0 || conflictingLink}
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
                <CardArt
                  card={c}
                  size={48}
                  showLevel={false}
                  showForm={false}
                />
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
 *  plain text, and its battle, its deck (the label, the average elixir,
 *  Copy deck) or its cards. */
export function PostBody({ it }) {
  const p = it.post ?? {};
  const words = String(p.text ?? "");
  return (
    <div className="kit-written">
      {p.question ? (
        <p className="kit-written__label">
          Question{p.answered ? <span> · Answered</span> : null}
        </p>
      ) : null}
      {words ? <p className="kit-written__text">{words}</p> : null}
      {p.moment ? <PostMoment moment={p.moment} /> : null}
      {p.battle ? (
        <PostBattle battle={p.battle} versus={p.versus} who={p.author} />
      ) : null}
      {p.edited ? <p className="kit-tiny m-0">Edited</p> : null}
      {p.status === "hidden" ? (
        <p className="kit-tiny m-0">
          Only you see this one for now: it's waiting for a look.
        </p>
      ) : null}
      {p.deck ? <PostDeck deck={p.deck} post={p} /> : null}
      {p.cards?.length ? <PostCards cards={p.cards} /> : null}
    </div>
  );
}

/** An actual recorded achievement, with its original time and source link. */
export function PostMoment({ moment }) {
  const { when } = useClock();
  const to = moment.item_ref ? memberItemPath(moment.item_ref) : null;
  return (
    <div className="kit-written__moment">
      <p className="kit-tiny m-0">
        Recorded milestone · <time dateTime={moment.at}>{when(moment.at)}</time>
      </p>
      <p className="kit-feed__text">
        <TagText>{moment.text}</TagText>
      </p>
      {to ? (
        <Link to={to} className="btn btn--sm">
          Open milestone
        </Link>
      ) : null}
    </div>
  );
}
/** An own milestone's Post action and composer, outside the social row. */
export function MilestonePost({ it }) {
  const { me } = useMe();
  const may = useMayPost();
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const owns = (me?.claims ?? []).some(
    (c) =>
      c.status === "verified" &&
      (c.is_primary || ["primary", "alt"].includes(c.relationship)) &&
      (it.subjects ?? []).some(
        (s) => s.kind === "player" && s.tag === c.player_tag,
      ),
  );
  const start = useRef(null);
  useEffect(() => {
    if (!open && opener.current) start.current?.focus();
  }, [open]);
  const close = () => setOpen(false);
  if (!may || !owns || !postableMoment(it)) return null;
  return (
    <div className="kit-milestone-post">
      {open ? (
        <PostForm moment={it} opener={opener} onClose={close} />
      ) : (
        <button
          ref={start}
          type="button"
          className="btn btn--sm"
          onClick={(e) => {
            e.currentTarget.focus();
            opener.current = e.currentTarget;
            setOpen(true);
          }}
        >
          Post
        </button>
      )}
    </div>
  );
}

const RESULT_WORD = { win: "win", loss: "loss", draw: "draw" };

/** What the battle was, in a line: "A 3-1 win against Name (Ranked)". */
export function battleLine(b) {
  const result = RESULT_WORD[b?.outcome] ?? "battle";
  const known =
    typeof b?.crowns === "number" && typeof b?.crowns_against === "number";
  const score = known ? `${b.crowns}-${b.crowns_against} ` : "";
  const them = (b?.opponents ?? []).map((o) => o.name ?? o.player_tag);
  const against = them.length ? ` against ${them.join(" and ")}` : "";
  const mode = b?.mode_group ? modeWord(b.mode_group) : null;
  return `A ${score}${result}${against}${mode ? ` (${mode})` : ""}`;
}

/** A post's battle: what happened, both decks with the score between when
 *  the record kept them, and the battle's page. */
function PostBattle({ battle: b, versus: v, who }) {
  const known =
    typeof b.crowns === "number" && typeof b.crowns_against === "number";
  const result =
    b.outcome === "win" ? "Won" : b.outcome === "loss" ? "Lost" : null;
  const theirName = b.opponents?.length === 1 ? b.opponents[0].name : null;
  const to = String(b.url ?? "").replace(/^https?:\/\/[^/]+/, "");
  return (
    <div className="kit-written__battle">
      <p className="kit-feed__text">
        <TagText>{battleLine(b)}</TagText>
      </p>
      {v?.mine && v?.theirs && known ? (
        <DeckVersus
          showForm={false}
          left={{
            name: <TagText>{who?.name ?? who?.player_tag ?? "Them"}</TagText>,
            label: v.mine.label ? <TagText>{v.mine.label}</TagText> : null,
            cards: v.mine.cards,
          }}
          right={{
            name: <TagText>{theirName ?? "Their deck"}</TagText>,
            label: v.theirs.label ? <TagText>{v.theirs.label}</TagText> : null,
            cards: v.theirs.cards,
          }}
          score={`${b.crowns}-${b.crowns_against}`}
          scoreLabel={`${result ? `${result} ` : ""}${b.crowns} to ${b.crowns_against}`}
          note={b.mode_group ? modeWord(b.mode_group) : null}
        />
      ) : null}
      {to.startsWith("/battle/") ? (
        <Link to={to} className="btn btn--sm">
          Open battle
        </Link>
      ) : null}
    </div>
  );
}

function DeckTrial({ post }) {
  const [asked, setAsked] = useState(false);
  const trial = useDeckTrial(post.id, asked);
  if (!asked)
    return (
      <button
        className="btn btn--sm"
        type="button"
        onClick={() => setAsked(true)}
      >
        I tried this deck
      </button>
    );
  if (trial.isError)
    return (
      <button
        className="btn btn--sm"
        type="button"
        onClick={() => trial.refetch()}
      >
        Try reading your battles again
      </button>
    );
  if (!trial.data)
    return <span role="status">Checking your recorded battles…</span>;
  const m = trial.data.match;
  if (!m)
    return (
      <span role="status">
        No matching battle recorded for your verified players since this post in
        the last 30 days.
      </span>
    );
  const path = new URL(m.url).pathname;
  const q = new URLSearchParams({ as: m.player_tag, deck_post: post.id });
  return (
    <Link className="btn btn--sm" to={`${path}?${q}#tried-deck`}>
      Post about {m.name ?? m.player_tag}’s matching battle
    </Link>
  );
}

function PostDeck({ deck, post }) {
  const [copied, setCopied] = useState(null);
  const avg = deck.average_elixir ?? averageElixir(deck.cards);
  return (
    <div className="kit-written__deck">
      <DeckRow
        cards={deck.cards}
        showForm={false}
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
      {post.id && !post.mine ? <DeckTrial post={post} /> : null}
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

/** What the reader may do about a post: edit or delete their own (and
 *  copy a shared battle post's link), report or block someone else's. */
export function PostActions({ it }) {
  const questionsOn = usePostsOn();
  const p = it.post ?? {};
  const changed = usePostsChanged();
  const invalidate = useInvalidate();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [editing, setEditing] = useState(false);
  const [answerBusy, setAnswerBusy] = useState(false);
  const [answerError, setAnswerError] = useState(null);
  const name = p.author?.name ?? p.author?.player_tag ?? "this player";
  if (reported)
    return (
      <p className="kit-tiny kit-written__acts" role="status">
        Thanks. You won't see that post now.
      </p>
    );
  return (
    <div className="kit-written__acts">
      {questionsOn && p.can_edit && p.mine && p.question && !p.status ? (
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          disabled={answerBusy}
          aria-busy={answerBusy}
          onClick={async () => {
            setAnswerBusy(true);
            setAnswerError(null);
            const out = await api.setQuestionAnswered(p.id, !p.answered);
            setAnswerBusy(false);
            if (out.ok) changed();
            else setAnswerError(refusalWords(out));
          }}
        >
          {p.answered ? "Mark unanswered" : "Mark answered"}
        </button>
      ) : null}
      {answerError ? (
        <p className="kit-tiny" role="status">
          {answerError}
        </p>
      ) : null}
      {p.can_edit && !editing ? (
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          aria-expanded={editing}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      ) : null}
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
            if (out?.ok) invalidate();
          }}
        />
      ) : null}
      {editing ? (
        <EditForm
          p={p}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            changed();
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

/** The author changes a post's words, through the same check as a new
 *  post. A post about a battle may be left with no words. */
function EditForm({ p, onClose, onDone }) {
  const [text, setText] = useState(String(p.text ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const box = useRef(null);
  const fieldId = useId();
  const left = POST_MAX - [...text.trim()].length;
  const empty = !text.trim() && !p.battle;
  const save = async (e) => {
    e.preventDefault();
    if (busy || empty || left < 0) return;
    setBusy(true);
    setError(null);
    const res = await api.editPost(p.id, text);
    setBusy(false);
    if (res.ok) return onDone();
    setError(notPostedWords(res, "edit"));
    box.current?.focus();
  };
  return (
    <form className="kit-post-compose kit-post-edit" onSubmit={save}>
      <textarea
        id={fieldId}
        ref={box}
        aria-label="Your words"
        className="kit-comments__field kit-post-compose__field"
        rows={3}
        maxLength={POST_MAX * 3}
        value={text}
        readOnly={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${fieldId}-help`}
        onChange={(e) => setText(e.target.value)}
      />
      <CheckingLine busy={busy} kind="edit" />
      <div className="kit-comments__send">
        <span
          id={`${fieldId}-help`}
          className={left < 0 ? "field-error" : "kit-tiny"}
        >
          {left < 0 ? `${-left} too many` : `${left} left`}
        </span>
        <span className="kit-post-compose__acts">
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
            {busy ? "Checking" : "Save"}
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
