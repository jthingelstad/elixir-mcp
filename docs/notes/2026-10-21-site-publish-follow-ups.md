# 2026-10-21 — The site publish measured, deletes S3 keeps, and the documented order

These follow up `2026-10-21-site-publish.md` (#639) and
`2026-10-21-deploy-tooling.md` (#637).

**Measured.** The deploy records before and after (site lane):

| phase | #637, before | #639, first run | #640, steady |
| --- | --- | --- | --- |
| assets | 20.3 s | 1.7 s | 0.9 s |
| site | 21.4 s | 7.4 s | 3.8 s |
| total before acceptance | 56.9 s | 22.2 s | 20.0 s |

The first deploy after #639 had no publish record yet, so it checked
about 1,470 matching files with HEAD. The deploy after it found them in
the record. The live headers were read back after the deploy:

- `llms.txt` and the font licence serve `text/plain; charset=utf-8`;
- a Vite chunk serves `text/javascript` and is immutable;
- the documents and `site.css` revalidate.

**Deletes S3 keeps (#640).** DeleteObjects answers 200 even when S3
keeps some keys, and lists those keys in `Errors` (Codex on #639).
`deleteKeys` returns them.

- A document the build no longer has that S3 kept fails the publish, as
  a failed PUT does. It may have been taken down on purpose.
- An asset the prune could not delete is only a warning, and the next
  prune tries again.

#640 first wrote this in #639's note. It is moved here because a merged
note is history.

**The documented order.** The order in `infra/AGENTS.md` and the ship
skill now names two phases it had left out (Codex on #637):

- the first migrations, on `--create`;
- the public statistics snapshot, on the platform lane, where a failed
  snapshot stops the deploy.

No code, MCP, JSON API or schema change.
