#!/usr/bin/env bash
# Apply the Supabase migrations to a throwaway Postgres and check the schema
# guarantees the API depends on. Mirrors the migration steps of the CI "api"
# job, so it can be run before pushing instead of waiting for CI.
#
# Usage:
#   backend/scripts/check_migrations.sh              # postgres:17 (matches CI)
#   PG_IMAGE=postgres:16 backend/scripts/check_migrations.sh
set -euo pipefail

SUPABASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../supabase" && pwd)"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
CONTAINER="${MIGRATION_CHECK_CONTAINER:-qn-migration-check}"
PORT="${MIGRATION_CHECK_PORT:-55432}"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres"

say() { printf '%s\n' "$1"; }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

say "starting $PG_IMAGE"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres \
  -p "${PORT}:5432" "$PG_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

say "stubbing Supabase auth.users"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -c "create schema if not exists auth;" \
  -c "create table if not exists auth.users (id uuid primary key);"

say "applying migrations"
for migration in "$SUPABASE_DIR"/migrations/*.sql; do
  say "  -> $(basename "$migration")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done

say "re-applying migrations (they must be idempotent)"
for migration in "$SUPABASE_DIR"/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration" >/dev/null
done

say "checking schema guarantees"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111')
  on conflict do nothing;
insert into auth.users (id) values ('22222222-2222-4222-8222-222222222222')
  on conflict do nothing;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'qn_runtime') then
    raise exception 'qn_runtime role is missing';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'qn_owner') then
    raise exception 'qn_owner role is missing';
  end if;
  if (select rolcanlogin from pg_roles where rolname = 'qn_owner') then
    raise exception 'qn_owner must not be able to log in';
  end if;
  -- referential actions on app tables run as the table owner, so the owner
  -- must be able to reach the schema
  if not has_schema_privilege('qn_owner', 'app', 'usage') then
    raise exception 'qn_owner cannot reach the schema it owns objects in';
  end if;
  if has_schema_privilege('public', 'app', 'usage') then
    raise exception 'PUBLIC must not have usage on the app schema';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_schema_privilege('anon', 'app', 'usage') then
    raise exception 'anon must not have usage on the app schema';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_schema_privilege('authenticated', 'app', 'usage') then
    raise exception 'authenticated must not have usage on the app schema';
  end if;
end
$$;

-- the account upsert the API uses must be idempotent
do $$
declare first_id uuid; second_id uuid;
begin
  insert into app.users (auth_user_id, email)
    values ('11111111-1111-4111-8111-111111111111', 'ci@example.com')
    on conflict (auth_user_id) do update set email = excluded.email
    returning id into first_id;
  insert into app.users (auth_user_id, email)
    values ('11111111-1111-4111-8111-111111111111', 'ci@example.com')
    on conflict (auth_user_id) do update set email = excluded.email
    returning id into second_id;
  if first_id <> second_id then
    raise exception 'the account upsert created a second row';
  end if;
end
$$;

-- updated_at must move forward on update
do $$
declare before_ts timestamptz;
begin
  select updated_at into before_ts from app.users
    where auth_user_id = '11111111-1111-4111-8111-111111111111';
  perform pg_sleep(0.05);
  update app.users set email = 'ci@example.com'
    where auth_user_id = '11111111-1111-4111-8111-111111111111';
  if (select updated_at from app.users
        where auth_user_id = '11111111-1111-4111-8111-111111111111') <= before_ts then
    raise exception 'the updated_at trigger did not fire';
  end if;
end
$$;

-- the runtime role owns nothing, but can work the table
set role qn_runtime;
insert into app.users (auth_user_id, email)
  values ('22222222-2222-4222-8222-222222222222', 'runtime@example.com');
update app.users set email = 'runtime@example.com'
  where auth_user_id = '22222222-2222-4222-8222-222222222222';
delete from app.users
  where auth_user_id = '22222222-2222-4222-8222-222222222222';
reset role;

do $$
declare blocked boolean := false;
begin
  begin
    set local role qn_runtime;
    execute 'create table app.should_not_exist (id int)';
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'qn_runtime was able to create a table in app';
  end if;
end
$$;

-- deleting a Supabase Auth user must cascade to the application row
do $$
declare remaining int;
begin
  delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
  select count(*) into remaining from app.users
    where auth_user_id = '11111111-1111-4111-8111-111111111111';
  if remaining <> 0 then
    raise exception 'the auth.users delete did not cascade to app.users';
  end if;
end
$$;

select 'migration checks passed' as result;
SQL
