# 2026-11-12 — Settings tests: the lazy chunk compiles before the wait

In one full `npm test` on a host at load average about 25, the whole-App
tests for Settings › Emails (`email-page`), What members see (`seen`)
and Timeline to Discord (`timeline-discord`) failed: the page's heading
did not appear within Testing Library's 5 s wait.

The cause was not the page. Settings is a lazy route chunk
(`lazyRouteComponent(() => import("./pages/SettingsPage.jsx"))`), so the
first test in each file paid for compiling Settings' whole module graph
through Vite inside its wait for first paint. Measured with the host
loaded by 30 busy processes, the first paint of `/settings/emails` took
855 to 1,004 ms cold and 318 to 431 ms with the chunk already imported:
the compile was most of it, and it grows with load, while the render
does not grow nearly as fast.

Each whole-App test file that opens a Settings page (`email-page`,
`seen`, `timeline-discord`, `profile`, `discord`, `verify`) now imports
`src/pages/SettingsPage.jsx` at its top. The compile happens while the
file loads, where nothing is bounded, and the lazy route resolves from
the module cache, so the 5 s wait measures only the render and the mocked
reads. No timeout was raised. Tests only; nothing ships.
