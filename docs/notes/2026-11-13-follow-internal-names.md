# 2026-11-13 — Internal names say follow

The last phase of DECISIONS "Follow, never track" [Jamie, 2026-11-12]:
names inside the code, where renaming is cheap and nothing stored or
promised moves.

Renamed:

- The Settings views: `Tracking` is `Following` (`Following.jsx`),
  `TrackedRecord` is `FollowedRecord`, `AgentTracking` is
  `AgentFollowing`, `StopTracking` is `StopFollowing`; Home's
  `TrackClan` offer is `FollowHomeClan` (`FollowClan` was taken);
  `ClaimNotice`'s `onTracking` is `onFollowing`.
- The web API's `trackPlayer` handler is `followPlayer` and Home's
  `tracksClan` is `followsClan`.
- The migrate op `{account_track}` is `{account_follow}`
  (`accountFollowOp`). The old key is refused as an unknown op, never run
  as something else.

Left as they are, on purpose:

- **Stored values:** the notification kind `tracking_report` (rows in
  every account's mail preferences), Home's clan state `untracked` (cached
  in `home_feed` rows), and every table and column (`recording`,
  `tracked_since` and the rest). A rename there is a migration over live
  rows for no reader's benefit.
- **Contract fields:** `players_tracked`, `clans_tracked`, `tracked_since`,
  `not_tracked`, `already_tracked` and their kin in MCP and `/api/v1`
  results. Renaming a result field is an MCP and JSON API major, Jamie's
  call.
- **`trackEvent`:** the analytics call (Tinylytics), not the product verb.
- Prose in comments, test titles and file names that name the old page
  ("Tracking"): cleanup when a file is next edited.
