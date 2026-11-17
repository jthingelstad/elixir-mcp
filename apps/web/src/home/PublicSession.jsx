import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import {
  Empty,
  ErrorState,
  NavigateProvider,
  Skeleton,
  ZoneProvider,
  browserZone,
} from "@elixir-mcp/ui";
import { sessionHeadline } from "@elixir-mcp/ui/session-story";
import { answered } from "../client/index.ts";
import { api } from "../api.js";
import { useMe, useNav } from "../App.jsx";
import { sessionHref } from "../lib/player.js";
import { SessionView } from "./SessionPage.jsx";

/**
 * A session's public page (2026-11-17), /session/<tag>/<id>/<start>: the
 * link a person shares, open to anyone with it and no account, as a
 * battle's /battle/<id> is. Signed in, it is the member page, so the
 * reader gets comments, Follow and their own marks; signed out it is
 * SessionView read as nobody, on the browser's clock. The read is
 * /api/public/sessions/..., the one the preview tags and the picture read.
 */
export function PublicSessionPage() {
  const { tag, id, at } = useParams({ strict: false });
  const navigate = useNav();
  const { me, unreachable } = useMe();
  const signedIn = me?.authenticated === true;
  const start = /^\d{9,11}$/.test(String(at ?? "")) ? Number(at) : null;
  useEffect(() => {
    if (signedIn && start !== null)
      navigate(
        sessionHref(`#${tag}`, id, new Date(start * 1000).toISOString()),
        {
          replace: true,
        },
      );
  }, [signedIn, start, tag, id, navigate]);
  // A battle's link stays in the app; anything else is a page load.
  const go = (to) =>
    to.startsWith("/battle/") ? navigate(to) : window.location.assign(to);
  // Who is reading decides which page this is; an unreachable door reads
  // as nobody, since this page needs no account.
  if (signedIn || (!me && !unreachable))
    return <Skeleton rows={4} label="Reading the session" />;
  return (
    <ZoneProvider zone={browserZone()}>
      <NavigateProvider navigate={go}>
        <PublicSession tag={tag} id={id} at={at} />
      </NavigateProvider>
    </ZoneProvider>
  );
}

function PublicSession({ tag, id, at }) {
  const [page, setPage] = useState({ offset: 0, version: null });
  const query = useQuery({
    queryKey: ["public", "session", tag, id, at, page.offset, page.version],
    queryFn: answered(() =>
      api.publicSession(tag, id, at, page.offset, page.version),
    ),
  });
  const data = query.data?.status === 200 ? query.data.data : null;
  useEffect(() => {
    if (!data) return;
    const who = data.player?.name ?? data.player?.tag ?? "A player";
    document.title = `${who}: ${sessionHeadline(data.item?.facts ?? {})} - Elixir`;
  }, [data]);
  if (query.isPending) return <Skeleton rows={4} label="Reading the session" />;
  if (query.isError || query.data.status >= 500)
    return (
      <ErrorState
        title="This session could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (query.data.status === 409)
    return (
      <Empty
        title="These games changed since the page was read"
        action={
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setPage({ offset: 0, version: null })}
          >
            Read them again
          </button>
        }
      >
        A battle was recorded after this page was read.
      </Empty>
    );
  if (!data)
    return (
      <Empty title="Elixir has no record of this session">
        A session older than 30 days drops off, and an address with a typo finds
        nothing.
      </Empty>
    );
  return (
    <SessionView
      data={data}
      publicView
      busy={query.isFetching}
      onPage={(offset) =>
        setPage({ offset, version: data.item?.evidence?.version ?? null })
      }
    />
  );
}
