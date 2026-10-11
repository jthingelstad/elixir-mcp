# 2026-10-11 — Decisions say who decided them; privacy and model rules narrowed

Jamie found agents making bad choices from DECISIONS lines that had grown
wider than the decisions behind them, privacy and model use above all. A
review traced each rule to its source (git history, the old ledger,
NOTES and memory) and Jamie decided, one at a time:

1. **Provenance.** Every DECISIONS line ends with who decided it: `[Jamie,
   date]` is not re-litigated; `[engineering, date]` is an agent default
   that may be challenged with evidence; mixed lines say which part is
   which. The tags were stripped on 2026-10-08 (67efa622, 143 Jamie
   attributions became 25) and are restored from that commit's parent and
   `git log -S`. A line says no more than its decision; other files cite
   the heading instead of restating it wider. Jamie: "Yes."
2. **Mail.** "No editorial or model-written mail" becomes "Ultimate
   Champions and Card of the Week are retired": the decision of 2026-10-02
   retired those two kinds. Whether Elixir's own mail may use a model is an
   open product question, not a ban. (Option A.)
3. **Ratings.** "No branded or derived player metric, ever" becomes
   "Elixir rates no player": no branded or invented score (Pilot Score,
   "Elixir Lift"). Plain derived facts and direction stated with numbers
   ("up from 52% to 58%") are allowed on Ladder as in mail; verdict words
   stay out. The Ladder form test no longer bans "up" and "down". (A.)
4. **Advice.** Elixir's outputs recommend nothing; agents (a person's own,
   and the family's Discord agent) may coach from Elixir's facts, the
   suggestion theirs. Scope in AGENTS.md and the timeline pages say so;
   elixir-mcp-discord's ask lane changes in its own pull request. (A.)
5. **Tags.** "CR tags are not PII; email is" now says what follows: a tag
   may appear in an issue, a note, an analytics path or a model request;
   tag and record-id masking in analytics is report hygiene, not privacy.
   The consistency skill's privacy-promise class drops analytics ids;
   OPERATIONS and Clan's analytics guide stop calling tags private. (A.)
6. **Privacy page.** It names a clan's own Anthropic key (member names
   are sent to draft words) and Clan's Discord posts, which makes
   OPERATIONS' "what reaches SES and Anthropic matches the privacy page"
   true. Feedback is answered by the maintainer, sometimes with help from
   AI agents (Jamie: "C. Both, depending on the item"); your-account,
   agents and architecture say so. Jamie: "Yes."
7. **Invites.** No referral codes, but a copy or share of Bring your
   clanmates sends one aggregate `console.invite_copied` event valued by
   channel (`chat`, `message`, `share`), as Clan's copy buttons do. (B.)
   Clan-visibility timeline items stay publishable to a person's
   cross-post. (A.)

Stale facts fixed on the way: roles.md said a kick never reaches an agent
(it reaches the clan and its agents); recording.md and follow-a-friend.md
said agents see your nicknames (an agent is its own account and keeps its
own); clan-actions.md called a page of public game counts "private";
EMAIL.md now documents that the tracking mail carries no attested fact, as
an engineering choice; two code comments cited VISION principles that no
longer exist and now cite DECISIONS lines.

MCP and JSON API unchanged.
