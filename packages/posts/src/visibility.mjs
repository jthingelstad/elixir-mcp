import { blockedSql } from "@elixir-mcp/claims";

/** The post alias and reader expression come from the calling query.
 * An open report hides this post for its reporter until it is resolved. */
export const postReaderAllowsSql = (post, reader) =>
  `(${reader} is null or
     (not ${blockedSql(post + ".account_id", reader)}
      and not exists (select 1 from post_report pr
        where pr.post_id = ${post}.post_id and pr.account_id = ${reader}
          and pr.resolved_at is null)))`;
