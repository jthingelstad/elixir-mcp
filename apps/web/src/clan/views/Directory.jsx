import {
  Avatar,
  Chips,
  Empty,
  ErrorState,
  Link,
  PageHead,
} from "@elixir-mcp/ui";
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
export function Directory({
  state,
  onRetry,
  onSignedOut = sessionExpired,
  query = "",
}) {
  // A clan's address for someone not in it opens here with its tag in the
  // search (`/clan/directory?q=<tag>`): Elixir has no page for a clan you
  // are not in, and the directory lists it when it saved its rules.
  const [f, setF] = useState(() => ({
    ...NO_FILTERS,
    q: String(query ?? "").slice(0, 100),
  }));
  // A finished read that refused is not a read still running (#782 review):
  // signed out goes where Clan's other views send it.
  useEffect(() => {
    if (state.signedOut) onSignedOut();
  }, [state.signedOut, onSignedOut]);
  // On a phone the filters other than search fold behind one control,
  // closed at first, so tiles show on the first screen (2026-11-13). A
  // wider screen always shows them and never draws the control.
  const [open, setOpen] = useState(false);
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
        <button
          type="button"
          className="btn btn--sm clan-dir__toggle"
          aria-expanded={open}
          aria-controls="clan-dir-more"
          onClick={() => setOpen((was) => !was)}
        >
          {foldedCount(f) ? `Filters · ${foldedCount(f)} set` : "Filters"}
        </button>
        <div
          id="clan-dir-more"
          className="clan-dir__more"
          data-open={open ? "" : undefined}
        >
          <div className="clan-dir__field">
            <span className="clan-dir__label">Clan Wars</span>
            <Chips
              label="Clan Wars"
              className="kit-chips--seg"
              options={FILTERS.war}
              value={f.war}
              onChange={set("war")}
            />
          </div>
          <div className="clan-dir__field">
            <span className="clan-dir__label">How strict</span>
            <Chips
              label="How strict"
              className="kit-chips--seg"
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
              className="kit-chips--seg clan-dir__fold"
              options={FILTERS.removal}
              value={f.removal}
              onChange={set("removal")}
            />
          </div>
          <div className="clan-dir__field">
            <span className="clan-dir__label">Room</span>
            <Chips
              label="Room"
              className="kit-chips--seg"
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
              onChange={(e) =>
                set("trophies")(e.target.value.replace(/\D/g, ""))
              }
              placeholder="Clans you can join with them"
              autoComplete="off"
            />
          </label>
        </div>
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

/** How many filters behind the phone's Filters control are set: every
 *  filter but search, which stays in view. */
function foldedCount(f) {
  return Object.keys(NO_FILTERS).filter(
    (k) => k !== "q" && String(f[k]).trim() !== NO_FILTERS[k],
  ).length;
}

function sessionExpired() {
  window.location.assign(`${CLAN}?error=session_expired`);
}

function ClanTile({ clan }) {
  const facts = policyFacts(clan.policy);
  const counted = countedWords(clan.policy.counted);
  const name = clan.name ?? clan.clan_tag;
  return (
    <li
      className={`clan-dir__tile${clan.yours ? " clan-dir__tile--mine" : ""}`}
      data-clan={clan.clan_tag}
    >
      <div className="clan-dir__top">
        <Avatar name={crestOf(clan)} tag={clan.clan_tag} clan />
        <div className="clan-dir__who">
          <h2 className="clan-dir__name">
            {tileHref(clan) ? (
              <Link to={tileHref(clan)} className="clan-dir__link">
                {name}
              </Link>
            ) : (
              name
            )}
          </h2>
          <span className="tag">{clan.clan_tag}</span>
        </div>
      </div>
      <ul className="clan-dir__facts" aria-label="Rules">
        {facts.map((t, i) => (
          <li
            key={t}
            className={`kit-fact${i === 0 && clan.policy.war_intent === "participating" ? " kit-fact--gold" : ""}`}
          >
            {t}
          </li>
        ))}
      </ul>
      {clan.description ? (
        <p className="clan-dir__about">{clan.description}</p>
      ) : null}
      <dl className="clan-dir__kv">
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
      </dl>
      {/* The tile's foot (canvas .ctile footer): size and the removal rule
          on the left, your own clan named on the right. */}
      <div className="clan-dir__tilefoot">
        <dl className="clan-dir__footkv">
          <div>
            <dt>Members</dt>
            <dd>
              {clan.members === null
                ? "Not recorded"
                : `${clan.members} of ${CLAN_FULL}`}
            </dd>
          </div>
          <div>
            <dt>Removal</dt>
            <dd>{removalWords(clan.policy.removal_day)}</dd>
          </div>
        </dl>
        {clan.yours ? <span className="clan-dir__mine">Your clan</span> : null}
      </div>
    </li>
  );
}
