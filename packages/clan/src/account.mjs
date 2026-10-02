/** Clan preferences belong to the authenticated Elixir account. Gate and
 * roster caches live only for this request; no token pair or second session
 * is persisted. Legacy player-keyed selection is read once as a fallback. */
export function createAccountContext({
  account,
  state,
  credential,
  login,
  logout,
}) {
  const id = `account#${account.accountId}`;
  let current = null;
  return {
    identity: {
      async load() {
        if (account.kind !== "person") return null;
        current ??= { id, ...((await state.get(id)) ?? {}) };
        return current;
      },
      credential(session) {
        return session === current ? credential : null;
      },
      login,
      logout,
    },
    store: {
      async updateSession(key, patch) {
        if (key !== id || !current) throw new Error("wrong Clan account");
        Object.assign(current, patch);
        // Reading a page can select the only clan and warm a roster cache;
        // neither is a durable write. Only explicit preference/notice actions
        // persist account state.
        if (!Object.hasOwn(patch, "verifyAck")) return;
        const durable = { pk: id };
        if (current.selected) durable.selected = current.selected;
        if (current.verifyAck) durable.verifyAck = current.verifyAck;
        await state.put(durable);
      },
      async getPreference(key) {
        if (key === id) return current?.selected ?? null;
        return state.get(`pref#${key}`);
      },
      async putPreference(key, value) {
        if (key !== id) throw new Error("wrong Clan account");
        current.selected = value;
        await state.put({
          pk: id,
          selected: value,
          ...(current.verifyAck ? { verifyAck: current.verifyAck } : {}),
        });
      },
      async deleteSession() {
        current = null;
      },
    },
  };
}
