# 2026-10-13 — Web connector egress avoids the unsupported AZ

The first production Web Functions update refused the existing PrivateSubnetB:
AWS reported `use1-az3 is not available for compute type WebFunction`. The
stack unwound before the native revision or CloudFront cutover. Migration 0226
remains applied and is additive.

Add a private /26 in physical zone `use1-az4` and attach it to the existing
private route table and S3 gateway endpoint. The native connector uses it and
PrivateSubnetA (`use1-az1`). The database subnet group and Event Function
subnets stay in place. The connector waits for its route associations and S3
endpoint. This is infrastructure only; the migration's full shared-transport
acceptance scope remains. MCP 11.13.0 and JSON API 3.2.0 unchanged.
