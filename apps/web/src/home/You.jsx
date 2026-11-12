import {
  FAMILY_PRODUCTS,
  PageHead,
  Panel,
  Row,
  Rows,
  TagText,
} from "@elixir-mcp/ui";
import { useMe } from "../App.jsx";
import { ladderHref } from "../ladder/ladder.js";
import { CONSOLE } from "../lib/console.js";
import { SETTINGS } from "../lib/settings.js";
import { playerHref } from "../lib/player.js";
import { useSignOut } from "../shell/sign-out.js";

const DROP =
  FAMILY_PRODUCTS.find((p) => p.key === "drop")?.href ??
  "https://drop.poapkings.com/";

/**
 * You (slice 7, #765): your own players' pages, your stats in Ladder, and
 * your account. The avatar's menu holds the same on a wide screen; this is
 * the phone's way to all of it. Ladder lost its tab and is reached from
 * here, by each of your players [engineering, 2026-11-12].
 */
export function YouPage() {
  const { me } = useMe();
  const signOut = useSignOut();
  const own = (me?.claims ?? []).filter(
    (c) => c.is_primary || c.relationship === "alt",
  );
  const name = (c) => c.nickname ?? c.name ?? c.player_tag;
  return (
    <div className="kit-home kit-home--read">
      <PageHead title="You" sub={me?.email ?? undefined} />
      <Panel title="Your players">
        <Rows>
          {own.length === 0 ? (
            <Row
              href={`${SETTINGS}/players/verify`}
              title="Add or verify a player"
              detail="Your own player, by its tag."
            />
          ) : (
            own.flatMap((c) => [
              <Row
                key={`${c.player_tag}-page`}
                href={playerHref(c.player_tag)}
                title={<TagText>{name(c)}</TagText>}
                detail={
                  c.is_primary === true
                    ? "Your main player: your page"
                    : "Also you: your page"
                }
              />,
              <Row
                key={`${c.player_tag}-ladder`}
                href={ladderHref("season", { player: c.player_tag })}
                title={
                  <>
                    Stats for <TagText>{name(c)}</TagText>
                  </>
                }
                detail="Your season in Ladder: battles, decks and cards."
              />,
            ])
          )}
        </Rows>
      </Panel>
      <Panel title="Your account">
        <Rows>
          <Row
            href={`${SETTINGS}/profile`}
            title="Settings"
            detail="Profile, players, email, connections and sign-ins."
          />
          {own.length > 0 ? (
            <Row
              href={`${SETTINGS}/players/verify`}
              title="Add or verify a player"
            />
          ) : null}
          <Row href={DROP} title="Play Drop" detail="The elixir-cost game." />
          {me?.is_admin === true ? (
            <Row href={`${CONSOLE}/admin`} title="Admin" detail="Staff only." />
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
    </div>
  );
}
