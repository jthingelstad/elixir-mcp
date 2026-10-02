/**
 * The docs' groups, in the order the rail, the docs home, llms.txt and
 * the MCP corpus (`elixir_docs`) show them. The ONE copy: the site's
 * config (apps/site/eleventy.config.mjs) and the corpus build
 * (packages/docs/build.mjs) both import this file, and both refuse a
 * page whose `section` is not a key here.
 *
 * Grouped by what a person came to do (2026-09-29, Jamie: the docs
 * "were heavily based on Elixir MCP as a product"), not by how the
 * service is built. A page names its group in front matter as
 * `section: <key>`, and `order` sorts it within the group. A group with
 * no pages is left out of every listing, so a group can be named here
 * before its pages exist.
 *
 * `icon` is a Lucide name, drawn beside the group in the rail.
 */
export default [
  { key: "start", label: "Start", icon: "compass" },
  { key: "ladder", label: "Ladder", icon: "chart-line" },
  { key: "clan", label: "Clan", icon: "users" },
  { key: "friends", label: "Friends and emails", icon: "heart" },
  { key: "agent", label: "Your AI agent", icon: "bot" },
  { key: "record", label: "The record", icon: "library" },
  { key: "build", label: "Build on Elixir", icon: "code" },
  { key: "policy", label: "Policy", icon: "shield" },
];
