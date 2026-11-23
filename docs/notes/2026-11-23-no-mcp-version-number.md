# 2026-11-23 — MCP has no version number and no changelog

Jamie (2026-11-23) asked to remove the MCP changelog and the numbered
contract version. Writing a change file and picking patch, minor or major
for every pull request was bookkeeping that nobody read: agents find tools
from `tools/list`, and people read What's new.

**Removed.** The `elixir_changelog` tool and its output schema; the
`elixir://changelog` resource; `packages/contracts/src/changes/` (one file
per version), the generated index, `changelog.ts`, `changelog-entry.ts`,
`version.ts`, the bump and index scripts and their tests; `npm run
contract:bump`; the contract half of `/updates` (the switch, the contract
entries and their pages under `/updates/<date>-contract-<version>/`, the
filter script and its styles) and of the feeds; the collector door's
`contract_version: 2`, which no collector reads.

**What stays.**

- `serverInfo.version` is the tool fingerprint alone, `tools.<12 hex>`:
  sha256 of every declaration and of the tool names each kind is shown
  (`toolsVersion` in `packages/tools/src/tools.mjs`), one value for every
  principal kind. Before, a person and an agent got different strings; now
  one string covers both surfaces, so it can equal `meta.contract_version`,
  and a visibility change still moves it. `services/mcp/test/mcp.test.mjs`
  proves it moves with an edited description, an edited argument and a
  tool hidden from agents.
- `meta.contract_version` stays on every response under the same key and
  carries the same string. Tools build meta without it; the registry's
  `invoke` stamps it, and so do the envelopes that skip `invoke` (invoker
  failures and internal errors, an oversized result, the MCP handler's
  own refusal). `/tools.json` keeps `contract_version` too.
- The JSON API's `info.version` stays where it is. Its pin,
  `services/web-api/test/sign-in-api.pin.json`, is the real guard; the
  test that reads it says so.
- The collector's `min_client_version` stays.
- What's new stays. An entry is written when a change is worth telling,
  not for every user-visible change, and new entries end without a
  versions line. Existing entries are not edited.
- A breaking tool change is still Jamie's call, asked up front and stated
  in the pull request.

**`feedback.shipped_in`.** No migration. It is free text a maintainer sets
with `{feedback_respond}` or in Admin. New answers carry the UTC day the
fix went live (`2026-11-23`); answers from before keep the version they
named, and the tools and account page show either as it is.

**Acceptance replay** read a capture's `contract_version` as semver to map
old captures (the timeline's `basis` before 11.8.0, the renames of
12.0.0). It now reads a small frozen table of those two versions; a
fingerprint is after all of them, and a capture with no version is before
the first.

**The deploy record** writes `tools_version` (the fingerprint read live
from `/tools.json`, else this commit's) where it wrote `contract_version`,
and the pull request comment says "MCP tools:" in place of "MCP contract:".

**Discord agent.** It logged a changelog notice when the version string
changed; now it logs the change once and says nothing more.

**Web bundle.** The changelog text rode in the app's modulepreloaded
`App` chunk, through the contracts package. That chunk went from 427.37 kB
(145.10 kB gzip) to 208.29 kB (70.42 kB gzip); the entry chunk is
unchanged at 208.92 kB (65.74 kB gzip).
