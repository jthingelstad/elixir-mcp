/**
 * Comments' fixed words and lists (2026-11-16), away from the drawing so a
 * test can pin them. The server's lists are services/web-api/src
 * comments.mjs (REPORT_REASONS, SETTINGS) and comment-filter.mjs
 * (COMMENT_MAX); these follow them.
 */

/** The most a comment may say, in characters. */
export const COMMENT_MAX = 280;

/** Why a comment is reported, in the order the form offers them. */
export const REPORT_REASONS = [
  { key: "bullying", label: "Bullying or mean" },
  { key: "hate", label: "Hate" },
  { key: "threat", label: "A threat" },
  { key: "sexual", label: "Sexual" },
  { key: "self_harm", label: "Self-harm" },
  { key: "personal_info", label: "Personal info" },
  { key: "spam", label: "Spam" },
  { key: "other", label: "Something else" },
];

/** Who may comment on your play: the setting's three answers. */
export const COMMENT_WHO = [
  { key: "followers", label: "People who follow you" },
  { key: "following", label: "People you follow" },
  { key: "nobody", label: "Nobody" },
];

/** The thread's way in: "Comments" when the count is not known (a page's
 *  item), else how many there are. */
export function commentsCountLabel(count) {
  if (count == null) return "Comments";
  if (count === 0) return "Comments";
  return count === 1 ? "See 1 comment" : `See all ${count} comments`;
}
