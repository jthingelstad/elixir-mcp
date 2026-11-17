# 2026-11-17 — Accept the unpatched picomatch development risk

Jamie: "Let's accept this issue and move forward."

The full dependency audit accepts GHSA-fc5q-39xc-vjpf for picomatch
through 4.0.7 and the development packages affected solely through that
advisory. Every affected installation in those chains must be marked
development-only in the lockfile. The production audit still fails on
every advisory; other high and critical development advisories still fail.
Malformed reports, audit failures and unresolved dependency chains fail
closed. CI prints the accepted advisory and affected packages.

There is no patched published version as of this decision. The accepted
risk is the potential exponential work when picomatch processes a hostile
glob during development or builds. Dependencies and application behavior
are unchanged. #1127 remains open to update the dependency and remove the
exception when a patched version is available.

Regression coverage checks another advisory on the same package, another
affected range, elevated severity, mixed advisory chains and production
installations. The original `npm audit --audit-level=high` fails on the
current lockfile; the scoped wrapper passes only the accepted risk.

MCP and JSON API versions, migrations and player-facing behavior are
unchanged. No What's new entry is needed for this CI-only change.
