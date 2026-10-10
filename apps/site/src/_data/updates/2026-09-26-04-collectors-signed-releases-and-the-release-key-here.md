# Collectors: signed releases, and the release key here

Collector releases are signed, and every collector checks the signature against its built-in release key before it installs an update this server names. The operators page now publishes that key and its fingerprint, a second place to check it beside the collector repository. The collector is Go only, and the idle fallback the config used to carry for the retired Python collector is gone; every current release reads the check-in interval instead.
