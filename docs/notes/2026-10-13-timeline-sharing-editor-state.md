# 2026-10-13 — Discard closed timeline-sharing drafts

The review of the interface cleanup found that Timeline sharing's editor
state lived above its conditional drawer. Closing hid an unfinished
webhook URL and write state, then restored them when reopened.

Console's brief keeps the person's switches explicit. Closing a contextual
editor should discard unsaved edits, as the shared settings editor does.
The sharing editor now owns its draft, status and visible error within
its own mount, keyed to the principal. Closing unmounts it; a pending
response may still update the saved setting but cannot populate a newly
opened editor. The parent keeps the live summary, query and mutation
observer, so reopening does not permit a duplicate in-flight update.

The live phone read-back also showed that an evidence button and unread
label could squeeze the event sentence into a narrow column without page
overflow. The mobile event row now stacks time, sentence and controls.

Regression checks cover Close, Escape and a refused response that arrives
after close. Native browser checks at phone and desktop widths verify that
an unsaved dummy URL disappears on reopen without any write request.

MCP 11.13.0 and JSON API 3.2.0 are unchanged. This changes local editor state,
not server settings, tools, schema or infrastructure; tool acceptance is
not required. No sibling change is needed.
