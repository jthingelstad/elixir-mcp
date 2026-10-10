/** The webhook, sealed: as the database keeps it and the outbox carries
 *  it. Clan's box (AES-256-GCM under a key derived from the app's sealing
 *  secret for this use only) is handed in by the two services that hold
 *  the secret: the web API seals a webhook when it is saved, and the
 *  relay opens it to post. The sync, in the VPC, only copies it. */

/** The derivation purpose, distinct from every Clan box's. */
export const WEBHOOK_PURPOSE = "timeline discord webhook v1";

/** Bound to the account: a box copied onto another account opens to
 *  nothing. */
const aad = (accountId) => `timeline-discord|${accountId}`;

/**
 * @param {{ seal: (plain: string, aad: string) => object,
 *           open: (box: object, aad: string) => string | null }} box
 */
export function webhookSeal(box) {
  return {
    seal: (url, accountId) => box.seal(url, aad(accountId)),
    open: (sealed, accountId) => box.open(sealed, aad(accountId)),
  };
}
