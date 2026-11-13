# 2026-11-13 — A shared highlight, posted in its clan's Discord

Social slice 9's Discord half (#767). Jamie, 2026-11-12, answering the
digest question: "Also: a shared post can post to the clan's Discord
through Clan's webhook." And, of every Discord post that links back to
Elixir: "make sure they do not have previews."

## What changed

- **Battle page:** under a shared highlight, its posting account sees
  **Post in your clan's Discord** (a confirm, not gold: it is not the
  page's primary action) when the server says it may; after, the line
  "Posted in your clan's Discord." Nobody else sees either.
- **`POST /api/me/highlights/discord`** `{ highlight_id }`, people only,
  the web app's own route (no MCP or `/api/v1` change). `GET
  /api/me/highlights` adds `clan_discord: { available, posted_at }` to
  each of the reader's own highlights.
- **Clan ▸ Social ▸ Discord:** a fourth group, **Shared highlights**, off
  by default with or without a policy; a leader turns it on. It has no
  activity kinds of its own, so it changes nothing the editor or the
  sync posts.
- **0254:** `battle_highlight.clan_discord_at` and `clan_discord_clan`,
  the once-only mark.
- `packages/syndication/src/highlight-share.mjs` builds the post and
  hands it to the `timeline-discord/` outbox as kind `clan_activity`,
  with the channel's webhook still sealed, and writes the `discord_post`
  ledger row. The relay posts it as it posts every activity line.

## The post

```
**Invented Name** shared a highlight: a 3-1 win
> “what a comeback”
[Open in Elixir](<https://elixir.poapkings.com/h/abc123>)
```

The battle phrase is `a win` without crowns and `a battle` when the
record has no outcome. The words line is left out when there are none.
The name and words go through `escapeDiscord` (markdown, mentions,
timestamps, masked links, one line). No tag, clan name, opponent or time.

## Previews and mentions

Two guards, both pinned in `services/web-api/test/highlight-discord.test.mjs`:
the link's address is in angle brackets (Discord does not unfurl a
bracketed link), and the relay sends every post with `flags: 4`
(SUPPRESS_EMBEDS) and `allowed_mentions: { parse: [] }`. The test
drives the relay against a fake receiver and asserts that exact body, a
hostile name (`@everyone **Boss** <@&4242>`) coming out literal, and
that an unknown outcome is not retried. No real webhook is called.

## Defaults taken (engineering, narrowest reading)

- The clan's **activity** channel, not the leaders' Actions webhook.
- Leaders opt in (off by default).
- Only the posting account, on a highlight already shared (so nothing
  becomes public that was not), while it holds a **verified** claim and
  the player is a **current** member.
- Once per highlight; later edits and deletion change nothing there.
- Posted as Elixir writes it: never held, skipped or rewritten by the
  clan's model.

## Questions for Jamie

- Should a deleted highlight's Discord post be deleted too? (Today it
  stays; its link answers "No post at this link".)
- Should Shared highlights be on by default when a clan has a policy?
