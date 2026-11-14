import { useLocation } from "@tanstack/react-router";
import {
  Empty,
  ErrorState,
  FAMILY_PRODUCTS,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Tabs,
  TagText,
} from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { LADDER, ladderPlayers } from "../ladder/ladder.js";
import { ADMIN, SETTINGS } from "../lib/settings.js";
import { playerHref } from "../lib/player.js";
import { usePlayerPage } from "../lib/queries.js";
import { useSignOut } from "../shell/sign-out.js";
import { VerifyPlayer } from "../components/VerifyPlayer.jsx";
import { PLAYER_TABS, PlayerView } from "./Player.jsx";

const DROP =
  FAMILY_PRODUCTS.find((p) => p.key === "drop")?.href ??
  "https://drop.poapkings.com/";

export const YOU = "/home/you";

/**
 * You (2026-11-12, Jamie's go: "You with Stats"): your own player page, the
 * one every player name opens, for your primary verified player, with a
 * Stats tab after its five. Stats is Ladder, unchanged (its scope bar and
 * four tabs), at LADDER; its old `/ladder` addresses are the site's 404.
 *
 * Alts [engineering, 2026-11-12, the narrow option]: You is the primary
 * player's page only. Your other players are listed below, to you alone,
 * each to its own page, and Stats' player picker reads any of them, as
 * Ladder's did. With no verified player, You says how to verify one.
 */
export function YouPage() {
  const { me } = useMe();
  const { search } = useLocation();
  const mine = youPlayer(me?.claims);
  return (
    <div className="kit-home kit-you">
      {mine ? (
        <YouPlayer tag={mine.player_tag} tab={search?.tab} />
      ) : (
        <NoVerified claims={me?.claims} />
      )}
      <YouAccount me={me} primary={mine?.player_tag ?? null} />
    </div>
  );
}

/** Your primary player, when you verified it: the page You draws. */
export function youPlayer(claims) {
  return (
    (claims ?? []).find((c) => c.is_primary && c.status === "verified") ?? null
  );
}

/** Stats as a tab of You, an address. */
const STATS_TAB = { key: "stats", label: "Stats", href: LADDER };

/** You's tabs over Stats (LadderPage): the player page's five, each back
 *  on You, then Stats, open. */
export function YouTabs() {
  const items = [
    ...PLAYER_TABS.map((t) => ({
      key: t.key,
      label: t.label,
      href: t.key === "timeline" ? YOU : `${YOU}?tab=${t.key}`,
    })),
    STATS_TAB,
  ];
  return <Tabs label="You" items={items} value="stats" />;
}

function YouPlayer({ tag, tab }) {
  const query = usePlayerPage(tag);
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  const env = query.data;
  if (query.isError || !env || env.status >= 500 || env.status === 429)
    return (
      <ErrorState
        title="Your page could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        {env?.data?.message ?? "Try again in a moment."}
      </ErrorState>
    );
  if (env.status !== 200)
    return (
      <>
        <PageHead title="You" />
        <Empty title="Elixir has not recorded your player yet">
          Its first battles arrive within the hour. Your stats are in{" "}
          <Link className="link" to={LADDER}>
            Stats
          </Link>
          .
        </Empty>
      </>
    );
  return (
    <PlayerView page={env.data} self initialTab={tab} extraTabs={[STATS_TAB]} />
  );
}

/** No verified player: how to verify one, and Stats for a player you added
 *  but have not verified yet, as Ladder read them. */
function NoVerified({ claims }) {
  const own = ladderPlayers(claims);
  return (
    <>
      <PageHead title="You" />
      <VerifyPlayer
        more={
          own.length > 0 ? (
            <Row
              href={LADDER}
              title="Your stats"
              detail="Your season, battles, decks and cards, before you verify."
            />
          ) : null
        }
      >
        You is your own player&rsquo;s page: its timeline, highlights, moments
        and who follows it. Verify the player by its tag first, so the page is
        yours and nobody else&rsquo;s.
      </VerifyPlayer>
    </>
  );
}

function YouAccount({ me, primary }) {
  const signOut = useSignOut();
  const others = (me?.claims ?? []).filter(
    (c) =>
      c.player_tag !== primary && (c.is_primary || c.relationship === "alt"),
  );
  const name = (c) => c.nickname ?? c.name ?? c.player_tag;
  return (
    <>
      {others.length ? (
        <Panel
          title={primary ? "Your other players" : "Your players"}
          titleAs="h2"
        >
          <Rows>
            {others.map((c) => (
              <Row
                key={c.player_tag}
                href={playerHref(c.player_tag)}
                title={<TagText>{name(c)}</TagText>}
                detail={`${c.is_primary ? "Your main player" : "Also you"}${c.status === "verified" ? "" : ", not verified"}: its page. Only you see this list.`}
              />
            ))}
          </Rows>
        </Panel>
      ) : null}
      <Panel title="Your account" titleAs="h2">
        <Rows>
          <Row
            href={`${SETTINGS}/profile`}
            title="Settings"
            detail="Profile, players, email, connections and sign-ins."
          />
          <Row
            href={`${SETTINGS}/players/verify`}
            title="Add or verify a player"
          />
          <Row href={DROP} title="Play Drop" detail="The elixir-cost game." />
          {me?.is_admin === true ? (
            <Row
              href={`${ADMIN}/accounts`}
              title="Admin"
              detail="Staff only."
            />
          ) : null}
        </Rows>
      </Panel>
      <div>
        <button type="button" className="btn" onClick={signOut.onClick}>
          {signOut.label}
        </button>
        <p className="kit-tiny">{signOut.note}</p>
        {signOut.error ? (
          <p className="kit-form__err" role="alert">
            {signOut.error}
          </p>
        ) : null}
      </div>
    </>
  );
}
