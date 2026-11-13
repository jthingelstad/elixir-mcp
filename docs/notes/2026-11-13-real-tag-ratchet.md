# 2026-11-13 — A ratchet on real tags

Many Clash Royale players are minors, and this repository is public: no
real player's tag belongs in it except King Thing's and POAP KINGS'.
Captured payloads put several hundred real tags into acceptance bites,
fixtures, mail fixtures and tests before that rule. Replacing them waits
on Jamie's decisions; until then the number may only fall.

- `docs/no-real-tags.test.mjs` (the root lane of `npm test`) counts, in
  every tracked text file, the distinct tag-shaped strings that are not
  King Thing's, POAP KINGS' or listed in `docs/invented-tags.json`. It
  fails when a file's count rises above `docs/no-real-tags.baseline.json`
  or a new file has one, and says how to invent a tag instead.
- What counts is written and tested in `infra/scripts/lib/no-real-tags.mjs`:
  a `#` (or `%23`) token over the tag alphabet holding a letter that is
  not hex (so colours and issue numbers never count; lower case needs a
  digit, so anchors do not either), or the value of a `tag`, `*_tag` or
  `*Tag` key that `normalizeTag` accepts.
- The baseline holds paths and counts, never a tag.
  `node infra/scripts/no-real-tags.mjs --update` only lowers it. The two
  sha256-pinned migrations that hold tags have fixed counts in the guard.
- Invent a tag over `0289PYLQGRJCUV` starting `#0` and list it. Neither
  cr-agent-api-docs nor this repo's helpers state how tags encode a
  number, so "a real tag never starts with 0" is not relied on: only a
  listed tag is allowed.

No contract, JSON API or migration change; nothing to deploy.
