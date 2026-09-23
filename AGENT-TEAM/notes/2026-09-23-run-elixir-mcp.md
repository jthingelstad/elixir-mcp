# Run Elixir MCP — durable AWS automation identity

## Failure and cause

The September 22-23 scheduled runs reached AWS through the human `jamie`
profile and stopped when that short-lived session expired. Otto already had a
Keychain-backed `cloud-engineer` source and assumed role, but the active project
instructions and deploy examples still selected `jamie` explicitly.

## Contract correction

All active Elixir MCP operator instructions and examples now select
`cloud-engineer`. The parent Projects instructions make that role the canonical
identity for authorized agent, scheduled, CLI, SDK, and local deployment work;
Jamie's profile is human-only. Historical notes remain unchanged.

The `durable-automation-aws-profile` decision case pins the behavior: a run uses
the authorized automation role after caller and deployment-readiness checks and
does not block on or request renewal of Jamie's profile.

## Verification and next evidence

The named and default profiles both resolved to
`assumed-role/ProjectsCloudEngineer/projects-cloud-engineer`. IAM simulation
allowed the role's IAM and CloudFormation deployment actions, the canonical
repository gate passed, and the production smoke passed through
`AWS_PROFILE=cloud-engineer` using read-only checks.

The next comparable natural evidence is the next scheduled Run Elixir MCP or
deployment path that needs AWS. It must complete its AWS reads or authorized
deployment without consulting `jamie`; until then, automation adoption is
verified mechanically and the natural sample is pending.
