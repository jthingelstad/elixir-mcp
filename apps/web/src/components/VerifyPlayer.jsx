import { Panel, Row, Rows } from "@elixir-mcp/ui";
import { SETTINGS } from "../lib/settings.js";

/** Settings → Players → Verify, where a player is verified. */
export const VERIFY = `${SETTINGS}/players/verify`;

/**
 * Elixir's verify notice: how to verify your player, by its tag. You shows
 * it when you have no verified player, and Clan after sign-in while a
 * player whose role is Elder or above is not verified. `children` is the
 * page's own lede; `more` adds rows under the verify row.
 */
export function VerifyPlayer({ titleAs = "h2", children = null, more = null }) {
  return (
    <Panel title="Verify your player" titleAs={titleAs}>
      {children ? <p className="kit-panel__body">{children}</p> : null}
      <Rows>
        <Row
          href={VERIFY}
          title="Verify a player"
          detail="By its tag, with one change in the game."
        />
        {more}
      </Rows>
    </Panel>
  );
}
