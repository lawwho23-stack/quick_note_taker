-- 0003_extension_tokens_rls.sql
-- Make app.extension_tokens work with row-level security switched on.
--
-- 0002 left RLS off for this table: tokens are looked up by hash before any
-- account is known, so a per-account policy cannot apply. On staging, RLS was
-- later switched on (for example from the Supabase security advisor) with no
-- policy, which denies every row and broke "Connect".
--
-- Keep RLS on everywhere, so local, CI and Supabase behave the same, and allow
-- only the API's runtime role. Browser-facing roles (anon, authenticated) have
-- no policy here and no access to the app schema at all.

alter table app.extension_tokens enable row level security;

drop policy if exists extension_tokens_runtime on app.extension_tokens;
create policy extension_tokens_runtime on app.extension_tokens
  for all
  to qn_runtime
  using (true)
  with check (true);

-- app.users has the same weakness: if RLS were switched on without a policy,
-- sign-in could no longer create or read accounts. Give it the same treatment.
alter table app.users enable row level security;

drop policy if exists users_runtime on app.users;
create policy users_runtime on app.users
  for all
  to qn_runtime
  using (true)
  with check (true);
