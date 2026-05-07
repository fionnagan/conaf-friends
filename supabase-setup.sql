-- Run this in your Supabase SQL editor to set up the i-feel submissions table.
-- Enable pgvector extension (for optional similarity search on user submissions)
create extension if not exists vector;

-- Submissions table
create table if not exists public.submissions (
  id               uuid        default gen_random_uuid() primary key,
  name             text        not null,
  country          text        not null,
  feeling_raw      text        not null,
  feeling_normalized text      not null,
  embedding        vector(313),          -- matches TF-IDF vocab size
  generated_image_url text,
  session_id       text,
  is_public        boolean     default true,
  created_at       timestamptz default now()
);

-- Indexes
create index if not exists submissions_created_at_idx on public.submissions (created_at desc);
create index if not exists submissions_country_idx     on public.submissions (country);
create index if not exists submissions_is_public_idx   on public.submissions (is_public);

-- Row-level security: allow anonymous inserts + public reads
alter table public.submissions enable row level security;

create policy "Anyone can insert" on public.submissions
  for insert with check (true);

create policy "Anyone can read public" on public.submissions
  for select using (is_public = true);

-- Enable realtime for live feed
alter publication supabase_realtime add table public.submissions;
