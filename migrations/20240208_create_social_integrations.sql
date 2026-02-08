-- Create social_integrations table for storing OAuth tokens
create table if not exists social_integrations (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  provider text not null check (provider in ('youtube', 'instagram', 'tiktok', 'twitch')),
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  profile_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, provider)
);

-- RLS Policies
alter table social_integrations enable row level security;

create policy "Users can view their own integrations"
  on social_integrations for select
  using (auth.uid() = user_id);

create policy "Users can insert their own integrations"
  on social_integrations for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own integrations"
  on social_integrations for update
  using (auth.uid() = user_id);

create policy "Users can delete their own integrations"
  on social_integrations for delete
  using (auth.uid() = user_id);
