import { responseMeta } from "@elixir-mcp/contracts";
import { docsRef, notes } from "../shared.mjs";

export const elixir_my_players = {
  description:
    'The players you track and WHO EACH ONE IS TO YOU: relationship (primary | alt | friend | watching), your private nickname if any, notify setting, recording status and current clan. That is what resolves "my alt" or "how are my friends doing" without asking. You do NOT need this to answer questions about yourself: omit player_tag and the tools already mean your primary.',
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async handler(ctx) {
    return {
      players: await myPlayers(ctx.db, ctx.account.accountId),
      notes: notes(
        "Omit player_tag on any tool to mean your primary; name a tag only for somebody else.",
      ),
      docs: docsRef("recording", "relationships-primary-nicknames"),
      meta: responseMeta({ as_of: new Date().toISOString() }),
    };
  },
};

/** The players an account tracks and who each is to them: one read shared
 *  by elixir_my_players and the JSON API's /api/v1/me (2026-09-23). */
export async function myPlayers(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag, c.status as claim_status, c.is_primary,
                -- is_primary is still the read path (0055 expand window), so
                -- the label follows it and the two cannot appear to disagree.
                case when c.is_primary then 'primary' else c.relationship end
                  as relationship,
                c.notify,
                p.name, p.last_known_clan_tag, nn.nickname,
                r.status as recording_status,
                cm.clan_tag as member_of, cm.role, cl.name as clan_name
         from claim c
         join player p on p.player_tag = c.player_tag
         left join player_nickname nn on nn.account_id = c.account_id
           and nn.player_tag = c.player_tag
         left join recording r on r.subject_type = 'player' and r.subject_tag = c.player_tag and r.status = 'active'
         left join clan_membership cm on cm.player_tag = c.player_tag and cm.left_observed_at is null
         -- The clan's name beside its tag (Clan walk 2026-09-24: Ship It!
         -- and Elixir Kings read as bare tags across Elixir Clan).
         left join clan cl on cl.clan_tag = coalesce(cm.clan_tag, p.last_known_clan_tag)
         where c.account_id = $1
         order by c.is_primary desc, c.player_tag`,
    [accountId],
  );
  return rows.map((r) => ({
    player_tag: r.player_tag,
    name: r.name,
    ...(r.nickname ? { nickname: r.nickname } : {}),
    relationship: r.relationship,
    is_primary: r.is_primary,
    claim_status: r.claim_status,
    notify: r.notify,
    recording: r.recording_status ?? "not_recording",
    clan_tag: r.member_of ?? r.last_known_clan_tag,
    clan_name: r.clan_name ?? null,
    clan_role: r.role,
  }));
}
