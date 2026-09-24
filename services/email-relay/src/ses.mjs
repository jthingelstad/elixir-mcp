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
    sdk = { client: client ?? new SESv2Client({}), SendEmailCommand };
    return sdk;
  }

  /** `headers` are extra RFC 5322 headers (the one-click unsubscribe pair
   *  on a bulk kind); empty for transactional mail, which is every kind
   *  today. */
  return async function send({ to, subject, text, html = null, headers = [] }) {
    const { client: ses, SendEmailCommand } = await api();
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
