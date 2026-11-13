import { PageHead as KitHead, Stat, Stats, TagText } from "@elixir-mcp/ui";

/**
 * A page's own head under the clan's (`ClanHead`, whose h1 is the clan's name):
 * its title as an h2, one lede, how fresh its read is on the right. `children`
 * sit under the lede. There is no breadcrumb: the tabs say where you are, and
 * a page one level down carries its own back link.
 */
export function PageHead({ title, lede, fresh, children }) {
  return (
    <KitHead
      as="h2"
      title={<TagText>{title}</TagText>}
      sub={lede}
      aside={fresh}
    >
      {children}
    </KitHead>
  );
}

/** One number with its label, the canvas's tile: a count the record
 *  returned, never a derived score. `of` is the whole it is out of. */
export function Tile({ label, value, of, hint, tone }) {
  return <Stat label={label} value={value} of={of} note={hint} tone={tone} />;
}

/** The row of tiles under a page's head. */
export function Tiles({ children, label }) {
  return (
    <Stats className="fact-strip" label={label}>
      {children}
    </Stats>
  );
}
