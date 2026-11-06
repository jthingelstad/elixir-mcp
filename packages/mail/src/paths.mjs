/**
 * Where mail sends a reader in Settings, in one place (structure, Mail links
 * and footer). The old addresses redirect for good, so what is already in an
 * inbox keeps working.
 */
export const MAIL_SITE = "https://elixir.poapkings.com";

export const MAIL_PATHS = {
  emails: `${MAIL_SITE}/settings/emails`,
  players: `${MAIL_SITE}/settings/players`,
  collectors: `${MAIL_SITE}/settings/collectors`,
  record: (sendId) =>
    `${MAIL_SITE}/settings/emails/${encodeURIComponent(sendId)}`,
  report: (sendId) =>
    `${MAIL_SITE}/settings/emails/${encodeURIComponent(sendId)}?report=1`,
  feedback: (id) => `${MAIL_SITE}/settings/feedback/${encodeURIComponent(id)}`,
};
