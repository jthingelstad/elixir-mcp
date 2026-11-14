# 2026-11-14 — Direction, not rulings

`docs/DECISIONS.md` opened by telling agents that a `[Jamie]` line is
never re-litigated and that any surface disagreeing with one is the
defect. The agent guide, the consistency and tool-change skills and the
briefs' README repeated it, and spoke of "rulings" and "ratified" pages.

That framing overstated what the lines are. Elixir is being built, most
`[Jamie]` lines record a short answer given in the middle of other work,
and the direction moves as we learn. Reading them as law made the project
feel like a set of strict requirements, and made agents quote passing
answers and ask for more of them.

What changed, in words only:

- The DECISIONS preamble says the file is a working record, not a
  rulebook. A `[Jamie]` line is product direction as of its date: build
  to it, and when newer direction or `VISION.md` has passed it, update
  the line and say so in the pull request. Ask only when the answer
  changes what gets built next.
- The few firm lines stay firm and are named as such: privacy (many
  players are minors), secrets, what is sent to whom, what a person is
  charged.
- New lines say what we do and why in plain words. Older lines keep
  their quotes as the record of the day; none was rewritten here.
- `AGENTS.md`, the two skills, `docs/product/README.md` and
  `docs/notes/README.md` say the same thing in the same words.

No behaviour, contract or migration changed.
