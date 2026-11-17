import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@elixir-mcp/ui";
import { pageCheersKey, useCheer, usePageCheers } from "../lib/queries.js";
import { useScope } from "../lib/scope.js";
import {
  CHEERS,
  DEFAULT_CHEER,
  cheerCounts,
  cheerOf,
  cheeredBy,
  nextCheer,
  withMyCheer,
} from "./cheer-set.js";
import { CheerGlyph } from "./CheerGlyph.jsx";

/** How long a finger rests on Cheer before the kinds open instead. */
export const LONG_PRESS_MS = 450;
/** How far a finger may drift and still be a press, not a scroll. */
const PRESS_SLOP = 10;

/** What a reader hears after the button's name: the counts by kind, how
 *  many cheered, and which one is yours (`yours: false` where the reader
 *  cannot cheer). Never who. */
export function cheerWords(cheers, mine, { yours = true } = {}) {
  const counts = cheerCounts(cheers)
    .map((c) => `${c.label} ${c.count}`)
    .join(", ");
  const who = cheeredBy(cheers, mine);
  return [
    counts,
    who,
    !yours
      ? ""
      : mine
        ? `Yours: ${cheerOf(mine).label}`
        : "No cheer from you yet",
  ]
    .filter(Boolean)
    .join(". ");
}

/**
 * A feed item's cheers (#765; one tap since 2026-11-17, "A cheer is one
 * tap"). Cheer gives the default cheer at once, shown before the server
 * answers, and a second tap takes yours back, whichever kind it is. The
 * smile beside it opens the six inline, where one tap switches to another
 * kind (or, on yours, takes it back); a long press on Cheer opens them too
 * on a touch screen. One per person per item. Counts only, never who.
 * Under an agent's scope (if it is ever drawn there) the counts show and
 * nothing can be pressed: an agent never cheers.
 *
 * `compact` is a one-line short session's: Cheer and its total, the
 * smile, and no counts by kind (they are on the session's page).
 *
 * Home's feed by default; `where` names another cached list the item lives
 * in (a player page's, a session page's or a battle page's cheers read,
 * `usePageCheered`).
 */
export function Cheers({ it, where, compact = false }) {
  const scope = useScope();
  const cheer = useCheer(where);
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(0);
  const press = useRef(null);
  const mainRef = useRef(null);
  const moreRef = useRef(null);
  const kindsRef = useRef(null);
  const pickId = useId();
  const wordsId = useId();

  // The cache is the item as you left it: `useCheer` writes each tap
  // there at once, and sends the taps for an item one at a time.
  const shown = it;
  const mine = shown.my_cheer ?? null;
  const counts = cheerCounts(shown.cheers);
  const total = counts.reduce((n, c) => n + c.count, 0);
  const who = cheeredBy(shown.cheers, mine);

  useEffect(() => () => clearTimeout(press.current?.timer), []);

  if (scope)
    return counts.length ? (
      <p
        className="kit-cheers__row kit-tiny"
        role="img"
        aria-label={cheerWords(shown.cheers, null, { yours: false })}
      >
        {counts.map((c) => (
          <span key={c.key} className="kit-cheers__count" aria-hidden="true">
            <CheerGlyph kind={c.key} size={15} /> {c.count}
          </span>
        ))}
      </p>
    ) : null;

  const set = (next) => {
    if (next) setPop((n) => n + 1);
    cheer.mutate({ item: it, next, shown: withMyCheer(it, next) });
  };

  const cancelPress = () => {
    clearTimeout(press.current?.timer);
    if (press.current && !press.current.fired) press.current = null;
  };
  const onPointerDown = (e) => {
    if (e.pointerType !== "touch") return;
    clearTimeout(press.current?.timer);
    const p = { x: e.clientX, y: e.clientY, fired: false };
    p.timer = setTimeout(() => {
      p.fired = true;
      setOpen(true);
    }, LONG_PRESS_MS);
    press.current = p;
  };
  const onPointerMove = (e) => {
    const p = press.current;
    if (!p || p.fired) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP)
      cancelPress();
  };
  const onMain = () => {
    // A long press opened the kinds: the click that ends it is not a tap.
    if (press.current?.fired) {
      press.current = null;
      return;
    }
    press.current = null;
    set(mine ? null : DEFAULT_CHEER);
  };
  const kinds = () => [...(kindsRef.current?.querySelectorAll("button") ?? [])];
  const onMore = (e) => {
    const opening = !open;
    setOpen(opening);
    // From the keyboard, the kinds take focus: yours, else the first.
    if (opening && e.detail === 0)
      requestAnimationFrame(() => {
        const list = kinds();
        const at = Math.max(
          0,
          CHEERS.findIndex((c) => c.key === mine),
        );
        list[at]?.focus();
      });
  };
  const choose = (key, e) => {
    set(nextCheer(mine, key));
    setOpen(false);
    if (e.detail === 0) requestAnimationFrame(() => mainRef.current?.focus());
  };
  const onKindsKey = (e) => {
    const list = kinds();
    const at = list.indexOf(document.activeElement);
    const go = (i) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      moreRef.current?.focus();
    }
  };

  const glyph = (
    <span
      key={pop}
      className={`kit-cheer__glyph${pop ? " kit-cheer__glyph--pop" : ""}`}
    >
      <CheerGlyph kind={mine ?? DEFAULT_CHEER} size={compact ? 20 : 18} />
    </span>
  );
  return (
    <div className={`kit-cheers${compact ? " kit-cheers--compact" : ""}`}>
      <div className="kit-cheers__row">
        <button
          ref={mainRef}
          type="button"
          className={`kit-cheer${mine ? " kit-cheer--mine" : ""}`}
          aria-label="Cheer"
          aria-pressed={Boolean(mine)}
          aria-describedby={wordsId}
          onClick={onMain}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={cancelPress}
          onPointerCancel={cancelPress}
          onPointerLeave={cancelPress}
          onContextMenu={(e) => {
            if (press.current) e.preventDefault();
          }}
        >
          {glyph}
          {compact ? (
            <span className="kit-cheer__n" aria-hidden="true">
              {total || ""}
            </span>
          ) : (
            <span className="kit-cheer__word" aria-hidden="true">
              <span className={mine ? "kit-cheer__off" : undefined}>Cheer</span>
              <span className={mine ? undefined : "kit-cheer__off"}>
                Cheered
              </span>
            </span>
          )}
        </button>
        <button
          ref={moreRef}
          type="button"
          className="kit-cheer__more"
          aria-label="Choose a cheer"
          title="Choose a cheer"
          aria-expanded={open}
          aria-controls={open ? pickId : undefined}
          onClick={onMore}
        >
          <Icon name={open ? "x" : "smile-plus"} size={18} />
        </button>
        {!compact && counts.length ? (
          <span className="kit-cheers__counts" aria-hidden="true">
            {counts.map((c) => (
              <span
                key={c.key}
                className={`kit-cheers__count${mine === c.key ? " kit-cheers__count--mine" : ""}`}
              >
                <CheerGlyph kind={c.key} size={15} />
                {c.count}
              </span>
            ))}
          </span>
        ) : null}
        {!compact && who ? (
          <span className="kit-cheers__who" aria-hidden="true">
            {who}
          </span>
        ) : null}
        <span id={wordsId} className="sr-only">
          {cheerWords(shown.cheers, mine)}
        </span>
      </div>
      {open ? (
        <div
          id={pickId}
          ref={kindsRef}
          role="group"
          aria-label="Cheer with"
          className="kit-cheers__kinds"
        >
          {CHEERS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="kit-cheers__kind"
              aria-pressed={mine === c.key}
              onClick={(e) => choose(c.key, e)}
              onKeyDown={onKindsKey}
            >
              <CheerGlyph kind={c.key} size={20} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {cheer.isError && !cheer.isPending ? (
        <p role="status" className="kit-cheers__error">
          Your cheer was not saved. Try again.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A player page's, a session page's or a battle page's cheers
 * (2026-11-12): an item there takes cheers, and shows its counts, only
 * while it is in your own feed (the server's `cheersOnPage` says which:
 * `items`). `of(item)` is the item ready for <Cheers>, or null for one that
 * has none; `where` is the list it lives in. Signed out, or before the read
 * answers, nothing has cheers.
 */
export function usePageCheered(ask, enabled = true) {
  const read = usePageCheers(ask, enabled);
  const byId = new Map((read.data?.items ?? []).map((c) => [c.id, c]));
  return {
    items: read.data?.items ?? [],
    where: { key: pageCheersKey(ask), list: "items" },
    of: (it) => {
      const c = it?.id ? byId.get(it.id) : null;
      return c
        ? {
            ...it,
            cheers: c.cheers ?? {},
            my_cheer: c.my_cheer ?? null,
            cheer_subjects: read.data.subjects ?? [],
          }
        : null;
    },
  };
}
