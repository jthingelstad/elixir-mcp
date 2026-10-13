import { renderToString } from "react-dom/server";
import { App, createAppRuntime } from "./App.jsx";

/** All state is request-local. No account query data survives this call. */
export async function renderApp({ url, me, clanMe, renderedAt }) {
  const runtime = createAppRuntime({ url, me, clanMe, renderedAt });
  try {
    // Complete cold route chunks and redirects before rendering a document.
    // An interactive load may publish pending UI before its chunks settle.
    await runtime.router.load({ sync: true });
    return renderToString(<App runtime={runtime} />);
  } finally {
    runtime.queryClient.clear();
  }
}
