import { useWrite } from "../../client/index.ts";
import {
  ConfirmAction,
  ErrorState,
  Panel,
  WriteError,
  useClock,
  useFlash,
} from "@elixir-mcp/ui";
import { useState } from "react";
import { api } from "../../api.js";
import { keys, useRssLink } from "../../lib/queries.js";

/**
 * Your timeline's RSS link (#765; DECISIONS "Your timeline is an RSS
 * feed"): one private link to your own timeline, everyone you follow
 * together, for a feed reader app. Elixir keeps only a fingerprint of it,
 * so the link shows once, when it is made or reset; Reset makes a new one
 * and stops the old at once, and Turn off ends it.
 */
export function RssLinkPanel() {
  const { whenDay } = useClock();
  const read = useRssLink();
  const [shown, setShown] = useState(null);
  const [copied, flash] = useFlash();
  const make = useWrite(api.resetRssLink, { invalidate: [keys.rss] });
  const off = useWrite(api.rssLinkOff, { invalidate: [keys.rss] });
  const on = read.data?.on === true;
  const keep = (res) => {
    if (res?.ok) setShown(res.data.url);
    return res;
  };

  let state;
  if (read.isError)
    state = (
      <ErrorState
        title="Your RSS link could not be read just now"
        onRetry={() => read.refetch()}
        busy={read.isFetching}
      >
        Nothing has changed. Try again in a moment.
      </ErrorState>
    );
  else if (read.isPending) state = null;
  else
    state = (
      <p className="panel__body m-0">
        {on
          ? `On, made ${whenDay(read.data.created_at)}.`
          : "Off: no link reads your timeline."}
      </p>
    );

  return (
    <Panel
      title="Your RSS link"
      titleAs="h2"
      action={
        on ? (
          <span className="st-actions">
            <ConfirmAction
              label="Reset link"
              title="Reset your RSS link?"
              body="You get a new link, and the one your reader uses stops working at once. Put the new one in your reader."
              confirm="Reset"
              danger={false}
              run={async () => keep(await make.run())}
            />
            <ConfirmAction
              label="Turn off"
              title="Turn off your RSS link?"
              body="The link stops working at once. You can make a new one at any time."
              confirm="Turn off"
              run={async () => {
                const res = await off.run();
                if (res.ok) setShown(null);
                return res;
              }}
            />
          </span>
        ) : read.data ? (
          <button
            type="button"
            className="btn btn--sm"
            disabled={make.busy}
            onClick={async () => keep(await make.run())}
          >
            Make my link
          </button>
        ) : null
      }
    >
      <p className="panel__body m-0 text-ink-faint">
        Your timeline, everyone you follow together, in a feed reader app. The
        link has a private token in it: anyone who holds it reads your timeline,
        so keep it like a password. It never carries your nicknames, your email
        or your account&rsquo;s own business.
      </p>
      {state}
      {shown ? (
        <div className="panel__body">
          <p className="m-0">
            <span className="mono break-all">{shown}</span>{" "}
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                navigator.clipboard?.writeText(shown);
                flash();
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </p>
          <p className="hint m-0">
            Copy it now: Elixir keeps only a fingerprint of the link and cannot
            show it again. Reset makes a new one.
          </p>
        </div>
      ) : null}
      <WriteError error={make.error ?? off.error} className="field-error" />
    </Panel>
  );
}
