# 2026-11-15 — Comments name the pages that exist

Comments only; no behaviour, contract or schema change.

The Console folded on 2026-11-12 and Ladder became Stats, but about
forty comments in live source still described today's pages by those
names ("the Console's and Ladder's own reads", "the Ladder page"). Each
now names what the code serves: the app, Stats, Settings, or the page
itself. Comments that tell the history ("the Console folded", "Ladder
until 2026-11-12") stay, and so do identifiers, stored values
(`console_timeline_seen_at`, the feedback areas `console` and `ladder`)
and the game mode Ladder.

Two stale facts went with them:

- `acceptance/run.mjs` said the database is a db.t4g.micro. It is a
  db.t4g.small for now (DECISIONS, "The database is db.t4g.small for
  now"); the pace was set on the micro and stays.
- `infra/template.yaml` said the sender's DNS records go to Namecheap by
  hand. They are Route 53 stack code in projects-sysadmin's
  `dns-poapkings-com` stack since 2026-10-27 (DECISIONS, "DNS is a
  Route 53 zone stack").

Left for a later pass: test comments and the lowercase "the console"
that many server comments still use for the signed-in app.
