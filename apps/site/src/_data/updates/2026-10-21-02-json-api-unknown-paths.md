# A wrong JSON API path says where the right ones are

A request to a path the JSON API does not have, such as
`GET /api/v1/models`, now gets a 404 that links the JSON API docs and
the OpenAPI document, whatever key it carries, where it used to get a
401 that suggested a key would help. Every real operation still needs
its key or grant. A 429 for an hourly limit now says exactly how many
seconds remain in the hour, and the OpenAPI document names the callers
of every operation.

MCP 11.13.3, unchanged, and JSON API 3.2.1 (a correction).
