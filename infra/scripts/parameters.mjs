/**
 * Stack parameter discipline — Drop's pattern, must-ported (AGENTS.md).
 *
 * CloudFormation SILENTLY RESETS every parameter you omit on update-stack
 * to its template Default. Hardcoding a literal here is the same bug in a
 * different shape: the value you deploy stops tracking what an operator
 * set out-of-band. So parameters split into:
 *
 *  - REQUIRED: computed fresh every deploy (code keys). Always sent.
 *  - PRESERVED: set at create or by hand, then carried with
 *    UsePreviousValue on every update so a deploy can never clobber them
 *    (cert ARNs land when DNS/ACM exists; the cost threshold is Jamie's).
 */

export const REQUIRED_PARAMETERS = [
  "CodeBucket",
  "WebApiCodeKey",
  "McpCodeKey",
  "SchedulerCodeKey",
  "IngestCodeKey",
  "EmailRelayCodeKey",
  "MigrateCodeKey",
  "JobsCodeKey",
];

export const PRESERVED_PARAMETERS = [
  "AppSecretName",
  "SiteCertificateArn",
  "MonthlyCostAlarmUsd",
  "SchedulerTickMinutes",
  // Replacement trigger: must never reset to default (see template).
  "DbSnapshotIdentifier",
];

/**
 * @param {Record<string,string>} required values for REQUIRED_PARAMETERS
 * @param {Record<string,string>} [initial] PRESERVED values (create only)
 */
export function buildParameters(required, initial = null, overrides = {}) {
  for (const key of REQUIRED_PARAMETERS) {
    if (required[key] === undefined)
      throw new Error(`missing required parameter: ${key}`);
  }
  const params = REQUIRED_PARAMETERS.map((key) => ({
    ParameterKey: key,
    ParameterValue: required[key],
  }));
  for (const key of PRESERVED_PARAMETERS) {
    if (overrides[key] !== undefined) {
      // Explicit one-time set (e.g. a parameter's FIRST deploy, where
      // UsePreviousValue has nothing to point at). Preserved as usual
      // on every later deploy.
      params.push({
        ParameterKey: key,
        ParameterValue: String(overrides[key]),
      });
      continue;
    }
    if (initial) {
      if (initial[key] !== undefined) {
        params.push({
          ParameterKey: key,
          ParameterValue: String(initial[key]),
        });
      }
      // Omitted at create: the template Default applies, once, visibly.
    } else {
      params.push({ ParameterKey: key, UsePreviousValue: true });
    }
  }
  return params;
}
