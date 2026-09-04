import { useState } from "react";
import { marked } from "marked";
import about from "../docs/about.md?raw";
import privacy from "../docs/privacy.md?raw";
import terms from "../docs/terms.md?raw";
import architecture from "../docs/architecture.md?raw";

const PAGES = [
  { id: "about", title: "About", md: about },
  { id: "privacy", title: "Privacy", md: privacy },
  { id: "terms", title: "Terms", md: terms },
  { id: "architecture", title: "Architecture", md: architecture },
];

export function Docs() {
  const [page, setPage] = useState(PAGES[0]);
  return (
    <div className="docs">
      <nav className="panel docs-toc" aria-label="Documentation">
        <h3>Documentation</h3>
        <ul>
          {PAGES.map((p) => (
            <li key={p.id}>
              <button
                className={p.id === page.id ? "tab active" : "tab"}
                onClick={() => setPage(p)}
              >
                {p.title}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article
        className="panel docs-body"
        // Our own repo-reviewed markdown, no user content.
        dangerouslySetInnerHTML={{ __html: marked.parse(page.md) }}
      />
    </div>
  );
}
