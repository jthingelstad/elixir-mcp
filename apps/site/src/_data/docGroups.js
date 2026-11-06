/**
 * The docs' groups, in the order the rail, the docs home, llms.txt and
 * the MCP corpus (`elixir_docs`) show them. The ONE copy: the site's
 * config (apps/site/eleventy.config.mjs) and the corpus build
 * (packages/docs/build.mjs) both import this file, and both refuse a
 * page whose `section` is not a key here.
 *
 * Three parents, by what a person came to do: use Elixir, connect an AI,
 * or build on it and look something up (redesign step 7, the DDocs board).
 * A page names its sub-group in front matter as `section: <key>`, and
 * `order` sorts it within the sub-group. `top` is the parent. A group with
 * no pages is left out of every listing.
 *
 * `icon` is a Lucide name.
 */
export const DOC_TOPS = [
  { key: "use", label: "Use Elixir", icon: "user" },
  { key: "connect", label: "Connect an AI", icon: "bot" },
  { key: "reference", label: "Build & reference", icon: "library" },
];

export default [
  { key: "start", label: "Start", icon: "compass", top: "use" },
  { key: "ladder", label: "Ladder", icon: "chart-line", top: "use" },
  { key: "clan", label: "Clan", icon: "users", top: "use" },
  { key: "friends", label: "Friends and emails", icon: "heart", top: "use" },
  { key: "policy", label: "Account and policy", icon: "shield", top: "use" },
  { key: "connect", label: "Connect", icon: "bot", top: "connect" },
  { key: "record", label: "The record", icon: "library", top: "reference" },
  { key: "tools", label: "Tools", icon: "wrench", top: "reference" },
  { key: "protocol", label: "Protocol", icon: "cable", top: "reference" },
  { key: "build", label: "Build", icon: "code", top: "reference" },
];
