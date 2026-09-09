/**
 * The owner_notify message, one shape for every producer (the site API and
 * the MCP door both enqueue it). Everything Jamie reads in the mail comes
 * from here: the kind picks the subject in the relay, the note is one
 * sentence, detail is short labelled facts, link is where to act.
 *
 * Never an email address and never a whole message: a feedback excerpt is
 * capped, and the sender is an agent's public id or the first eight hex of
 * the email hash - enough to find them in the console, nothing more.
 */

const SITE = "https://elixir.poapkings.com";
const EXCERPT = 300;

const ownerAddress = () =>
  process.env.OWNER_NOTIFY_EMAIL || "elixir@poapkings.com";

/** Who, without saying who: an agent's public id, else 8 hex of the hash. */
export function senderRef(account) {
  if (account?.publicId) return `agent ${account.publicId}`;
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
    case "access_request":
      return {
        ...base,
        note: `New access request${spec.playerTag ? ` from ${spec.playerTag}` : ""}.`,
        link: `${SITE}/admin`,
      };
    case "feedback":
      return {
        ...base,
        note: excerpt(spec.message),
        detail: {
          category: String(spec.category ?? "general"),
          surface: String(spec.surface ?? "web"),
          from: spec.from ?? "an account",
          ...(spec.feedbackId ? { feedback_id: String(spec.feedbackId) } : {}),
        },
        link: `${SITE}/admin`,
      };
    case "role_upgrade_request":
      return {
        ...base,
        note: `${spec.from ?? "An account"} asked for ${spec.requestedRole} (currently ${spec.currentRole ?? "member"}).${spec.reason ? ` Their note: ${excerpt(spec.reason)}` : ""}`,
        detail: {
          requested_role: String(spec.requestedRole),
          current_role: String(spec.currentRole ?? "member"),
          from: spec.from ?? "an account",
        },
        link: `${SITE}/admin`,
      };
    case "gateway_request":
      return {
        ...base,
        note: `Gateway raise-hand: "${spec.playerTag}". Provision a collector token in Admin (docs/OPERATORS.md).`,
        link: `${SITE}/admin`,
      };
    case "gateway_quarantined":
      return {
        ...base,
        note: `Collector "${spec.playerTag}" QUARANTINED: too many leases expired unsubmitted; now draining.`,
        link: `${SITE}/admin`,
      };
    case "approved_welcome":
      return {
        ...base,
        note: `Account approved (${String(spec.emailHash ?? "").slice(0, 8)}).`,
        link: `${SITE}/admin`,
      };
    default:
      return {
        ...base,
        notify_kind: undefined,
        note: String(spec.note ?? kind),
      };
  }
}
