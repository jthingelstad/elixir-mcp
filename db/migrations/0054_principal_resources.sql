-- More than one protected resource.
--
-- SECURITY REVIEW, not a schema tidy-up. Until now oauth_code.resource and
-- oauth_family.resource were pinned by CHECK to exactly one string, and that
-- equality is what has been preventing a token from being minted for an
-- audience of somebody's choosing. Replacing it with a pattern moves that
-- guarantee from "one literal" to "this regex is right", so the regex is the
-- security boundary and deserves to be read as one:
--
--   * the host is still a hard-coded literal -- this is not a wildcard, and no
--     input can steer the audience off this origin;
--   * the only other shapes admitted are /a/<id>/mcp and /i/<id>/mcp, where
--     <id> is the same [a-z0-9]{8,16} that account.public_id already enforces;
--   * anchored at both ends, so no prefix or suffix can be smuggled in.
--
-- WHY AT ALL. A clan leader may hold a personal connection AND an agent
-- connection in one client. Same-URL connections publish identical tool names,
-- the model picks between them arbitrarily, and the two answer from different
-- subjects with no sign that a choice was made. Distinct resources make the
-- URL declare intent and the credential prove it, so a mismatch is a refusal
-- instead of a wrong answer.
--
-- EXPAND-FIRST, and the personal surface does not move: every existing row
-- keeps the exact value it has, /mcp still means what it has always meant, and
-- the pattern is a superset of the old literal.

alter table oauth_code drop constraint oauth_code_resource_shape;
alter table oauth_code add constraint oauth_code_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|[ai]/[a-z0-9]{8,16}/mcp)$'
);

alter table oauth_family drop constraint oauth_family_resource_shape;
alter table oauth_family add constraint oauth_family_resource_shape check (
  resource ~ '^https://elixir\.poapkings\.com/(mcp|[ai]/[a-z0-9]{8,16}/mcp)$'
);

comment on column oauth_family.resource is
  'RFC 8707 audience. https://elixir.poapkings.com/mcp for a person; /a/<public_id>/mcp for an agent; /i/<public_id>/mcp for an integration. A token is valid at exactly one.';
