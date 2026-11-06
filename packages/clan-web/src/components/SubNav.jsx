/**
 * A tab's row of pages, under the tabs: real links, so each page has its own
 * address, Back works and the row reads the same with or without scripts.
 */
export function SubNav({ label, items, current, navigate, aside }) {
  return (
    <div className="clan-subnav">
      <nav aria-label={label} className="clan-subnav__links">
        {items.map((i) => (
          <a
            key={i.key}
            className="clan-subnav__link"
            href={i.to}
            aria-current={current === i.key ? "page" : undefined}
            onClick={(e) => {
              if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey) return;
              e.preventDefault();
              navigate(i.to);
            }}
          >
            {i.label}
            {i.count ? (
              <span className="clan-subnav__count">{i.count}</span>
            ) : null}
          </a>
        ))}
      </nav>
      {aside ? <div className="clan-subnav__aside">{aside}</div> : null}
    </div>
  );
}
