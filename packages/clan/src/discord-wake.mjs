/**
 * A clan's Actions in its Discord are looked at again a minute after
 * each hand-off to the relay (2026-10-11): a timeline-sync/ object (the
 * sync's queue holds every wake a minute), at most one a clan a minute.
 * The sync runs `share` under the clan's lock (services/timeline-sync).
 *
 * `outbox` is `makeOutbox`'s writer; without it there is no wake and the
 * next request or morning run collects the answers, as before.
 */
export function clanDiscordWake(outbox, now = Date.now) {
  if (!outbox) return null;
  return (clanTag) =>
    outbox(
      "timeline-sync",
      { v: 1, clan_discord: clanTag },
      {
        id: `clan-discord-${String(clanTag).slice(1)}.${Math.floor(now() / 60_000)}`,
        once: true,
      },
    );
}
