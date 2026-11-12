/**
 * Where arriving at a clan lands: its Feed, for everyone (A12, replacing the
 * 2026-10-20 rule that sent a member to the roster; Today became Feed with
 * Clan as one view, 2026-11-12). Actions waiting for you are at the top of
 * the Feed, with nothing to redirect.
 */
import { clanPath } from "./base.js";

export const landingPath = (me, clanTag = me?.selected?.clan_tag) =>
  `${clanPath(clanTag)}/feed`;
