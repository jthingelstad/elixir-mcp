# Provisioning tells you what it did

Provisioning a collector token in Admin used to succeed silently: the token is staged for the operator's one-time reveal on their Collector page, so the Admin table just refreshed and looked like nothing happened. Admin now confirms the token is staged, keeps a 'token staged' note until it is revealed, links straight to the reveal when you own the collector yourself, and surfaces any failure instead of swallowing it.
