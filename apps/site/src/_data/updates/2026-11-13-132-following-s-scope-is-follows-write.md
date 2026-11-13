# Following's scope is follows:write

The permission an agent or an app needs to follow players and clans for
you is called `follows:write` now, as the tools and the app say follow. It
was `recordings:write`, and on the consent page it reads **Change who you
follow**, as before.

Nothing you connected needs doing again: every connection and agent key
made with the old name keeps following for you, with no new consent, and
an app that still asks for `recordings:write` is given `follows:write`.

MCP 12.1.0 (no tool changed). The JSON API is 3.7.0: `POST /me/players`
names `follows:write`.
