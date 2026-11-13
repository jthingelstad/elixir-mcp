import { test, expect } from "vitest";
import { CHAT_MAX, chatWarnings } from "@elixir-mcp/clan-engine/chat";
import {
  INVITE_CHANNELS,
  INVITE_EVENT,
  SIGNUP_URL,
  SITE,
  clanChatLine,
  clanMessage,
} from "../src/lib/invite.js";

/**
 * Bring your clanmates: the clan-chat line must survive the game's chat
 * filter (the rules Elixir Clan learned in production, clan-engine
 * chat.mjs) and its 200 characters, whatever the clan is called; and no
 * invite carries a referral code, invite id or tracking parameter.
 */

// The game caps a clan name well under this; a longer one proves the
// fallback rather than a clipped line.
const LONGEST = "W".repeat(15);

test("the clan-chat line passes the chat filter at the longest clan name, and names the site", () => {
  for (const name of [
    "POAP KINGS",
    LONGEST,
    "Kings-Hall & Co",
    "+44 phone club",
    "Moon Ox!",
    null,
  ]) {
    const line = clanChatLine(name);
    expect(line.length, line).toBeLessThanOrEqual(CHAT_MAX);
    expect(chatWarnings(line), line).toEqual([]);
    expect(line.endsWith(SITE), line).toBe(true);
    expect(line).toMatch(/free/i);
    expect(line).toMatch(/Unofficial/);
  }
  expect(clanChatLine("POAP KINGS")).toContain("the POAP KINGS week");
  expect(clanChatLine(LONGEST)).toContain(`the ${LONGEST} week`);
  // The filter's rewrites reach the name too.
  expect(clanChatLine("Kings-Hall & Co")).toContain("Kings Hall and Co");
  expect(clanChatLine(null)).toContain("plus our clan's week");
});

test("a clan name too long for the game's 200 characters becomes our clan's week, never a clipped line", () => {
  const line = clanChatLine("N".repeat(60));
  expect(line.length).toBeLessThanOrEqual(CHAT_MAX);
  expect(line).toContain("plus our clan's week");
  expect(line.endsWith(SITE)).toBe(true);
});

test("the message names the clan, tells the digest, and says unofficial", () => {
  const m = clanMessage("POAP KINGS");
  expect(m).toContain("the POAP KINGS week comes in your digest");
  expect(m).toContain("missing social layer of Clash Royale");
  expect(m).toMatch(/unofficial fan project, not endorsed by Supercell/);
  expect(clanMessage(null)).toContain("our clan's week comes in your digest");
});

test("the invite link is the canonical signup, with no referral or tracking parameter", () => {
  expect(SIGNUP_URL).toBe("https://elixir.poapkings.com/signin?signup");
  const url = new URL(SIGNUP_URL);
  expect([...url.searchParams.keys()]).toEqual(["signup"]);
});

test("a copy is one aggregate event whose value is a channel, never a tag, a person or a URL", () => {
  expect(INVITE_EVENT).toBe("console.invite_copied");
  expect(Object.values(INVITE_CHANNELS).sort()).toEqual([
    "chat",
    "message",
    "share",
  ]);
  for (const v of Object.values(INVITE_CHANNELS)) expect(v).toMatch(/^[a-z]+$/);
});
