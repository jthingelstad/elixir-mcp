/** Players whose games Elixir records now: direct active recordings and
 *  current members of an actively recorded comprehensive clan, one row
 *  per player (`player_tag`). Scoped history uses this to exclude
 *  incidental opponent-only observations, and the stored Timeline stores
 *  exactly this set (activity/story-store.mjs, story-wake.mjs).
 *
 *  Its own module, with nothing imported, so the collector's admission
 *  wake reads it without the tool registry; tools/shared.mjs re-exports
 *  it. An activity-scope clan (the automatic follow of your primary's
 *  clan) polls only its roster, so its members are not in it. */
export const RECORDED_PLAYERS_SQL = `select subject_tag as player_tag from recording
       where subject_type = 'player' and status = 'active'
     union
     select cm.player_tag
       from recording r
       join clan_membership cm on cm.clan_tag = r.subject_tag
         and cm.left_observed_at is null
      where r.subject_type = 'clan' and r.status = 'active'
        and r.scope = 'comprehensive'`;
