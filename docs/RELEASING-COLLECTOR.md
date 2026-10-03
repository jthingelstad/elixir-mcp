# Runbook: releasing a collector version

Who this is for: the maintainer. Operators never do any of this: their
collectors update themselves.

**The one idea:** publishing a release does not ship it. Every green
push to `elixir-mcp-collector` publishes a **candidate** (a signed GitHub
prerelease) that nobody runs. It reaches the fleet only when this server
**names** it, and naming also promotes it to Latest. Building and
shipping are two separate acts, on purpose.

**Who checks what.** The collector repo builds and signs a release; this
server names it; every collector verifies it before it runs a byte of
it (the URL, the signature over `SHA256SUMS`, the `VERSION` line, the
hash, the floor: the collector's `SECURITY.md`). Naming refuses anything
a collector would refuse, so a release that would be turned away at the
fleet is turned away here first.

---

## 1. Land the change

Work lands on `main` in `elixir-mcp-collector` through a PR; the
collector's `validate` check (all of its CI jobs) is the gate. A green
push runs
`release.yml`, which builds seven binaries plus the installers, writes
`VERSION` and `SHA256SUMS`, signs `SHA256SUMS` with the release key in
the `release` environment (`SHA256SUMS.sig`), verifies that signature
twice, and publishes all of it as a prerelease.

```sh
gh release list --repo jthingelstad/elixir-mcp-collector --limit 3
```

The newest tag with `prerelease=true` is your candidate.

> **If the run fails before any job starts**, you broke the workflow
> YAML, not the code — there will be no log to read. Extract the `run:`
> block and check it with `bash -n` before pushing again.

## 2. Check the candidate before naming it

Two checks, because they prove different things and neither can prove
both.

**A dev build, for the startup path.** A released binary cannot soak on
its own: it asks the update authority at startup and installs whatever
is named, so a candidate put on a canary downgrades itself to the named
release within a second (found on v2.0.26, 2026-09-11). A locally built
binary reports `dev` and never self-updates, so it is how a candidate's
code is run long enough to read. Build the candidate's commit and put
it in place of the binary on one machine you control, through its
supervisor:

```sh
cd ~/Projects/clash-royale/elixir-mcp-collector
git fetch && git checkout <candidate commit>
GOOS=linux GOARCH=amd64 go build -trimpath -o collector-dev ./cmd/collector   # your canary's platform
```

Keep the released binary beside it to put back. Start it through the
supervisor and read the log. You want the startup line, a `config`
line, and at least one activity summary with no fetch errors:

```
"gateway up (go, zero-trust v2) version=dev"
"config: channel=bulk pacing=1500ms status=active"
"activity: 30 jobs done, 0 fetch errors in the last 5m (channel=bulk)"
```

Then put the released binary back and restart it. Admin → Collectors
shows `dev` for the canary while it runs; that is the only time it
should.

There has been no `live` channel since 2026-09-11: every collector checks
in and takes live jobs first. The `channel=` the client still prints is a
leftover column (expand-and-contract) that nothing routes on; ignore its
value.

> **Do not run a staged collector by hand to check its version.** If a
> `.env` is already beside it you have just started a second live
> collector on that identity. Start it through its supervisor and read
> the version from the log.

**A signed candidate, for the update path.** The live check done on
2026-09-26 for v3: install the signed candidate's released binary by hand
on one machine and restart it. At startup it asks the authority, is
told the currently named release, and updates to it: it fetches that
release's `SHA256SUMS` and `SHA256SUMS.sig` over GitHub's real
redirects, verifies the signature and the named hash, runs the new
binary once, swaps it in and proves it. That is every step of a real
rollout and of a rollback, on real infrastructure, before the fleet
depends on it. You want:

```
"update authority names v3.0.N; self-updating"
"v3.0.N is signed by release key SHA256:mktajl7kjMESYLyiY34rRu9hLTL6+EJS3I6aa/sGqeU and its signed SHA256SUMS covers the hash the hub named"
"updated; exiting for supervisor restart"
"update trial: running v3.0.N; v3.0.M is kept until the hub answers"
"update to v3.0.N proven (the hub answered); removed collector.prev"
```

`self-update REFUSED` here stops the release: something between the
candidate's verifier and what GitHub serves is wrong, and the whole fleet
would refuse the same way. Do not name until it is understood.

## 3. Run the full payload audit

The full audit gates a release (`docs/DECISIONS.md`: every payload field
needs a manifest disposition). The nightly shape census samples twenty
archived objects per endpoint a day and cannot see a rare field; this
reads every archived object for one endpoint and exits 1 when any field
path arrives with no disposition in `packages/ingest/src/payload-keys.mjs`:

```sh
cd ~/Projects/clash-royale/elixir-mcp
AWS_PROFILE=cloud-engineer node infra/scripts/payload-field-audit.mjs                   # player_battlelog, the default
AWS_PROFILE=cloud-engineer node infra/scripts/payload-field-audit.mjs <endpoint>        # any endpoint the release touches
AWS_PROFILE=cloud-engineer node infra/scripts/payload-field-audit.mjs all             # every endpoint
```

The endpoint names are the keys of `PAYLOAD_KEYS` (`player`, `clan`,
`currentriverrace`, `riverracelog`, `player_battlelog`, `cards`, the
ranking boards, `events`). It lists the whole archive, so it is slow on
`player_battlelog`; run it once, not in a loop. A non-zero exit stops the
release: the missing disposition is a server-side change that lands here
first (a manifest entry plus its projection or written reason), and the
audit is re-run before naming.

## 4. Name it

Naming writes the update authority and promotes the release. Dry-run
first — it verifies everything and prints exactly what it would write,
and touches nothing:

```sh
cd ~/Projects/clash-royale/elixir-mcp
AWS_PROFILE=cloud-engineer node infra/scripts/name-collector-release.mjs --dry-run
AWS_PROFILE=cloud-engineer node infra/scripts/name-collector-release.mjs [tag]
```

With no tag it takes the newest release of any kind. It is idempotent:
naming the same tag twice changes nothing but `updated_at`.

Before it writes a row it refuses:

- a release with no `SHA256SUMS.sig`;
- a signature `ssh-keygen -Y verify` rejects against the release key
  (the line and fingerprint `SHA256:mktajl7kjMESYLyiY34rRu9hLTL6+EJS3I6aa/sGqeU`
  from the collector's `SECURITY.md`, carried in the script);
- a signed `SHA256SUMS` whose `VERSION` line is not this tag's;
- any url that is not exactly
  `https://github.com/jthingelstad/elixir-mcp-collector/releases/download/<tag>/<asset>`.

The migrate op behind it (`{collector_release}`) checks the url shape, a
64-hex `sha256` and a `vX.Y.Z` version again server-side, so a
hand-typed payload cannot write a row the fleet would refuse.

Check the platform keys in the dry-run output. Two do not match their
asset names, and a wrong key fails **silently** — the collector looks up
a key that is not in the response and simply never updates:

| Config key | Asset |
|---|---|
| `go-linux-arm` | `collector_linux_armv7` (GOARM is not part of GOARCH) |
| `go-windows-amd64` | `collector_windows_amd64.exe` (the key has no `.exe`) |

## 5. Verify the fleet moves

Collectors check `/config` at startup and hourly, so a rollout lands
**within an hour**. To see it immediately on a machine you control,
restart it. The log lines are the ones in step 2's update-path check,
ending in `proven`.

An exit with no `updated` line above it is a crash or the watchdog, not
an update. A new version that cannot reach the hub rolls itself back
after three dirty starts (`ROLLED BACK: ...`) and refuses that version on
that machine until another is named. Confirm the whole fleet on
**Admin → Collectors**, Version column (or `/api/public/status`). `dev`
there means a machine is running a local build rather than a release.

## Rolling back

Name the previous tag. That rewrites the authority and moves Latest
back, and collectors install it on their next config call exactly the
way they upgraded, through the same checks and the same trial:

```sh
AWS_PROFILE=cloud-engineer node infra/scripts/name-collector-release.mjs v3.0.PREVIOUS
```

**A release from before signing needs signing first.** v2.0.30 is the
floor (the collector's `installFloor`): nothing below it installs, and
a release from before signing has no `SHA256SUMS.sig`, so naming refuses
it and a verifying collector would too. Run the collector repo's
**sign-release** workflow for that tag (Actions → sign-release → Run
workflow, `tag: v2.0.NN`) first, then name it. Do it ahead of time for
the release you would fall back to, never during an incident. A release
from before signing does not verify its own updates, so name a signed
release again as soon as the problem is fixed.

Rollback is naming, not deleting. Never delete a release that is named
or was recently named: the URL in `collector_release` points at its
assets, and a collector mid-update would 404. An update failure never
stops collection, but you will have made a fixable problem permanent.

## Version numbers

Releases are `v3.0.x`, one per green push: `release.yml` takes the next
patch no tag has used (`scripts/next-version.sh 3 0`), nobody tags by
hand, a red build uses no number, and a number is never reused. The
major moved from 2 to 3 on 2026-09-26 for the Go-only collector with a
self-rolling-back updater and signed releases; the `config`/`lease`/
`submit` contract did not change, and every v3 is above every v2. A
local build reports `dev`.

The minimum is `CONFIG.min_client_version` in
`packages/collector-door/src/door.mjs` (2.0.30). Raising it retires
the pre-signing rollback lever, so it moves only on Jamie's call.
Enforcement is server-side and switched by the stack parameter
`CollectorMinEnforce` (`"0"` or `"1"`, template default `"0"`), which
reaches the collector Lambda as `COLLECTOR_MIN_ENFORCE`. It is a PRESERVED
parameter (`infra/scripts/parameters.mjs`), so an ordinary deploy never
flips it either way; changing it is a parameter-only update,
`AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs --param=CollectorMinEnforce=<0|1>`. The last
value the notes record for production is `1` (set 2026-09-06, restated
2026-09-12 with the minimum at 2.0.30; `docs/notes/2026-W36-W37.md`). The
repo cannot show the live value: read the stack's parameters before
relying on it.

With enforcement on, the door refuses `lease` and `submit` with a 426
`client_too_old` but never `config`, because config is the channel a stale
client updates through. It also fails open on any version it cannot parse
(`dev` passes): this gate retires old clients, it does not authenticate
anyone.

> **A refused client looks idle, not broken.** The collector treats a
> 426 `client_too_old` on `/lease` as an empty answer (a collector-repo
> bug, reported to Jamie 2026-09-25), so a stale client logs quiet
> activity summaries rather than errors, and its heartbeat stays fresh
> because the door stamps it before the version check. Look for a
> collector checking in with no leases issued and a stale
> `last_success_at`, not for errors in its log.

---

_Related: <https://elixir.poapkings.com/docs/operators> (the operator's side),
`docs/COLLECTOR-ZERO-TRUST.md` (why the server is the update authority),
the collector's `SECURITY.md` (the release key and what a collector
verifies), and `AGENTS.md`, "Working style"._


## Release details in operator email

Naming now stores the published GitHub release body and URL for observed-upgrade
emails, preserving the release body when promoting the page. Add
`--reason="<verified purpose of this release>"` to the naming command when a
maintainer reason is available. Do not infer the installation mechanism on any
operator’s host. A notice is sent only after a collector reports a higher
installed version; naming alone sends nothing.
