/**
 * deploy.mjs's command line, parsed before a single AWS call. Every flag
 * it knows is listed here and anything else refuses the run: until
 * 2026-09-25 an unknown flag was ignored, so `deploy.mjs --help` built,
 * uploaded and updated the production stack.
 */

export const DEPLOY_USAGE = `usage: AWS_PROFILE=cloud-engineer node infra/scripts/deploy.mjs [flags]

  (no flags)             update the production stack
  --create               first deploy (GATED)
  --skip-web             code and infrastructure only; no site sync
  --param=Key=Value      a one-time value for a PRESERVED parameter
  --acceptance           run the whole acceptance suite after the smoke
  --acceptance=<family>  run one family's acceptance cases (a,b for several)
  --help, -h             print this and exit; nothing is deployed`;

/** @param {string[]} argv process.argv.slice(2) */
export function parseDeployArgs(argv) {
  const out = {
    help: false,
    create: false,
    skipWeb: false,
    params: {},
    acceptance: false,
    acceptanceFamily: null,
    unknown: [],
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--create") out.create = true;
    else if (arg === "--skip-web") out.skipWeb = true;
    else if (arg === "--acceptance") out.acceptance = true;
    else if (/^--acceptance=[\w,-]+$/.test(arg)) {
      out.acceptance = true;
      out.acceptanceFamily = arg.slice("--acceptance=".length);
    } else if (/^--param=[A-Za-z0-9]+=/.test(arg)) {
      const [key, ...rest] = arg.slice("--param=".length).split("=");
      out.params[key] = rest.join("=");
    } else out.unknown.push(arg);
  }
  return out;
}
