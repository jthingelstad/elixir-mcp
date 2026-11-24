# Rules: what away does, and the all-goals advice

Two fixes from Codex's review of #1232, Clan Rules:

- **Away keeps a member from a kick; it does not stop the clock.** The
  engine shields removal while an Away or Keep in clan exception runs, but
  quiet days still count from the last battle or join, so a member can be
  due the day it ends (the inactivity clock doc already said so). The
  Rules editor said "Away days don't count as quiet", and the member page
  said "Kick clock paused". They now say "No kick while they're away.
  Their quiet days still count." and "No kick while their exception runs".
  The helper is `kickHeld`.
- **The advice follows the clan's goals rule.** A member short of the
  goals in a clan whose rule is "all" was told any one goal would do. The
  Rules tab now says "Meet every goal" for "all", and "Any one of these"
  otherwise, as its heading already did.
