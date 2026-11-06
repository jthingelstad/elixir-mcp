# 2026-11-06: The redesign's last seven decisions

Jamie approved all seven as recommended on 2026-11-06: "Approved: Elixir redesign
decisions 1-7 as recommended, including verified members only for Gone quiet".

1. Gone quiet and its "Back:" line read `verified_clans`, not `member_clans`. An
   unverified claim on the clan reads no section. This closes the question left
   open in `2026-11-06-mail-review-fixes.md`.
2. The meaning change in `at_unix` and `local` stays the minor it shipped as (11.17.0).
3. Invite clanmates stays off Home, as `docs/product/structure.md` records.
4. `/data` keeps 120 days and 8 weeks; the full-history chart stays removed.
5. `clans_participation` keeps ISO weeks.
6. The docs and mail fixtures keep the owner's own names.
7. The privacy page is unchanged.

Only the first changes code. The rest are recorded in `docs/DECISIONS.md`.
