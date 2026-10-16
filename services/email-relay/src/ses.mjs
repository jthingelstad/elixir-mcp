/**
 * SES send from elixir@poapkings.com (2026-09-16), the relay's only
 * transport; receiving stays at Fastmail.
 * One SESv2 SendEmail per message through the stack's configuration set,
 * which is what routes bounces and complaints to the ops queue; open and
 * click are not in that set's event list, so nothing is added to the body
 * and no link is rewritten. The client is injectable for the test; in the
 * Lambda it is the runtime's SDK v3.
 *
 * multipart/alternative here too: SES builds it from Text + Html, and a
 * client that will not render HTML must still read a sign-in code.
 */

export function makeSesSender({
  fromEmail,
  configurationSet,
  fromName = "Elixir",
  client = null,
}) {
  let sdk; // { client, SendEmailCommand }, resolved on first send
  async function api() {
    if (sdk) return sdk;
    const { SESv2Client, SendEmailCommand } =
      await import("@aws-sdk/client-sesv2");
    sdk = {
      client: client ?? new SESv2Client({}),
      // Upgrade receipts need one attempt: SES has no idempotency key,
      // so SDK retries can repeat an ambiguously accepted request.
      singleAttemptClient: client ?? new SESv2Client({ maxAttempts: 1 }),
      SendEmailCommand,
    };
    return sdk;
  }

  /** `headers` are extra RFC 5322 headers (the one-click unsubscribe pair
   *  on a bulk kind); empty for transactional mail, which is every kind
   *  today. */
  return async function send({
    to,
    subject,
    text,
    html = null,
    headers = [],
    singleAttempt = false,
  }) {
    const {
      client: normal,
      singleAttemptClient,
      SendEmailCommand,
    } = await api();
    const ses = singleAttempt ? singleAttemptClient : normal;
    const out = await ses.send(
      new SendEmailCommand({
        FromEmailAddress: `${fromName} <${fromEmail}>`,
        Destination: { ToAddresses: [to] },
        ConfigurationSetName: configurationSet,
        Content: {
          Simple: {
            ...(headers.length
              ? {
                  Headers: headers.map((h) => ({
                    Name: h.name,
                    Value: h.value,
                  })),
                }
              : {}),
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: text, Charset: "UTF-8" },
              ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}),
            },
          },
        },
      }),
    );
    return { sent: true, message_id: out?.MessageId ?? null };
  };
}

/**
 * The account-level suppression list, asked before a send (2026-10-16):
 * SES adds an address on a hard bounce or a complaint (the
 * configuration set's SuppressionOptions) and then refuses to deliver to
 * it, but it still accepts the send and answers each one with an
 * OnAccountSuppressionList bounce to the ops queue: five in a week from
 * one address on the 09:00 CT mail. Returns the reason (BOUNCE or
 * COMPLAINT) or null when the address is not listed; any other answer
 * throws, and the caller sends as before.
 */
export function makeSuppressionCheck({ client = null } = {}) {
  let sdk;
  async function api() {
    if (sdk) return sdk;
    const { SESv2Client, GetSuppressedDestinationCommand } =
      await import("@aws-sdk/client-sesv2");
    sdk = {
      client: client ?? new SESv2Client({ maxAttempts: 2 }),
      GetSuppressedDestinationCommand,
    };
    return sdk;
  }
  return async function suppressed(to) {
    const { client: ses, GetSuppressedDestinationCommand } = await api();
    try {
      const out = await ses.send(
        new GetSuppressedDestinationCommand({ EmailAddress: to }),
      );
      return out?.SuppressedDestination?.Reason ?? "SUPPRESSED";
    } catch (err) {
      if (err?.name === "NotFoundException") return null;
      throw err;
    }
  };
}
