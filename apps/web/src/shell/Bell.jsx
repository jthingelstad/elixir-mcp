import { useEffect, useRef } from "react";
import {
  FAMILY_PLACES,
  Icon,
  Link,
  Row,
  Rows,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import { needsYou, panelOf } from "../home/logic.js";
import { useBellNeeds, useHomeClan } from "../lib/queries.js";

/**
 * The bell (slice 7, #765): what needs you, on every page. It is Home's old
 * Needs you box, moved: your clan's actions waiting on you as a leader, and
 * an old key still trying to connect. The dot is lit while any of them is.
 *
 * The dot reads Needs you's own read (no record reads) once every few
 * minutes; the sheet adds the clan card's read only when it is opened, for
 * the one row that needs the clan's size. Nothing here is new: cheers and
 * followers are not in it [engineering, 2026-11-12].
 */
export function useBell(me, enabled) {
  const clock = useClock();
  const needs = panelOf(useBellNeeds(enabled), "needs");
  const { rows } = needsYou({ needs, signals: me?.signals, clock });
  return { lit: rows.length > 0, count: rows.length };
}

export function BellButton({ bell, onOpen, phone = false }) {
  const words = FAMILY_PLACES.bell;
  const label = bell.lit
    ? `${words.label}, ${bell.count} ${bell.count === 1 ? "needs" : "need"} you`
    : words.label;
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
          <span className="kit-bell__dot" aria-hidden="true" />
        ) : null}
      </span>
      {phone ? (
        <span>
          {words.tab}
          {bell.lit ? <span className="sr-only">, {label}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

export function BellSheet({ me, onClose }) {
  const box = useRef(null);
  const clock = useClock();
  const needs = panelOf(useBellNeeds(true), "needs");
  const clan = panelOf(useHomeClan(), "clan");
  const { rows, more } = needsYou({ clan, needs, signals: me?.signals, clock });
  useEffect(() => {
    const d = box.current;
    if (d && typeof d.showModal === "function" && !d.open) d.showModal();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
    };
  }, []);
  return (
    <dialog
      ref={box}
      className="kit-help"
      aria-labelledby="bell-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="kit-help__box">
        <header className="kit-help__head">
          <h2 id="bell-title">Needs you</h2>
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        {needs === undefined ? (
          <div className="kit-skeleton" aria-busy="true" />
        ) : rows.length === 0 ? (
          <p>Nothing needs you right now.</p>
        ) : (
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
            {more ? <Row quiet href={more.to} title={more.title} /> : null}
          </Rows>
        )}
        {needs?.ok === false ? (
          <p className="kit-tiny" role="alert">
            Your clan&rsquo;s actions could not be read just now.
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
