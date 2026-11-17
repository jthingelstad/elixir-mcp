import {
  Empty,
  ErrorState,
  SHELL_PRODUCTS,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  Tabs,
  Skeleton,
} from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { STATS, statsPlayers } from "../stats/stats.js";
import { ADMIN, SETTINGS } from "../lib/settings.js";
import { PASSPORT } from "../lib/passport.js";
import { useAccountPage } from "../lib/queries.js";
import { useSignOut } from "../shell/sign-out.js";
import { AccountView } from "./Account.jsx";

const DROP =
  SHELL_PRODUCTS.find((p) => p.key === "drop")?.href ??
  "https://drop.poapkings.com/";

export const YOU = "/home/you";

/**
 * Profile, the You tab until 2026-11-17 (Jamie, 2026-11-15: "when you tap You it should go to your account,
 * not your primary player"): your own account page, as other members see
 * it (your players, Stamps and timeline), with Your stats one tap away and
 * your account's rows under it. Each player opens its own page. With no
 * player yet, the Players list says Add your player.
 */
export function YouPage() {
  const { me } = useMe();
  return (
    <div className="kit-home kit-you">
      {me?.page_id ? (
        <YouAccountPage id={me.page_id} claims={me?.claims} />
      ) : (
        <>
          <PageHead title="Profile" />
          {me?.claims?.length ? null : <AddYourPlayer />}
        </>
      )}
      <YouAccount me={me} />
    </div>
  );
}

/** Profile's tabs over Stats (StatsPage): back to Profile, then Stats, open. */
export function YouTabs() {
  const items = [
    { key: "you", label: "Profile", href: YOU },
    { key: "stats", label: "Stats", href: STATS },
  ];
  return <Tabs label="Profile" items={items} value="stats" />;
}

function YouAccountPage({ id, claims }) {
  const query = useAccountPage(id);
  if (query.isPending) return <Skeleton shape="profile" />;
  const env = query.data;
  if (query.isError || !env || env.status !== 200)
    return (
      <ErrorState
        title="Your page could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        {env?.data?.message ?? "Try again in a moment."}
      </ErrorState>
    );
  const own = statsPlayers(claims);
  return (
    <AccountView
      page={env.data}
      actions={
        own.length ? (
          <Link className="btn btn--sm" to={STATS}>
            Your stats
          </Link>
        ) : null
      }
      noPlayers={<AddYourPlayer />}
    />
  );
}

/** With no player yet, the one thing to do next, said plainly, with
 *  where the tag is (2026-11-16: it was a quiet line among the rows). */
function AddYourPlayer() {
  return (
    <Empty
      title="Add your player"
      titleAs="h2"
      action={
        <Link
          className="btn btn--primary"
          to={`${SETTINGS}/players#add-player-tag`}
        >
          Add your player
        </Link>
      }
    >
      In Clash Royale, open your profile: your player tag starts with # and sits
      under your name. Add it and Elixir starts recording your battles.
    </Empty>
  );
}

function YouAccount({ me }) {
  const signOut = useSignOut();
  return (
    <>
      <Panel title="Your account" titleAs="h2">
        <Rows>
          <Row
            href={PASSPORT}
            title="Your passport"
            detail="Your Stamps, and how to earn the rest."
          />
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
