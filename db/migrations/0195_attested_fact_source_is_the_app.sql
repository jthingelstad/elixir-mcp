-- 0195: an attested fact's source names the family app, not a host.
--
-- A person's fact was keyed by the host of its client's first redirect
-- URI (0178). Elixir Clan moves from clan.poapkings.com to
-- elixir.poapkings.com/clan (one origin, 2026-09-28), and with that key
-- its facts would have been relabelled "elixir.poapkings.com" and a
-- retry of one written before the move would not have found it. The
-- source is now the app the client was provisioned for (0185), under the
-- key its rows already carry: clan.poapkings.com and drop.poapkings.com
-- for those two, the app's own name for any later one
-- (services/web-api/src/attested-facts.mjs, SOURCE_OF_APP). No row
-- changes.
--
-- A comment only: no data, no lock beyond the comment's own.
comment on column attested_fact.source is
  'The family app that wrote it: for a person''s fact, the app its client was provisioned for (0185), keyed as its rows always were (clan.poapkings.com, drop.poapkings.com; a later app by its name), an identifier and not an address (0195); for an integration''s, the integration''s name (elixir-drop).';
