import { PlayerName } from "@elixir-mcp/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Empty,
  ErrorState,
  SHELL_PLACES,
  Icon,
  Link,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import { FollowButton } from "../home/follow.jsx";
import { needsYou, panelOf } from "../home/logic.js";
import {
  useBell as useBellRead,
  useBellNeeds,
  useBellSeen,
  useHomeClan,
} from "../lib/queries.js";
import { SETTINGS } from "../lib/settings.js";
import { PushPrompt } from "./PushPrompt.jsx";
import { bellCount, bellGroups, bellLabel } from "./bell-logic.js";

/**
 * The bell (2026-11-12): what is about you, not your friends. Reactions to
 * your items (counts, never who), new followers (named by their player,
 * a claimed one marked not verified; an account with none counted), Needs you (your clan's Actions waiting on you, an
 * old key still trying to connect), answers to your feedback and your
 * account's own lines, Stamps among them.
 *
 * Its shape since #1009 (2026-11-14): an inbox in two parts. Needs you is
 * what waits on you; it stays until it is done, wherever it is done. The
 * rest is events, split into New and Earlier, every row one target. On a
 * wide screen it is a popover under the bell; on a phone, where the bell is
 * a tab, a sheet from the foot of the screen.
 *
 * The badge counts what needs you plus what is new since you last opened
 * the bell (an unread answer until you read it). Opening it moves your seen
 * marker once, as soon as there is something to show. What was new stays
 * marked while it is open, and when you leave through a row it stays marked
 * (but the row you opened) for when you come back, with the list where you
 * left it; closing the bell yourself starts it fresh next time. Nothing
 * here goes to mail or Discord. Both reads are every few minutes at most;
 * the sheet adds the clan card's read only when it is opened.
 */
export function useBell(me, enabled) {
  const clock = useClock();
  const needs = panelOf(useBellNeeds(enabled), "needs");
  const bell = useBellRead(enabled).data;
  const { rows } = needsYou({ needs, signals: me?.signals, clock });
  const need = rows.length;
  const count = bellCount(need, bell);
  return { lit: count > 0, count, need, fresh: count - need };
}

/** The badge's number: at most "99+". */
const badge = (n) => (n > 99 ? "99+" : String(n));

export function BellButton({ bell, onOpen, phone = false }) {
  const words = SHELL_PLACES.bell;
  const label = bellLabel(words.label, bell);
  return (
    <button
      type="button"
      className={
        phone
          ? "kit-bell kit-bell--tab"
          : "kit-top__icon kit-bell kit-bell--bar"
      }
      aria-haspopup="dialog"
      aria-label={phone ? undefined : label}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <span className="kit-bell__mark">
        <Icon name={words.icon} size={phone ? 22 : 18} />
        {bell.lit ? (
          // The number on the bar and on the phone's tab alike (#1009);
          // the button's name says it in words.
          <span
            className="kit-bell__dot kit-bell__dot--count"
            aria-hidden="true"
          >
            {badge(bell.count)}
          </span>
        ) : null}
      </span>
      {phone ? (
        <span>
          {words.tab}
          {bell.lit ? (
            <span className="sr-only">{label.slice(words.label.length)}</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Where the bell was when you left it through a row: what was new then
 * (less what you opened) and how far down the list was. One per document,
 * so it outlives the shell remounting between sections; closing the bell
 * yourself clears it.
 */
let place = null;

/** A row's "new" mark: a dot to see, a word to hear. */
const New = ({ on }) =>
  on ? (
    <span className="kit-bell__new">
      <span className="sr-only">New: </span>
    </span>
  ) : null;

/**
 * One row: the whole row is its link (44px and up), its kind's icon first,
 * what happened, then when or where on the line under it. A control of its
 * own (Follow back) sits above the link at the right.
 */
function Item({ icon, to, onLeave, isNew, title, detail, action, tone }) {
  const body = (
    <>
      <span className="kit-bell__icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="kit-bell__body">
        <span className="kit-bell__title">
          <New on={isNew} />
          {title}
        </span>
        {detail ? <span className="kit-bell__detail">{detail}</span> : null}
      </span>
    </>
  );
  return (
    <li
      className={[
        "kit-bell__item",
        isNew ? "kit-bell__item--new" : "",
        tone ? `kit-bell__item--${tone}` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {to ? (
        <Link to={to} className="kit-bell__hit" data-bell-row onClick={onLeave}>
          {body}
        </Link>
      ) : (
        <span className="kit-bell__hit kit-bell__hit--still">{body}</span>
      )}
      {action ? <span className="kit-bell__action">{action}</span> : null}
    </li>
  );
}

function Group({ id, title, children, tone }) {
  return (
    <section
      className={
        tone ? `kit-bell__group kit-bell__group--${tone}` : "kit-bell__group"
      }
      aria-labelledby={id}
    >
      <h3 id={id}>{title}</h3>
      <ul className="kit-bell__list">{children}</ul>
    </section>
  );
}

/** Cheers as the picker draws them, said as words. */
function Cheers({ row }) {
  return (
    <span role="img" aria-label={row.words} className="kit-bell__cheers">
      {row.counts.map((c) => (
        <span key={c.key} className="kit-bell__cheer">
          <span aria-hidden="true">{c.emoji}</span> {c.count}
        </span>
      ))}
    </span>
  );
}

/** Where the popover sits: under the bar's bell, its right edge on the
 *  bell's. A phone's sheet ignores these. */
function placeUnder(dialog, from) {
  const r = from?.closest?.(".kit-top") ? from.getBoundingClientRect() : null;
  if (!r) {
    dialog.style.removeProperty("--bell-top");
    dialog.style.removeProperty("--bell-right");
    return;
  }
  const right = Math.max(8, window.innerWidth - r.right - 8);
  dialog.style.setProperty("--bell-top", `${Math.round(r.bottom + 8)}px`);
  dialog.style.setProperty("--bell-right", `${Math.round(right)}px`);
}

/** The keys that move between rows: arrows, Home and End. */
const MOVES = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * The bell open. `onClose` is called whether you close it or leave through
 * a row; `returnTo` is the button that opened it, which takes focus back
 * when you close it yourself (Escape, Close or a tap outside).
 */
export function BellSheet({ me, onClose, returnTo = null }) {
  const box = useRef(null);
  const list = useRef(null);
  const head = useRef(null);
  const clock = useClock();
  const needsRead = useBellNeeds(true);
  const needs = panelOf(needsRead, "needs");
  const clan = panelOf(useHomeClan(), "clan");
  const read = useBellRead(true, { fresh: true });
  const seen = useBellSeen();
  // What was new when the sheet opened stays marked while it is open; the
  // marker moves once, as soon as there is something to show.
  const [shown, setShown] = useState(null);
  const [kept] = useState(() => place);
  const marked = useRef(false);
  useEffect(() => {
    // A refresh that failed shows the cached rows, so it moves nothing:
    // what came since was never shown.
    if (
      !read.data ||
      !read.isFetchedAfterMount ||
      read.isError ||
      marked.current
    )
      return;
    marked.current = true;
    setShown(read.data);
    seen.mutate();
  }, [read.data, read.isFetchedAfterMount, read.isError, seen]);
  const { rows: needRows, more } = needsYou({
    clan,
    needs,
    signals: me?.signals,
    clock,
  });
  const bell = shown ?? read.data ?? null;
  const { fresh, earlier, counted } = bellGroups(bell, {
    keep: kept?.keys ?? null,
  });
  // Followed back while the sheet is open: the sheet keeps the read it
  // opened on, so the row says Following itself.
  const [backed, setBacked] = useState(() => new Set());

  // Open as a modal (focus stays inside, Escape is the dialog's cancel),
  // placed under the bell on a wide screen; the title takes focus, so the
  // name is read first and the arrows go down the list.
  useEffect(() => {
    const d = box.current;
    if (!d) return undefined;
    placeUnder(d, returnTo);
    if (typeof d.showModal === "function" && !d.open) d.showModal();
    else if (!d.open) d.setAttribute("open", "");
    head.current?.focus();
    const move = () => placeUnder(d, returnTo);
    window.addEventListener("resize", move);
    return () => {
      window.removeEventListener("resize", move);
      if (d.open && typeof d.close === "function") d.close();
    };
  }, [returnTo]);
  // Back from a row: the list where it was.
  useLayoutEffect(() => {
    if (shown && kept?.scroll && list.current)
      list.current.scrollTop = kept.scroll;
  }, [shown, kept]);

  /** Closed by you: the next opening starts fresh, and focus goes back to
   *  the bell (the one on screen, if the one that opened it has gone). */
  const dismiss = () => {
    place = null;
    onClose();
    const shown = (el) => el?.isConnected && el.getClientRects().length > 0;
    const back = shown(returnTo)
      ? returnTo
      : [...document.querySelectorAll("button.kit-bell")].find(shown);
    // After the dialog has gone, or the browser puts focus back itself.
    requestAnimationFrame(() => back?.focus());
  };
  /** Left through a row: keep what is still new and the scroll for when
   *  you come back. */
  const leave = (key) => () => {
    const keys = new Set(fresh.map((r) => r.key));
    if (key) keys.delete(key);
    place = { keys, scroll: list.current?.scrollTop ?? 0 };
    onClose();
  };
  const onKeyDown = (e) => {
    if (!MOVES.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const rows = [...(box.current?.querySelectorAll("[data-bell-row]") ?? [])];
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement);
    const to =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : e.key === "ArrowDown"
            ? at < 0
              ? 0
              : Math.min(at + 1, rows.length - 1)
            : at <= 0
              ? 0
              : at - 1;
    e.preventDefault();
    rows[to].focus();
  };

  const loading = bell === null && read.isPending;
  const failed = bell === null && read.isError;
  // The fresh read failed but the badge's earlier one is at hand: keep its
  // rows and say they may be out of date.
  const stale = bell !== null && read.isError;
  const noPlayer = bell?.players === 0;
  const needShown = needRows.length > 0 || more || needs?.ok === false;
  const nothing =
    bell &&
    !stale &&
    needs !== undefined &&
    !needShown &&
    !noPlayer &&
    fresh.length === 0 &&
    earlier.length === 0 &&
    !counted;

  const eventItem = (r) => {
    const on = r.new;
    switch (r.kind) {
      case "cheer":
        return (
          <Item
            key={r.key}
            icon={r.icon}
            to={r.to}
            onLeave={leave(r.key)}
            isNew={on}
            title={<TagText>{r.text}</TagText>}
            detail={<Cheers row={r} />}
          />
        );
      case "follower": {
        const one = (bell?.players ?? 0) <= 1;
        const backable = r.followBack || backed.has(r.tag);
        return (
          <Item
            key={r.key}
            icon={r.icon}
            to={r.to}
            onLeave={leave(r.key)}
            isNew={on}
            detail={r.verified ? null : "Not verified"}
            title={
              <>
                {/* A claimed player wears no gold mark (Jamie, 2026-11-14). */}
                <PlayerName
                  tag={r.tag}
                  verified={r.verified ? undefined : false}
                >
                  <TagText>{r.title}</TagText>
                </PlayerName>{" "}
                {one ? (
                  "follows you"
                ) : (
                  <>
                    follows <TagText>{r.followed}</TagText>
                  </>
                )}
              </>
            }
            action={
              backable ? (
                backed.has(r.tag) ? (
                  <span className="kit-following">Following</span>
                ) : (
                  // Follow back (2026-11-13): the follower's player,
                  // verified or claimed, by the one confirmed, priced Follow.
                  <FollowButton
                    tag={r.tag}
                    name={r.name}
                    label="Follow back"
                    lazy
                    onDone={() => setBacked((was) => new Set(was).add(r.tag))}
                  />
                )
              ) : null
            }
          />
        );
      }
      case "comment":
        return (
          <Item
            key={r.key}
            icon={r.icon}
            to={r.to}
            onLeave={leave(r.key)}
            isNew={on}
            title={
              <>
                {r.tag ? (
                  <PlayerName tag={r.tag}>
                    <TagText>{r.who}</TagText>
                  </PlayerName>
                ) : (
                  <TagText>{r.who}</TagText>
                )}{" "}
                commented
              </>
            }
            detail={[`“${r.text}”`, r.at ? clock.when(r.at) : null]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      case "answer":
        return (
          <Item
            key={r.key}
            icon={r.icon}
            to={r.to}
            onLeave={leave(r.key)}
            isNew={on}
            title={r.title}
            detail={[
              r.about ? `“${r.about}”` : null,
              r.at ? clock.when(r.at) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        );
      default:
        return (
          <Item
            key={r.key}
            icon={r.icon}
            to={r.to}
            onLeave={leave(r.key)}
            isNew={on}
            title={<TagText>{r.title}</TagText>}
            detail={[r.at ? clock.when(r.at) : null, r.detail]
              .filter(Boolean)
              .join(" · ")}
          />
        );
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a modal dialog: its backdrop tap and arrow keys are the sheet's own
    <dialog
      ref={box}
      className="kit-bell__sheet"
      aria-labelledby="bell-title"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      // A tap outside the box lands on the dialog itself (its backdrop).
      onClick={(e) => {
        if (e.target === box.current) dismiss();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="kit-bell__box">
        <header className="kit-bell__head">
          <h2 id="bell-title" ref={head} tabIndex={-1}>
            {SHELL_PLACES.bell.label}
          </h2>
          <button
            type="button"
            className="btn btn--quiet kit-bell__close"
            aria-label="Close"
            onClick={dismiss}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <div className="kit-bell__scroll" ref={list}>
          {stale ? (
            <div className="kit-bell__stale" role="status">
              <p>Couldn’t refresh just now, so this may be out of date.</p>
              <button
                type="button"
                className="btn btn--sm"
                disabled={read.isFetching}
                onClick={() => read.refetch()}
              >
                {read.isFetching ? "Trying…" : "Try again"}
              </button>
            </div>
          ) : null}
          <PushPrompt onLeave={leave(null)} />
          {needShown ? (
            <Group id="bell-needs" title="Needs you" tone="needs">
              {needRows.map((r) => (
                <Item
                  key={r.key}
                  icon={r.key === "refusals" ? "key-round" : "flag"}
                  to={r.to}
                  onLeave={leave(null)}
                  title={<TagText>{r.title}</TagText>}
                  detail={r.detail}
                  tone="needs"
                />
              ))}
              {more ? (
                <Item
                  key="more"
                  icon="list"
                  to={more.to}
                  onLeave={leave(null)}
                  title={more.title}
                  tone="needs"
                />
              ) : null}
              {needs?.ok === false ? (
                <li className="kit-bell__note">
                  <ErrorState
                    title="Your clan’s actions could not be read just now"
                    onRetry={() => needsRead.refetch()}
                    busy={needsRead.isFetching}
                  >
                    Try again in a moment.
                  </ErrorState>
                </li>
              ) : null}
            </Group>
          ) : null}
          {loading ? (
            <ul
              className="kit-bell__list"
              aria-busy="true"
              aria-label="Loading"
            >
              {[0, 1, 2].map((i) => (
                <li key={i} className="kit-bell__ghost" />
              ))}
            </ul>
          ) : null}
          {failed ? (
            <ErrorState
              title="Your notifications could not be read just now"
              onRetry={() => read.refetch()}
              busy={read.isFetching}
            >
              Try again in a moment.
            </ErrorState>
          ) : null}
          {noPlayer ? (
            <ul className="kit-bell__list">
              <Item
                icon="shield-check"
                to={`${SETTINGS}/players/verify`}
                onLeave={leave(null)}
                title="Verify your player"
                detail="Then cheers on your play and your new followers show up here."
              />
            </ul>
          ) : null}
          {fresh.length ? (
            <Group id="bell-new" title="New">
              {fresh.map(eventItem)}
            </Group>
          ) : null}
          {earlier.length || counted ? (
            <Group id="bell-earlier" title="Earlier">
              {earlier.map(eventItem)}
              {counted ? (
                <Item key="counted" icon="users" title={counted} />
              ) : null}
            </Group>
          ) : null}
          {nothing ? (
            <Empty title="All quiet">
              Cheers on your play, new followers and answers to your feedback
              show up here.
            </Empty>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
