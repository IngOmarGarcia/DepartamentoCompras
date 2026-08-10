-- Roles y stubs que Supabase provee de fábrica. Necesarios para correr el
-- stack local (Postgres + PostgREST) sin la plataforma completa.

-- `auth.uid()` lo consumen las políticas RLS de db/03_rls.sql.
create schema if not exists auth;
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid;
$$;

-- Roles del modelo de Supabase.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

-- El rol con el que PostgREST se conecta y luego cambia de identidad.
create role authenticator login noinherit password 'authenticator_pwd';
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;

-- Todo lo que se cree después hereda estos permisos.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on functions to service_role;
alter default privileges in schema public grant all on sequences to service_role;
