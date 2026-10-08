import { Icon, Link, useClock } from "@elixir-mcp/ui";
import { useEffect, useState } from "react";
import { MailFrame } from "../../components/MailFrame.jsx";
import { useEmailRecord } from "../../lib/queries.js";
import { CONSOLE } from "../../lib/console.js";

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

/** The mail's footer links here with ?report=1 ("Something not right?
 *  Send feedback about this email"): one click from the inbox to the
 *  feedback form with this email attached. Read once, at open. */
function wantsReport(search = window.location.search) {
  return new URLSearchParams(search).get("report") === "1";
}

export function EmailRecord({ id, navigate, search }) {
  const { stamp } = useClock();
  const when = (ts) => stamp(ts, { year: true, seconds: true });
  const [report] = useState(() => wantsReport(search));
  useEffect(() => {
    if (report && id)
      navigate(
        `${CONSOLE}/account/feedback?send_id=${encodeURIComponent(id)}`,
        {
          replace: true,
        },
      );
  }, [report, id, navigate]);
  // The envelope, because 404 is an answer this page reads.
  const record = useEmailRecord(id);
  const status = record.data?.status ?? (record.isError ? 0 : null);
  const rec = record.data?.ok ? record.data.data : null;

  const back = (
    <div className="page__crumb">
      <Link to={`${CONSOLE}/account/activity/emails`}>‹ Emails</Link>
    </div>
  );

  if (status === null && rec === null)
    return <p className="text-ink-faint">Loading…</p>;
  // A failed read is not an absence (console audit M1).
  if (!rec && status !== 403 && status !== 404)
    return (
      <>
        {back}
        <div className="empty">
          <div className="empty__title">This email could not be read</div>
          <p className="empty__body mb-0">
            Elixir did not answer just now; try again in a moment.
          </p>
        </div>
      </>
    );
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
        {/* The email is a FIELD on the report (feedback.send_id), the
            way a call is: the queue links straight back to this record. */}
        <Link
          className="btn btn--sm"
          to={`${CONSOLE}/account/feedback?send_id=${encodeURIComponent(send.send_id)}`}
        >
          <Icon name="message-square" size={15} />
          Report a problem with this email
        </Link>
        <Link className="btn btn--sm" to={`${CONSOLE}/account/profile/email`}>
          Emails from Elixir
        </Link>
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
