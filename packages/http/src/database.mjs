import pg from "pg";

/** A new connection that never opened: pg-pool's own words when the
 *  socket, TLS and auth outlive connectionTimeoutMillis, or the network
 *  refusing it. Not a full pool ("timeout exceeded when trying to
 *  connect"): waiting longer behind busy clients would only queue. */
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"]);
function connectFailedToOpen(error) {
  return (
    /Connection terminated due to connection timeout/.test(
      String(error?.message ?? ""),
    ) || NETWORK_CODES.has(error?.code)
  );
}

/** A process-local pool; a lease belongs to one request until cleanup completes.
 * Never return an abandoned query/transaction to another request. */
export function makeDatabase({ connectionString, max = 4, pool = null }) {
  pool ??= new pg.Pool({
    connectionString,
    max,
    allowExitOnIdle: true,
    connectionTimeoutMillis: 2500,
    idleTimeoutMillis: 30_000,
    maxLifetimeSeconds: 300,
  });
  pool.on("error", (error) =>
    console.error({ event: "db_pool_error", name: error.name }),
  );
  return {
    close: () => pool.end(),
    lease() {
      let client;
      let closed = false;
      let pending = 0;
      let failed = false;
      let prepared = false;
      return {
        async connect() {
          // One more try for a connection that never opened (2026-10-16):
          // each revision flip on 10-13 cost about ten requests 2.5 s
          // and a 5xx while fresh environments opened their first
          // connections at once. A second try is bounded (one, so at
          // most twice connectionTimeoutMillis) and sits inside every
          // door's own deadline.
          let acquired;
          try {
            acquired = await pool.connect();
          } catch (error) {
            if (closed || !connectFailedToOpen(error)) throw error;
            console.error({ event: "db_connect_retry", name: error.name });
            acquired = await pool.connect();
          }
          if (closed) {
            acquired.release(true);
            throw new Error("database lease expired while waiting");
          }
          client = acquired;
        },
        async query(...args) {
          if (closed || !client) throw new Error("database lease is not open");
          prepared ||= Boolean(args[0]?.name);
          pending++;
          try {
            return await client.query(...args);
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            pending--;
          }
        },
        async end() {
          closed = true;
          if (!client) return;
          const owned = client;
          client = null;
          if (pending || failed || prepared) {
            owned.release(true);
            return;
          }
          try {
            // DISCARD ALL requires no transaction. It also releases session
            // advisory locks and resets SET settings/temporary objects.
            await owned.query("ROLLBACK");
            await owned.query("DISCARD ALL");
            owned.release();
          } catch {
            owned.release(true);
          }
        },
      };
    },
  };
}
