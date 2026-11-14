# 2026-11-13 — Polish round two: tap targets and the sweep

Round two of the polish pass: the tap targets the design lead listed, and
a sweep of round one's captures for shortfalls. Layout, styling and label
wording only: the same reads and the same rules.

## Tap targets (44px by hit area)

The capture now measures a control's hit area, not only its box: its own
box, a `::before`/`::after` hit box, or a label that wraps it.

- **Sign-in's product news box:** its label is the tap, a real 44px row
  (`min-h-[44px]`, centred), not a pseudo box over the footnote.
- **The front page's links** already took a 44px box on a touch screen;
  wrapped rows of them now sit 44px apart (`row-gap: 22px` under
  `pointer: coarse`), so one link's tap never reaches into the next row.
- **Settings › Emails' Sent to you rows** (`.mailsent`, 42px) and a
  player's **battle rows** (`.battle-row`, 41px) are 44px tall.
- **Stats › Cards' card names** take the shared 44px hit box.
- Left: "Create an account" on sign-in is a link inside a sentence, which
  WCAG 2.5.8 exempts; a 44px box there would cover the lines around it.

## The sweep

- **One Follow.** Every Follow act is the kit's Follow pill
  (`btn--follow`): Home's Follow these, Find's Follow my clan and Follow by
  tag, Follow everyone (the `FollowAll` default and the clan's), Settings'
  Follow forms. Gold, grey and muted purple versions of the same act are
  gone. Beside a field the pill takes the field's height; a Settings
  form's button sits on its fields' row (`.st-form > .btn`), not centred
  against a label and its field.
- **No orphaned head words:** h1 to h3 balance their lines
  (`text-wrap: balance`), so "Sign in or create an / account" no longer
  ends on one word. A head's own rule still wins.
- **A reading measure on a wide screen:** panel feet, footnotes, small
  explanatory lines and the starter's lead stop at 76ch (Stats' floor
  note ran about 190 characters, Find's tag help about 145).
- **Card form badges** (Hero, Evo) never wrap: on Stats' small cards HERO
  stacked a letter per line. The badge's size and padding follow the
  card's width down to a floor.
- **Your own empty Highlights tab** links to how a battle is highlighted
  (`/docs/battles#highlight-a-battle`); another player's says only that
  none are posted.
- **Sign-ins & devices' empty line** sits on the list's edge instead of
  inset twice.

Looked at and left: the battle page's deck gutter (the battle page's
layout is ruled); Highlights' display-face title (the canvas's highlight
card); the signed-out bar's second row for Docs (Docs would otherwise
leave the phone's top bar). Not done here: the error states come in four
forms (a box, a head with Try again, a head alone, a box with a link);
one form for them is a pass of its own.

Tests: `apps/web/test/player-page.test.jsx` (the own-page highlights link).
