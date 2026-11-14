# 2026-11-13 — Polish: Home and Find

Part of the polish pass on the signed-in app (the owner: the app "is rough
on the edges"). Layout, styling and label wording only: the same reads,
the same rules, nothing anyone can see or do changed.

- **People you know (Home's starter set).** A row says why, plus a small
  green **Free** when following that player costs nothing (its title says
  why). What following the ticked players costs is one line by **Follow
  these** ("8 players · uses 7 of your 50 follows"), the same line the
  confirm dialog shows. The foot is "Untick anyone you'd rather not
  follow." and **Not now**; on a phone the fine print no longer collides
  with Not now.
- **Plan lines** (`planLine` in `follow.jsx`, used by the starter set,
  Find's Your clan, a player page's Follow everyone and Clan's members)
  say "N players · uses S of your L follows", "N players · free", or the
  refusal, which keeps the product's word: slots. The single Follow
  dialog says "Uses 1 of your 50 follows · 3 used" and "Free · already
  recorded · 3 of your 50 follows used"; at the limit it still says "All
  50 player slots in use". Settings' meter keeps "slots".
- **Find.** Suggested drops its panel title (the tab says it) and the
  per-row "Uses a slot"; rows carry Free only. From your battles says
  when in Home's format on its own line ("Last met today, 3:52 pm",
  "Last met Tuesday, 7:57 am", `lastMetLine` in `logic.js`); `metLine`
  no longer says when. The Clan directory tab is one plain link row, not
  a panel round one row. The side panel is "Your follows" ("3 of 50
  used"), and the link is the Follow me link everywhere ("Your Follow me
  link", "Copy your Follow me link"; the tab stays "Your link").
- **Home's head on a phone** is two rows, not four: "Battle log read …"
  is quiet text on the title's line (its 44px target kept), and the feed's
  chips are one row that scrolls with the kit's fade, New pinned at its
  end.
- **One name:** the feed's battle card link says "Open the battle", as the
  player page and Clan's feed do (it said "The battle").

Before and after captures came from the e2e fixtures (invented players)
at 390x844 and 1280x800.
