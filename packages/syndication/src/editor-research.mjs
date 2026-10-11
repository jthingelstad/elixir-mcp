/** The clan's model's lookups while it edits the clan's activity channel
 *  (2026-10-11; Jamie approved "read-only research on the clan's
 *  record"). Each is a read of the clan's record as its members could
 *  read it, never anything private to Clan, and never a write:
 *
 *  - `member_record`: a current member's record (`clanStoryFacts`, as
 *    the posts are told it). A member who has left is not looked up: a
 *    departure is told only its member's time in the clan and weeks.
 *  - `member_battles`: a current member's battles this week, newest
 *    first: mode, result, crowns, opponent, deck archetype, trophy change
 *    and roughly when (in words, never a clock time).
 *  - `channel_recent`: what the channel posted in the last three days,
 *    from the relay's delivery history.
 *
 *  Bounded: `EDITOR_LOOKUPS_MAX` a round, each answer at most
 *  `EDITOR_RESULT_MAX` characters, a name matched exactly (case aside)
 *  against the clan's current roster; a name two current members share
 *  is not looked up (a display name is not an identity). A lookup that
 *  fails says so; the run goes on. */
import { modeGroupOf } from "@elixir-mcp/contracts";
import {
  EDITOR_LOOKUPS_MAX,
  EDITOR_RESULT_MAX,
  memberLines,
} from "@elixir-mcp/clan-engine";
import { deckIdentities } from "@elixir-mcp/tools/shared";
import { clanStoryFacts } from "./story-facts.mjs";

const DAY_MS = 24 * 3600_000;
const H_MS = 3600_000;
const BATTLES_DAYS = 7;
const BATTLES_MAX = 10;
const CHANNEL_DAYS = 3;
const CHANNEL_MAX = 15;

/** Roughly when, in words: never a clock time. */
export function agoWords(atMs, nowMs) {
  const age = nowMs - atMs;
  if (!Number.isFinite(age)) return "";
  if (age < H_MS) return "within the hour";
  if (age < 3 * H_MS) return "a couple of hours ago";
  if (age < DAY_MS) return "earlier today";
  if (age < 2 * DAY_MS) return "yesterday";
  return `${Math.floor(age / DAY_MS)} days ago`;
}

const unescape = (s) => String(s ?? "").replace(/\\([\\*_~`|>[\]<@#-])/g, "$1");
const clip = (s) =>
  s.length > EDITOR_RESULT_MAX ? `${s.slice(0, EDITOR_RESULT_MAX - 1)}…` : s;

/**
 * @param {import("pg").ClientBase} db
 * @param {string} clanTag
 * @param {{ nowMs?: number, history?: () => Promise<object|null>,
 *   except?: string[], identities?: typeof deckIdentities }} [opts]
 *   `history` reads the channel's delivery history; `except` are the
 *   run's own item ids (never told back as a member's "recent moment").
 * @returns {(calls: { id: string, name: string, input: object }[]) =>
 *   Promise<{ id: string, text: string }[]>}
 */
export function editorResearch(
  db,
  clanTag,
  {
    nowMs = Date.now(),
    history = async () => null,
    except = [],
    identities = deckIdentities,
  } = {},
) {
  let roster = null;
  /** The current member by name, exactly as written (case aside); null
   *  for none, `"ambiguous"` when two or more share it. */
  async function member(name) {
    roster ??= (
      await db.query(
        `select p.player_tag, p.name
           from clan_membership cm
           join player p on p.player_tag = cm.player_tag
          where cm.clan_tag = $1 and cm.left_observed_at is null
            and p.name is not null`,
        [clanTag],
      )
    ).rows;
    const want = String(name ?? "")
      .trim()
      .toLowerCase();
    const found = want
      ? roster.filter((r) => r.name.trim().toLowerCase() === want)
      : [];
    if (found.length > 1) return "ambiguous";
    return found[0] ?? null;
  }
  const said = (name) => String(name ?? "").slice(0, 40);
  const notMember = (name, m) =>
    m === "ambiguous"
      ? `More than one current member is named "${said(name)}"; not looked up.`
      : `No current member of the clan is named "${said(name)}".`;

  const lookups = {
    async member_record({ name }) {
      const m = await member(name);
      if (!m || m === "ambiguous") return notMember(name, m);
      const facts = await clanStoryFacts(db, clanTag, {
        playerTags: [m.player_tag],
        nowMs,
        moments: { max: 3, members: 1, except },
      });
      const lines = memberLines(facts.members[m.player_tag], {
        label: "MEMBER",
      });
      return lines.length
        ? lines.join("\n")
        : `Nothing recorded for ${m.name}.`;
    },

    async member_battles({ name, mode = "any" }) {
      const m = await member(name);
      if (!m || m === "ambiguous") return notMember(name, m);
      const { rows } = await db.query(
        `select bp.battle_time, bp.type, b.event_tag, bp.outcome, bp.crowns,
                bp.trophy_change, bp.deck_hash,
                opp.crowns as crowns_against, op.name as opponent
           from battle_participant bp
           join battle b on b.battle_id = bp.battle_id
           left join lateral (
             select o.player_tag, o.crowns from battle_participant o
              where o.battle_id = bp.battle_id and o.side <> bp.side
              order by o.player_tag limit 1) opp on true
           left join player op on op.player_tag = opp.player_tag
          where bp.player_tag = $1 and bp.battle_time > $2
            and bp.battle_time <= $3
          order by bp.battle_time desc
          limit 40`,
        [
          m.player_tag,
          new Date(nowMs - BATTLES_DAYS * DAY_MS),
          new Date(nowMs),
        ],
      );
      const picked = rows
        .map((r) => ({ ...r, group: modeGroupOf(r.type, r.event_tag) }))
        .filter((r) => mode === "any" || r.group === mode)
        .slice(0, BATTLES_MAX);
      if (!picked.length)
        return `No ${mode === "any" ? "" : `${mode} `}battles recorded for ${m.name} in the last ${BATTLES_DAYS} days.`;
      const ids = await identities(db, [
        ...new Set(picked.map((r) => r.deck_hash).filter(Boolean)),
      ]);
      const lines = picked.map((r) => {
        const a = r.deck_hash ? ids.get(r.deck_hash)?.archetype : null;
        const parts = [
          `${r.outcome ?? "result unknown"}${r.crowns != null && r.crowns_against != null ? ` ${r.crowns}-${r.crowns_against}` : ""}${r.opponent ? ` against ${r.opponent}` : ""}`,
          r.group,
          a?.label && a.family !== "unclassified" ? a.label : null,
          r.trophy_change != null && r.trophy_change !== 0
            ? `${r.trophy_change > 0 ? "+" : ""}${r.trophy_change} trophies`
            : null,
          agoWords(r.battle_time.getTime(), nowMs),
        ].filter(Boolean);
        return `- ${parts.join(", ")}`;
      });
      return [`${m.name}'s battles, newest first:`, ...lines].join("\n");
    },

    async channel_recent() {
      const h = await history();
      const posts = (h?.entries ?? [])
        .filter(
          (e) =>
            (e.outcome === "posted" || e.outcome === "edited") &&
            e.excerpt &&
            nowMs - Date.parse(e.at) <= CHANNEL_DAYS * DAY_MS,
        )
        .slice(0, CHANNEL_MAX);
      if (!posts.length)
        return `The channel posted nothing in the last ${CHANNEL_DAYS} days.`;
      return [
        "The channel's posts, newest first:",
        ...posts.map(
          (e) =>
            `- ${agoWords(Date.parse(e.at), nowMs)}: ${unescape(e.excerpt)}`,
        ),
      ].join("\n");
    },
  };

  return async function research(calls) {
    const out = [];
    for (const [i, c] of calls.entries()) {
      let text;
      if (i >= EDITOR_LOOKUPS_MAX)
        text = `Not looked up: at most ${EDITOR_LOOKUPS_MAX} lookups a round.`;
      else if (!Object.hasOwn(lookups, c.name))
        text = `There is no lookup named ${String(c.name).slice(0, 40)}.`;
      else
        try {
          text = await lookups[c.name](c.input ?? {});
        } catch {
          text = "That lookup failed; go on without it.";
        }
      out.push({ id: c.id, name: c.name, text: clip(text) });
    }
    return out;
  };
}
