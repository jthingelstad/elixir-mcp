-- 0277: accounts can be followed, and every person account has a page id.
--
-- Jamie, 2026-11-15: "Accounts can be followed just like players... if
-- you follow an account you should see their passport stamps and any
-- other activity that comes from the account level, setting location is
-- one." An account page lives at /home/account/<id>, its passport at
-- /home/account/<id>/passport.
--
-- account_follow: one row per (follower, followed) pair of person
-- accounts. A follow of an account records nothing and takes no slot:
-- Elixir records players and clans, and an account's own events
-- (verifying a player, a Stamp, a place) are already Elixir's. Either
-- account removed takes the row with it.
--
-- The page id is the passport id (0269): random, opaque, never the
-- account UUID or account.public_id (the agents' URL segment). Until now
-- a passport row was made on a person's first session after launch, so
-- an account not seen since had none and could not be linked. The
-- insert below gives every approved person account its row, drawing the
-- twelve characters from the passport alphabet (32 letters and digits,
-- so a byte mod 32 is uniform). The table is small (one row per person);
-- re-running inserts nothing. A collision fails the deploy, which
-- retries with fresh draws.
--
-- vacuum after: account_passport
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table account_follow (
  account_id          uuid not null references account on delete cascade,
  followed_account_id uuid not null references account on delete cascade,
  created_at          timestamptz not null default now(),
  primary key (account_id, followed_account_id),
  check (account_id <> followed_account_id)
);

create index account_follow_followed on account_follow (followed_account_id);

comment on table account_follow is
  '0277: a person following another person''s account (Jamie, 2026-11-15). Records nothing, takes no slot; the follower''s timeline carries the followed account''s public events (a verified player, a Stamp, a place).';

insert into account_passport (account_id, passport_id)
select a.account_id,
       (select string_agg(
                 substr('abcdefghijkmnpqrstuvwxyz23456789',
                        get_byte(b.bytes, i) % 32 + 1, 1), '' order by i)
          from generate_series(0, 11) as i)
  from account a
  cross join lateral (
    select decode(md5(gen_random_uuid()::text || a.account_id::text), 'hex')
             as bytes) b
 where a.kind = 'person'
   and not exists (select 1 from account_passport p
                    where p.account_id = a.account_id);
