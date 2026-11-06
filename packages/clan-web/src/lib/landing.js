/**
 * Where arriving at a clan lands: Today, for everyone (A12, replacing the
 * 2026-10-20 rule that sent a member to the roster). A leader with Actions
 * waiting finds them at the top of Today, with nothing to redirect.
 */
import { clanPath } from "./base.js";

export const landingPath = (me, clanTag = me?.selected?.clan_tag) =>
  `${clanPath(clanTag)}/today`;
