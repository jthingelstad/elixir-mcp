-- 0132: the nightly shape census's memory (time-series review 2.7; the
-- rule is in docs/ENGINEERING.md under Ingest invariants). One row per
-- (endpoint, path) the census has ever seen in a sampled archived
-- payload, with when it was first and last seen: a manifest field
-- absent from every sample for seven days is "the API retired
-- something", and the census cannot know seven days without a memory.
-- Nothing on the ingest path reads or writes this.
create table payload_shape_seen (
  endpoint      text not null,
  path          text not null,
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,
  primary key (endpoint, path)
);
comment on table payload_shape_seen is
  'Field paths seen by the nightly {shape_census} in sampled archived payloads, per endpoint, in the manifest''s notation (services/ingest/src/payload-keys.mjs). Read and written by the jobs Lambda only.';
