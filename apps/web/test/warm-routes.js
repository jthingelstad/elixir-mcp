/**
 * Every lazy route chunk App.jsx can load, imported up front.
 *
 * A whole-App test that renders a route waits for its lazy chunk, and in
 * vitest that chunk is transformed and evaluated on first import: inside
 * the test's own timeout and inside the first findBy's wait. On a loaded
 * host (load average about 42, several verify runs at once, 2026-11-13)
 * that compile was most of a first paint and outran the waits. Imported
 * from a test file's top level instead, the graph compiles while the file
 * loads, where no wait is bounded, and the route's import() then resolves
 * from the module cache. Import this from any test that renders <App />.
 */
import "../src/pages/SettingsPage.jsx";
import "../src/pages/AdminPage.jsx";
import "../src/pages/LadderPage.jsx";
import "../src/pages/HomePage.jsx";
import "../src/views/Battle.jsx";
import "../src/views/Post.jsx";
import "../src/home/Find.jsx";
import "../src/home/You.jsx";
import "../src/home/Player.jsx";
import "../src/home/FollowMe.jsx";
import "../src/clan/App.jsx";
