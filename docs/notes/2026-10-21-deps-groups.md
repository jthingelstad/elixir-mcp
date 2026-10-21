# 2026-10-21 — Dependency groups, the advisories cleared, an audit gate

Step "deps-groups" of the platform review Jamie approved on 2026-10-21
(`../plans/elixir-platform-review-2026-10-21.md` in the domain repo). No
contract change: MCP and the JSON API keep their versions. The deploy
runs the whole acceptance suite, because every Lambda's AWS SDK moved.

## Dependabot, by kind of change

`.github/dependabot.yml` had one `dev-toolchain` group of every package,
so a week was one pull request of everything: #597 carried 29 updates
across 18 manifests and nobody could review it. Now a week brings up to
six pull requests (`open-pull-requests-limit: 6`), each one kind of
change, minor and patch only (a major is a pull request of its own):

- `aws-sdk`: `@aws-sdk/*` and `@smithy/*`, which release almost daily
  and move together; every Lambda carries them.
- `react`: React, React DOM, their types and `@tanstack/*`.
- `vite`: Vite, Vitest and their plugins, which pin one another.
- `playwright`: Playwright and its axe adapter (CI's browser cache keys
  on Playwright's version).
- `runtime`: every other production dependency.
- `dev-toolchain`: every other development dependency.

A dependency joins the first group that matches, so the named groups
come first. `@types/node` follows the runtime's major (Node 24,
`.node-version`, Lambda's `nodejs24.x`), so its majors are ignored, and
`packages/contracts`, which had `^26.6.4`, now has `^24.19.2` like the
rest. GitHub Actions updates come monthly in one `actions` group.

## #597's updates, superseded here

The same specifier bumps #597 proposed, applied by hand with a fresh
lock: the AWS SDK 3.1146 to 3.1152, Vite 8.3.4, Vitest 5.0.5, Eleventy
3.1.7, marked 18.1.1, React 19.3.1, TanStack Query and Router, Playwright
1.64.1 with `@axe-core/playwright` 4.14, knip, oxlint, prettier, jsdom,
lucide and `@vitejs/plugin-react`. Two of them changed behaviour:

- **marked 18.1 is stricter CommonMark:** an HTML block must open on one
  line, so the architecture page's `<svg ...>` tag, wrapped over several
  lines, rendered as text. Of the 540 Markdown files, only that page
  rendered differently between 18.0.14 and 18.1.1 (compared file by
  file). The tag is on one line now, and `apps/site/test/site.test.mjs`
  fails any doc that opens an HTML block with a tag spanning lines.
- **axe 4.14 promoted `label-content-name-mismatch`** from experimental
  to WCAG 2.1 A (2.5.3, Label in Name). It counted the account button's
  avatar initials ("AD") as label text, which the button's name,
  "Account: Ada", does not contain; three Clan removal journeys, which
  run axe's default rules, failed on it at both widths. The initials are the account's
  picture, so CSS draws them now (`data-initials`, `::before`): the
  button looks the same at both widths and is announced the same,
  "Account: Ada". `[engineering]`

## The advisories: 17 to 0

`npm audit` reported 17 advisories in development dependencies, 12 of
them high, none in production ones. In-range updates cleared most:
markdown-it 14.3.3, brace-expansion 1.1.21, source-map-js 1.2.2,
smol-toml 1.9.1 and Vite 8.3.4; Eleventy 3.1.7 dropped chokidar 3,
nunjucks, gray-matter and the old js-yaml, argparse and sprintf-js
chain.

**One had no fix to update to.** `braces` (to 3.0.3) has no fixed
release, and it came in through `micromatch` from `@parcel/watcher`
2.5.1, which `@tailwindcss/cli` pins exactly. `@parcel/watcher` 2.6.0
matches with picomatch and carries neither. The narrowest honest
mechanism is one nested override, scoped to the one parent:

```json
"overrides": { "@tailwindcss/cli": { "@parcel/watcher": "^2.6.0" } }
```

It changes only the watcher Tailwind's `--watch` uses (the CSS dev
script; CI and the deploy run one-shot builds, which never start it).
A probe of `--watch` here saw no rebuild with 2.5.1 or 2.6.0 alike, so
the probe, not the override, is the likely fault; a person running the
dev script would notice first. Drop the override when Tailwind's CLI
stops pinning 2.5.1.

## The audit gate

The `static` job ran `npm audit || true`, a report nobody read. It now
fails `validate` on any advisory in a production dependency
(`npm audit --omit=dev --audit-level=low`) and on a high or critical one
anywhere (`npm audit --audit-level=high`).
`services/mcp/test/ci-tooling.test.mjs` pins both lines and that neither
is softened with `||`. An advisory with no fixed release blocks
`validate` until it has an override like the one above, or the package
is replaced: that is the point of the gate, and the reason to keep each
override scoped to its one parent and noted here.
