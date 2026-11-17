import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@elixir-mcp/ui";
import { pageCheersKey, useCheer, usePageCheers } from "../lib/queries.js";
import { useScope } from "../lib/scope.js";
import {
  CHEERS,
  DEFAULT_CHEER,
  LEAD,
  LEAD_CHEERS,
  cheerCounts,
  cheerOf,
  cheeredBy,
  foldCounts,
  knownCheer,
  nextCheer,
  recentCheer,
  rememberCheer,
  withMyCheer,
} from "./cheer-set.js";
import { CheerGlyph } from "./CheerGlyph.jsx";

/** How long a finger rests on Cheer before the kinds open instead, and on
 *  a kind before its name shows. */
export const LONG_PRESS_MS = 450;
/** How far a finger may drift and still be a press, not a scroll. */
const PRESS_SLOP = 10;
/** The full set's columns (twenty kinds: four rows of five). */
export const GRID_COLUMNS = 5;
/** How near the viewport's edge the popover and a name may come. */
const EDGE = 4;
// The popover's distance from the row (components.css, .kit-cheers__pop).
const GAP = 4;

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

/** The main button's accessible name: the reaction one tap gives or takes
 *  back, and its state (also `aria-pressed`). */
export const cheerButtonName = (mine) =>
  mine
    ? `Cheered: ${cheerOf(mine).label}`
    : `Cheer: ${cheerOf(DEFAULT_CHEER).label}`;

/** Folded counts as glyphs and numbers: yours tinted, the rest one +N. */
function Counts({ shown, rest, mine, className = "kit-cheers__counts" }) {
  if (!shown.length && !rest) return null;
  return (
    <span className={className} aria-hidden="true">
      {shown.map((c) => (
        <span
          key={c.key}
          className={`kit-cheers__count${mine === c.key ? " kit-cheers__count--mine" : ""}`}
        >
          <CheerGlyph kind={c.key} size={15} />
          {c.count}
        </span>
      ))}
      {rest ? <span className="kit-cheers__rest">+{rest}</span> : null}
    </span>
  );
}

/** Moves the element, whose position comes from `--x`/`--y` style
 *  variables, back inside the viewport sideways. */
function keepInside(el, x) {
  el.style.setProperty("--x", `${x}px`);
  // Its laid-out width about its drawn centre: the opening animation
  // scales it, and a measure taken mid-scale would let it end up wider.
  const r = el.getBoundingClientRect();
  const w = el.offsetWidth || r.width;
  const left = r.left + r.width / 2 - w / 2;
  const right = left + w;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  let shift = 0;
  if (right > vw - EDGE) shift = vw - EDGE - right;
  if (left + shift < EDGE) shift = EDGE - left;
  if (shift) el.style.setProperty("--x", `${x + shift}px`);
}

/**
 * A feed item's cheers (#765; one tap since 2026-11-17, "A cheer is one
 * tap"; glyphs alone and twenty kinds since 2026-11-17, "Reactions are
 * glyphs alone; a larger set"). The cheer button is a glyph and its kind's
 * count: one tap gives the default cheer at once, shown before the server
 * answers, and a second takes yours back, whichever kind it is. The smile
 * beside it (or a long press on touch) opens a small popover anchored to
 * the row, over the content rather than pushing it down: six glyphs in a
 * fixed order, the recent slot, and More, which grows it in place to all
 * twenty as a grid. One per person per item. Counts only, never who, and
 * no word beside a reaction: each glyph-only control has its name
 * (`aria-label`) and shows it as a tooltip on hover, keyboard focus and a
 * long press.
 *
 * Under an agent's scope (if it is ever drawn there) the counts show and
 * nothing can be pressed: an agent never cheers.
 *
 * `compact` is a one-line short session's: the button, a +N for other
 * kinds and the smile, no counts by kind (they are on the session's page).
 *
 * Home's feed by default; `where` names another cached list the item lives
 * in (a player page's, a session page's or a battle page's cheers read,
 * `usePageCheered`).
 */
export function Cheers({ it, where, compact = false }) {
  const scope = useScope();
  const cheer = useCheer(where);
  // 0 closed, 1 the six, 2 all of them.
  const [level, setLevel] = useState(0);
  const [up, setUp] = useState(false);
  const [recent, setRecent] = useState(null);
  const [tip, setTip] = useState(null);
  const [pop, setPop] = useState(0);
  const press = useRef(null);
  const kindPress = useRef(null);
  const kindHide = useRef(null);
  const rowRef = useRef(null);
  const mainRef = useRef(null);
  const toggleRef = useRef(null);
  const moreRef = useRef(null);
  const popRef = useRef(null);
  const tipRef = useRef(null);
  // Whether the last focus came from a pointer, which shows no name.
  const byPointer = useRef(false);
  const focusAt = useRef(null);
  const pickId = useId();
  const wordsId = useId();
  const open = level > 0;

  // The cache is the item as you left it: `useCheer` writes each tap
  // there at once, and sends the taps for an item one at a time.
  const shown = it;
  const mine = shown.my_cheer ?? null;
  const face = mine ?? DEFAULT_CHEER;
  const faceCount = Number(shown.cheers?.[face]) || 0;
  const others = foldCounts(shown.cheers, { mine, except: face });
  const othersTotal =
    others.rest + others.shown.reduce((n, c) => n + c.count, 0);

  useEffect(
    () => () => {
      clearTimeout(press.current?.timer);
      clearTimeout(kindPress.current?.timer);
      clearTimeout(kindHide.current);
    },
    [],
  );

  // A tap anywhere else closes the popover.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!rowRef.current?.contains(e.target)) {
        setLevel(0);
        setTip(null);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // The popover stays on screen: sideways inside the viewport, and above
  // the row when there is no room under it. Decided again at each level
  // from the popover's own height and whenever the viewport changes, so
  // the open picker stays inside it without moving keyboard focus.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    const position = () => {
      keepInside(el, 0);
      const h = el.getBoundingClientRect().height;
      const row = rowRef.current?.getBoundingClientRect();
      setUp(
        Boolean(row) &&
          row.bottom + GAP + h > window.innerHeight - EDGE &&
          row.top - GAP - h >= EDGE,
      );
    };
    position();
    window.addEventListener("resize", position);
    const at = focusAt.current;
    focusAt.current = null;
    if (at != null) el.querySelectorAll("button")[at]?.focus();
    return () => window.removeEventListener("resize", position);
  }, [level]);

  // A name over the glyph it names, inside the viewport.
  useLayoutEffect(() => {
    const el = tipRef.current;
    const row = rowRef.current;
    if (!el || !row || !tip?.target?.isConnected) return;
    const t = tip.target.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    el.style.setProperty("--y", `${t.top - r.top}px`);
    keepInside(el, t.left + t.width / 2 - r.left);
  }, [tip]);

  if (scope) {
    const all = foldCounts(shown.cheers);
    return all.shown.length || all.rest ? (
      <p
        className="kit-cheers__row kit-tiny"
        role="img"
        aria-label={cheerWords(shown.cheers, null, { yours: false })}
      >
        <Counts {...all} mine={null} className="kit-cheers__counts" />
      </p>
    ) : null;
  }

  const set = (next) => {
    if (next) setPop((n) => n + 1);
    cheer.mutate({ item: it, next, shown: withMyCheer(it, next) });
  };
  const close = (focus) => {
    setLevel(0);
    setTip(null);
    if (focus) requestAnimationFrame(() => focus.current?.focus());
  };

  // A name shows on focus only when the focus came from the keyboard: a
  // tap or a click focuses the button too, and needs no tooltip then.
  const showTip = (e, label) => {
    if (e.type === "focus" && byPointer.current) return;
    setTip({ label, target: e.currentTarget });
  };
  const hideTip = () => setTip(null);
  const tipProps = (label) => ({
    onMouseEnter: (e) => showTip(e, label),
    onMouseLeave: hideTip,
    onFocus: (e) => showTip(e, label),
    onBlur: hideTip,
  });

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
      setRecent(recentCheer());
      setLevel(1);
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

  // The slot before More: yours when it is past the six, else the last one
  // from past the six you gave on this device.
  const slot =
    mine && knownCheer(mine) && CHEERS.findIndex((c) => c.key === mine) >= LEAD
      ? mine
      : recent;
  const row1 = [...LEAD_CHEERS, ...(slot ? [cheerOf(slot)] : [])];

  const onToggle = (e) => {
    if (open) return close(null);
    setRecent(recentCheer());
    // From the keyboard, the kinds take focus: yours, else the first.
    if (e.detail === 0) {
      const at = row1.findIndex((c) => c.key === mine);
      focusAt.current = Math.max(0, at);
    }
    setLevel(1);
  };
  const onMore = () => {
    setTip(null);
    // The first kind the six did not show takes focus.
    focusAt.current = LEAD;
    setLevel(2);
  };
  const choose = (key, e) => {
    if (kindPress.current?.fired) {
      kindPress.current = null;
      return;
    }
    const next = nextCheer(mine, key);
    if (next) rememberCheer(next);
    set(next);
    close(e.detail === 0 ? mainRef : null);
  };

  // Touch: a finger resting on a kind shows its name, and lifting it then
  // is not a cheer.
  const kindDown = (e, label) => {
    if (e.pointerType !== "touch") return;
    const target = e.currentTarget;
    clearTimeout(kindPress.current?.timer);
    clearTimeout(kindHide.current);
    const p = { x: e.clientX, y: e.clientY, fired: false };
    p.timer = setTimeout(() => {
      p.fired = true;
      setTip({ label, target });
    }, LONG_PRESS_MS);
    kindPress.current = p;
  };
  const kindMove = (e) => {
    const p = kindPress.current;
    if (
      p &&
      !p.fired &&
      Math.hypot(e.clientX - p.x, e.clientY - p.y) > PRESS_SLOP
    ) {
      clearTimeout(p.timer);
      kindPress.current = null;
    }
  };
  const kindUp = () => {
    const p = kindPress.current;
    if (!p) return;
    clearTimeout(p.timer);
    // The name stays a moment after the finger lifts. Its timer belongs
    // to the view, since the synthetic click consumes the press itself.
    clearTimeout(kindHide.current);
    if (p.fired)
      kindHide.current = setTimeout(() => {
        kindHide.current = null;
        hideTip();
      }, 1200);
    else kindPress.current = null;
  };

  // The kinds the arrows move between: the ones drawn. Under 380 px the
  // recent slot is hidden (display: none) unless it is yours, and an arrow
  // must step over it, not stop on it (Codex on #1108).
  const buttons = () =>
    [...(popRef.current?.querySelectorAll("button") ?? [])].filter(
      (b) => getComputedStyle(b).display !== "none",
    );
  const onKindsKey = (e) => {
    const list = buttons();
    const at = list.indexOf(document.activeElement);
    const go = (i) => {
      e.preventDefault();
      list[i]?.focus();
    };
    const n = list.length;
    const wrap = (i) => (i + n) % n;
    if (e.key === "Escape") {
      e.preventDefault();
      if (level === 2) {
        // One step back: the six again, focus on More.
        focusAt.current = row1.length;
        setTip(null);
        setLevel(1);
      } else close(toggleRef);
      return;
    }
    if (level === 2) {
      const cols = GRID_COLUMNS;
      if (e.key === "ArrowRight") go(wrap(at + 1));
      else if (e.key === "ArrowLeft") go(wrap(at - 1));
      else if (e.key === "ArrowDown") go(at + cols < n ? at + cols : at % cols);
      else if (e.key === "ArrowUp")
        go(
          at - cols >= 0
            ? at - cols
            : at + cols * Math.floor((n - 1 - at) / cols),
        );
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n - 1);
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") go(wrap(at + 1));
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(wrap(at - 1));
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
  };

  const kindButton = (c, extra = "") => (
    <button
      key={c.key}
      type="button"
      className={`kit-cheers__kind${extra}`}
      aria-label={c.label}
      aria-pressed={mine === c.key}
      onClick={(e) => choose(c.key, e)}
      onKeyDown={onKindsKey}
      onPointerDown={(e) => kindDown(e, c.label)}
      onPointerMove={kindMove}
      onPointerUp={kindUp}
      onPointerCancel={kindUp}
      onContextMenu={(e) => e.preventDefault()}
      {...tipProps(c.label)}
    >
      <CheerGlyph kind={c.key} size={20} />
    </button>
  );

  const glyph = (
    <span
      key={pop}
      className={`kit-cheer__glyph${pop ? " kit-cheer__glyph--pop" : ""}`}
    >
      <CheerGlyph kind={face} size={compact ? 20 : 18} />
    </span>
  );
  const name = cheerButtonName(mine);
  return (
    <div className={`kit-cheers${compact ? " kit-cheers--compact" : ""}`}>
      <div
        className="kit-cheers__row"
        ref={rowRef}
        onPointerDownCapture={() => (byPointer.current = true)}
        onKeyDownCapture={() => (byPointer.current = false)}
      >
        <button
          ref={mainRef}
          type="button"
          className={`kit-cheer${mine ? " kit-cheer--mine" : ""}`}
          aria-label={name}
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
          {...tipProps(name)}
        >
          {glyph}
          <span className="kit-cheer__n" aria-hidden="true">
            {faceCount || ""}
          </span>
        </button>
        {compact && othersTotal ? (
          <span className="kit-cheers__rest" aria-hidden="true">
            +{othersTotal}
          </span>
        ) : null}
        <button
          ref={toggleRef}
          type="button"
          className="kit-cheer__more"
          aria-label="Choose a cheer"
          aria-expanded={open}
          aria-controls={open ? pickId : undefined}
          onClick={onToggle}
          onKeyDown={
            open ? (e) => e.key === "Escape" && close(toggleRef) : undefined
          }
          {...tipProps("Choose a cheer")}
        >
          {/* The same glyph open or shut, so its name always fits it;
              open, it is lit (aria-expanded). */}
          <Icon name="smile-plus" size={18} />
        </button>
        {!compact ? <Counts {...others} mine={mine} /> : null}
        <span id={wordsId} className="sr-only">
          {cheerWords(shown.cheers, mine)}
        </span>
        {open ? (
          <div
            id={pickId}
            ref={popRef}
            role="group"
            aria-label={level === 2 ? "All cheers" : "Cheer with"}
            className={`kit-cheers__pop kit-cheers__pop--${level === 2 ? "all" : "lead"}${up ? " kit-cheers__pop--up" : ""}`}
          >
            {level === 2
              ? CHEERS.map((c) => kindButton(c))
              : [
                  ...LEAD_CHEERS.map((c) => kindButton(c)),
                  ...(slot
                    ? [kindButton(cheerOf(slot), " kit-cheers__kind--recent")]
                    : []),
                  <button
                    key="more"
                    ref={moreRef}
                    type="button"
                    className="kit-cheers__kind kit-cheers__kind--more"
                    aria-label="More reactions"
                    aria-expanded={false}
                    onClick={onMore}
                    onKeyDown={onKindsKey}
                    {...tipProps("More reactions")}
                  >
                    <Icon name="plus" size={20} />
                  </button>,
                ]}
          </div>
        ) : null}
        {tip ? (
          <span ref={tipRef} className="kit-cheers__tip" aria-hidden="true">
            {tip.label}
          </span>
        ) : null}
      </div>
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
