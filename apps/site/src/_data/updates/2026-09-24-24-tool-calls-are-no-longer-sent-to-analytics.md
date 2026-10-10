# Tool calls are no longer sent to analytics

Elixir used to count every tool call in Tinylytics, the site's analytics, by tool name. It no longer does: your call record already holds every call, with more detail, and nothing leaves Elixir for it. Page views and mail opens are counted as before.
