# Collectors show whether they run a signed release

The fleet page marks each collector signed when the binary it runs is exactly a release Elixir named, and says dev build, unverified or mismatch otherwise; collectors from v3.0.4 report what they run. Beside it, the release key's fingerprint is drawn as the picture ssh-keygen prints for it, so an operator can compare it with their own at a glance.
