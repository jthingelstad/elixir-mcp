-- Web-app collector provisioning (Jamie, 2026-09-06: "config
-- parameters and tokens would come from there, with the exception of
-- the CR token"). The owner mints the per-gateway IAM user + key via a
-- LOCAL script (the NAT-free VPC lambdas cannot reach the IAM API, and
-- no public lambda should hold IAM powers); the rendered .env lands in
-- provision_env for a ONE-TIME operator download from the website -
-- claimed = nulled, provision_claimed_at is the receipt.
alter table gateway add column iam_user_name text;
alter table gateway add column provision_env text;
alter table gateway add column provision_claimed_at timestamptz;
