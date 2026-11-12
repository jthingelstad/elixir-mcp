import { Chips, Empty, ErrorState, Link, PageHead } from "@elixir-mcp/ui";
import { useEffect, useMemo, useState } from "react";
import { CLAN } from "../lib/base.js";
import {
  CLAN_FULL,
  FILTERS,
  NO_FILTERS,
  TYPE_LABELS,
  countedWords,
  crestOf,
  isFiltered,
  policyFacts,
  removalWords,
  tileHref,
  visible,
} from "../lib/directory.js";

/**
 * The clan directory (#768): every clan that saved its rules in Elixir, as
 * a grid of tiles, with filters on facts the tiles show. Listed by name and
 * never ranked; a filter hides tiles and never reorders them.
 */
export function Directory({ state, onRetry, onSignedOut = sessionExpired }) {
  const [f, setF] = useState(NO_FILTERS);
  // A finished read that refused is not a read still running (#782 review):
  // signed out goes where Clan's other views send it.
  useEffect(() => {
    if (state.signedOut) onSignedOut();
  }, [state.signedOut, onSignedOut]);
  const set = (k) => (v) => setF((was) => ({ ...was, [k]: v }));
  const clans = useMemo(() => state.data?.clans ?? [], [state.data]);
  const shown = useMemo(() => visible(clans, f), [clans, f]);

  const head = (
    <PageHead
      title="Clan directory"
      sub="Every clan here has saved its rules in Elixir. Find one whose rules fit how you play."
    />
  );
  if (state.signedOut)
    return (
      <div className="clan-dir">
        {head}
        <p className="page-head__note" role="status">
          Your session ended. Taking you to sign in…
        </p>
      </div>
    );
  if (state.forbidden)
    return (
      <div className="clan-dir">
        {head}
        <div className="callout callout--warn" role="alert">
          <span>
            The clan directory is for people signed in to Elixir with an
            approved account.
          </span>
        </div>
      </div>
    );
  if (state.error && !state.data)
    return (
      <div className="clan-dir">
        {head}
        <ErrorState onRetry={onRetry} busy={state.loading}>
          The directory did not load.
        </ErrorState>
      </div>
    );
  if (!state.data)
    return (
      <div className="clan-dir">
        {head}
        <p className="page-head__note" role="status">
          Reading the directory…
        </p>
      </div>
    );
  if (clans.length === 0)
    return (
      <div className="clan-dir">
        {head}
        <Empty title="No clan has saved its rules yet">
          A clan is listed here once its leaders save a policy in Clan.
        </Empty>
      </div>
    );

  return (
    <div className="clan-dir">
      {head}
      <form
        className="clan-dir__filters"
        role="search"
        aria-label="Filter the clan directory"
        onSubmit={(e) => e.preventDefault()}
      >
        <label className="clan-dir__field clan-dir__field--wide">
          <span className="clan-dir__label">Search</span>
          <input
            type="search"
            value={f.q}
            onChange={(e) => set("q")(e.target.value)}
            placeholder="Name, tag or description"
            autoComplete="off"
            spellCheck="false"
          />
        </label>
        <div className="clan-dir__field">
          <span className="clan-dir__label">Clan Wars</span>
          <Chips
            label="Clan Wars"
            options={FILTERS.war}
            value={f.war}
            onChange={set("war")}
          />
        </div>
        <div className="clan-dir__field">
          <span className="clan-dir__label">How strict</span>
          <Chips
            label="How strict"
            options={FILTERS.posture}
            value={f.posture}
            onChange={set("posture")}
          />
        </div>
        <div className="clan-dir__field">
          <span className="clan-dir__label">
            Days with no battle before a removal
          </span>
          <Chips
            label="Days with no battle before a removal"
            options={FILTERS.removal}
            value={f.removal}
            onChange={set("removal")}
          />
        </div>
        <div className="clan-dir__field">
          <span className="clan-dir__label">Room</span>
          <Chips
            label="Room"
            options={FILTERS.room}
            value={f.room}
            onChange={set("room")}
          />
        </div>
        <label className="clan-dir__field">
          <span className="clan-dir__label">Your trophies</span>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={f.trophies}
            onChange={(e) => set("trophies")(e.target.value.replace(/\D/g, ""))}
            placeholder="Clans you can join with them"
            autoComplete="off"
          />
        </label>
      </form>

      <p className="clan-dir__count" role="status">
        {isFiltered(f)
          ? `${shown.length} of ${clans.length} listed clans fit`
          : `${clans.length} listed ${clans.length === 1 ? "clan" : "clans"}, by name`}
        {isFiltered(f) ? (
          <>
            {" · "}
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => setF(NO_FILTERS)}
            >
              Clear the filters
            </button>
          </>
        ) : null}
      </p>

      {shown.length === 0 ? (
        <Empty
          title="No clan fits all of that"
          action={
            <button
              type="button"
              className="btn"
              onClick={() => setF(NO_FILTERS)}
            >
              Clear the filters
            </button>
          }
        >
          Loosen a filter to see more clans.
        </Empty>
      ) : (
        <ul className="clan-dir__grid">
          {shown.map((c) => (
            <ClanTile key={c.clan_tag} clan={c} />
          ))}
        </ul>
      )}

      {state.data.truncated ? (
        <p className="clan-dir__foot">
          The directory shows the first {clans.length} clans by name.
        </p>
      ) : null}
      <p className="clan-dir__foot">
        Nothing here is a rating. Clans are listed by name; each tile says only
        what the game shows about the clan and what its leaders saved as its
        rules.
      </p>
    </div>
  );
}

function sessionExpired() {
  window.location.assign(`${CLAN}?error=session_expired`);
}

function ClanTile({ clan }) {
  const facts = policyFacts(clan.policy);
  const counted = countedWords(clan.policy.counted);
  const name = clan.name ?? clan.clan_tag;
  return (
    <li className="clan-dir__tile" data-clan={clan.clan_tag}>
      <div className="clan-dir__top">
        <span className="clan-dir__crest" aria-hidden="true">
          {crestOf(clan)}
        </span>
        <div className="clan-dir__who">
          <h2 className="clan-dir__name">
            <Link to={tileHref(clan)} className="clan-dir__link">
              {name}
            </Link>
          </h2>
          <span className="tag">{clan.clan_tag}</span>
          {clan.yours ? <span className="chip chip--info">yours</span> : null}
        </div>
      </div>
      <ul className="clan-dir__facts" aria-label="Rules">
        {facts.map((t) => (
          <li key={t} className="chip chip--mute">
            {t}
          </li>
        ))}
      </ul>
      {clan.description ? (
        <p className="clan-dir__about">{clan.description}</p>
      ) : null}
      <dl className="clan-dir__kv">
        <div>
          <dt>Members</dt>
          <dd>
            {clan.members === null
              ? "Not recorded"
              : `${clan.members} of ${CLAN_FULL}`}
          </dd>
        </div>
        <div>
          <dt>To join</dt>
          <dd>
            {[
              clan.type ? TYPE_LABELS[clan.type] : null,
              clan.required_trophies === null
                ? null
                : `${clan.required_trophies.toLocaleString("en-US")} trophies`,
            ]
              .filter(Boolean)
              .join(", ") || "Not recorded"}
          </dd>
        </div>
        <div>
          <dt>What counts</dt>
          <dd>{counted.length ? counted.join(", ") : "Nothing counted"}</dd>
        </div>
        <div>
          <dt>Removal</dt>
          <dd>{removalWords(clan.policy.removal_day)}</dd>
        </div>
      </dl>
    </li>
  );
}
