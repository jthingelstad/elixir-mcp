-- 0184: what a collector says it runs, and every release the hub named.
--
-- Collector releases are signed, and naming verifies the signature
-- before it writes collector_release (name-collector-release.mjs), so a
-- collector_release row holds the signed SHA-256 of one platform's
-- binary. From the collector release that reports its build, every
-- door call carries x-collector-binary-sha256 (the running executable's
-- hash) and x-collector-release-key (the key fingerprints it trusts)
-- beside x-collector-version; the door stamps them on the gateway row
-- as it stamps the heartbeat. A collector runs a signed release when
-- its hash is the named hash for the version it reports.
--
-- collector_release keeps only the current release per platform, so a
-- collector one release behind would read as a mismatch the moment the
-- next is named. collector_release_history keeps every (platform,
-- version) the hub has named; the collector_release op writes both, and
-- this seeds it with what is named now. Hashes from before today were
-- never kept, so a collector still on an older release reads as
-- unverified or mismatch until it takes a named one.
--
-- Nullable columns with no default: catalog-only on gateway. Null means
-- the collector sent no header (an older client), which the pages say.

set local lock_timeout = '5s';

alter table gateway add column binary_sha256 text;
alter table gateway add column release_key_fingerprints text;

create table collector_release_history (
  platform   text not null,
  version    text not null,
  sha256     text not null,
  url        text not null,
  named_at   timestamptz not null default now(),
  primary key (platform, version)
);

create index collector_release_history_version_sha
  on collector_release_history (version, sha256);

insert into collector_release_history (platform, version, sha256, url, named_at)
select platform, version, sha256, url, updated_at
from collector_release
on conflict (platform, version) do nothing;
