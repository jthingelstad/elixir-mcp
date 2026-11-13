import { useEffect, useRef, useState } from "react";
import {
  FAMILY_PLACES,
  Icon,
  Link,
  Row,
  Rows,
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
import {
  accountRows,
  answerRows,
  bellCount,
  bellLabel,
  followerRows,
  reactionRow,
} from "./bell-logic.js";

/**
 * The bell (2026-11-12): what is about you, not your friends. Jamie's go,
 * 2026-11-12: "Approved: build the remaining canvas pieces (bell, …)", and
 * the canvas's four parts: reactions to your items (counts, never who), new
 * followers (named by their verified player, else counted), Needs you (your
 * clan's actions waiting on you as a leader, and an old key still trying to
 * connect: Home's old Needs you, as before) and answers to your feedback.
 * Since 2026-11-12 also your account's own lines, out of Home's feed: a burst
 * is one line ("Recording started for 24 players").
 *
 * The dot is lit while something needs you or something came since you last
 * opened the bell; opening it moves your seen marker. Nothing here goes to
 * mail or Discord. Both reads are every few minutes at most; the sheet adds
 * the clan card's read only when it is opened.
 */
export function useBell(me, enabled) {
  const clock = useClock();
  const needs = panelOf(useBellNeeds(enabled), "needs");
  const bell = useBellRead(enabled).data;
  const { rows } = needsYou({ needs, signals: me?.signals, clock });
  const count = bellCount(rows.length, bell);
  return { lit: count > 0, count };
}

export function BellButton({ bell, onOpen, phone = false }) {
  const words = FAMILY_PLACES.bell;
  const label = bellLabel(words.label, bell.count);
  return (
    <button
      type="button"
      className={phone ? undefined : "kit-top__icon kit-bell"}
      aria-haspopup="dialog"
      aria-label={phone ? undefined : label}
      onClick={onOpen}
    >
      <span className="kit-bell__mark">
        <Icon name={words.icon} size={phone ? 22 : 18} />
        {bell.lit ? (
          // On the bar the dot carries the count (the button's name says
          // it); on a phone tab it stays a dot.
          <span
            className={
              !phone && bell.count > 0
                ? "kit-bell__dot kit-bell__dot--count"
                : "kit-bell__dot"
            }
            aria-hidden="true"
          >
            {!phone && bell.count > 0
              ? bell.count > 99
                ? "99+"
                : bell.count
              : null}
          </span>
        ) : null}
      </span>
      {phone ? (
        <span>
          {words.tab}
          {bell.lit ? (
            <span className="sr-only">, {bell.count} new</span>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

/** A row's "new" mark: a dot to see, a word to hear. */
const New = ({ on }) =>
  on ? (
    <span className="kit-bell__new">
      <span className="sr-only">New: </span>
    </span>
  ) : null;

function Section({ title, children }) {
  return (
    <section className="kit-bell__sec" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function BellSheet({ me, onClose }) {
  const box = useRef(null);
  const clock = useClock();
  const needs = panelOf(useBellNeeds(true), "needs");
  const clan = panelOf(useHomeClan(), "clan");
  const read = useBellRead(true, { fresh: true });
  const seen = useBellSeen();
  // What was new when the sheet opened stays marked while it is open; the
  // marker moves once, as soon as there is something to show.
  const [shown, setShown] = useState(null);
  const marked = useRef(false);
  useEffect(() => {
    if (!read.data || !read.isFetchedAfterMount || marked.current) return;
    marked.current = true;
    setShown(read.data);
    seen.mutate();
  }, [read.data, read.isFetchedAfterMount, seen]);
  const { rows, more } = needsYou({ clan, needs, signals: me?.signals, clock });
  useEffect(() => {
    const d = box.current;
    if (d && typeof d.showModal === "function" && !d.open) d.showModal();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
    };
  }, []);
  const bell = shown ?? read.data ?? null;
  const reactions = (bell?.reactions?.items ?? []).map(reactionRow);
  const followers = followerRows(bell?.followers);
  // Followed back while the sheet is open: the sheet keeps the read it
  // opened on, so the row says Following itself.
  const [backed, setBacked] = useState(() => new Set());
  const answers = answerRows(bell?.answers);
  const account = accountRows(bell?.account);
  const nothing =
    bell &&
    needs !== undefined &&
    rows.length === 0 &&
    reactions.length === 0 &&
    followers.rows.length === 0 &&
    !followers.counted &&
    answers.length === 0 &&
    account.length === 0;
  return (
    <dialog
      ref={box}
      className="kit-help kit-bell__sheet"
      aria-labelledby="bell-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="kit-help__box">
        <header className="kit-help__head">
          <h2 id="bell-title">{FAMILY_PLACES.bell.label}</h2>
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <p className="kit-tiny">What is about you, not your friends.</p>
        {bell === null && read.isPending ? (
          <div className="kit-skeleton" aria-busy="true" />
        ) : null}
        {read.isError ? (
          <p className="kit-tiny" role="alert">
            Your notifications could not be read just now.
          </p>
        ) : null}
        {bell && bell.players === 0 ? (
          <p>
            Verify your player to see cheers on your items and who follows you.{" "}
            <Link
              to={`${SETTINGS}/players/verify`}
              className="link"
              onClick={onClose}
            >
              Verify a player
            </Link>
          </p>
        ) : null}
        {reactions.length ? (
          <Section title="Reactions to your items">
            <Rows>
              {reactions.map((r) => (
                <Row
                  key={r.key}
                  href={r.to ?? undefined}
                  onClick={r.to ? onClose : undefined}
                  title={
                    <>
                      <New on={r.new} />
                      <TagText>{r.text}</TagText>
                    </>
                  }
                  detail={
                    <span aria-label={r.words}>
                      {r.counts.map((c) => (
                        <span key={c.key} className="kit-bell__cheer">
                          <span aria-hidden="true">{c.emoji}</span> {c.count}
                        </span>
                      ))}
                    </span>
                  }
                />
              ))}
            </Rows>
            <p className="kit-tiny">Counts only: never who cheered.</p>
          </Section>
        ) : null}
        {followers.rows.length || followers.counted ? (
          <Section title="New followers">
            {followers.rows.length ? (
              <Rows>
                {followers.rows.map((f) =>
                  f.followBack || backed.has(f.tag) ? (
                    // Follow back (2026-11-13): the follower's verified
                    // player, by the one confirmed, priced Follow. The name
                    // still opens their page; the row is not a link, so
                    // the button is not inside one.
                    <Row
                      key={f.key}
                      title={
                        <>
                          <New on={f.new} />
                          <Link to={f.to} className="hit" onClick={onClose}>
                            <TagText>{f.title}</TagText>
                          </Link>
                        </>
                      }
                      detail={<TagText>{f.detail}</TagText>}
                      right={
                        backed.has(f.tag) ? (
                          <span className="kit-following">Following</span>
                        ) : (
                          <FollowButton
                            tag={f.tag}
                            name={f.name}
                            label="Follow back"
                            lazy
                            onDone={() =>
                              setBacked((was) => new Set(was).add(f.tag))
                            }
                          />
                        )
                      }
                    />
                  ) : (
                    <Row
                      key={f.key}
                      href={f.to}
                      onClick={onClose}
                      title={
                        <>
                          <New on={f.new} />
                          <TagText>{f.title}</TagText>
                        </>
                      }
                      detail={<TagText>{f.detail}</TagText>}
                    />
                  ),
                )}
              </Rows>
            ) : null}
            {followers.counted ? (
              <p className="kit-tiny">{followers.counted}</p>
            ) : null}
          </Section>
        ) : null}
        {rows.length || needs?.ok === false ? (
          <Section title="Needs you">
            {rows.length ? (
              <Rows>
                {rows.map((r) => (
                  <Row
                    key={r.key}
                    title={<TagText>{r.title}</TagText>}
                    detail={r.detail}
                    right={
                      <Link to={r.to} className="btn btn--sm" onClick={onClose}>
                        {r.cta}
                      </Link>
                    }
                  />
                ))}
                {more ? (
                  <Row
                    quiet
                    href={more.to}
                    title={more.title}
                    onClick={onClose}
                  />
                ) : null}
              </Rows>
            ) : null}
            {needs?.ok === false ? (
              <p className="kit-tiny" role="alert">
                Your clan&rsquo;s actions could not be read just now.
              </p>
            ) : null}
          </Section>
        ) : null}
        {answers.length ? (
          <Section title="Answers to your feedback">
            <Rows>
              {answers.map((a) => (
                <Row
                  key={a.key}
                  href={a.to}
                  onClick={onClose}
                  title={
                    <>
                      <New on={a.new} />
                      {a.title}
                    </>
                  }
                  detail={a.detail}
                />
              ))}
            </Rows>
          </Section>
        ) : null}
        {account.length ? (
          <Section title="Your account">
            <Rows>
              {account.map((a) => (
                <Row
                  key={a.key}
                  href={a.to}
                  onClick={onClose}
                  title={
                    <>
                      <New on={a.new} />
                      <TagText>{a.title}</TagText>
                    </>
                  }
                  detail={a.detail ?? clock.when(a.at)}
                />
              ))}
            </Rows>
          </Section>
        ) : null}
        {nothing ? <p>Nothing new about you right now.</p> : null}
      </div>
    </dialog>
  );
}
