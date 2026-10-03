# Consistency trace: Clan leadership messages

Basis: main `dde047fb`, then the reviewed Clan readiness diff; MCP 11.0.1,
external JSON API unchanged. Two independent read-only reviewers followed the
ledger, consistency facets/classes, role gates, model service/relay, action UI,
sharing, public docs and Monday engine tests. No secret read or live write.

Closed findings:

- `privacy-promise`: arbitrary chat tone notes could disclose member details.
  Both the service and pure request helper now accept fixed tones only; an
  adversarial note refuses before provider dispatch. Existing Leader Message
  notes retain their behavior with accurate privacy wording.
- `unrealized`: a pending draft could overwrite edits or a Restore click.
  Text, tone and Restore lock while pending; a deferred second-request test
  guards this. Empty previous text can also be restored.
- `unrealized`: automatic clan selection lost the incoming action link.
  It now preserves the path; manual selection still opens the chosen roster.
  Built desktop/mobile journeys exercise this previously failing entry path.
- `contradicted`: Settings described recruiting-only drafting.
  UI and public actions/policy docs now name the supported message uses.

Consistent coverage: current session/clan membership, verified writes,
leader/co-leader model spending, cross-clan card scope, key-owner roster check,
counted pre-dispatch reservations, encrypted relay, immutable worker claim and
no automatic retries remain. Welcome completion shares edited words; removal
chat remains excluded from shared message facts. Weekly/early close, unknown
evidence and grant-once behavior passed 74 engine regressions. The four owners,
cadences and private-state boundaries remain.

Validation: full `npm run verify` passes; 81 Clan UI tests and 20 focused
engine/backend tests pass; built desktop/mobile clipboard and completion
journeys pass with no serious accessibility violation, page exception or
horizontal overflow. Production co-leader account, policy and model-status
checks remain explicitly owed because Otto's browser is signed out; fixtures
are not claimed as proof of those accounts.
