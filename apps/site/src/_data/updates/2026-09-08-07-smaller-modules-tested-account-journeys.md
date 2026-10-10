# Smaller modules, tested account journeys

Account pages, API routes and maintenance commands now have smaller, focused modules. Successful account and agent journeys are tested against the real API on disposable databases, including first capture, agent creation, key rotation, suspension and resumption. Existing behavior is preserved. CI now runs the same complete verification gate as local development, including dead-code checks.
