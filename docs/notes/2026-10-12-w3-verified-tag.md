# 2026-10-12 — A verified tag cannot be claimed by any other account (#556)

MCP 11.11.4 (a correction: `elixir_track_player` refuses a primary or alt
on a tag another account has verified, with `not_entitled` and the Verify
page's answer; the identity brief no longer tells a person with players
but no primary that they have none). JSON API 3.2.0 unchanged: its
`POST /me/players` runs the same tool and fails with the same Problem.
No migration. A read-only census, `{verified_tag_census}`.

## Jamie's answer

Issue #556, while ruling on #535 [Jamie, 2026-10-12]:

> IF a player has VERIFIED their player tag, we should NOT allow any other
> account to claim it as a self or alt tag… by VERIFYING you are
> protecting your tag from any other user being able to claim it as
> themselves.

The default on existing claims (they end when the tag is verified) was
shown to Jamie in the issue, and they said go.

## Product questions and the answers taken

1. **What does "claim it as a self or alt tag" cover?** [Jamie's words]
   A claim whose relationship is `primary` or `alt`, and the implicit
   first-player primary (a person's first player is them). `friend` and
   `watching` say "not me" and stay open to anyone: following a verified
   player is not claiming to be them.
2. **A first add named `friend` or `watching` on a verified tag?**
   [engineering, 2026-10-12] Added as asked and not made the primary. A
   first add with no relationship (the console's add, the signup tag) is
   a claim to be that player, and is refused. Inferred from "claim it as
   themselves".
3. **Which paths refuse?** [engineering, 2026-10-12] Every path that
   writes `primary` or `alt`: `addPlayer` (the console's Tracking add and
   Make primary, `elixir_track_player` and `POST /api/v1/me/players`,
   signup's tag through `onboardAccount`, the `{account_enroll}` and
   `{account_track}` ops lanes) and the console's relationship change to
   `alt` (now `setRelationship` in `@elixir-mcp/claims`). Each takes the
   subject lock, so a claim and a verification of one tag are serialised.
   Drop's collection path adds collection members, never claims, and is
   untouched.
4. **One refusal text.** [engineering, 2026-10-12] `VERIFIED_ELSEWHERE`
   in `@elixir-mcp/claims`, the Verify page's answer: "Another account
   has verified this player. If that player is yours, sign in to the
   account that verified it, or tell us through the feedback form." The
   console route and Verify's two 409s carry it as `message`; the tool
   carries it as the message of a `not_entitled` failure. No new error
   code.
5. **What happens to other accounts' claims when a tag is verified?**
   [engineering, 2026-10-12; #556, Jamie said go] Every other account's
   `primary` or `alt` claim on the tag ends (is removed) in the
   verification's transaction (`markVerified`); their `friend` and
   `watching` claims stay. The recording reconciles as for any removed
   claim (the verifier still claims the tag, so it continues). Removing
   the claim removes that account's open Verify challenge for the tag
   (0080 cascade). An ended primary takes the clan follow Elixir made
   for it (`auto_followed_at` set), as a primary that moves does
   (`followPrimaryClan`), logged `clan_removed` with `auto: true` and not
   marked declined; a follow the person made stays (Codex on #565). From
   now on only: claims already colliding are counted by the census and
   left alone.
6. **How is the account told?** [engineering, 2026-10-12] An
   `account_event` `claim_ended` (`player_tag`, `reason:
   verified_elsewhere`, `was_primary`, `relationship`) becomes the
   timeline item `account_claim_ended`, with its own sentence naming the
   tag and never the other account. No mail: the event-based kinds are
   `milestone` (firsts), `clan_actions_waiting` (Clan) and
   `feedback_answer` (answers), none fits, and no kind is invented.
7. **A primary that ends.** [engineering, 2026-10-12; DECISIONS, apart
   from 2026-09-25's refusal to remove a primary through the tool] The
   account is left with no primary: nothing is promoted (Elixir does not
   choose who "you" are). `GET /api/me` carries `claim_notice` for as
   long as the account has no primary (a friend or watched player added
   since does not answer it; Codex on #565), and the console
   says so on Tracking and the Overview: the tag, why, and what to do.
   The MCP identity brief says the account has players but no primary.
8. **A signup tag that is verified elsewhere.** [engineering, 2026-10-12]
   Not claimed; the account is onboarded with nothing, lands on Tracking,
   and gets a `claim_refused` event (its own timeline sentence) and the
   same console notice. `{account_enroll}` does the same for a tag it is
   given, and then follows no clan for it (Codex on #565).
9. **Clan's gate and #535.** Unchanged code: the gate reads a person's own
   claims, and the #535 read requires a verified claim, which now has no
   unverified self-claimant beside it. The gate's comment is corrected.

## The census

`{verified_tag_census: {dry_run: true}}` (`services/migrate/src/ops-verified-tag-census.mjs`):
tags one account has verified that another account also claims, with the
other claims split by relationship (`primary`, `alt`, `friend`,
`watching`) and the distinct accounts behind the `primary` and `alt`
ones, which are the collisions the rule concerns. Counts only. A read-only
session; nothing is written.
