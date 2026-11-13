import { useId, useState } from "react";
import { pageCheersKey, useCheer, usePageCheers } from "../lib/queries.js";
import { useScope } from "../lib/scope.js";
import {
  CHEERS,
  cheerCounts,
  cheeredBy,
  nextCheer,
  withMyCheer,
} from "./cheer-set.js";

/**
 * A feed item's cheers (#765): the cheers it has, each with its count, the
 * one that is yours pressed; Cheer opens the six. One per person per item:
 * another cheer changes yours, the same one takes it back. Counts only:
 * "You and 2 others", never who. Under an agent's scope (if it is ever
 * drawn there) the counts show and nothing can be pressed: an agent never
 * cheers.
 *
 * Home's feed by default; `where` names another cached list the item lives
 * in (a player page's or a battle page's cheers read, `usePageCheered`).
 */
export function Cheers({ it, where }) {
  const scope = useScope();
  const cheer = useCheer(where);
  const [open, setOpen] = useState(false);
  const pickId = useId();
  const mine = it.my_cheer ?? null;
  const counts = cheerCounts(it.cheers);
  const who = cheeredBy(it.cheers, mine);
  const label = (c) =>
    `${c.label}, ${c.count}${mine === c.key ? ", yours" : ""}`;

  if (scope)
    return counts.length ? (
      <p className="kit-cheers__row kit-tiny">
        {counts.map((c) => (
          <span key={c.key} aria-label={label(c)} role="img">
            <span aria-hidden="true">
              {c.emoji} {c.count}
            </span>
          </span>
        ))}
      </p>
    ) : null;

  // One write at a time per item: a second tap waits for the first's
  // answer, so answers can never land out of order or roll back a newer
  // cheer.
  const busy = cheer.isPending;
  const tap = (key) => {
    if (busy) return;
    const next = nextCheer(mine, key);
    setOpen(false);
    cheer.mutate({ item: it, next, shown: withMyCheer(it, next) });
  };
  return (
    <div className="kit-cheers">
      <div className="kit-cheers__row">
        {counts.map((c) => (
          <button
            key={c.key}
            type="button"
            className="kit-chip"
            disabled={busy}
            aria-pressed={mine === c.key}
            aria-label={label(c)}
            onClick={() => tap(c.key)}
          >
            <span aria-hidden="true">{c.emoji}</span> {c.count}
          </button>
        ))}
        <button
          type="button"
          className="kit-chip kit-cheers__add"
          disabled={busy}
          aria-expanded={open}
          aria-controls={open ? pickId : undefined}
          onClick={() => setOpen(!open)}
        >
          Cheer
        </button>
        {who ? <span className="kit-cheers__who">{who}</span> : null}
        {cheer.isError ? (
          <span role="alert" className="field-error">
            Your cheer was not saved. Try again.
          </span>
        ) : null}
      </div>
      {open ? (
        <div
          id={pickId}
          role="group"
          aria-label="Choose a cheer"
          className="kit-cheers__row"
        >
          {CHEERS.map((c) => (
            <button
              key={c.key}
              type="button"
              className="kit-chip"
              disabled={busy}
              aria-pressed={mine === c.key}
              onClick={() => tap(c.key)}
            >
              <span aria-hidden="true">{c.emoji}</span> {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A player page's or a battle page's cheers (2026-11-12): an item there
 * takes cheers, and shows its counts, only while it is in your own feed
 * (the server's `cheersOnPage` says which: `items`). `of(item)` is the item ready
 * for <Cheers>, or null for one that has none; `where` is the list it lives
 * in. Signed out, or before the read answers, nothing has cheers.
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
