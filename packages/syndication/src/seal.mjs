/** The webhook, sealed: as the database keeps it and the outbox carries
 *  it. Clan's box (AES-256-GCM under a key derived from the app's sealing
 *  secret for this use only) is handed in by the two services that hold
 *  the secret: the web API seals a webhook when it is saved, and the
 *  relay opens it to post. The sync, in the VPC, only copies it. */

/** The derivation purpose, distinct from every Clan box's. */
export const WEBHOOK_PURPOSE = "timeline discord webhook v1";
/** A clan's activity channel (Clan Settings, Social): its own purpose,
 *  so neither kind of box opens as the other. */
export const CLAN_ACTIVITY_PURPOSE = "clan activity webhook v1";

/** Bound to the account (or a clan's channel): a box copied onto
 *  another opens to nothing. */
const aad = (accountId) => `timeline-discord|${accountId}`;
const clanAad = (channelId) => `clan-activity|${channelId}`;

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

/** A clan's activity webhook, bound to its channel id. */
export function clanActivitySeal(box) {
  return {
    seal: (url, channelId) => box.seal(url, clanAad(channelId)),
    open: (sealed, channelId) => box.open(sealed, clanAad(channelId)),
  };
}
