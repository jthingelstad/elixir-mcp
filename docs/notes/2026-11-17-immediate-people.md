# 2026-11-17 — Meet your people while your battles arrive

Jamie approved immediate social value during onboarding and allowed live
reads to make suggestions useful. The first added player now gets the
existing priced, confirmed starter follows before its own battle log has
arrived. The other welcome steps remain under Finish your setup. A
successful follow leaves the reader in place, preserves unticked choices
even when the usual starter offer ends or the first battle log lands, and
offers Open Timeline. Retained choices use the canonical follow-plan read
when the usual starter response no longer carries its prices.

## Defaults taken

- Suggestions remain facts from the canonical record, using the same
  starter set, blocks, source ordering, follow prices, caps and confirmation.
  No extra person is followed automatically. Failed reads say so and can
  be retried; nobody is invented to fill a quiet list.
- During the first day of a new primary claim, a missing roster for its
  already-followed, actively recorded clan may receive one collector live
  read per account per UTC day. The opportunity is three minutes from the
  later of the claim and admitted profile, so a delayed first profile does
  not consume it. Once requested, the job's timestamp freezes the window;
  later profile observations cannot extend it. After the fast window the
  progress read falls back from five seconds to once a minute while waiting,
  and stops after the claim's first day or a landed roster. Hidden pages do
  not poll. A declined clan or a full clan slot is never overridden.
- The shared live lane reuses a fresh receipt or open job and owns the
  global token. The daily allowance is spent only before a mint, and is
  refunded when that mint fails or joins a racing job. Empty global budget
  creates no job and spends no allowance. No standing capacity increased,
  no new recording authority, and no browser or Lambda calls Supercell.
- The existing first-read helper treats a profile admitted within
  the last day as sufficient to request a missing first battle log. Rejected or
  retired receipts do not qualify. This reaches MCP as well as the app:
  MCP 13.11.1, a patch; response shapes and JSON API 5.1.0 unchanged.

## Verification

The missing-battlelog regression fails without the helper correction. The
early-people regression fails against the former welcome component. The
post-follow receipt-arrival regression fails against the old automatic
ready switch, and the retained-choice regression fails when an ended
starter offer loses its slot price. Scratch
tests cover the shared rate budget, concurrent tabs, open jobs, failed
mint refunds, delayed profiles, frozen windows, no clan, declined and
unfollowed clans, and person-only route authority. Real-ledger tests also distinguish
admitted, rejected and retired existing profile receipts. Browser fixtures cover
early names, a roster landing, one confirmed follow with an unticked choice,
and keyboard entry to the Timeline at 320, 390 and 1280px. A failed roster
mint offers an explicit retry; its regression fails without the notice. The first visual
pass exposed a 21px Open Timeline target; it was changed to the kit's 44px
button before the second pass. No live follow, read request or other
verification write was made.

The narrow consistency trace covers the shared first-read helper's web,
signup and MCP callers; the welcome and ready Timeline's shared starter
query; source-authorized roster requests and their progress; the public
docs and regression journeys. Other Timeline, mail and sharing work is
separate. The deployment's acceptance should cover the elixir family for
the follow-player scheduling correction; the local journeys cover the
new web-only route. Migration 0293 adds only the partial live-clan job
history index, with five-second lock and statement limits. On a synthetic
200,000-job ledger, the lookup changed from a sequential scan over 2,667
buffers (21.157ms) to an index-only scan over three buffers (0.036ms); the
index built in 40.2ms. These are local figures, not a production guarantee.
The actual progress SQL has a plan regression, demonstrated red without
the index; migration sha256 and fresh-scratch schema fingerprint are pinned.
No data rewrite or backfill is needed.
