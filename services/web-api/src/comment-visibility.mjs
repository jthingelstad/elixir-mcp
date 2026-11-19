import { visibleClanInteractionSql } from "@elixir-mcp/record/clan-lifecycle";
import { blockedSql } from "@elixir-mcp/claims";

/** Canonical comment visibility for a member: moderation, their open
 * reports and blocks both ways. Hidden own comments remain visible. */
export const commentSeenSql = (reader) => `(tc.status = 'visible'
         or (tc.status = 'hidden' and tc.account_id = ${reader}))
        and ${visibleClanInteractionSql("tc", reader)}
        and not ${blockedSql("tc.account_id", reader)}
        and not exists (select 1 from comment_report cr
                         where cr.comment_id = tc.comment_id
                           and cr.account_id = ${reader} and cr.resolved_at is null)`;
