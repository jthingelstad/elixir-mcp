import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { answered } from "@elixir-mcp/client";
import { NavigateProvider, ZoneProvider, browserZone } from "@elixir-mcp/ui";
import { api } from "../api.js";
import { useMe, useNav } from "../App.jsx";
import { CONSOLE } from "../lib/console.js";
import { BattleView, Invite } from "./Battle.jsx";
import { FollowFromHere } from "./FollowFromHere.jsx";

/**
 * A shared post, /h/<share id> (social slice 4, #762; DECISIONS
 * "Everyone signs in; shared posts stay public"). Opens without an
 * account: the owner's game name and words over the battle exactly as its
 * own page shows it. Everything here is /api/public/highlights/<id>, the
 * one projection the preview tags and the picture read too. A deleted post
 * is "No post at this link".
 */
export function PostPage() {
  const { id } = useParams({ strict: false });
  const navigate = useNav();
  const { me } = useMe();
  const zone = me?.authenticated ? (me.timezone ?? null) : browserZone();
  const go = (to) =>
    to.startsWith("/battle/") || to.startsWith(`${CONSOLE}/`)
      ? navigate(to)
      : window.location.assign(to);
  return (
    <ZoneProvider zone={zone}>
      <NavigateProvider navigate={go}>
        <Post shareId={id} me={me} />
      </NavigateProvider>
    </ZoneProvider>
  );
}

export function Post({ shareId, me }) {
  const query = useQuery({
    queryKey: ["public", "post", shareId],
    queryFn: answered(() => api.publicPost(shareId)),
  });
  const read = query.data?.ok ? query.data.data : null;
  const h = read?.highlight ?? null;
  const who = h ? (h.name ?? h.player_tag) : null;
  const gone = query.isSuccess && !h;

  useEffect(() => {
    if (gone) document.title = "No post at this link - Elixir";
    else if (who) document.title = `${who} - Post - Elixir`;
  }, [who, gone]);

  if (query.isPending) return <p className="nil">Loading…</p>;
  if (query.isError)
    return (
      <div className="empty">
        <div className="empty__title">Elixir did not answer</div>
        <div className="empty__body">
          Try again in a minute.{" "}
          <button
            type="button"
            className="link"
            onClick={() => query.refetch()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  if (!h)
    return (
      <div className="empty">
        <div className="empty__title">No post at this link</div>
        <div className="empty__body">
          Nothing is shared under this link. Its owner may have deleted it.
        </div>
      </div>
    );
  return (
    <>
      <section className="panel" aria-label={`${who}’s post`}>
        <div className="panel__body">
          <span className="battle-deck__label">{who}, on Elixir</span>
          {h.words ? (
            <blockquote className="mt-2 whitespace-pre-line">
              “{h.words}”
            </blockquote>
          ) : (
            <p className="mt-2">{who} highlighted this battle.</p>
          )}
        </div>
      </section>
      {/* The way in, or the Follow, sits under the post: its player first
          (#763), read from the post itself, never from who sent it. */}
      {me?.authenticated === false && <Invite who={who} />}
      {me?.authenticated === true && (
        <FollowFromHere sides={read.sides} me={me} first={h.player_tag} />
      )}
      <BattleView read={read} me={me} follow={false} invite={false} />
    </>
  );
}
