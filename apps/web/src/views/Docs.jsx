import { marked } from "marked";
import about from "../docs/about.md?raw";
import privacy from "../docs/privacy.md?raw";
import terms from "../docs/terms.md?raw";
import architecture from "../docs/architecture.md?raw";
import tools from "../docs/tools.md?raw";
import roles from "../docs/roles.md?raw";

const PAGES = [
  { id: "about", title: "About", md: about },
  { id: "privacy", title: "Privacy", md: privacy },
  { id: "terms", title: "Terms", md: terms },
  { id: "tools", title: "Tools", md: tools },
  { id: "roles", title: "Roles", md: roles },
  { id: "architecture", title: "Architecture", md: architecture },
];

export function Docs({ page: slug, navigate }) {
  // URL-addressable (/docs/<id>); unknown or missing slug lands on About.
  const page = PAGES.find((p) => p.id === slug) ?? PAGES[0];
  return (
    <div className="docs">
      <nav className="panel docs-toc" aria-label="Documentation">
        <h3>Documentation</h3>
        <ul>
          {PAGES.map((p) => (
            <li key={p.id}>
              <button
                className={p.id === page.id ? "tab active" : "tab"}
                onClick={() => navigate(`/docs/${p.id}`)}
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
