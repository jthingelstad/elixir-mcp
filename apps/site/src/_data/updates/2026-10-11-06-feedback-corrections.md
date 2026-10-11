# Feedback reads over the JSON API

GET /api/v1/feedback now honours feedback_id and verbosity=compact, as the 3.2.0 reference says; on 11.10.0 they were ignored, so a compact read returned full bodies and marked them read. A maintainer's needs_info answer always carries a new question. MCP 11.10.1; JSON API 3.2.0 unchanged.
