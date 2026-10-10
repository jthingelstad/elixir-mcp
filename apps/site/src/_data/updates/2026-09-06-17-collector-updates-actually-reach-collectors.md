# Collector updates actually reach collectors

Collectors only install the exact binary version and hash this server names, which is what stops a compromised release page from pushing code to operators. That naming step had never been used, so released collectors were quietly staying on whatever version they were installed with. We can now name a release in one command, and have named the current one.
