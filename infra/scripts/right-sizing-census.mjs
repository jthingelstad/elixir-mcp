/** Download cutoff-bound census pages into a private, resumable directory.
 * This invokes only the read-only census and never reads credentials. */
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, stat, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const sha = (b) => createHash("sha256").update(b).digest("hex");

export async function collectCensus({
  snapshot,
  invoke,
  download,
  save,
  progress = () => {},
}) {
  for (const lane of snapshot.lanes) {
    snapshot.pages[lane] ??= [];
    const receipts = snapshot.pages[lane];
    if (receipts.at(-1)?.done) continue;
    let after = receipts.at(-1)?.next_after ?? null;
    const seen = new Set(receipts.map((r) => r.next_after).filter(Boolean));
    for (;;) {
      const r = await invoke({
        lane,
        snapshot_id: snapshot.snapshot_id,
        cutoff: snapshot.cutoff,
        after,
        limit: snapshot.limit,
      });
      if (
        r.readonly !== true ||
        r.snapshot_id !== snapshot.snapshot_id ||
        r.lane !== lane ||
        r.cutoff !== snapshot.cutoff ||
        !/^[a-f0-9]{64}$/.test(r.sha256 ?? "") ||
        r.key !==
          `right-sizing/v1/${snapshot.snapshot_id}/${lane}/${r.sha256}.json` ||
        !Number.isInteger(r.rows) ||
        r.rows < 0 ||
        r.rows > snapshot.limit ||
        r.done !== (r.next_after === null)
      )
        throw new Error("invalid census receipt");
      if (
        !r.done &&
        (typeof r.next_after !== "string" || seen.has(r.next_after))
      )
        throw new Error("census cursor repeated or missing");
      const bytes = await download(r.key);
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
        page.after !== after ||
        page.next_after !== r.next_after ||
        !Array.isArray(page.rows) ||
        page.rows.length !== r.rows
      )
        throw new Error("census page differs from receipt");
      // Save verified data before its checkpoint. A crash can safely reread it.
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
    complete: true,
    lanes: Object.fromEntries(
      snapshot.lanes.map((lane) => [
        lane,
        {
          pages: snapshot.pages[lane].length,
          rows: snapshot.pages[lane].reduce((n, p) => n + p.rows, 0),
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
        !["--directory", "--cutoff", "--resume"].includes(x.slice(0, i))
      )
        throw new Error("unknown census argument");
      return [x.slice(2, i), x.slice(i + 1)];
    }),
  );
  if (!path.isAbsolute(args.directory ?? ""))
    throw new Error("census needs an absolute private directory");
  const options = { region: "us-east-1" };
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
        Payload: Buffer.from(JSON.stringify({ right_sizing_census: spec })),
      }),
    );
    const p = JSON.parse(Buffer.from(r.Payload).toString("utf8"));
    if (r.FunctionError || p.error)
      throw new Error("read-only census invocation failed");
    return p;
  };
  let snapshot;
  if (args.resume === "true") {
    const dir = await stat(args.directory);
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
    // Every previously saved page must still match its private receipt.
    for (const [lane, pages] of Object.entries(snapshot.pages))
      for (const p of pages) {
        const bytes = await readFile(
          path.join(args.directory, `${lane}-${p.sha256}.json`),
        );
        if (sha(bytes) !== p.sha256)
          throw new Error("saved census page differs");
      }
  } else {
    if (
      args.resume !== undefined ||
      !Number.isFinite(Date.parse(args.cutoff)) ||
      new Date(args.cutoff).toISOString() !== args.cutoff ||
      Date.parse(args.cutoff) > Date.now()
    )
      throw new Error("census needs a canonical past cutoff");
    const listing = await call({});
    if (
      listing.readonly !== true ||
      !Array.isArray(listing.lanes) ||
      listing.lanes.some((n) => !/^[a-z][a-z0-9_]*$/.test(n))
    )
      throw new Error("invalid lane inventory");
    await mkdir(args.directory, { mode: 0o700 });
    snapshot = {
      version: 1,
      snapshot_id: randomUUID(),
      cutoff: args.cutoff,
      limit: 10000,
      lanes: listing.lanes,
      pages: {},
    };
  }
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
  if (!snapshot.catalog_sha256) {
    const catalog = await call({ catalog: true });
    if (
      catalog.readonly !== true ||
      !Array.isArray(catalog.foreign_keys) ||
      !Array.isArray(catalog.primary_keys)
    )
      throw new Error("schema catalogue unavailable");
    const bytes = Buffer.from(JSON.stringify(catalog));
    await save("catalog.json", bytes);
    snapshot.catalog_sha256 = sha(bytes);
  } else if (
    sha(await readFile(path.join(args.directory, "catalog.json"))) !==
    snapshot.catalog_sha256
  )
    throw new Error("saved schema catalogue differs");
  await save("checkpoint.json", Buffer.from(JSON.stringify(snapshot)));
  const result = await collectCensus({
    snapshot,
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
