# 2026-10-13 — The collector minimum is 3.0.6

Jamie approved raising the hub's minimum collector version to 3.0.6,
deploying, verifying and closing #418. The production preflight found
minimum enforcement enabled and every active collector on signed v3.0.6.

The door now advertises 3.0.6 and refuses lease and submit below it when
enforcement is enabled. Config remains available to an old client so it
can update. Unknown versions retain the existing fail-open behavior.
Rollback below 3.0.6 now requires Jamie's approval to lower the minimum
and a hub deploy before naming the older release. The collector's
separate installer floor is unchanged.

Product question: may the pre-signing and earlier v3 rollback options be
retired? The collectors brief leaves a minimum change to Jamie, and
Jamie explicitly chose 3.0.6 in this session. No engineering defaults
were added.

The existing scratch-database gate test covers 3.0.5 and retired v2
clients being refused on both work routes, old clients still reading
config, 3.0.6 and later versions reaching work, and enforcement being
off by default. Release, trust and public operator docs carry the rule.

MCP 11.13.0 and JSON API 3.2.0 are unchanged; the collector contract's
shape and version are unchanged. No MCP tool changed, so deploy
acceptance is not requested. Verify production's deployed collector
bundle, enforcement parameter and the fleet's natural heartbeats after
deploy, without issuing a live lease or submit.
