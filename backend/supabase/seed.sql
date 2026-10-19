-- Local development seed. Applied only by `supabase db reset` / local starts.
--
-- Two fixture identities without passwords: they cannot sign in, but they give
-- local tests and future note fixtures two distinct account owners.

insert into auth.users (
  id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'fixture-a@example.com', now(), now(), now(),
    '{"provider": "email", "providers": ["email"]}', '{}'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'fixture-b@example.com', now(), now(), now(),
    '{"provider": "email", "providers": ["email"]}', '{}'
  )
on conflict (id) do nothing;

insert into app.users (id, auth_user_id, email)
values
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '11111111-1111-4111-8111-111111111111',
    'fixture-a@example.com'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '22222222-2222-4222-8222-222222222222',
    'fixture-b@example.com'
  )
on conflict (auth_user_id) do nothing;
