-- 0001_init.sql
-- Private application schema, database roles, and the account table that links
-- Quick Note accounts to Supabase Auth users.
--
-- Local and staging apply this through the Supabase CLI:
--   supabase db push --db-url <owner connection string>
-- CI applies the same files with psql against a Postgres service container.

create schema if not exists app;

-- Roles ---------------------------------------------------------------------
-- qn_owner   : owns application objects (migrations run as the platform owner
--              role and then hand ownership over).
-- qn_runtime : the API's runtime role. It never owns objects, never bypasses
--              RLS, and only has the privileges granted below. Its password is
--              set out-of-band (backend/scripts/set_runtime_password.sh); no
--              password ever lives in a migration.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'qn_owner') then
    create role qn_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'qn_runtime') then
    create role qn_runtime login;
  end if;
end
$$;

-- The migration runner must be able to hand ownership to qn_owner.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute 'grant qn_owner to postgres';
  end if;
end
$$;

-- Keep the schema private: nothing for browser-facing roles or PUBLIC.
do $$
declare
  browser_role text;
begin
  foreach browser_role in array array['anon', 'authenticated', 'service_role']
  loop
    if exists (select 1 from pg_roles where rolname = browser_role) then
      execute format('revoke all on schema app from %I', browser_role);
      execute format('alter default privileges in schema app revoke all on tables from %I', browser_role);
      execute format('alter default privileges in schema app revoke all on functions from %I', browser_role);
    end if;
  end loop;
end
$$;

revoke all on schema app from public;
grant usage on schema app to qn_runtime;

-- The schema belongs to the application owner so that referential actions on
-- app tables (for example the auth.users -> app.users cascade) run with a role
-- that can actually reach the schema. Without this, deleting a Supabase Auth
-- user fails with "permission denied for schema app".
alter schema app owner to qn_owner;

-- updated_at helper ---------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Application objects belong to the application owner, and nothing in this
-- schema is callable by the browser-facing roles.
alter function app.touch_updated_at() owner to qn_owner;
revoke all on function app.touch_updated_at() from public;
grant execute on function app.touch_updated_at() to qn_runtime;

-- app.users -----------------------------------------------------------------
create table if not exists app.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app.users is 'Quick Note accounts: one row per Supabase Auth user.';
comment on column app.users.auth_user_id is 'auth.users.id; deletes cascade from Supabase Auth.';

create index if not exists users_email_idx on app.users (lower(email));

drop trigger if exists users_touch_updated_at on app.users;
create trigger users_touch_updated_at
  before update on app.users
  for each row
  execute function app.touch_updated_at();

-- Ownership and privileges --------------------------------------------------
alter table app.users owner to qn_owner;
grant select, insert, update, delete on app.users to qn_runtime;
