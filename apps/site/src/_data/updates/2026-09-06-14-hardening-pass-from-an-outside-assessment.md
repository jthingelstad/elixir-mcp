# Hardening pass from an outside assessment

An independent review of the whole system produced a punch list, now shipped: war-day events and the current-war view survive season rollover (the period index resets each season - the anchors now know that), staying signed in actually works (sessions slide with activity up to 90 days instead of dying at day nine), every recorded payload is verified to be ABOUT the player or clan it was requested for, delayed data can no longer overwrite newer snapshots, and deploys now run schema migrations before new code goes live.
