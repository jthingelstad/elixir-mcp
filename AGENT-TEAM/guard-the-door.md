# Guard the Door

Own the outcome: **the boundaries hold.** Elixir MCP is a multi-tenant
data service developed in a public repository, serving private account
data next to public game data, operating inside Supercell's terms on
one shared rate budget. Every one of those clauses is a boundary someone
could erode by accident. This objective is an independent control: Run
cannot waive its findings, and it never loosens a boundary to make other
work easier.

## Every run (Sunday, and after any security-sensitive change)

- **Public-repo hygiene.** `git ls-files` sweep for anything
  secret-shaped (tokens, keys, .env content, dumps with member data);
  `.gitignore` is not evidence — tracked state is. Local `.env` is mode
  0600. Provisioning and secret flows still move values file → AWS
  without printing them.
- **Entitlement boundaries, probed read-only.** The refusal paths still
  refuse: an outsider session on clan tools gets `not_entitled`; account
  data (claims, nicknames, feedback, usage, events) never crosses
  accounts; nicknames stay strictly account-private; universal reads
  serve game data only. Reads and refusal paths — never verify with
  writes on live data.
- **The doors.** OAuth token/family rotation and revocation behavior;
  session sweeps actually pruning (jobs lambda logs); admin routes
  gated admin-vs-owner exactly as the roles contract says; service
  tokens: usage matches their purpose, nothing unexplained.
- **ToS posture.** Fetch volume vs one key's budget (the fleet is
  redundancy, never multiplication); live-lane caps enforced; the
  unofficiality disclaimer on every surface including tool meta.
- **Third-party data discipline.** Tinylytics event values carry tool
  names and categories only — never user text, tags, or emails; the
  public status page still shows card names only (no IPs, no machine
  labels); Buttondown holds addresses of people who signed in, nothing
  more; unsubscribes were never overridden.
- **Blast-radius review** of the week's diffs: new env vars, new IAM
  grants, new outbound calls from the relay, new queue consumers —
  each one justified or challenged.

## Action

- A leaked secret is an incident: rotate first (the affected credential,
  via the documented flow), then scrub, then write the class lesson in
  NOTES. Never merely delete the file.
- An entitlement regression gets a failing test before the fix, and the
  fix at the gate that should have held — not a patch in the caller.
- Boundary *changes* (a new data exposure, a new third-party, a
  loosened gate) are never this objective's to make alone and never
  another objective's to make silently: they go to Jamie as one
  concrete decision with the tradeoff stated.
- Findings that implicate the shared account or host (IAM, backups,
  DNS) hand off to the projects-sysadmin team explicitly in NOTES —
  named, not assumed.

## Success

The sweep finds nothing, and that finding is itself evidenced (the
commands run, the probes made, the diffs reviewed are listed in the
run's note). Anyone reading the Sunday note could re-verify every claim
in ten minutes. The week's changes all have the same security posture
the design docs promise.
