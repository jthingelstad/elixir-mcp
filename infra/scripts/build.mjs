#!/usr/bin/env node
/**
 * Bundle every Lambda with esbuild into infra/dist/<name>/ and zip it.
 * ESM output (nodejs24.x native) with the createRequire banner so CJS deps
 * like pg resolve; @aws-sdk/* stays external (provided by the runtime);
 * pg-native is an optional dep that must stay external. The migrate bundle
 * carries db/migrations alongside the code.
 */

import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');
const distRoot = path.join(repoRoot, 'infra/dist');

export const LAMBDAS = [
  { name: 'web-api', entry: 'services/web-api/src/index.mjs' },
  { name: 'mcp', entry: 'services/mcp/src/index.mjs' },
  { name: 'scheduler', entry: 'services/scheduler/src/index.mjs' },
  { name: 'ingest', entry: 'services/ingest/src/index.mjs' },
  { name: 'email-relay', entry: 'services/email-relay/src/index.mjs' },
  { name: 'migrate', entry: 'services/migrate/src/lambda.mjs' },
];

export async function buildAll() {
  await rm(distRoot, { recursive: true, force: true });
  const artifacts = [];
  for (const { name, entry } of LAMBDAS) {
    const outDir = path.join(distRoot, name);
    await mkdir(outDir, { recursive: true });
    await build({
      entryPoints: [path.join(repoRoot, entry)],
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      outfile: path.join(outDir, 'index.mjs'),
      external: ['@aws-sdk/*', 'pg-native'],
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      sourcemap: false,
      minify: false,
      logLevel: 'error',
    });
    if (name === 'migrate') {
      await cp(path.join(repoRoot, 'db/migrations'), path.join(outDir, 'migrations'), {
        recursive: true,
      });
    }
    const zipPath = path.join(distRoot, `${name}.zip`);
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: outDir });
    artifacts.push({ name, zipPath });
  }
  return artifacts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const artifacts = await buildAll();
  for (const a of artifacts) console.log(`built ${a.zipPath}`);
}
