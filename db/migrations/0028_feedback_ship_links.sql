-- Agent feedback #4: structured ship links on responses, and seen
-- tracking so response meta can hint "a maintainer replied" exactly
-- until the requester reads it.
alter table feedback add column shipped_in text;
alter table feedback add column related_tools text[];
alter table feedback add column response_seen_at timestamptz;
