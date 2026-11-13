import { responseMeta } from "@elixir-mcp/contracts";
import { buildTimeline, shownAt } from "../../activity/entries.mjs";
import { itemText } from "../../activity/summary.mjs";
import { CHEER_KEYS, ITEM_ID_RE, cheerable } from "../../activity/cheers.mjs";
import { primaryOf } from "../../social.mjs";
import { socialReaderOrRefuse } from "../social.mjs";
import {
  SEASON_ARG_SCHEMA,
  ToolFailure,
  WINDOW_ARGS,
  appliedBlock,
  docsRef,
  notes,
  resolveSeasonWindow,
} from "../shared.mjs";

const DAY_MS = 86_400_000;
/** The longest window one read rebuilds: a season (up to five weeks). */
const MAX_WINDOW_DAYS = 35;

/** Every item of the window that can carry a cheer: the kept items and the
 *  ones past the timeline's presentation cap (`timeline_dropped`), since a
 *  cheer on an older item still counts (Codex on #849: a busy 30-day window
 *  clipped at 150 read as no cheers). Newest kept first. */
export function cheerableItems(built) {
  return [...(built.timeline ?? []), ...(built.timeline_dropped ?? [])].filter(
    (it) => cheerable(it) && ITEM_ID_RE.test(it.id),
  );
}

/**
 * The cheers other people gave the items about your primary player
 * (DECISIONS "Agents read the social layer and never write it"): counts
 * only, never who, and never the reader's own cheer. The items are rebuilt
 * for the one player as anyone's feed shows them (Home's weekly count,
 * services/web-api/src/cheers.mjs cheersReceived, reads the same way).
 */
export const elixir_cheers = {
  description:
    "The cheers other people gave the timeline items about your primary player (your owner's, for an agent) in the last days: each cheered item's id, kind, time and sentence with its cheers as counts by kind (well_played, on_fire, royal, wow, ha, grind), and the total. Counts only, never who cheered; your own cheers are not counted. Read-only: an agent never gives a cheer. For a person's own connection and their agents.",
  inputSchema: {
    type: "object",
    properties: {
      ...WINDOW_ARGS,
      days: {
        type: "integer",
        minimum: 1,
        maximum: 30,
        default: 7,
        description:
          "The last N days, ending now: 1 to 30, default 7. Or from/to, or season (at most 35 days).",
      },
      season: SEASON_ARG_SCHEMA,
    },
    additionalProperties: false,
  },
  async handler(ctx, args) {
    const reader = await socialReaderOrRefuse(ctx);
    const tag = await primaryOf(ctx.db, reader.accountId);
    if (!tag)
      throw new ToolFailure(
        "no_subject",
        reader.asOwner
          ? "Your owner has no primary player in Elixir, so no item is about them."
          : "You have no primary player in Elixir, so no item is about you.",
        "Set a primary player in Settings, Players & following.",
      );
    const explicit = ["from", "to", "weeks", "season"].some(
      (k) => args[k] !== undefined,
    );
    const win = await resolveSeasonWindow(
      ctx,
      explicit ? args : { ...args, days: args.days ?? 7 },
      { defaultDays: 7, flavor: "plain" },
    );
    const nowMs = Date.now();
    const toMs = win.to ? Math.min(win.to.getTime(), nowMs) : nowMs;
    const fromMs = win.from ? win.from.getTime() : toMs - 7 * DAY_MS;
    if (toMs - fromMs > MAX_WINDOW_DAYS * DAY_MS)
      throw new ToolFailure(
        "bad_request",
        `The window is ${Math.ceil((toMs - fromMs) / DAY_MS)} days; cheers are read at most ${MAX_WINDOW_DAYS} days at a time.`,
        "Pass days (1 to 30), a season, or a from/to at most 35 days apart.",
      );
    const built = await buildTimeline(
      ctx.db,
      [{ kind: "player", tag, relationship: "primary", nickname: null }],
      {
        fromMs,
        toMs,
        accountId: reader.accountId,
        interactive: true,
        accountLines: false,
      },
    );
    const open = cheerableItems(built);
    const counts = new Map();
    if (open.length > 0) {
      const { rows } = await ctx.db.query(
        `select item_id, cheer, count(*)::int as n
           from timeline_cheer
          where item_id = any($1::text[]) and account_id <> $2
          group by item_id, cheer`,
        [[...new Set(open.map((it) => it.id))], reader.accountId],
      );
      for (const r of rows) {
        if (!CHEER_KEYS.includes(r.cheer)) continue;
        const one = counts.get(r.item_id) ?? {};
        one[r.cheer] = r.n;
        counts.set(r.item_id, one);
      }
    }
    const items = [];
    const seen = new Set();
    for (const it of open) {
      const cheers = counts.get(it.id);
      if (!cheers || seen.has(it.id)) continue;
      seen.add(it.id);
      items.push({
        id: it.id,
        kind: it.kind,
        at: shownAt(it) || it.at || null,
        text: String(it.text ?? itemText(it) ?? ""),
        cheers,
      });
    }
    const total = items.reduce(
      (n, it) => n + Object.values(it.cheers).reduce((a, b) => a + b, 0),
      0,
    );
    return {
      player_tag: tag,
      total,
      items,
      applied: appliedBlock({ player_tag: tag, window: win.echo }),
      notes: notes(
        "Counts only: who cheered is never shown, and the reader's own cheers are not counted.",
        items.length === 0
          ? "Nobody else cheered an item about this player in the window."
          : null,
        win.seasonNotes,
      ),
      docs: docsRef("timeline", "cheers"),
      meta: responseMeta({ as_of: new Date(toMs).toISOString() }),
    };
  },
};
