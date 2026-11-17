import { useState } from "react";
import {
  ConfirmAction,
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
import { api } from "../api.js";
import { accountHref } from "../lib/account.js";
import { useAdminComments } from "../lib/queries.js";
import { playerHref } from "../lib/player.js";
import { REPORT_REASONS } from "../home/comment-set.js";

const ADMIN_KEY = ["admin", "comments"];
const reasonLabel = (key) =>
  REPORT_REASONS.find((r) => r.key === key)?.label ?? key;

/**
 * Admin › Comments (2026-11-16): the queue the reports build. A comment
 * two people reported is hidden until it is removed or dismissed here.
 * Beside it, the check's recent refusals (what it stopped, for tuning),
 * the month's spend against the cap, and the accounts whose commenting is
 * paused. The server half is services/web-api/src/routes/comments.mjs;
 * the rules docs/notes/2026-11-16-comments.md.
 */
export function AdminComments() {
  const read = useAdminComments();
  const data = read.data;
  return (
    <div className="st-page">
      <PageHead
        crumb="Admin"
        title="Comments"
        sub={
          data
            ? data.enabled
              ? "Comments are on. Reported comments wait here for a decision."
              : "Comments are off (CommentsEnabled). Nothing new posts; the queue still reads."
            : null
        }
      />
      {read.isPending ? (
        <p className="kit-tiny" role="status">
          Reading the queue.
        </p>
      ) : read.isError ? (
        <ErrorState
          title="The comments queue couldn't be read"
          onRetry={() => read.refetch()}
          busy={read.isFetching}
        />
      ) : (
        <>
          <Spend month={data.month} cap={data.cap_usd} />
          <Reported items={data.reported ?? []} />
          {data.posts_enabled || (data.posts ?? []).length ? (
            <ReportedPosts items={data.posts ?? []} />
          ) : null}
          <Suspended items={data.suspended ?? []} />
          <Refused items={data.refused ?? []} />
        </>
      )}
    </div>
  );
}

function Spend({ month, cap }) {
  const m = month ?? {};
  const usd = Number(m.usd ?? 0);
  return (
    <Panel title="This month's check" titleAs="h2">
      <Rows>
        <Row
          title="Spend"
          detail={
            m.paused === true
              ? "Paused: the cap is reached, so new comments wait until next month or a higher cap."
              : `Cap $${Number(cap ?? 0).toFixed(2)} a month`
          }
          right={`$${usd.toFixed(4)}`}
        />
        <Row
          title="Checks"
          detail={`${m.allowed ?? 0} allowed, ${m.refused ?? 0} refused, ${m.errors ?? 0} failed closed`}
          right={String(m.checks ?? 0)}
        />
      </Rows>
    </Panel>
  );
}

function Who({ author }) {
  if (!author) return "A player";
  const name = author.name ?? author.player_tag ?? "A player";
  return author.player_tag ? (
    <Link to={playerHref(author.player_tag)}>{name}</Link>
  ) : (
    name
  );
}

function Reported({ items }) {
  const { stamp } = useClock();
  const queryClient = useQueryClient();
  const done = (out) => {
    if (out?.ok) queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
  return (
    <Panel title="Reported" titleAs="h2">
      {items.length === 0 ? (
        <Empty title="Nothing reported" />
      ) : (
        <ul className="kit-comments__list kit-panel__body">
          {items.map((c) => (
            <li key={c.id} className="kit-comments__item">
              <p className="kit-comments__head">
                <span className="kit-comments__who">
                  <Who author={c.author} />
                </span>
                <span className="kit-tiny">
                  {" "}
                  · {c.at ? stamp(c.at) : ""} ·{" "}
                  {c.status === "hidden" ? "hidden" : "showing"}
                </span>
              </p>
              <p className="kit-comments__text">{c.text}</p>
              <p className="kit-tiny">
                {(c.reports ?? [])
                  .map((r) => `${reasonLabel(r.reason)} (${stamp(r.at)})`)
                  .join("; ")}
              </p>
              <div className="kit-comments__acts">
                <ConfirmAction
                  label="Remove"
                  className="btn btn--sm"
                  title="Remove this comment?"
                  body="It goes for everyone. Its writer isn't told."
                  confirm="Remove"
                  run={() => api.adminRemoveComment(c.id)}
                  onDone={done}
                />
                <ConfirmAction
                  label="Dismiss"
                  className="btn btn--quiet btn--sm"
                  danger={false}
                  title="Dismiss the reports?"
                  body="The comment shows again, except to those who reported it."
                  confirm="Dismiss"
                  run={() => api.adminDismissComment(c.id)}
                  onDone={done}
                />
              </div>
              {c.author?.account_id ? (
                <SuspendForm accountId={c.author.account_id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Posts (2026-11-17): reported or hidden ones, as comments are; the
 *  same decisions, and the same pause (it stops posting too). */
function ReportedPosts({ items }) {
  const { stamp } = useClock();
  const queryClient = useQueryClient();
  const done = (out) => {
    if (out?.ok) queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
  return (
    <Panel title="Reported posts" titleAs="h2">
      {items.length === 0 ? (
        <Empty title="No posts reported" />
      ) : (
        <ul className="kit-comments__list kit-panel__body">
          {items.map((p) => (
            <li key={p.id} className="kit-comments__item">
              <p className="kit-comments__head">
                <span className="kit-comments__who">
                  <Who author={p.author} />
                </span>
                <span className="kit-tiny">
                  {" "}
                  · {p.at ? stamp(p.at) : ""} ·{" "}
                  {p.question ? "question · " : ""}
                  {p.status === "hidden" ? "hidden" : p.status}
                </span>
              </p>
              <p className="kit-comments__text">{p.text}</p>
              {p.deck || p.cards?.length ? (
                <p className="kit-tiny">
                  {p.deck
                    ? `Deck: ${p.deck.cards.map((c) => c.name).join(", ")}`
                    : `Cards: ${p.cards.map((c) => c.name).join(", ")}`}
                </p>
              ) : null}
              <p className="kit-tiny">
                {(p.reports ?? [])
                  .map((r) => `${reasonLabel(r.reason)} (${stamp(r.at)})`)
                  .join("; ")}
              </p>
              <div className="kit-comments__acts">
                <ConfirmAction
                  label="Remove"
                  className="btn btn--sm"
                  title="Remove this post?"
                  body="It goes for everyone. Its writer isn't told."
                  confirm="Remove"
                  run={() => api.adminRemovePost(p.id)}
                  onDone={done}
                />
                <ConfirmAction
                  label="Dismiss"
                  className="btn btn--quiet btn--sm"
                  danger={false}
                  title="Dismiss the reports?"
                  body="The post shows again."
                  confirm="Dismiss"
                  run={() => api.adminDismissPost(p.id)}
                  onDone={done}
                />
              </div>
              {p.author?.account_id ? (
                <SuspendForm accountId={p.author.account_id} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Pause one account's commenting for some days; 0 lifts it. */
function SuspendForm({ accountId }) {
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const queryClient = useQueryClient();
  const send = async (e) => {
    e.preventDefault();
    const n = Number(days);
    if (busy || !Number.isInteger(n) || n < 0) return;
    setBusy(true);
    const res = await api.adminSuspendCommenting(accountId, n);
    setBusy(false);
    setMsg(res.ok ? (n ? `Paused ${n} days.` : "Lifted.") : "Not saved.");
    if (res.ok) queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
  };
  return (
    <form className="kit-comments__send" onSubmit={send}>
      <label className="kit-tiny">
        Pause commenting and posting for{" "}
        <input
          className="kit-comments__days"
          type="number"
          min="0"
          max="365"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />{" "}
        days
      </label>
      <button type="submit" className="btn btn--quiet btn--sm" disabled={busy}>
        Pause
      </button>
      {msg ? (
        <span className="kit-tiny" role="status">
          {msg}
        </span>
      ) : null}
    </form>
  );
}

function Suspended({ items }) {
  const { stamp } = useClock();
  const queryClient = useQueryClient();
  return (
    <Panel title="Paused from commenting and posting" titleAs="h2">
      {items.length === 0 ? (
        <p className="kit-panel__body kit-tiny">Nobody.</p>
      ) : (
        <Rows>
          {items.map((s) => {
            const name = s.name ?? s.player_tag ?? s.account_id.slice(0, 8);
            return (
              <Row
                key={s.account_id}
                title={<Link to={accountHref(s.account_id)}>{name}</Link>}
                detail={s.until ? `Until ${stamp(s.until)}` : null}
                right={
                  <ConfirmAction
                    label="Lift"
                    className="btn btn--sm"
                    danger={false}
                    title={`Let ${name} comment again?`}
                    body="Their commenting starts again now."
                    confirm="Lift"
                    run={() => api.adminSuspendCommenting(s.account_id, 0)}
                    onDone={(out) => {
                      if (out?.ok)
                        queryClient.invalidateQueries({ queryKey: ADMIN_KEY });
                    }}
                  />
                }
              />
            );
          })}
        </Rows>
      )}
    </Panel>
  );
}

/** What the check stopped lately: to see whether it is too strict. The
 *  words are kept only on a refusal, for this, and swept at 35 days. */
function Refused({ items }) {
  const { stamp } = useClock();
  return (
    <Panel title="Recently refused" titleAs="h2">
      {items.length === 0 ? (
        <p className="kit-panel__body kit-tiny">Nothing refused lately.</p>
      ) : (
        <Rows>
          {items.map((r) => (
            <Row
              key={r.id}
              title={r.text}
              detail={[
                r.author?.name ?? r.author?.player_tag ?? "A player",
                r.kind === "post" ? "post" : null,
                r.stage,
                r.category,
                stamp(r.at),
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          ))}
        </Rows>
      )}
    </Panel>
  );
}
