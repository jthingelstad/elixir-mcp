import { PlayerName } from "@elixir-mcp/ui";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Icon, Link, TagText } from "@elixir-mcp/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { FollowCost, Followed, useFollow } from "../home/follow.jsx";
import { useCardCatalog, useMyClans, usePeople } from "../lib/queries.js";
import { ClanmateState, isClanmateConnection } from "../home/Connection.jsx";
import {
  readSearch,
  readable,
  searchSources,
  typedGroups,
  handleQuery,
  isTagQuery,
} from "./search-logic.js";
import { normTag } from "../lib/tag-url.js";

/** A name read waits this long after the last key; Enter does not wait. Each
 *  read is on the account's shared hourly budget. */
const SETTLE_MS = 500;

export function SearchSheet({ me, onClose }) {
  const box = useRef(null);
  const [q, setQ] = useState("");
  const [settled, setSettled] = useState("");
  const clans = useMyClans();
  // The same current, blocked-aware peers as Find, including alt clans.
  // A raw roster or followed clan cannot establish a social connection.
  const clanmates = usePeople("clan");
  const cards = useCardCatalog({ enabled: q.trim().length > 0 });

  useEffect(() => {
    const d = box.current;
    if (d && typeof d.showModal === "function" && !d.open) d.showModal();
    return () => {
      if (d?.open && typeof d.close === "function") d.close();
    };
  }, []);

  useEffect(() => {
    const t = q.trim();
    if (!readable(t)) {
      setSettled("");
      return undefined;
    }
    // A debounce, cleared on every keystroke and on close.
    const settle = () => setSettled(t);
    const timer = setTimeout(settle, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  const remote = useQuery({
    queryKey: ["me", "search", "read", settled],
    enabled: Boolean(settled),
    staleTime: 60 * 1000,
    retry: false,
    queryFn: () => readSearch(settled, api.tool),
  });

  const sources = useMemo(
    () =>
      searchSources({
        me,
        clans: clans.data,
        clanmates: clanmates.data,
        cards: cards.data?.cards,
      }),
    [me, clans.data, clanmates.data, cards.data],
  );
  // Accounts by @handle (2026-11-15), beside the player read.
  const handle = handleQuery(settled);
  const accounts = useQuery({
    queryKey: ["me", "search", "accounts", handle ?? ""],
    enabled: Boolean(handle),
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async () => {
      const r = await api.searchAccounts(handle);
      return r.ok ? (r.data?.accounts ?? []) : [];
    },
  });
  // Accounts show as soon as they are found, whatever the player read is
  // doing (Codex on #1065): a slow or failed name search hides no @handle.
  // An empty account answer alone is not "nothing matches" yet.
  const settledNow = q.trim() === settled;
  const foundAccounts = settledNow ? (accounts.data ?? []) : [];
  const found =
    settledNow && remote.data
      ? { ...remote.data, accounts: foundAccounts }
      : foundAccounts.length
        ? { players: [], clans: [], miss: null, accounts: foundAccounts }
        : null;
  const groups = typedGroups(q, sources, found);
  const miss = found?.miss ?? null;
  const failed = q.trim() === settled && remote.isError;

  const submit = (e) => {
    e.preventDefault();
    const t = q.trim();
    if (readable(t) && settled !== t) {
      setSettled(t);
      return;
    }
    box.current?.querySelector("[data-search-row]")?.click();
  };

  return (
    <dialog
      ref={box}
      className="kit-search"
      aria-label="Search"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="kit-search__box">
        <form className="kit-search__field" onSubmit={submit}>
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            aria-label="Search players, clans, cards, help"
            placeholder="Players, clans, cards, help"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // A search field's own Escape only clears it; here Escape
              // closes the sheet, as it does from anywhere else in it.
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            autoComplete="off"
            spellCheck="false"
            autoFocus
          />
          {/* The sheets close one way (2026-11-13): an X, as the bell and
              help do, which leaves the field its width on a phone. */}
          <button
            type="button"
            className="btn btn--sm btn--quiet"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </form>
        <div className="kit-search__results" aria-live="polite">
          {failed ? (
            <ErrorState
              title="Search could not be read just now"
              onRetry={() => remote.refetch()}
              busy={remote.isFetching}
            >
              {remote.error?.message ?? "Try again in a moment."}
            </ErrorState>
          ) : null}
          {groups.map((g) => (
            <section key={g.h} className="kit-search__group">
              <h2>{g.h}</h2>
              {g.rows.map((r) =>
                r.plain ? (
                  <a key={r.href} href={r.href} data-search-row="">
                    <span>{r.t}</span>
                    <span className="kit-search__door">{r.d}</span>
                  </a>
                ) : (
                  <Link
                    key={r.href}
                    to={r.href}
                    data-search-row=""
                    onClick={onClose}
                  >
                    <span>
                      <PlayerName
                        tag={
                          r.href?.startsWith("/home/player/")
                            ? normTag(r.href.split("/").at(-1))
                            : null
                        }
                      >
                        <TagText>{r.t}</TagText>
                      </PlayerName>
                    </span>
                    <span className="kit-search__door">
                      {isClanmateConnection(r) ? (
                        <>
                          <ClanmateState
                            friend={r.connection === "friend"}
                            close={r.close === true}
                          />
                          <br />
                        </>
                      ) : null}
                      <TagText>{r.d}</TagText>
                    </span>
                  </Link>
                ),
              )}
            </section>
          ))}
          {miss ? <Miss tag={miss} /> : null}
          {q.trim() &&
          !miss &&
          !failed &&
          groups.length === 0 &&
          (found || !readable(q)) ? (
            // [engineering, 2026-11-05]: the boards draw a tag's miss only.
            <p className="kit-search__note">
              Nothing here matches that. A player tag finds anyone on record.
            </p>
          ) : null}
          {isTagQuery(q) && q.trim() === settled && remote.isFetching ? (
            <p className="kit-search__note" role="status">
              Looking up {normTag(q)}.
            </p>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

/** A tag nobody has added. Following it is the same act as Home's. */
function Miss({ tag }) {
  const { follow, busy, error, result } = useFollow();
  return (
    <div className="kit-search__miss">
      <h2>{tag} has no record here</h2>
      <p>
        Elixir records the players and clans someone added. It does not crawl
        the whole game. Follow this tag and recording starts within a few
        minutes.
      </p>
      {result ? (
        <Followed result={result} />
      ) : (
        <>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => follow(tag)}
          >
            Follow {tag}
          </button>
          <FollowCost tag={tag} />
        </>
      )}
      {error ? (
        <p className="kit-form__err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
