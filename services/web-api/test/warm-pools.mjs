/**
 * Open each web-api handler's whole pool before the tests run.
 *
 * A handler's pool opens connections lazily, on the request that first
 * finds none idle. Under a loaded host a new connection to a fresh
 * scratch database took 1.2 s (2026-11-13), inside a test's own wait,
 * and the doors give a connection 2.5 s to open (tried twice). Opening
 * them in setup keeps that cost out of every assertion that follows.
 *
 * `size` requests are sent at once, so none finds an idle client and each
 * opens one: the pool's max under test.mjs (DB_POOL_MAX), else the
 * handler's default of 4.
 */
export async function warmPools(
  handlers,
  size = Number(process.env.DB_POOL_MAX ?? 4),
) {
  await Promise.all(
    handlers.flatMap((handler) =>
      Array.from({ length: size }, () =>
        handler({ path: "/api/me", method: "GET", headers: {} }).then((r) => {
          if (r.statusCode !== 200)
            throw new Error(`warming the pool: GET /api/me ${r.statusCode}`);
        }),
      ),
    ),
  );
}
