/** Linking and signing in with Discord (#531). Both are browser
 *  navigations to the API, which ends every outcome with a redirect back
 *  to the page that asked, carrying `?discord=<outcome>`. */

/** Where a "Continue with Discord" or "Connect Discord" link goes. A
 *  sign-in carries what the email form would: the browser's zone and the
 *  product-news box, used only if the sign-in opens a new account. */
export function discordStartHref({ intent, zone = null, news = false }) {
  const q = new URLSearchParams({ intent });
  if (intent === "signin") {
    if (zone) q.set("tz", zone);
    if (news) q.set("news", "1");
  }
  return `/api/auth/discord/start?${q}`;
}

const SHARED = {
  unavailable: "Discord isn’t available right now.",
  limited: "Too many Discord tries from here. Wait a little and try again.",
  cancelled: "Discord was cancelled; nothing changed.",
  failed: "Discord didn’t let Elixir in. Try again.",
  slow: "Discord was slow to answer. Try again.",
};

const SIGNIN = {
  ...SHARED,
  unavailable: "Discord sign-in isn’t available right now. Use your email.",
  expired:
    "That Discord sign-in expired or finished in another browser. Try again.",
  no_email:
    "Your Discord account has no verified email. Sign in with your email, then connect Discord from your profile.",
  other:
    "The Elixir account for that email is connected to a different Discord account. Sign in with your email.",
  not_approved: "This account can’t sign in.",
};

const LINK = {
  ...SHARED,
  linked: "Discord connected.",
  taken: "That Discord account is already connected to another Elixir account.",
  expired: "That took too long, or you signed in again meanwhile. Try again.",
};

/** What `?discord=` says on the page it came back to, or null. */
export function discordOutcome(search, intent) {
  const outcome = new URLSearchParams(search).get("discord");
  if (!outcome) return null;
  const text = (intent === "link" ? LINK : SIGNIN)[outcome];
  return text ? { outcome, text, ok: outcome === "linked" } : null;
}
