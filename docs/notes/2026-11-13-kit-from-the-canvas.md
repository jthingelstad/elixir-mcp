# 2026-11-13 — The kit, drawn from the canvas

Jamie, 2026-11-13: the app looked nothing like the approved styles canvas
(Round 3, "flat", 2026-11-11/12). This change brings the shared kit
(`packages/design`, `packages/ui`) to the canvas, so every page that uses
the kit's parts takes the look; Home's markup follows in its own pull
request, and other pages restyle on top of this kit.

The canvas was not pasted in. Each canvas class is mapped to the kit
piece that plays its role, and the kit's names stay the one system. No
wording, API or visibility changed. Card art is untouched: CSS sizes it.

## Tokens

| Token | Was | Now | Canvas |
| --- | --- | --- | --- |
| `--control` | `#352c55` | `#3a2f5c` | `.btn` (solid secondary) |
| `--control-hover` | `#433870` | `#463a6d` | `.btn:hover` |
| `--gold-edge` | | `#9c7520` | `.btn.gold` lip, `0 2px 0` |
| `--gold-wash` | | `rgba(245,200,76,.07)` | `.item.clan` wash |
| `--gold-dash` | | `rgba(245,200,76,.55)` | `.item.decision` dashed edge |
| `--shadow-brand` | | `0 2px 0 #000` | `.brand`, display titles |
| `--av-1` to `--av-7` | | seven fills | `.av.h1` to `.h7` (`--av-2` darkened to `#0d7a68` for 4.5:1 on white) |
| `--av-ink` | | `#fff` | `.av` text |
| `--t-h1-page` | 28px | 30px | `.pagehead h1` |

The ground, chrome, panel, line, gold, violet, ok and bad tokens already
matched the canvas and are unchanged.

## Classes

| Canvas | Kit piece |
| --- | --- |
| `.top` (60px, chrome ground) | `.kit-top`, `.kit-top__row` (54px on a phone) |
| `.brand` | `.kit-top__brand` (display face, gold, `--shadow-brand`) |
| `.nav a`, `.nav a.on` | `.kit-top__nav a`, current marked by `--mark-tab` |
| `.search` | `.kit-top__search` (sunken, 38px) |
| `.iconbtn`, `.bell .count` | `.kit-top__icon`, `.kit-bell__dot--count` |
| `.me` | `.kit-top__avatar` (a pill) |
| `.tabbar` (phone) | `.kit-bottom` |
| `.pagehead h1` | `PageHead` with `--t-h1-page` |
| `.cols` (`1fr 320px`, gap 24) | `.kit-home__two` |
| `.btn.gold`, `.btn`, `.btn.link` | `.btn--primary`/`.btn--gold`, `.btn`, `.btn--quiet`/`.link` |
| `.btn.sm` | `.btn--sm` (32px; touch target kept by the row) |
| `.follow`, `.follow.on` | `.btn--follow`, `[aria-pressed=true]` (`FollowButton`) |
| `.chip`, `.chip.on` | `.kit-chip`, `[aria-pressed=true]` (filled violet) |
| `.panel`, `.panel h3` | `.kit-panel`, `.kit-panel__head` (no border) |
| `.panel.clan` | `.kit-panel--clan` (gold title) |
| `.welcome`, `.step .n`, `.step.done .n` | `.kit-welcome`, `.kit-step__dot` |
| `.label` (day head) | `.kit-day__head` |
| `.newmark` | `.kit-newmark` (gold rules either side) |
| `.item` | `.kit-feed__item` (a card, no border) |
| `.item.clan` | `.kit-feed__item--clan` (`--edge-clan` and `--gold-wash`) |
| `.item.decision` | `.kit-feed__item--decision`, `.kit-panel--decision` (dashed `--gold-dash`) |
| `.clanband` | `.kit-feed__band` |
| `.ihead`, `.who b`, `.when` | `.kit-feed__head`, `.kit-feed__name`, `.kit-feed__time` |
| `.av`, `.av.s`, `.av.clan` | `Avatar` (`.kit-av`, `--s`, `--clan`, `--1` to `--7`) |
| `.headline`, `.sub`, `.quote` | `.kit-feed__text`, `.kit-feed__sub`, `.kit-feed__words` |
| `.medal`, `.medal.violet` | `.kit-medal`, `.kit-medal--violet` |
| `.mbattle`, `.res.w`/`.res.l` | `.kit-mbattle`, `__res--won`/`__res--lost` |
| `.sfacts` | `.kit-sfacts` (a `dl`; `--won`, `--up`, `--down`) |
| `.spark`, `.spark i.w`/`.l` | `.kit-spark` (HTML bars, midline), `__win`/`__loss`/`__draw`, heights `__m1` to `__m3` |
| `.decklabel` | `.kit-decklabel` |
| `.rx`, `.rxc`, `.rxc.mine`, `.rxadd` | `.kit-cheers`, its `.kit-chip` pills, `[aria-pressed=true]`, `.kit-cheers__add` |
| `.ifoot` | `.kit-feed__foot`, `.kit-feed__links` |
| `.person`, `.cost`, `.cost.free` | `Row` with `lead` (`.kit-row__lead`), `.kit-people__cost`, `--free` |
| `.slots`, `.meter` | `.kit-people__slots`, `.kit-meter` (a `progress`) |
| `.stat .k`, `.stat .v` | `.kit-stat__label`, `.kit-stat__value` |

## Kept as the kit had it

- The breakpoint stays at 760px (the canvas uses 900px): every page
  reflows on the kit's one breakpoint, and moving it is its own change.
- The canvas's chip, follow, reaction and small-button heights (32 to
  40px) are drawn at those sizes with a mouse; under a finger
  (`pointer: coarse`) each is at least the 44px target (`--hit-touch`).
  Focus rings stay.

## Decks (player and highlight pages, 2026-11-13)

| Canvas | Kit |
| --- | --- |
| `.deck` (eight `.ct` tiles) | `DeckRow` (`ul.kit-deckrow`, `--8`/`--4`): real card art through `CardArt size="fill"` (`.card-art--fill`), sized by CSS only |
| `.ct`, `.ct .cost`, rarity borders | Not drawn: the canvas's text tiles were stand-ins for the art |
| `.vs`, `.vs .mid`, `.score` | `DeckVersus` (`.kit-vs`, `__side`, `__mid`, `__score`; the score said in words in `__said`) |
