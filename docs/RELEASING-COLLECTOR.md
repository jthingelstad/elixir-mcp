# Runbook: releasing a collector version

Who this is for: the maintainer. Operators never do any of this — their
collectors update themselves, or in the Python case get re-downloaded.

**The one idea:** publishing a release does not ship it. Every green
push to `elixir-mcp-collector` publishes a **candidate** (a GitHub
prerelease) that nobody runs. It reaches the fleet only when this server
**names** it, and naming also promotes it to Latest. Building and
shipping are two separate acts, on purpose.

---

## 1. Land the change

Work lands on `main` in `elixir-mcp-collector`; its `validate` workflow
(Go tests, Python unittest, the `run-forever.sh` shell tests under both
`sh` and `dash`) is the gate. A green push runs `release.yml`, which
builds seven artifacts plus the Python twin and publishes them as a
prerelease named `v2.0.<run_number>`.

```sh
gh release list --repo jthingelstad/elixir-mcp-collector --limit 3
```

The newest tag with `prerelease=true` is your candidate.

> **If the run fails before any job starts**, you broke the workflow
> YAML, not the code — there will be no log to read. Extract the `run:`
> block and check it with `bash -n` before pushing again.

## 2. Soak the candidate on one machine

Nothing installs a candidate on its own, so put it on a canary by hand.
A NAS or a spare box is ideal; do not use the whole fleet.

```sh
TAG=v2.0.NN     # the candidate
base=https://github.com/jthingelstad/elixir-mcp-collector/releases/download/$TAG
curl -fsSL -o collector "$base/collector_linux_amd64"     # your platform
curl -fsSL "$base/SHA256SUMS" | grep ' collector_linux_amd64$' \
  | sed 's| collector_linux_amd64| collector|' | shasum -a 256 -c -
chmod +x collector
```

Then let its supervisor start it and read the log. You want a startup
line naming the new version, a `config` line, and at least one activity
summary with no fetch errors:

```
"gateway up (go, zero-trust v2) version=v2.0.NN"
"config: channel=live pacing=1500ms status=active"
"activity: 30 jobs done, 0 fetch errors in the last 5m (channel=live)"
```

> **Do not run a staged collector by hand to check its version.** If a
> `.env` is already beside it you have just started a second live
> collector on that identity. Start it through its supervisor and read
> the version from the log.

## 3. Name it

Naming writes the update authority and promotes the release. Dry-run
first — it prints exactly what it would write and touches nothing:

```sh
cd ~/Projects/elixir-mcp
AWS_PROFILE=jamie node infra/scripts/name-collector-release.mjs --dry-run
AWS_PROFILE=jamie node infra/scripts/name-collector-release.mjs [tag]
```

With no tag it takes the newest release of any kind. It is idempotent:
naming the same tag twice changes nothing but `updated_at`.

Check the platform keys in the dry-run output. Two do not match their
asset names, and a wrong key fails **silently** — the collector looks up
a key that is not in the response and simply never updates:

| Config key | Asset |
|---|---|
| `go-linux-arm` | `collector_linux_armv7` (GOARM is not part of GOARCH) |
| `go-windows-amd64` | `collector_windows_amd64.exe` (the key has no `.exe`) |

## 4. Verify the fleet moves

Go collectors check `/config` at startup and hourly, so a rollout lands
**within an hour**. To see it immediately on a machine you control,
restart it. The log says plainly what happened:

```
"update authority names v2.0.NN; self-updating"
"updated; exiting for supervisor restart"
"gateway up (go, zero-trust v2) version=v2.0.NN"
```

An exit with no `updated` line above it is a crash or the watchdog, not
an update. Confirm the whole fleet on **Admin → Collectors**, Version
column. `py-dev` there means a machine is running a working tree rather
than a release.

## 5. Update the Python twins by hand

The Python collector never self-updates — that is the point of it, so a
bad Go release cannot silence a whole fleet. Each Python machine needs:

```sh
base=https://github.com/jthingelstad/elixir-mcp-collector/releases/latest/download
curl -fsSL -o collector.py.new "$base/collector.py"
curl -fsSL "$base/SHA256SUMS" | grep ' collector.py$' \
  | sed 's| collector.py| collector.py.new|' | shasum -a 256 -c -
mv collector.py.new collector.py
# then restart it through its supervisor
```

`releases/latest` is safe to use here: it resolves to the **named**
release, never to an unsoaked candidate.

## Rolling back

Name the previous tag. That rewrites the authority and moves Latest
back, and collectors downgrade themselves on their next config call
exactly the way they upgraded:

```sh
AWS_PROFILE=jamie node infra/scripts/name-collector-release.mjs v2.0.PREVIOUS
```

Rollback is naming, not deleting. Never delete a release that is named
or was recently named: the URL in `collector_release` points at its
assets, and a collector mid-update would 404. An update failure never
stops collection, but you will have made a fixable problem permanent.

## Version numbers

Releases are `v2.0.<run_number>`. The `2` is the **client generation**
that speaks `config`/`lease`/`submit`, and it is the number the door's
`min_client_version` gates on. Keep the major at 2 for as long as that
contract holds. The Python twin reports `py-v2.0.<run>` from the same
stamp; a checkout copy reports `py-dev`.

Enforcement of the minimum is server-side and **off** unless
`COLLECTOR_MIN_ENFORCE=1`. It refuses `lease` and `submit` with a 426
but never `config`, because config is the channel a stale client updates
through. It also fails open on any version it cannot parse: this gate
retires old clients, it does not authenticate anyone.

---

_Related: `docs/OPERATORS.md` (the operator's side),
`docs/COLLECTOR-ZERO-TRUST.md` (why the server is the update authority),
and `AGENTS.md` rule 4._
