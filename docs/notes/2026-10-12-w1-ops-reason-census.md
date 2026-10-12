# 2026-10-12 — The `ops`-origin census after the reason was retired (#527)

MCP 11.11.2 and JSON API 3.2.0 unchanged; no migration; nothing deploys.
Follows `2026-10-12-w1-ops-reason.md` (#546), which retired the
maintainer's `ops` reason and added `{ops_recordings}`.

## The read

`npm run op -- '{"ops_recordings": {"dry_run": true}}'` (an allowlisted
read), after the deploy of 42d4ea64 on 2026-10-12:

| `subject_type` | `status` | rows with origin `ops` |
|---|---|---|
| player | any | 0 |
| clan | active | 1 |
| clan | stopped | 10 |

`subjects` 1; `would_stop_count` `{player: 0, clan: 0}`. The one active
`ops` clan is still tracked, so it keeps recording and its label. No
player row carries `ops`; the 0042-era clan rows are stopped history.
Nothing is left for `{ops_recordings: {dry_run: false}}` to do. Tags are
not written here.

## The questions, and the answers taken

1. **Where does the census go?** In a note of its own: a merged note is
   history (`docs/notes/README.md`), so #548's edit of the #546 note is
   reverted here and the census moves to this note (Codex on #548).
