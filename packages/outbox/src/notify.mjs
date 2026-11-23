/**
 * The owner_notify message, one shape for every producer (the site API and
 * the MCP door both enqueue it). Everything Jamie reads in the mail comes
 * from here: the kind picks the subject in the relay, the note is one
 * sentence, detail is short labelled facts, link is where to act.
 *
 * Never an email address and never a whole message: a feedback excerpt is
 * capped, and the sender is the first eight hex of the email hash - enough
 * to find them in the console, nothing more.
 */

const SITE = "https://elixir.poapkings.com";
const EXCERPT = 300;

const ownerAddress = () =>
  process.env.OWNER_NOTIFY_EMAIL || "elixir@poapkings.com";

/** Who, without saying who: 8 hex of the email hash. */
export function senderRef(account) {
  if (account?.emailHash)
    return `account ${String(account.emailHash).slice(0, 8)}`;
  return "an account";
}

function excerpt(text) {
  const one = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return one.length > EXCERPT ? `${one.slice(0, EXCERPT)}…` : one;
}

export function ownerNotifyMessage(spec) {
  const { kind } = spec;
  const base = {
    v: 1,
    kind: "owner_notify",
    to: ownerAddress(),
    notify_kind: kind,
  };
  switch (kind) {
    case "feedback":
      return {
        ...base,
        note: excerpt(spec.message),
        detail: {
          category: String(spec.category ?? "general"),
          surface: String(spec.surface ?? "web"),
          ...(spec.area ? { area: String(spec.area) } : {}),
          from: spec.from ?? "an account",
          ...(spec.feedbackId ? { feedback_id: String(spec.feedbackId) } : {}),
        },
        link: `${SITE}/settings/admin/feedback`,
      };
    case "gateway_request": {
      // A member's raise waits for the owner (2026-11-23): the notice asks
      // for the decision and opens the collector's own page, where the
      // Operations panel approves or revokes it. The owner's own raise
      // starts on probation and needs no decision.
      const page = `${SITE}/settings/collectors/${encodeURIComponent(spec.card ?? spec.playerTag)}`;
      return {
        ...base,
        note:
          spec.status === "probation"
            ? `Collector enrolled: "${spec.playerTag}". It is yours, so it starts on probation with its token staged.`
            : `Collector request: "${spec.playerTag}" is waiting for your decision. Approve it to let it fetch, or revoke it. It leases nothing until you approve.`,
        ...(spec.card ? { detail: { card: String(spec.card) } } : {}),
        link: page,
      };
    }
    case "gateway_quarantined":
      return {
        ...base,
        note: `Collector "${spec.playerTag}" QUARANTINED: too many leases expired unsubmitted; now draining.`,
        link: `${SITE}/settings/admin/collectors`,
      };
    default:
      return {
        ...base,
        notify_kind: undefined,
        note: String(spec.note ?? kind),
      };
  }
}
