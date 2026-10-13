import pg from "pg";

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
          const acquired = await pool.connect();
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
