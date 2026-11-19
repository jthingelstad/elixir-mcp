/** Actual pair records: both named players in one canonical battle.
 * The player's time cover is the outer read; the other player is a keyed
 * probe, never a scan of everyone's opponents. Boat defenses are static
 * decks, not two people playing together or against one another. */
import { modeGroupSql } from "@elixir-mcp/contracts";
import { battleLinks } from "./battle-links.mjs";

export const PAIR_PAGE = 20;
const mode = modeGroupSql("me.type", "b.event_tag");
const from = `from battle_participant me
  cross join lateral(select peer.side from battle_participant peer
    where peer.battle_id=me.battle_id and peer.player_tag=$2 offset 0) peer
  join battle b on b.battle_id=me.battle_id
  where me.player_tag=$1 and me.player_tag<>$2 and me.battle_time >= $3 and me.battle_time < $4
    and me.type<>'boatBattle' and b.boat_battle_side is null`;

export async function playerPairSummary(
  db,
  { playerTag, friendTag, fromMs, toMs, timezone = "UTC" },
) {
  const { rows } = await db.query(
    `with days as(select ${mode} as mode,me.side=peer.side as teamed,
       to_char(me.battle_time at time zone $5,'YYYY-MM-DD') as day,
       count(*)::int as count,count(*) filter(where me.outcome='win')::int as wins,
       count(*) filter(where me.outcome='loss')::int as losses,max(me.battle_time) as latest
       ${from} group by 1,2,3)
    select mode,teamed,sum(count)::int as count,sum(wins)::int as wins,sum(losses)::int as losses,max(latest) as latest,
      jsonb_agg(jsonb_build_object('day',day,'teamed',teamed,'count',count,'wins',wins) order by day desc) as days
      from days group by mode,teamed order by latest desc,mode`,
    [playerTag, friendTag, new Date(fromMs), new Date(toMs), timezone],
  );
  const modes = new Map();
  for (const row of rows) {
    const item = modes.get(row.mode) ?? {
      key: row.mode,
      teamed: 0,
      against: 0,
    };
    item[row.teamed ? "teamed" : "against"] = row.count;
    item[row.teamed ? "teamed_record" : "against_record"] = {
      wins: row.wins,
      losses: row.losses,
    };
    (item.days ??= []).push(...row.days);
    modes.set(row.mode, item);
  }
  return [...modes.values()];
}

export function pairCursor(raw) {
  if (typeof raw !== "string" || raw.length > 350) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString());
    return typeof value.at === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.at) &&
      Number(value.at.slice(0, 4)) > 0 &&
      Number.isFinite(Date.parse(value.at)) &&
      new Date(value.at).toISOString().slice(0, 19) === value.at.slice(0, 19) &&
      /^[0-9a-f]{64}$/.test(value.id)
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function playerPairBattles(
  db,
  { playerTag, friendTag, fromMs, toMs, mode: modeKey, side, before = null },
) {
  const params = [
    playerTag,
    friendTag,
    new Date(fromMs),
    new Date(toMs),
    modeKey,
    side === "teamed",
  ];
  if (before) params.push(before.at, before.id);
  const { rows } = await db.query(
    `select me.battle_id,me.battle_time,me.outcome,
       to_char(me.battle_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
    ${from} and ${mode}=$5 and (me.side=peer.side)=$6
    ${before ? "and (me.battle_time,me.battle_id)<($7::timestamptz,$8::text)" : ""}
    order by me.battle_time desc,me.battle_id desc limit ${PAIR_PAGE + 1}`,
    params,
  );
  const page = rows.slice(0, PAIR_PAGE);
  const links = await battleLinks(
    db,
    page.map((row) => row.battle_id),
  );
  const last = page.at(-1);
  return {
    battles: page.map((row) => ({
      battle_id: row.battle_id,
      at: new Date(row.battle_time).toISOString(),
      outcome: row.outcome,
      url: links.get(row.battle_id)?.url ?? null,
    })),
    next_before:
      rows.length > PAIR_PAGE && last
        ? Buffer.from(
            JSON.stringify({ at: last.cursor_at, id: last.battle_id }),
          ).toString("base64url")
        : null,
  };
}
