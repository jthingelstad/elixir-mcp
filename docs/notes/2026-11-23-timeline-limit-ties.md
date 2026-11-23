# A limit never cuts inside one instant

2026-11-23. Follows `2026-11-23-timeline-one-week.md`; found by Codex on
#1207.

`elixir_timeline`'s `limit` cut on the instant of the first item it left
out. When that item shared its instant with the Nth, the cut removed every
item at that instant, the read fell into the page's stuck fallback, served
N of them and reported `has_more: false` with no `timeline_more_to`. The
items older than that instant could not be reached by paging with `limit`.

Paging here is by time alone (`to`), and no `to` splits one instant, so a
count cannot cut inside one. Now the cut falls on the first item older
than the Nth: the items sharing the Nth's instant are served with it, the
read can hold more than N, and a note says so. The stuck fallback no
longer stops at `limit`; it is reached only when one instant overflows the
page's character budget, as before `limit` existed.

An exact count would need a cursor that orders items inside an instant.
Nothing asks for that yet [engineering].
