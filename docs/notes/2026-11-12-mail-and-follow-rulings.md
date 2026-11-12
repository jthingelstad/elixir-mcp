# 2026-11-12 — Collector mail, the Actions mail cap and agent follows

Jamie answered three points left open by the social-layer rulings
(`2026-11-12-social-layer-rulings.md`), recorded in `docs/DECISIONS.md`.
The collector mail stays: "the one scheduled mail" means mail to members,
and operational mail to a role (people running a collector, leaders with
an Action waiting) is separate. The leaders' Actions mail goes when an
Action waits, at most once a day. An agent may follow a player for its
person when the person asks, with the follow tool `elixir_track_player`
becomes; cheers and highlights stay app-only. Docs only: no behaviour,
contract version or migration.
