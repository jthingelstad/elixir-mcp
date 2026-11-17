import { useState } from "react";
import {
  Chips,
  Empty,
  ErrorState,
  Link,
  PageHead,
  Panel,
  Row,
  Rows,
  useClock,
} from "@elixir-mcp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { accountHref } from "../../lib/account.js";
import { useBlocks, useCommentSetting } from "../../lib/queries.js";
import { UnblockButton } from "../../home/Block.jsx";
import { COMMENT_WHO } from "../../home/comment-set.js";

/**
 * Settings › Comments & blocks (2026-11-16): who may comment on your play,
 * and the people you block, each with Unblock. Drawn only while comments
 * are on; the reads answer 404 `comments_off` otherwise. A block is
 * silent: this list is the one place it shows.
 */
export function CommentsSettings({ me }) {
  if (me?.features?.comments !== true)
    return (
      <div className="st-page">
        <PageHead title="Comments & blocks" />
        <Empty title="Comments aren't on yet" />
      </div>
    );
  return (
    <div className="st-page">
      <PageHead
        title="Comments & blocks"
        sub="Who can comment on your play, and who you've blocked."
      />
      <WhoMayComment />
      <Blocked />
    </div>
  );
}

function WhoMayComment() {
  const read = useCommentSetting();
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const who = read.data?.who ?? null;
  const pick = async (key) => {
    if (busy || key === who) return;
    setBusy(true);
    setError(null);
    const res = await api.setCommentSetting(key);
    setBusy(false);
    if (res.ok) queryClient.setQueryData(["me", "comment-setting"], res.data);
    else setError("That wasn't saved. Try again.");
  };
  return (
    <Panel title="Who can comment on your play" titleAs="h2">
      <div className="kit-panel__body">
        {read.isError ? (
          <p className="field-error">This couldn't be read just now.</p>
        ) : (
          <Chips
            label="Who can comment"
            options={COMMENT_WHO}
            value={who ?? ""}
            onChange={pick}
          />
        )}
        <p className="kit-tiny">
          Only players who&rsquo;ve verified a player of their own can comment,
          and every comment is checked before it posts. You can always comment
          on your own play, and remove any comment on it.
        </p>
        {read.data?.suspended_until ? (
          <p className="field-error" role="status">
            Commenting is paused for your account for now.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function Blocked() {
  const read = useBlocks();
  const { whenDay } = useClock();
  const blocks = read.data?.blocks ?? [];
  return (
    <Panel title="People you've blocked" titleAs="h2">
      {read.isPending ? (
        <p className="kit-panel__body kit-tiny" role="status">
          Reading your blocks.
        </p>
      ) : read.isError ? (
        <ErrorState
          title="Your blocks couldn't be read just now"
          onRetry={() => read.refetch()}
          busy={read.isFetching}
        />
      ) : blocks.length === 0 ? (
        <p className="kit-panel__body kit-tiny">
          Nobody. Block someone from a comment, their player or their account
          page. They&rsquo;re never told.
        </p>
      ) : (
        <Rows>
          {blocks.map((b) => {
            const name = b.name ?? b.player_tag ?? "An Elixir member";
            return (
              <Row
                key={b.account_id}
                title={
                  b.account_id ? (
                    <Link to={accountHref(b.account_id)}>{name}</Link>
                  ) : (
                    name
                  )
                }
                detail={
                  b.blocked_at ? `Blocked ${whenDay(b.blocked_at)}` : null
                }
                right={
                  b.account_id ? (
                    <UnblockButton account={b.account_id} name={name} />
                  ) : null
                }
              />
            );
          })}
        </Rows>
      )}
    </Panel>
  );
}
