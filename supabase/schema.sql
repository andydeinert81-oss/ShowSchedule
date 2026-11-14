-- ShowSchedule database schema for Supabase (Postgres).
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: objects are created only if missing, and policies are replaced.

-- ───────────────────────── profiles & roles ─────────────────────────
-- One row per login. role: exhibitor (default), manager (can create and run shows), admin (everything).
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null default '',
  role         text not null default 'exhibitor' check (role in ('exhibitor','manager','admin')),
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Helper functions run with owner rights so policies can check roles without recursion.
create or replace function public.my_role() returns text
  language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.can_create_shows() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() in ('manager','admin'), false) $$;

-- New sign-ups get a profile. The very first account becomes admin; everyone after is an exhibitor.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin') then 'exhibitor' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop policy if exists "profiles: signed-in users read names" on public.profiles;
create policy "profiles: signed-in users read names" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles: edit own name, not own role" on public.profiles;
create policy "profiles: edit own name, not own role" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = public.my_role());

drop policy if exists "profiles: admins edit anyone" on public.profiles;
create policy "profiles: admins edit anyone" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ───────────────────────── series ─────────────────────────
create table if not exists public.series (
  id         text primary key,
  name       text not null,
  year       text,
  rules      jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.series enable row level security;

drop policy if exists "series: anyone reads" on public.series;
create policy "series: anyone reads" on public.series for select to anon, authenticated using (true);
drop policy if exists "series: managers create" on public.series;
create policy "series: managers create" on public.series for insert to authenticated with check (public.can_create_shows());
drop policy if exists "series: creator or admin edits" on public.series;
create policy "series: creator or admin edits" on public.series for update to authenticated
  using (created_by = auth.uid() or public.is_admin());
drop policy if exists "series: creator or admin deletes" on public.series;
create policy "series: creator or admin deletes" on public.series for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- ───────────────────────── shows ─────────────────────────
-- data holds the show's settings, class order, back numbers, ring state, placings and champions.
create table if not exists public.shows (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  managers   uuid[] not null default '{}',
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shows enable row level security;

drop policy if exists "shows: anyone reads" on public.shows;
create policy "shows: anyone reads" on public.shows for select to anon, authenticated using (true);
drop policy if exists "shows: managers create" on public.shows;
create policy "shows: managers create" on public.shows for insert to authenticated
  with check (public.can_create_shows() and auth.uid() = any(managers));
drop policy if exists "shows: its managers edit" on public.shows;
create policy "shows: its managers edit" on public.shows for update to authenticated
  using (auth.uid() = any(managers) or public.is_admin());
drop policy if exists "shows: its managers delete" on public.shows;
create policy "shows: its managers delete" on public.shows for delete to authenticated
  using (auth.uid() = any(managers) or public.is_admin());

-- Merge a partial change into a show's data in one step (row security still applies).
create or replace function public.update_show(p_id text, p_patch jsonb) returns jsonb
  language sql security invoker set search_path = public as
$$
  update public.shows set data = data || p_patch, updated_at = now()
  where id = p_id
  returning data
$$;

-- ───────────────────────── entries ─────────────────────────
-- One row per (show, family login) — or per paper entry, where doc_id starts with 'office-'.
create table if not exists public.entries (
  show_id    text not null references public.shows on delete cascade,
  doc_id     text not null,
  owner      uuid references auth.users on delete set null,
  exhibitors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (show_id, doc_id)
);
alter table public.entries enable row level security;

create or replace function public.is_show_manager(p_show text) returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.shows where id = p_show and auth.uid() = any(managers)) or public.is_admin() $$;

create or replace function public.entries_open(p_show text) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select (data->>'entriesOpen')::boolean from public.shows where id = p_show), false) $$;

drop policy if exists "entries: anyone reads" on public.entries;
create policy "entries: anyone reads" on public.entries for select to anon, authenticated using (true);

drop policy if exists "entries: families add their own while open" on public.entries;
create policy "entries: families add their own while open" on public.entries for insert to authenticated
  with check (owner = auth.uid() and doc_id = auth.uid()::text and public.entries_open(show_id));
drop policy if exists "entries: families change their own while open" on public.entries;
create policy "entries: families change their own while open" on public.entries for update to authenticated
  using (owner = auth.uid() and doc_id = auth.uid()::text and public.entries_open(show_id))
  with check (owner = auth.uid() and doc_id = auth.uid()::text);
drop policy if exists "entries: families withdraw while open" on public.entries;
create policy "entries: families withdraw while open" on public.entries for delete to authenticated
  using (owner = auth.uid() and doc_id = auth.uid()::text and public.entries_open(show_id));

drop policy if exists "entries: show managers do anything" on public.entries;
create policy "entries: show managers do anything" on public.entries for all to authenticated
  using (public.is_show_manager(show_id)) with check (public.is_show_manager(show_id));

-- ───────────────────────── barns (private) ─────────────────────────
create table if not exists public.barns (
  owner      uuid primary key references auth.users on delete cascade default auth.uid(),
  data       jsonb not null default '{"showmen":[],"animals":[]}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.barns enable row level security;

drop policy if exists "barns: owner only" on public.barns;
create policy "barns: owner only" on public.barns for all to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ───────────────────────── live updates ─────────────────────────
do $$
begin
  begin alter publication supabase_realtime add table public.shows;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.entries; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.series;  exception when duplicate_object then null; end;
end $$;
