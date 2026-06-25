-- M5: saves table — one row per user, whole state as jsonb blob.
-- Run this in the Supabase SQL Editor (or via `supabase db push`).

create table if not exists saves (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  state      jsonb  not null,
  version    bigint not null default 0,  -- matches state.syncVer, used for last-write-wins
  updated_at timestamptz default now()
);

-- Every row is owned by exactly one authenticated user.
alter table saves enable row level security;

-- Users can only read/write their own row.
create policy "own save" on saves
  for all
  using     (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Automatically keep updated_at fresh on upsert.
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists saves_updated_at on saves;
create trigger saves_updated_at
  before update on saves
  for each row execute procedure touch_updated_at();
