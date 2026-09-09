import pg from "pg";

/** Gateway provisioning ({gateway_provision: {name, iam_user_name,
 *  env}}): stores the owner-minted one-time config for the operator's
 *  web download (0034). The env content passes through as an opaque
 *  string - this op never logs it. */
export async function gatewayProvision(databaseUrl, spec) {
  if (!spec?.name || !spec?.env) {
    throw new Error("gateway_provision needs name and env");
  }
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: found } = await db.query(
      `select gateway_id from gateway where name = $1 and status <> 'revoked'`,
      [String(spec.name)],
    );
    if (!found[0]) throw new Error(`no live gateway named ${spec.name}`);
    const env = String(spec.env).replaceAll(
      "__GATEWAY_ID__",
      found[0].gateway_id,
    );
    const { rows } = await db.query(
      `update gateway
       set provision_env = $2, iam_user_name = $3, provision_claimed_at = null,
           provision_expires_at = now() + interval '72 hours'
       where gateway_id = $1
       returning gateway_id, name`,
      [found[0].gateway_id, env, spec.iam_user_name ?? null],
    );
    return { gateway_id: rows[0].gateway_id, name: rows[0].name, staged: true };
  } finally {
    await db.end();
  }
}

/** Zero-trust collector ops (COLLECTOR-ZERO-TRUST.md).
 *  {collector_token: {name, token_hash, channel?}} stores the sha256 of
 *  a LOCALLY generated token (the raw token never reaches the cloud in
 *  plaintext) and optionally sets the channel; {collector_release:
 *  {platform, version, sha256, url}} sets the update authority the
 *  config endpoint serves. */
export async function collectorTokenOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (!/^[0-9a-f]{64}$/.test(spec?.token_hash ?? "")) {
      return { error: "token_hash must be sha256 hex" };
    }
    const sets = ["token_hash = $2"];
    const params = [spec.name, spec.token_hash];
    if (spec.channel) {
      if (!["bulk", "live"].includes(spec.channel))
        return { error: "channel must be bulk or live" };
      params.push(spec.channel);
      sets.push(`channel = $${params.length}`);
    }
    const { rows } = await db.query(
      `update gateway set ${sets.join(", ")}
       where name = $1 and status <> 'revoked'
       returning gateway_id, name, channel, status`,
      params,
    );
    return rows[0] ? { ok: true, gateway: rows[0] } : { error: "not_found" };
  } finally {
    await db.end();
  }
}

export async function collectorReleaseOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { platform, version, sha256, url } = spec ?? {};
    if (!platform || !version || !/^[0-9a-f]{64}$/.test(sha256 ?? "") || !url) {
      return { error: "platform, version, sha256 (hex), url required" };
    }
    await db.query(
      `insert into collector_release (platform, version, sha256, url)
       values ($1, $2, $3, $4)
       on conflict (platform) do update set
         version = excluded.version, sha256 = excluded.sha256,
         url = excluded.url, updated_at = now()`,
      [platform, version, sha256, url],
    );
    return { ok: true, platform, version };
  } finally {
    await db.end();
  }
}
