/** The event ledgers as tests read them since 0125: the typed columns,
 *  hydrated into the facts object through the reader's own module. */
import {
  hydratePlayerEvents,
  hydrateClanEvents,
  PLAYER_EVENT_COLUMNS,
  CLAN_EVENT_COLUMNS,
} from "../../mcp/src/event-payloads.mjs";

export async function playerEvents(db, where = "true", params = []) {
  const { rows } = await db.query(
    `select ${PLAYER_EVENT_COLUMNS} from player_event where ${where} order by event_id`,
    params,
  );
  return hydratePlayerEvents(db, rows);
}

export async function clanEvents(db, where = "true", params = []) {
  const { rows } = await db.query(
    `select ${CLAN_EVENT_COLUMNS} from clan_event where ${where} order by event_id`,
    params,
  );
  return hydrateClanEvents(db, rows);
}
