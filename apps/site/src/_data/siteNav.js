/**
 * The static site's own pages: the row under the top bar, and the
 * footer at the end of every page (canvas 2026-09-29).
 *
 * The top bar holds PLACES - Console, Ladder, Clan, Docs, the game - and
 * is the kit's, read from packages/ui/src/family.json (`familyBar`). The
 * site's pages are not places, so they left the bar and live here, in
 * the site, beside the templates that draw them. base.njk loops over
 * this list and holds no page or label of its own; a test pins that.
 *
 * `key` is the `navActive` a page names to light its item. Family is
 * not on the menu (Jamie, 2026-09-29): its pages are still built, and
 * nothing links them from here.
 */
export default {
  /** The row under the bar, left to right. */
  pages: [
    { key: "home", label: "Home", path: "/" },
    { key: "data", label: "Data", path: "/data" },
    { key: "examples", label: "Examples", path: "/examples/play" },
    { key: "updates", label: "Updates", path: "/updates" },
    { key: "support", label: "Support", path: "/support" },
  ],
  /** The footer: what Elixir is, under the logo... */
  tagline: "Your Clash Royale record. Free and sponsor-supported.",
  /** ...then its columns. The places column is the bar's products, so it
   *  is drawn from the manifest rather than listed here. */
  footer: {
    elixir: {
      label: "Elixir",
      links: [
        { label: "Docs", path: "/docs" },
        { label: "Updates", path: "/updates" },
        { label: "Data", path: "/data" },
        { label: "Support", path: "/support" },
      ],
    },
    places: { label: "Places" },
    policy: {
      label: "Policy",
      links: [
        { label: "Roles and tiers", path: "/docs/roles" },
        { label: "Privacy", path: "/docs/privacy" },
        { label: "Terms", path: "/docs/terms" },
      ],
    },
  },
};
