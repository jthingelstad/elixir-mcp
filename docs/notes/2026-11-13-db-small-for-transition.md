# The database on db.t4g.small for the data layer refactor

2026-11-13. Jamie: "I think that we are going to have to do a data layer
refactor, and I suspect that migrating to small to do that is going to be
a smart idea", and earlier the same morning, of the resize, "to get this
transition done and then scale back to micro I approve that".

## What the census showed

`npm run op -- '{"inspect": true}'` that morning: the database is 2,402 MB
on an instance with 1 GB of memory.

| Table | Size | Rows |
| --- | --- | --- |
| `battle_participant_card` | 547 MB (288 MB of it the primary key) | 2.03 M |
| `api_receipt` | 341 MB | 0.59 M |
| `deck_card` | 332 MB (241 MB of it two indexes) | 0.87 M |
| `battle_participant` | 307 MB | 0.23 M |
| `battle` | 175 MB | 0.11 M |
| `deck` | 109 MB | 0.11 M |

The two tables that hold a battle's cards one row per card are 879 MB,
37% of the database, for 105,214 battles. That is the first thing the
refactor looks at.

## What changes here

`DBInstanceClass` goes to `db.t4g.small` (2 GB). `shared_buffers` is the
engine default, a quarter of memory, so it follows the class. The change
is a short outage while RDS swaps the instance; Elixir is in beta and a
missed scheduled run catches up.

## Going back

When the refactor has landed and the rewritten tables are in place, set
the class back to `db.t4g.micro` in `infra/template.yaml` and deploy. The
reserved instance (to 2027-09-07) covers the micro in full.
