import { Icon } from "@elixir-mcp/ui";
import { useState } from "react";
import { useEmailRecord } from "../../lib/queries.js";

/**
 * One sent email: the mail as it went out, and the way to say something
 * about it (Jamie, 2026-09-19: "a list of emails sent to me just like my
 * MCP calls, and a feedback item straight from the details of one").
 *
 * The console's job here is the call record's: make the thing visible.
 * The body is the archived render, shown in a sandboxed frame with no
 * scripts and the open pixel already stripped by the API, so looking at
 * your own record is never counted as an open. The id in the header is
 * the id printed in the mail's footer and logged by the relay, so a
 * person quoting it and a maintainer reading the log mean the same send.
 */
const when = (ts) =>
  ts ? new Date(ts).toISOString().slice(0, 19).replace("T", " ") + "Z" : "—";

/** The mail in a frame that runs nothing: same-origin so the frame can
 *  be sized to its content, links opening in a new tab, no scripts (an
 *  archived mail carries none, and a frame that could run one would be
 *  the one place in the console that does). */
function MailFrame({ html }) {
  const [height, setHeight] = useState(600);
  const doc = html.replace(/<head>/i, '<head><base target="_blank">');
  return (
    <iframe
      title="The email as it was sent"
      srcDoc={doc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="block w-full border border-line rounded-[12px] bg-ground"
      style={{ height: `${height}px` }}
      onLoad={(ev) => {
        const h = ev.target.contentDocument?.documentElement?.scrollHeight;
        if (h) setHeight(h + 24);
      }}
    />
  );
}

export function EmailRecord({ id, navigate }) {
  // The envelope, because 404 is an answer this page reads.
  const record = useEmailRecord(id);
  const status = record.data?.status ?? (record.isError ? 0 : null);
  const rec = record.data?.ok ? record.data.data : null;

  const back = (
    <div className="page__crumb">
      <a onClick={() => navigate("/account/activity/emails")}>‹ Emails</a>
    </div>
  );

  if (status === null && rec === null)
    return <p className="text-ink-faint">Loading…</p>;
  if (!rec?.send)
    return (
      <>
        {back}
        <div className="empty">
          <div className="empty__title">That email is not one of yours</div>
          <p className="empty__body mb-0">
            This page opens the emails sent to your own account. An id from
            someone else's footer opens nothing here.
          </p>
        </div>
      </>
    );

  const { send } = rec;
  return (
    <>
      {back}
      <div className="record__head">
        <h1 className="text-[24px] m-0 text-ink">
          {send.subject ?? send.label}
        </h1>
        <span className="chip chip--info">
          <span className="chip__dot" />
          {send.label}
        </span>
      </div>
      <p className="record__sub">
        <span className="mono">{when(send.sent_at)}</span>
        {send.period ? ` · ${send.period}` : ""} ·{" "}
        <span className="mono" title="The id printed in the mail's footer">
          {send.send_id}
        </span>
      </p>

      <div className="flex items-center gap-2 flex-wrap mb-[18px]">
        <a
          className="btn btn--sm"
          onClick={() =>
            // The email is a FIELD on the report (feedback.send_id), the
            // way a call is: the queue links straight back to this record.
            navigate(
              `/account/feedback?send_id=${encodeURIComponent(send.send_id)}`,
            )
          }
        >
          <Icon name="message-square" size={15} />
          Report a problem with this email
        </a>
        <a className="btn btn--sm" onClick={() => navigate("/account/profile")}>
          Email switches
        </a>
      </div>

      {rec.html ? (
        <MailFrame html={rec.html} />
      ) : (
        <div className="empty">
          <div className="empty__title">
            {rec.archive_error
              ? "The email was kept but could not be read back just now"
              : "The email itself was not kept"}
          </div>
          <p className="empty__body mb-0">
            {rec.archive_error
              ? "Try again in a moment. The send itself is on record above."
              : "Emails sent before 2026-09-19 have a row here but no body; everything since is kept as it was sent."}
          </p>
        </div>
      )}

      <p className="footnote mt-3 max-w-[78ch]">
        Shown as it was sent, without the open pixel: reading it here is not
        counted as an open. Links open in a new tab.
      </p>
    </>
  );
}
