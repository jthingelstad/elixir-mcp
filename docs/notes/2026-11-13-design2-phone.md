# 2026-11-13 — Design pass two: the restyled pages at 390px

Second design pass, part 3. Each page the pass restyled (Policy,
Standings, Run's editor, the clan directory, Settings › Emails) was
opened at 390px with a touch pointer, and every control measured. Style
only; no words, reads or behaviour changed, beyond Standing's leader
link becoming a button.

- **Touch targets** (`packages/design/src/components.css`, the existing
  `pointer: coarse` block): `.btn--text`, the clan header's freshness
  summary, Run's checkbox rows, segmented buttons and Emails' "All sent"
  reach 44px; a `summary.label` grows by padding so it keeps its marker;
  the switch keeps its drawn size and gets a 44px hit area from a
  `::before`.
- **Clan tabs** (under 480px): tighter padding and 13.5px type, so a
  leader's six tabs fit at 390px instead of scrolling.
- **Directory filters** (under 480px): each field takes the full row
  with its chips sharing it; the four-way removal filter
  (`.clan-dir__fold`) folds to two rows instead of scrolling half its
  choices out of view.
- **Standing:** the leader's "Read the policy in full, in Run" is a
  button (it was a 15px link).

Left, outside the restyled pages: the shell's top bar (help 40px, the
account button 38px, the brand 28px), the footer links, and links in
Feed, Members and War (inline 16 to 20px). The app is dark only, so
there is no light theme to check.
