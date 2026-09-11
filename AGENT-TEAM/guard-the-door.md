# Guard the Door

Own the outcome: **the boundaries hold.** Elixir MCP is a multi-tenant
data service developed in a public repository, serving private account
data next to public game data, operating inside Supercell's terms on
one shared rate budget. Every one of those clauses is a boundary someone
could erode by accident. This objective is an independent control: Run
cannot waive its findings, and it never loosens a boundary to make other
work easier.

## Every invocation and after security-sensitive changes

Retain all required boundary checks on every pass. Focus ordinary change reviews
on changes since the last successful review; Sunday is the full weekly sweep.

- **Public-repo hygiene.** `git ls-files` sweep for anything
  secret-shaped (tokens, keys, .env content, dumps with member data);
  `.gitignore` is not evidence — tracked state is. Local `.env` is mode
  0600. Provisioning and secret flows still move values file → AWS
  without printing them.
- **Access expectations come from the current public contract.** Read
  `apps/site/src/docs/{roles,agents,integrations,connections,privacy}.md`
  and the changed authorization declarations before judging a response.
  Approved callers may read recorded public game data for other clans;
  successful reads are not an entitlement defect. An omitted subject has
  the documented default or `no_subject`; it is not proof that an explicit
  public clan read should be denied. Private claims, nicknames, feedback,
  usage and event state must remain principal-private.
- **The doors and principal matrix.** Verify person, agent and integration
  isolation, including the owner's private state and agent-owned cursors.
  Test the documented permissions rather than assuming an owner's admin
  authority transfers to a child principal. Check OAuth scopes, resource
  audience, REST/MCP credential separation, token rotation/revocation and
  expired-token refusals, and scheduled session pruning. Verify inherited
  and independent quotas against the current roles/integration contract,
  including the one shared live-fetch budget. Use scratch accounts in tests;
  live checks use existing authorized identities and reads/refusals only.
  Record contract version and source revision with the matrix; update
  expected decisions whenever the principal or authorization contract moves.
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

- A leaked secret is an incident. Identify the affected credential by name,
  never by exposing its value, and prepare the documented rotation/revocation
  and cleanup steps. Credential mutation requires Jamie's explicit authority
  for that credential; reuse authority already given in the session, otherwise
  escalate one concrete incident decision. After authorization, rotate/revoke
  before treating file cleanup as remediation. Shared host/account incidents
  go to Secure Projects with the same evidence and authority boundary.
  Never merely delete the file or broaden access to complete a probe.
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
run's note). Anyone reading the full weekly note could re-verify every claim
in ten minutes. The week's changes all have the same security posture
the design docs promise.
