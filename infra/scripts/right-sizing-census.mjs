/** Download cutoff-bound census pages into a private, resumable directory.
 * This invokes only the read-only census and never reads credentials. */
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, lstat, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha = (b) => createHash("sha256").update(b).digest("hex");

function validatePage(snapshot, lane, r, bytes, after) {
  if (
    r.readonly !== true ||
    r.snapshot_isolation !== "per_page" ||
    r.definition_sha256 !== snapshot.definition_sha256 ||
    r.schema_sha256 !== snapshot.schema_sha256 ||
    typeof r.cutoff_policy !== "string" ||
    r.snapshot_id !== snapshot.snapshot_id ||
    r.lane !== lane ||
    r.cutoff !== snapshot.cutoff ||
    r.receipt_high_water !== snapshot.receipt_high_water ||
    !/^[a-f0-9]{64}$/.test(r.sha256 ?? "") ||
    r.key !==
      `right-sizing/v1/${snapshot.snapshot_id}/${lane}/${r.sha256}.json` ||
    !Number.isInteger(r.rows) ||
    r.rows < 0 ||
    r.rows > 10000 ||
    r.done !== (r.next_after === null)
  )
    throw new Error("invalid census receipt");
  if (
    bytes.length > 5_000_000 ||
    bytes.length !== r.bytes ||
    sha(bytes) !== r.sha256
  )
    throw new Error("census page digest differs");
  const page = JSON.parse(bytes.toString("utf8"));
  if (
    page.version !== 1 ||
    page.snapshot_id !== snapshot.snapshot_id ||
    page.lane !== lane ||
    page.cutoff !== snapshot.cutoff ||
    page.receipt_high_water !== snapshot.receipt_high_water ||
    page.after !== after ||
    page.next_after !== r.next_after ||
    page.definition_sha256 !== r.definition_sha256 ||
    page.schema_sha256 !== r.schema_sha256 ||
    page.cutoff_policy !== r.cutoff_policy ||
    page.snapshot_isolation !== r.snapshot_isolation ||
    !Array.isArray(page.rows) ||
    page.rows.length !== r.rows
  )
    throw new Error("census page differs from receipt");
}
export async function collectCensus({
  snapshot,
  expectedLanes = snapshot.lanes,
  invoke,
  download,
  readSaved,
  save,
  progress = () => {},
}) {
  if (
    !/^[a-f0-9]{64}$/.test(snapshot.definition_sha256 ?? "") ||
    !Array.isArray(snapshot.lanes) ||
    JSON.stringify(snapshot.lanes) !== JSON.stringify(expectedLanes) ||
    !snapshot.lanes.length ||
    new Set(snapshot.lanes).size !== snapshot.lanes.length ||
    snapshot.lanes.some((n) => !/^\w+$/.test(n)) ||
    !Number.isInteger(snapshot.limit) ||
    snapshot.limit < 1 ||
    snapshot.limit > 10000 ||
    Object.keys(snapshot.pages).some((n) => !snapshot.lanes.includes(n))
  )
    throw new Error("invalid census checkpoint or lane coverage");
  for (const lane of snapshot.lanes) {
    snapshot.pages[lane] ??= [];
    const receipts = snapshot.pages[lane],
      seen = new Set();
    let after = null,
      terminal = false;
    for (const r of receipts) {
      if (terminal || !readSaved || !/^[a-f0-9]{64}$/.test(r.sha256 ?? ""))
        throw new Error("invalid saved census chain");
      const bytes = await readSaved(`${lane}-${r.sha256}.json`);
      validatePage(snapshot, lane, r, bytes, after);
      if (
        !r.done &&
        (typeof r.next_after !== "string" || seen.has(r.next_after))
      )
        throw new Error("census cursor repeated or missing");
      terminal = r.done;
      after = r.next_after;
      seen.add(after);
    }
    if (terminal) continue;
    for (;;) {
      let r;
      try {
        r = await invoke({
          lane,
          snapshot_id: snapshot.snapshot_id,
          cutoff: snapshot.cutoff,
          ...(snapshot.group === "admissions"
            ? { receipt_high_water: snapshot.receipt_high_water }
            : {}),
          after,
          limit: snapshot.limit,
          definition_sha256: snapshot.definition_sha256,
          schema_sha256: snapshot.schema_sha256,
        });
      } catch (error) {
        if (error.code !== "CENSUS_PAGE_TOO_LARGE" || snapshot.limit === 1)
          throw error;
        snapshot.limit = Math.max(1, Math.floor(snapshot.limit / 2));
        await save("checkpoint.json", Buffer.from(JSON.stringify(snapshot)));
        continue;
      }
      if (
        !r.done &&
        (typeof r.next_after !== "string" || seen.has(r.next_after))
      )
        throw new Error("census cursor repeated or missing");
      if (
        !/^[a-f0-9]{64}$/.test(r.sha256 ?? "") ||
        r.key !==
          `right-sizing/v1/${snapshot.snapshot_id}/${lane}/${r.sha256}.json` ||
        r.snapshot_id !== snapshot.snapshot_id ||
        r.rows > snapshot.limit
      )
        throw new Error("invalid census receipt");
      const bytes = await download(r.key);
      validatePage(snapshot, lane, r, bytes, after);
      await save(`${lane}-${r.sha256}.json`, bytes);
      receipts.push(r);
      await save("checkpoint.json", Buffer.from(JSON.stringify(snapshot)));
      progress({
        lane,
        pages: receipts.length,
        rows: receipts.reduce((n, p) => n + p.rows, 0),
        done: r.done,
      });
      if (r.done) break;
      seen.add(r.next_after);
      after = r.next_after;
    }
  }
  return {
    snapshot_id: snapshot.snapshot_id,
    cutoff: snapshot.cutoff,
    snapshot_isolation: "per_page",
    complete: true,
    lanes: Object.fromEntries(
      snapshot.lanes.map((lane) => [
        lane,
        {
          pages: snapshot.pages[lane].length,
          rows: snapshot.pages[lane].reduce((n, p) => n + p.rows, 0),
          cutoff_policy: snapshot.pages[lane][0]?.cutoff_policy,
        },
      ]),
    ),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.env.AWS_PROFILE !== "cloud-engineer")
    throw new Error("use AWS_PROFILE=cloud-engineer");
  const args = Object.fromEntries(
    process.argv.slice(2).map((x) => {
      const i = x.indexOf("=");
      if (
        i < 3 ||
        ![
          "--directory",
          "--cutoff",
          "--resume",
          "--limit",
          "--group",
          "--receipt-high-water",
        ].includes(x.slice(0, i))
      )
        throw new Error("unknown census argument");
      return [x.slice(2, i), x.slice(i + 1)];
    }),
  );
  if (!path.isAbsolute(args.directory ?? ""))
    throw new Error("census needs an absolute private directory");
  const group = args.group ?? "history";
  if (!["history", "references", "admissions"].includes(group))
    throw new Error("unknown census group");
  const options = { region: "us-east-1", maxAttempts: 1 };
  const sts = await new STSClient(options).send(
    new GetCallerIdentityCommand({}),
  );
  if (
    sts.Account !== "999153317627" ||
    !sts.Arn?.includes(
      "assumed-role/ProjectsCloudEngineer/projects-cloud-engineer",
    )
  )
    throw new Error("unexpected AWS caller");
  const lambda = new LambdaClient(options),
    s3 = new S3Client(options);
  const call = async (spec) => {
    const r = await lambda.send(
      new InvokeCommand({
        FunctionName: "elixir-mcp-migrate",
        InvocationType: "RequestResponse",
        Payload: Buffer.from(
          JSON.stringify({ right_sizing_census: { ...spec, group } }),
        ),
      }),
    );
    const p = JSON.parse(Buffer.from(r.Payload).toString("utf8"));
    if (r.FunctionError || p.error) {
      if (
        p.errorMessage ===
        "census page exceeds private size bound; reduce limit"
      )
        throw Object.assign(new Error("reduce census page size"), {
          code: "CENSUS_PAGE_TOO_LARGE",
        });
      throw new Error("read-only census invocation failed");
    }
    return p;
  };
  const listing = await call({});
  if (
    listing.readonly !== true ||
    !/^[a-f0-9]{64}$/.test(listing.definition_sha256 ?? "") ||
    !Array.isArray(listing.lanes) ||
    listing.lanes.some((n) => !/^\w+$/.test(n))
  )
    throw new Error("invalid lane inventory");
  const requestedLimit =
    args.limit === undefined ? undefined : Number(args.limit);
  if (
    requestedLimit !== undefined &&
    (!Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 10000)
  )
    throw new Error("limit is 1..10000");
  let snapshot;
  if (args.resume === "true") {
    const dir = await lstat(args.directory);
    if (
      !dir.isDirectory() ||
      (dir.mode & 0o777) !== 0o700 ||
      dir.uid !== process.getuid()
    )
      throw new Error("unsafe census directory");
    snapshot = JSON.parse(
      await readFile(path.join(args.directory, "checkpoint.json"), "utf8"),
    );
    if (args.cutoff && snapshot.cutoff !== args.cutoff)
      throw new Error("resume cutoff differs");
    if (
      args["receipt-high-water"] &&
      snapshot.receipt_high_water !== args["receipt-high-water"]
    )
      throw new Error("resume receipt ceiling differs");
    if ((snapshot.group ?? "history") !== group)
      throw new Error("resume group differs");
  } else {
    if (
      args.resume !== undefined ||
      !Number.isFinite(Date.parse(args.cutoff)) ||
      new Date(args.cutoff).toISOString() !== args.cutoff ||
      Date.parse(args.cutoff) > Date.now()
    )
      throw new Error("census needs a canonical past cutoff");
    await mkdir(args.directory, { mode: 0o700 });
    snapshot = {
      version: 1,
      group,
      ...(group === "admissions"
        ? { receipt_high_water: args["receipt-high-water"] }
        : {}),
      snapshot_id: randomUUID(),
      cutoff: args.cutoff,
      limit: requestedLimit ?? 2000,
      lanes: listing.lanes,
      definition_sha256: listing.definition_sha256,
      pages: {},
    };
  }
  if (requestedLimit !== undefined) snapshot.limit = requestedLimit;
  if (
    snapshot.definition_sha256 !== listing.definition_sha256 ||
    JSON.stringify(snapshot.lanes) !== JSON.stringify(listing.lanes)
  )
    throw new Error("resume lane inventory changed; start a new census");
  const save = async (name, bytes) => {
    const destination = path.join(args.directory, name);
    if (name === "checkpoint.json") {
      const temp = destination + ".tmp";
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, destination);
    } else {
      try {
        await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if (
          error.code !== "EEXIST" ||
          sha(await readFile(destination)) !== sha(bytes)
        )
          throw error;
      }
    }
  };
  const catalog = await call({ catalog: true });
  if (
    catalog.readonly !== true ||
    !/^[a-f0-9]{64}$/.test(catalog.schema_sha256 ?? "") ||
    !Array.isArray(catalog.foreign_keys) ||
    !Array.isArray(catalog.primary_keys)
  )
    throw new Error("schema catalogue unavailable");
  const catalogBytes = Buffer.from(JSON.stringify(catalog));
  if (!snapshot.catalog_sha256) {
    await save("catalog.json", catalogBytes);
    snapshot.catalog_sha256 = sha(catalogBytes);
    snapshot.schema_sha256 = catalog.schema_sha256;
  } else if (
    snapshot.catalog_sha256 !== sha(catalogBytes) ||
    snapshot.schema_sha256 !== catalog.schema_sha256 ||
    sha(await readFile(path.join(args.directory, "catalog.json"))) !==
      snapshot.catalog_sha256
  )
    throw new Error(
      "live or saved schema catalogue changed; start a new census",
    );
  await save("checkpoint.json", Buffer.from(JSON.stringify(snapshot)));
  const result = await collectCensus({
    snapshot,
    expectedLanes: listing.lanes,
    readSaved: (name) => readFile(path.join(args.directory, name)),
    invoke: (spec) => call({ export: spec }),
    download: async (key) => {
      const o = await s3.send(
        new GetObjectCommand({
          Bucket: "elixir-mcp-archive-999153317627",
          Key: key,
        }),
      );
      if (o.ContentLength > 5_000_000) {
        o.Body.destroy?.();
        throw new Error("oversized private census object");
      }
      return Buffer.from(await o.Body.transformToByteArray());
    },
    save,
    progress: (p) => {
      if (p.done || p.pages % 10 === 0) console.log(JSON.stringify(p));
    },
  });
  await save(
    "summary.json",
    Buffer.from(JSON.stringify(result, null, 2) + "\n"),
  );
  console.log(JSON.stringify(result));
}
