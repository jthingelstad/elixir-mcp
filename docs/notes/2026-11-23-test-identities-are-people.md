# 2026-11-23 — Elixir has people, not agents; test identities are people

Jamie, 2026-11-23:

- "Approved: remove the Agents concept from Elixir, superseding the 11-14
  'a clan has one MCP endpoint' ruling"
- "Approved: the breaking MCP change that drops /a/<id>/mcp, on_behalf_of
  and elixir_my_identities"
- "Approved: the acceptance and Gym test account may hold a person-bound
  key"
- "Delete the old agent accounts."

Why: "Now that 'Clans' are real entities in Elixir -- we can just
associate config and web hooks and such with Clans as they are… This
could really simplify Elixirs model and account setup".

The removal lands in slices. This one records the decision (DECISIONS,
`VISION.md`, a banner on `docs/product/agents.md`) and moves Elixir's own
two MCP consumers, the acceptance suite and the Gym, off agent accounts
first, so the gate does not depend on what the later slices delete. The
door, `on_behalf_of`, `elixir_my_identities`, the agent paths in claims,
auth and tools, the schema, the web pages and the public docs are later
slices.

## Test accounts

A test account is a person-kind account made only by the `{test_account}`
op (migration 0316, `account.test_name`):

- no address (`email` null) and an `email_hash` of `test:<name>` that no
  address hashes to, the same device as a removed account's `removed:`
  tombstone: it is sent no mail, nobody signs in as it, and it has no
  newsletter;
- no claim and no handle, so no search, follow list or page reaches it;
  onboarded at creation;
- one followed clan (activity scope, notify on), which must already be
  recorded: the op never starts a recording;
- one key, `cr:read` (and `feedback:write` for the Gym), its own hourly
  ceiling, and its own daily quota on the account (a person spends their
  own; the member role's 500 is far below a Gym run).

The check constraint pins the shape (person, no address, the `test:`
hash), so nothing can later give one an address. `{funnel}` leaves test
accounts out; `{account_role}` lists show `test_name`. The admin accounts
page still lists them, as staff see every account.

People still cannot mint keys: the web refusal is unchanged, and the op
only keys an account it made. The key is minted on the operator's
machine by `infra/scripts/mint-test-key.mjs`, which writes the raw value
to a 0600 file and prints only the op payload with its sha256, so the
value never enters a Lambda, a log or an agent's context.

## The cut-over

Nothing breaks while the old agents still exist:

- the acceptance door and the Gym's `call.mjs` take the URL and the token
  from their `.env`, so the switch is a new file, not a code change;
- the run reads which kind is calling from tools/list (`principalKind`):
  the two cases that differ by kind (`clans_my_view`, `elixir_cheers`)
  assert each kind's answer, and for a person an omitted clan on the
  eight clan-default reads is sent as POAP KINGS (`argsForKind`), as the
  agent's default was, while cases, the cache and the Gym's filings keep
  their args as written;
- `{profile_tool}`'s token name resolves to the test account when an
  agent holds a key of the same name (`serviceTokenAccountByName`), so
  `acceptance` and `gym` keep their audit surfaces (`svc:acceptance`,
  `svc:gym`).

Rejected: a new account kind `test`. Every kind filter (`kind = 'person'`
in mail, the newsletter, pages, follows, the funnel) would have to learn
it, and a test identity on a code path no person uses tests nothing
people get. Giving the test person a claim on a real player was rejected
too: it would put a test account in that player's follower counts and
make the suite's answers depend on one player's history.
